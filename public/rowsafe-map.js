/**
 * RowSafe-themed map — /api/traccar snapshot + geofences.
 * RNZ boundary: geofences whose name matches Rowing NZ / RNZ / RowSafe (or all polygon/circle if none).
 */
const API_BASE = '/api/traccar';
const REFRESH_INTERVAL = 10000;

const STOP_SPEED_MPS = 0.5;
const STOP_MIN_MS = 30 * 60 * 1000;
const MOVE_RESET_M = 35;
const LS_STOPPED = 'rnzRowsafeStoppedOutside';

let authToken = null;
let devices = [];
let positions = {};
let geofences = [];
let groups = [];
let groupLookup = new Map();

let map = null;
const markersByDeviceId = new Map();
let mapInitialFitDone = false;
let pollTimer = null;
let geofenceLayer = null;

/** Latest boundary + stopped timer (for red alerts & map styling). */
let lastFenceParts = [];
let lastStoppedState = {};

function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function matchesRnzGeofenceName(name) {
    if (!name || typeof name !== 'string') return false;
    const n = name.toLowerCase();
    return (
        n.includes('rowing') ||
        n.includes('rnz') ||
        n.includes('rowsafe') ||
        n.includes('rowinghub') ||
        n.includes('new zealand') ||
        n.includes('row nz')
    );
}

function parseGeofenceArea(areaStr) {
    if (!areaStr || typeof areaStr !== 'string') return null;
    const s = areaStr.trim();

    const circleM = s.match(/CIRCLE\s*\(\s*([\d.-]+)\s+([\d.-]+)\s*,\s*([\d.]+)\s*\)/i);
    if (circleM) {
        return {
            type: 'circle',
            lat: parseFloat(circleM[1]),
            lon: parseFloat(circleM[2]),
            radiusM: parseFloat(circleM[3]),
        };
    }

    const polyM = s.match(/POLYGON\s*\(\s*\(\s*([^)]+)\)\s*\)/i);
    if (polyM) {
        const ring = [];
        const parts = polyM[1].split(',');
        for (const part of parts) {
            const bits = part.trim().split(/\s+/);
            if (bits.length >= 2) {
                const lat = parseFloat(bits[0]);
                const lon = parseFloat(bits[1]);
                if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
                    ring.push([lat, lon]);
                }
            }
        }
        if (ring.length >= 3) {
            return { type: 'polygon', ring };
        }
    }

    if (/^LINESTRING/i.test(s)) {
        const inner = s.replace(/^LINESTRING\s*\(\s*/i, '').replace(/\s*\)\s*$/i, '');
        const pts = [];
        inner.split(',').forEach((seg) => {
            const bits = seg.trim().split(/\s+/);
            if (bits.length >= 2) {
                const lat = parseFloat(bits[0]);
                const lon = parseFloat(bits[1]);
                if (!Number.isNaN(lat) && !Number.isNaN(lon)) pts.push([lat, lon]);
            }
        });
        if (pts.length >= 2) {
            return { type: 'line', points: pts };
        }
    }

    return null;
}

function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toR = (d) => (d * Math.PI) / 180;
    const dLat = toR(lat2 - lat1);
    const dLon = toR(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInPolygon(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const yi = ring[i][0];
        const xi = ring[i][1];
        const yj = ring[j][0];
        const xj = ring[j][1];
        const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

function isInsideBoundaryParts(lat, lon, parts) {
    for (const p of parts) {
        if (p.type === 'circle') {
            if (haversineM(lat, lon, p.lat, p.lon) <= p.radiusM + 1) return true;
        } else if (p.type === 'polygon') {
            if (pointInPolygon(lat, lon, p.ring)) return true;
        }
    }
    return false;
}

function getMatchedGeofences(all) {
    const list = Array.isArray(all) ? all : [];
    const named = list.filter((g) => g && matchesRnzGeofenceName(g.name));
    if (named.length > 0) return { geofences: named, mode: 'name' };
    const withArea = list.filter((g) => {
        const p = parseGeofenceArea(g && g.area);
        return p && (p.type === 'circle' || p.type === 'polygon');
    });
    return { geofences: withArea, mode: withArea.length ? 'all-shapes' : 'none' };
}

function boundaryPartsFromGeofences(list) {
    const parts = [];
    for (const g of list) {
        const parsed = parseGeofenceArea(g && g.area);
        if (!parsed) continue;
        if (parsed.type === 'circle' || parsed.type === 'polygon') {
            parts.push(parsed);
        }
    }
    return parts;
}

function drawGeofencesOnMap(allGeofences, matchedList) {
    if (!geofenceLayer || !map) return;
    geofenceLayer.clearLayers();
    const matchedIds = new Set(matchedList.map((g) => g.id));

    for (const g of Array.isArray(allGeofences) ? allGeofences : []) {
        const parsed = parseGeofenceArea(g && g.area);
        if (!parsed) continue;
        const isMatch = matchedIds.has(g.id);
        const style = isMatch
            ? { color: '#0f766e', weight: 3, fillColor: '#14b8a6', fillOpacity: 0.18 }
            : { color: '#64748b', weight: 2, fillColor: '#94a3b8', fillOpacity: 0.08 };

        if (parsed.type === 'circle') {
            L.circle([parsed.lat, parsed.lon], {
                radius: parsed.radiusM,
                ...style,
            })
                .bindPopup(`<strong>${escapeHtml(g.name || 'Geofence')}</strong><br>${isMatch ? 'RNZ boundary' : 'Other'}`)
                .addTo(geofenceLayer);
        } else if (parsed.type === 'polygon') {
            L.polygon(parsed.ring, style)
                .bindPopup(`<strong>${escapeHtml(g.name || 'Geofence')}</strong><br>${isMatch ? 'RNZ boundary' : 'Other'}`)
                .addTo(geofenceLayer);
        } else if (parsed.type === 'line') {
            L.polyline(parsed.points, { color: '#64748b', weight: 2, dashArray: '6 4', opacity: 0.85 })
                .bindPopup(`<strong>${escapeHtml(g.name || 'Geofence')}</strong> (line)`)
                .addTo(geofenceLayer);
        }
    }
}

function loadStoppedState() {
    try {
        return JSON.parse(localStorage.getItem(LS_STOPPED)) || {};
    } catch {
        return {};
    }
}

function saveStoppedState(obj) {
    try {
        localStorage.setItem(LS_STOPPED, JSON.stringify(obj));
    } catch {
        /* ignore */
    }
}

function updateStoppedTracking(parts) {
    const state = loadStoppedState();
    const now = Date.now();
    const deviceIds = new Set(devices.map((d) => d.id));
    const next = { ...state };

    for (const id of Object.keys(next)) {
        if (!deviceIds.has(Number(id))) delete next[id];
    }

    for (const d of devices) {
        const pos = positions[d.id];
        if (!pos || typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number') {
            delete next[d.id];
            continue;
        }
        const outside = parts.length > 0 ? !isInsideBoundaryParts(pos.latitude, pos.longitude, parts) : false;
        const slow = typeof pos.speed === 'number' && pos.speed < STOP_SPEED_MPS;

        if (!outside || !slow || parts.length === 0) {
            delete next[d.id];
            continue;
        }

        const prev = next[d.id];
        if (!prev) {
            next[d.id] = { t: now, lat: pos.latitude, lng: pos.longitude };
            continue;
        }

        if (haversineM(prev.lat, prev.lng, pos.latitude, pos.longitude) > MOVE_RESET_M) {
            next[d.id] = { t: now, lat: pos.latitude, lng: pos.longitude };
        }
    }

    saveStoppedState(next);
    return next;
}

/**
 * Outside RNZ boundary and (no fix for 30+ min OR slow outside 30+ min tracked).
 */
function isCriticalOutsideAlert(device, pos, parts, stoppedState) {
    if (!parts || parts.length === 0) return false;
    if (!pos || typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number') return false;
    if (isInsideBoundaryParts(pos.latitude, pos.longitude, parts)) return false;
    const fixMs = pos.fixTime ? new Date(pos.fixTime).getTime() : 0;
    const fixAgeMs = fixMs > 0 ? Date.now() - fixMs : Number.POSITIVE_INFINITY;
    const slow = typeof pos.speed === 'number' && pos.speed < STOP_SPEED_MPS;
    const st = stoppedState[device.id];
    const stationaryLong = slow && st && Date.now() - st.t >= STOP_MIN_MS;
    const offlineLong = fixAgeMs >= STOP_MIN_MS;
    return offlineLong || stationaryLong;
}

function initMap() {
    map = L.map('map', {
        zoomControl: true,
        attributionControl: true,
    }).setView([-36.85, 174.76], 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    geofenceLayer = L.layerGroup().addTo(map);

    setTimeout(() => map.invalidateSize(), 100);
    window.addEventListener('resize', () => {
        if (map) map.invalidateSize();
    });
}

function isLiveUpdatesEnabled() {
    const el = document.getElementById('liveUpdatesToggle');
    return el ? el.checked : true;
}

function startPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (!isLiveUpdatesEnabled()) return;
    pollTimer = setInterval(updateData, REFRESH_INTERVAL);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function wireLiveToggle() {
    const toggle = document.getElementById('liveUpdatesToggle');
    if (!toggle) return;
    toggle.addEventListener('change', () => {
        if (isLiveUpdatesEnabled()) {
            startPolling();
            updateData();
        } else {
            stopPolling();
        }
    });
}

function wireSidebarCollapse() {
    const btn = document.getElementById('rnzCollapseSidebar');
    const layout = document.getElementById('rnzLayout');
    if (!btn || !layout) return;
    btn.addEventListener('click', () => {
        const collapsed = layout.classList.toggle('rnz-sidebar-collapsed');
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.textContent = collapsed ? 'Show panel' : 'Hide panel';
        setTimeout(() => map && map.invalidateSize(), 320);
    });
}

function wireLeftCollapse() {
    const btn = document.getElementById('rnzCollapseLeft');
    const layout = document.getElementById('rnzLayout');
    if (!btn || !layout) return;
    btn.addEventListener('click', () => {
        const collapsed = layout.classList.toggle('rnz-left-collapsed');
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.textContent = collapsed ? 'Show warnings' : 'Hide warnings';
        setTimeout(() => map && map.invalidateSize(), 320);
    });
}

function wireFleetDockResize() {
    const dock = document.getElementById('rnzFleetDock');
    if (!dock || dock.dataset.rnzResizeBound === '1') return;
    dock.dataset.rnzResizeBound = '1';
    dock.addEventListener('toggle', () => {
        setTimeout(() => map && map.invalidateSize(), 80);
    });
}

function buildGroupLookup(groupList) {
    const map = new Map();
    for (const g of Array.isArray(groupList) ? groupList : []) {
        if (!g || g.id == null) continue;
        const id = Number(g.id);
        if (!Number.isFinite(id)) continue;
        const name =
            typeof g.name === 'string' && g.name.trim() ? g.name.trim() : `Group ${g.id}`;
        map.set(id, name);
    }
    return map;
}

function groupLabelForDevice(device) {
    const raw = device && (device.groupId ?? device.groupid);
    if (raw == null || raw === '') return '—';
    const id = Number(raw);
    if (!Number.isFinite(id)) return '—';
    if (groupLookup.has(id)) return groupLookup.get(id);
    return `Group #${id}`;
}

function mergeDevicesFromPositions(deviceList, positionsMap) {
    const list = Array.isArray(deviceList) ? deviceList.slice() : [];
    const seen = new Set(list.map((d) => d && d.id).filter((id) => id != null));

    for (const key of Object.keys(positionsMap)) {
        const id = Number(key);
        if (!Number.isFinite(id) || seen.has(id)) continue;
        const pos = positionsMap[id];
        let name = `Device ${id}`;
        if (pos && typeof pos.deviceName === 'string' && pos.deviceName.trim()) {
            name = pos.deviceName.trim();
        }
        list.push({ id, name });
        seen.add(id);
    }

    list.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
    return list;
}

function isPositionRecent(fixTime) {
    const fixTimeDate = new Date(fixTime);
    const now = new Date();
    return (now - fixTimeDate) / (1000 * 60) < 5;
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function updateMapMarkers() {
    if (!map) return;

    const latlngs = [];
    const seenIds = new Set();

    devices.forEach((device) => {
        const position = positions[device.id];
        if (
            !position ||
            typeof position.latitude !== 'number' ||
            typeof position.longitude !== 'number' ||
            Number.isNaN(position.latitude) ||
            Number.isNaN(position.longitude)
        ) {
            const existing = markersByDeviceId.get(device.id);
            if (existing) {
                existing.remove();
                markersByDeviceId.delete(device.id);
            }
            return;
        }

        seenIds.add(device.id);
        const latlng = [position.latitude, position.longitude];
        const online = isPositionRecent(position.fixTime);
        const critical = isCriticalOutsideAlert(device, position, lastFenceParts, lastStoppedState);
        const fill = critical ? '#fecaca' : online ? '#14b8a6' : '#94a3b8';
        const stroke = critical ? '#b91c1c' : online ? '#0f766e' : '#475569';
        const radius = critical ? 14 : 11;
        const weight = critical ? 3 : 2;

        let marker = markersByDeviceId.get(device.id);
        if (!marker) {
            marker = L.circleMarker(latlng, {
                radius,
                weight,
                color: stroke,
                fillColor: fill,
                fillOpacity: 0.92,
            }).addTo(map);
            markersByDeviceId.set(device.id, marker);
        } else {
            marker.setLatLng(latlng);
            marker.setStyle({ fillColor: fill, color: stroke, radius, weight });
        }

        const speedKmh = (position.speed * 3.6).toFixed(1);
        const fix = formatDateTime(position.fixTime);
        const addr = escapeHtml(position.address || 'Unknown');
        marker.bindPopup(
            `<div class="rnz-popup-title">${escapeHtml(device.name)}</div>` +
                `<div><strong>Speed:</strong> ${speedKmh} km/h</div>` +
                `<div><strong>Last fix:</strong> ${fix}</div>` +
                `<div><strong>Location:</strong> ${addr}</div>`,
            { maxWidth: 260 }
        );

        latlngs.push(latlng);
    });

    const orphanIds = [...markersByDeviceId.keys()].filter((id) => !seenIds.has(id));
    orphanIds.forEach((id) => {
        const marker = markersByDeviceId.get(id);
        if (marker) marker.remove();
        markersByDeviceId.delete(id);
    });

    if (latlngs.length > 0 && !mapInitialFitDone) {
        map.fitBounds(L.latLngBounds(latlngs), { padding: [48, 48], maxZoom: 15 });
        mapInitialFitDone = true;
    }
}

function renderFenceAndLists(parts, stoppedState) {
    const warnEl = document.getElementById('rnzWarningsList');
    const warnBox = document.getElementById('rnzWarningBox');

    const warnings = [];
    const now = Date.now();

    if (parts.length > 0) {
        for (const d of devices) {
            const pos = positions[d.id];
            if (!pos || typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number') continue;
            const inside = isInsideBoundaryParts(pos.latitude, pos.longitude, parts);
            if (!inside) {
                if (isCriticalOutsideAlert(d, pos, parts, stoppedState)) {
                    const fixMs = pos.fixTime ? new Date(pos.fixTime).getTime() : 0;
                    const fixAgeMs = fixMs > 0 ? now - fixMs : null;
                    const slow = typeof pos.speed === 'number' && pos.speed < STOP_SPEED_MPS;
                    const st = stoppedState[d.id];
                    let detail = 'No fix for 30+ min';
                    if (fixAgeMs != null && fixAgeMs < STOP_MIN_MS && slow && st) {
                        detail = `Stationary outside ~${Math.floor((now - st.t) / 60000)} min`;
                    } else if (fixAgeMs != null && fixAgeMs >= STOP_MIN_MS) {
                        detail = `Last fix ${Math.floor(fixAgeMs / 60000)} min ago`;
                    }
                    warnings.push({ device: d, pos, detail });
                }
            }
        }
    }

    if (warnEl && warnBox) {
        if (warnings.length === 0) {
            warnBox.hidden = true;
            warnEl.innerHTML = '';
        } else {
            warnBox.hidden = false;
            if (warnBox.tagName === 'DETAILS') warnBox.open = true;
            warnEl.innerHTML =
                '<ul class="rnz-alert-list rnz-alert-list--critical">' +
                warnings
                    .map((w) => {
                        const pos = w.pos;
                        const hasLoc =
                            pos &&
                            typeof pos.latitude === 'number' &&
                            typeof pos.longitude === 'number' &&
                            !Number.isNaN(pos.latitude) &&
                            !Number.isNaN(pos.longitude);
                        const nameHtml = hasLoc
                            ? `<button type="button" class="device-name--fly device-name--fly-inline" data-fly-lat="${pos.latitude}" data-fly-lng="${pos.longitude}" data-device-id="${w.device.id}" title="Show on map">${escapeHtml(w.device.name)}</button>`
                            : `<strong>${escapeHtml(w.device.name)}</strong>`;
                        return `<li>${nameHtml} — ${escapeHtml(w.detail)} (outside boundary).</li>`;
                    })
                    .join('') +
                '</ul>';
        }
    }
}

async function authenticate() {
    try {
        const response = await fetch(`${API_BASE}?action=auth`);
        const session = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(session.error || `Authentication failed: ${response.status}`);
        }

        authToken = session.token || true;
        updateData();
    } catch (error) {
        console.error('Authentication error:', error);
        showError('Failed to authenticate with the tracking server.');
    }
}

async function updateData() {
    try {
        const response = await fetch(`${API_BASE}?action=snapshot`);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            showError(data.error || `Request failed: ${response.status}`);
            return;
        }

        const rawDevices = Array.isArray(data.devices) ? data.devices : [];
        positions = {};
        (Array.isArray(data.positions) ? data.positions : []).forEach((pos) => {
            if (pos && pos.deviceId != null) positions[pos.deviceId] = pos;
        });

        geofences = Array.isArray(data.geofences) ? data.geofences : [];
        groups = Array.isArray(data.groups) ? data.groups : [];
        groupLookup = buildGroupLookup(groups);

        devices = mergeDevicesFromPositions(rawDevices, positions);

        const { geofences: matched, mode } = getMatchedGeofences(geofences);
        const parts = boundaryPartsFromGeofences(matched);
        const stoppedState = updateStoppedTracking(parts);

        lastFenceParts = parts;
        lastStoppedState = stoppedState;

        drawGeofencesOnMap(geofences, matched);
        renderFenceAndLists(parts, stoppedState);

        clearSnapshotError();
        renderFleetDevices();
        updateMapMarkers();
        updateTimestamp();

        if (map) {
            requestAnimationFrame(() => map.invalidateSize());
        }
    } catch (error) {
        console.error('Error loading snapshot:', error);
        showError(error.message || 'Failed to load device data');
    }
}

function renderFleetDevices() {
    const container = document.getElementById('rnzFleetDevicesList');
    if (!container) return;

    if (devices.length === 0) {
        container.innerHTML =
            '<div class="error rnz-fleet-dock-error">No devices or positions for this account. Check Vercel environment variables (Traccar credentials).</div>';
        return;
    }

    let html = '';

    devices.forEach((device) => {
        const position = positions[device.id];
        const isOnline = position && isPositionRecent(position.fixTime);
        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? 'Online' : 'Offline';
        const critical =
            position &&
            isCriticalOutsideAlert(device, position, lastFenceParts, lastStoppedState);
        const rowCriticalClass = critical ? ' rnz-fleet-row--critical' : '';
        const groupName = escapeHtml(groupLabelForDevice(device));
        const hasLoc =
            position &&
            typeof position.latitude === 'number' &&
            typeof position.longitude === 'number' &&
            !Number.isNaN(position.latitude) &&
            !Number.isNaN(position.longitude);
        const nameHtml = hasLoc
            ? `<button type="button" class="device-name device-name--fly rnz-fleet-name-btn" data-fly-lat="${position.latitude}" data-fly-lng="${position.longitude}" data-device-id="${device.id}" title="Show on map">${escapeHtml(device.name)}</button>`
            : `<span class="rnz-fleet-name">${escapeHtml(device.name)}</span>`;

        html += `
            <div class="rnz-fleet-row${rowCriticalClass}">
                <div class="rnz-fleet-row-top">
                    ${nameHtml}
                    <span class="device-status ${statusClass}">${statusText}</span>
                </div>
                <div class="rnz-fleet-meta">
                    <span class="rnz-fleet-group" title="Traccar group">Group: <strong>${groupName}</strong></span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function wireDeviceNameFlyTo() {
    const handler = (e) => {
        const btn = e.target.closest('.device-name--fly');
        if (!btn || !map) return;
        const lat = parseFloat(btn.dataset.flyLat);
        const lng = parseFloat(btn.dataset.flyLng);
        const id = Number(btn.dataset.deviceId);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const targetZoom = Math.max(map.getZoom(), 15);
        if (typeof map.flyTo === 'function') {
            map.flyTo([lat, lng], targetZoom, { duration: 0.65 });
        } else {
            map.setView([lat, lng], targetZoom);
        }
        const mk = markersByDeviceId.get(id);
        if (mk) {
            setTimeout(() => mk.openPopup(), 400);
        }
    };

    const fleet = document.getElementById('rnzFleetDevicesList');
    if (fleet && fleet.dataset.rnzFlyBound !== '1') {
        fleet.dataset.rnzFlyBound = '1';
        fleet.addEventListener('click', handler);
    }

    const warnList = document.getElementById('rnzWarningsList');
    if (warnList && warnList.dataset.rnzFlyBound !== '1') {
        warnList.dataset.rnzFlyBound = '1';
        warnList.addEventListener('click', handler);
    }
}

function updateTimestamp() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const el = document.getElementById('lastUpdate');
    if (el) el.textContent = `Last updated: ${h}:${m}:${s}`;
}

function clearSnapshotError() {
    const errEl = document.getElementById('rnzSnapshotError');
    if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
    }
}

function showError(message) {
    const errEl = document.getElementById('rnzSnapshotError');
    if (errEl) {
        errEl.hidden = false;
        errEl.textContent = message;
    }
    const fleet = document.getElementById('rnzFleetDevicesList');
    if (fleet) {
        fleet.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    wireLiveToggle();
    wireSidebarCollapse();
    wireLeftCollapse();
    wireFleetDockResize();
    wireDeviceNameFlyTo();
    authenticate();
    startPolling();
});
