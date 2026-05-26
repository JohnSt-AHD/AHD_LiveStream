/**
 * Themed safety fleet map — /api/traccar snapshot + geofences.
 * Theme via window.SafetyMapTheme (see safety-map-themes.js).
 */
const API_BASE = '/api/traccar';
const SAFETY_THEME = window.SafetyMapTheme || window.SafetyMapThemes?.rnz || {};
function mapRefreshMs() {
    return window.AltitudeHdMapRefresh?.getIntervalMs() ?? 10000;
}

const STOP_SPEED_MPS = 0.5;
const STOP_MIN_MS = 30 * 60 * 1000;
const MOVE_RESET_M = 35;
const LS_STOPPED = SAFETY_THEME.lsStopped || 'rnzRowsafeStoppedOutside';

/** Recent GPS trace on map: samples expire after ~2 min; fill colour from speed. */
const LIVE_TRAIL_TTL_MS = 2 * 60 * 1000;
const LIVE_TRAIL_DEDUPE_MOVE_M = 4;
const LIVE_TRAIL_DEDUPE_MS = 8000;
let liveTrailLayer = null;
const deviceLiveTrails = new Map();

/** On-water list: recent fix window and minimum speed (m/s) for “moving”. */
const ON_WATER_FIX_MAX_MIN = 30;

let devices = [];
let positions = {};
let geofences = [];
let groups = [];
let groupLookup = new Map();

let map = null;
const markersByDeviceId = new Map();
let mapInitialFitDone = false;
let pollTimer = null;
let demoAnimTimer = null;
let geofenceLayer = null;
let courseOverlayLayer = null;

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

function matchesThemeGeofenceName(name) {
    if (typeof SAFETY_THEME.matchGeofenceName === 'function') {
        return SAFETY_THEME.matchGeofenceName(name);
    }
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
    const named = list.filter((g) => g && matchesThemeGeofenceName(g.name));
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

function getOnWaterExcludeParts(allGeofences) {
    const matcher = SAFETY_THEME.onWaterExcludeGeofenceName;
    if (typeof matcher !== 'function') return null;
    const list = (Array.isArray(allGeofences) ? allGeofences : []).filter((g) => g && matcher(g.name));
    return boundaryPartsFromGeofences(list);
}

function getOnWaterBoundaryParts(boundaryParts) {
    const excludeParts = getOnWaterExcludeParts(geofences);
    if (excludeParts !== null) return excludeParts;
    return boundaryParts;
}

function onWaterBoundaryLabel() {
    return SAFETY_THEME.onWaterExcludeLabel || SAFETY_THEME.boundaryLabel || 'boundary';
}

function deviceOnWaterCrew(device) {
    if (!device) return { clubName: '', logoUrl: null };
    if (device.demoClubName) {
        return { clubName: device.demoClubName, logoUrl: device.demoLogoUrl || null };
    }
    return { clubName: '', logoUrl: null };
}

function countOnWaterBoats(boundaryParts) {
    const parts = getOnWaterBoundaryParts(boundaryParts);
    if (!parts || parts.length === 0) return 0;
    let n = 0;
    for (const d of devices) {
        const pos = positions[d.id];
        if (!pos || typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number') continue;
        if (Number.isNaN(pos.latitude) || Number.isNaN(pos.longitude)) continue;
        if (!isMovingRecently(pos, ON_WATER_FIX_MAX_MIN, STOP_SPEED_MPS)) continue;
        if (isInsideBoundaryParts(pos.latitude, pos.longitude, parts)) continue;
        n += 1;
    }
    return n;
}

function updateKriHubStatsFromUi(warningCount, onWaterCount) {
    if (!document.body?.classList.contains('kri-page')) return;
    const warnEl = document.getElementById('hubStatWarnings');
    const onWaterEl = document.getElementById('hubStatOnWater');
    if (onWaterEl) onWaterEl.textContent = `${onWaterCount} on water`;
    if (warnEl) {
        warnEl.textContent = `${warningCount} warning${warningCount === 1 ? '' : 's'}`;
        warnEl.dataset.level = warningCount > 0 ? 'alert' : '';
    }
}

function geofenceDrawStyle(g, isMatch) {
    if (typeof SAFETY_THEME.classifyGeofenceName === 'function') {
        const kind = SAFETY_THEME.classifyGeofenceName(g.name);
        if (kind === 'hidden') return null;
        if (kind === 'hazard') {
            const color = SAFETY_THEME.geofenceHazardColor || '#dc2626';
            const fill = SAFETY_THEME.geofenceHazardFill || '#ef4444';
            return { color, weight: 3, fillColor: fill, fillOpacity: 0.32 };
        }
        if (kind === 'marshal') {
            const color = SAFETY_THEME.geofenceMarshalColor || '#b45309';
            const fill = SAFETY_THEME.geofenceMarshalFill || '#fbbf24';
            return { color, weight: 3, fillColor: fill, fillOpacity: 0.28 };
        }
        if (kind === 'warmupline') {
            const color = SAFETY_THEME.geofenceWarmupLineColor || '#ea580c';
            const fill = SAFETY_THEME.geofenceWarmupLineFill || '#fb923c';
            return { color, weight: 3, fillColor: fill, fillOpacity: 0.22 };
        }
        if (kind === 'boundary' || isMatch) {
            const matchColor = SAFETY_THEME.geofenceMatchColor || '#0f766e';
            const matchFill = SAFETY_THEME.geofenceMatchFill || '#14b8a6';
            return { color: matchColor, weight: 3, fillColor: matchFill, fillOpacity: 0.18 };
        }
        return { color: '#64748b', weight: 2, fillColor: '#94a3b8', fillOpacity: 0.08 };
    }

    const matchColor = SAFETY_THEME.geofenceMatchColor || '#0f766e';
    const matchFill = SAFETY_THEME.geofenceMatchFill || '#14b8a6';
    return isMatch
        ? { color: matchColor, weight: 3, fillColor: matchFill, fillOpacity: 0.18 }
        : { color: '#64748b', weight: 2, fillColor: '#94a3b8', fillOpacity: 0.08 };
}

function drawGeofencesOnMap(allGeofences, matchedList) {
    if (!geofenceLayer || !map) return;
    geofenceLayer.clearLayers();
    const matchedIds = new Set(matchedList.map((g) => g.id));

    for (const g of Array.isArray(allGeofences) ? allGeofences : []) {
        const parsed = parseGeofenceArea(g && g.area);
        if (!parsed) continue;
        const isMatch = matchedIds.has(g.id);
        const style = geofenceDrawStyle(g, isMatch);
        if (!style) continue;
        const boundaryTag = SAFETY_THEME.boundaryPopup || 'Boundary';
        const kind =
            typeof SAFETY_THEME.classifyGeofenceName === 'function'
                ? SAFETY_THEME.classifyGeofenceName(g.name)
                : isMatch
                  ? 'boundary'
                  : 'other';
        const popupTag =
            kind === 'hazard'
                ? 'Hazard area'
                : kind === 'marshal'
                  ? 'Marshal zone'
                  : kind === 'warmupline'
                    ? 'Warm-up area'
                    : kind === 'boundary' || isMatch
                      ? boundaryTag
                      : 'Other';

        if (parsed.type === 'circle') {
            L.circle([parsed.lat, parsed.lon], {
                radius: parsed.radiusM,
                ...style,
            })
                .bindPopup(`<strong>${escapeHtml(g.name || 'Geofence')}</strong><br>${popupTag}`)
                .addTo(geofenceLayer);
        } else if (parsed.type === 'polygon') {
            L.polygon(parsed.ring, style)
                .bindPopup(`<strong>${escapeHtml(g.name || 'Geofence')}</strong><br>${popupTag}`)
                .addTo(geofenceLayer);
        } else if (parsed.type === 'line') {
            const lineColor =
                kind === 'hazard'
                    ? SAFETY_THEME.geofenceHazardColor || '#dc2626'
                    : kind === 'marshal'
                      ? SAFETY_THEME.geofenceMarshalColor || '#b45309'
                      : kind === 'warmupline'
                        ? SAFETY_THEME.geofenceWarmupLineColor || '#ea580c'
                        : '#64748b';
            const lineWeight =
                kind === 'hazard' || kind === 'marshal' || kind === 'warmupline' ? 3 : 2;
            const lineDash =
                kind === 'hazard' || kind === 'marshal' || kind === 'warmupline'
                    ? undefined
                    : '6 4';
            L.polyline(parsed.points, {
                color: lineColor,
                weight: lineWeight,
                dashArray: lineDash,
                opacity: 0.92,
            })
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
    const center = SAFETY_THEME.mapCenter || [-36.85, 174.76];
    const zoom = SAFETY_THEME.mapZoom || 5;
    map = L.map('map', {
        zoomControl: true,
        attributionControl: true,
    }).setView(center, zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    geofenceLayer = L.layerGroup().addTo(map);
    liveTrailLayer = L.layerGroup().addTo(map);

    if (SAFETY_THEME.enableCourseOverlay) {
        if (!map.getPane('kriCoursePane')) {
            map.createPane('kriCoursePane');
            map.getPane('kriCoursePane').style.zIndex = 420;
        }
        courseOverlayLayer = L.layerGroup([], { pane: 'kriCoursePane' }).addTo(map);
        if (window.KriRowingCourseOverlay) {
            window.KriRowingCourseOverlay.mount(map, courseOverlayLayer);
        }
    }

    setTimeout(() => map.invalidateSize(), 100);
    window.addEventListener('resize', () => {
        if (map) map.invalidateSize();
    });
}

function isLiveUpdatesEnabled() {
    const el = document.getElementById('liveUpdatesToggle');
    return el ? el.checked : true;
}

function isKriDemoMode() {
    return (
        SAFETY_THEME.enableDemoMode &&
        window.KriSafetyDemo &&
        typeof window.KriSafetyDemo.isEnabled === 'function' &&
        window.KriSafetyDemo.isEnabled()
    );
}

function stopDemoAnimation() {
    if (demoAnimTimer) {
        clearInterval(demoAnimTimer);
        demoAnimTimer = null;
    }
}

function applyDemoSnapshotToUi() {
    if (!window.KriSafetyDemo) return;
    window.KriSafetyDemo.setGeofences(geofences);
    window.KriSafetyDemo.tick(performance.now());
    const snap = window.KriSafetyDemo.getSnapshot();
    devices = snap.devices;
    positions = snap.positions;

    const { geofences: matched } = getMatchedGeofences(geofences);
    const parts = boundaryPartsFromGeofences(matched);
    const stoppedState = updateStoppedTracking(parts);

    lastFenceParts = parts;
    lastStoppedState = stoppedState;

    drawGeofencesOnMap(geofences, matched);
    renderFenceAndLists(parts, stoppedState);
    clearSnapshotError();
    renderFleetDevices();
    renderOnWaterBoats(parts);
    updateMapMarkers();
    deviceLiveTrails.clear();
    redrawLiveTrail();

    const ts = document.getElementById('lastUpdate');
    if (ts) ts.textContent = `Last updated: demo (${snap.phase.replace(/_/g, ' ')})`;
}

function startDemoAnimation() {
    stopDemoAnimation();
    if (!isKriDemoMode()) return;
    demoAnimTimer = setInterval(() => {
        if (!isKriDemoMode()) return;
        applyDemoSnapshotToUi();
    }, 200);
}

async function loadGeofencesSnapshot() {
    const result = await rowsafeSnapshotFetch();
    if (!result.ok) {
        showError(result.error || `Request failed: ${result.status}`);
        return false;
    }
    const data = result.data;
    geofences = Array.isArray(data.geofences) ? data.geofences : [];
    groups = Array.isArray(data.groups) ? data.groups : [];
    groupLookup = buildGroupLookup(groups);
    return true;
}

async function bootstrapMapData() {
    if (isKriDemoMode()) {
        stopPolling();
        const ok = await loadGeofencesSnapshot();
        if (!ok) return;
        window.KriSafetyDemo?.reset?.();
        applyDemoSnapshotToUi();
        startDemoAnimation();
        return;
    }
    stopDemoAnimation();
    await updateData();
    startPolling();
}

function startPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (isKriDemoMode()) return;
    if (!isLiveUpdatesEnabled()) return;
    pollTimer = setInterval(updateData, mapRefreshMs());
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    deviceLiveTrails.clear();
    redrawLiveTrail();
}

function wireLiveToggle() {
    const toggle = document.getElementById('liveUpdatesToggle');
    if (!toggle) return;
    toggle.addEventListener('change', () => {
        if (isKriDemoMode()) return;
        if (isLiveUpdatesEnabled()) {
            startPolling();
            updateData();
        } else {
            stopPolling();
        }
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

function isFixWithinMinutes(fixTime, maxMinutes) {
    const fixTimeDate = new Date(fixTime);
    if (Number.isNaN(fixTimeDate.getTime())) return false;
    const now = new Date();
    return (now - fixTimeDate) / (1000 * 60) <= maxMinutes;
}

/** Moving recently: fix age and speed at or above slow/stopped threshold. */
function isMovingRecently(pos, maxFixAgeMinutes, minSpeedMps) {
    if (!pos || !pos.fixTime) return false;
    if (!isFixWithinMinutes(pos.fixTime, maxFixAgeMinutes)) return false;
    if (typeof pos.speed !== 'number' || Number.isNaN(pos.speed)) return false;
    return pos.speed >= minSpeedMps;
}

function speedMpsForTrailColor(speed) {
    return window.AltitudeHdSpeedColor.speedMpsForColor(speed);
}

function trailSpeedToColor(speedMps) {
    return window.AltitudeHdSpeedColor.speedToRainbowColor(speedMps);
}

function recordLiveTrailSamples() {
    if (!isLiveUpdatesEnabled()) return;
    const now = Date.now();
    const deviceIdSet = new Set(devices.map((d) => d.id));

    for (const id of [...deviceLiveTrails.keys()]) {
        if (!deviceIdSet.has(id)) {
            deviceLiveTrails.delete(id);
            continue;
        }
        const pruned = deviceLiveTrails.get(id).filter((p) => now - p.addedAt <= LIVE_TRAIL_TTL_MS);
        if (pruned.length === 0) {
            deviceLiveTrails.delete(id);
        } else {
            deviceLiveTrails.set(id, pruned);
        }
    }

    for (const d of devices) {
        const pos = positions[d.id];
        if (
            !pos ||
            typeof pos.latitude !== 'number' ||
            typeof pos.longitude !== 'number' ||
            Number.isNaN(pos.latitude) ||
            Number.isNaN(pos.longitude) ||
            !isPositionRecent(pos.fixTime)
        ) {
            continue;
        }

        let arr = deviceLiveTrails.get(d.id);
        if (!arr) {
            arr = [];
            deviceLiveTrails.set(d.id, arr);
        }
        arr = arr.filter((p) => now - p.addedAt <= LIVE_TRAIL_TTL_MS);

        const last = arr[arr.length - 1];
        if (
            last &&
            haversineM(last.lat, last.lng, pos.latitude, pos.longitude) < LIVE_TRAIL_DEDUPE_MOVE_M &&
            now - last.addedAt < LIVE_TRAIL_DEDUPE_MS
        ) {
            deviceLiveTrails.set(d.id, arr);
            continue;
        }

        const spd = typeof pos.speed === 'number' && !Number.isNaN(pos.speed) ? pos.speed : 0;
        arr.push({ lat: pos.latitude, lng: pos.longitude, speed: spd, addedAt: now });
        deviceLiveTrails.set(d.id, arr);
    }
}

function redrawLiveTrail() {
    if (!liveTrailLayer || !map) return;
    liveTrailLayer.clearLayers();
    const now = Date.now();

    for (const arr of deviceLiveTrails.values()) {
        for (const p of arr) {
            if (now - p.addedAt > LIVE_TRAIL_TTL_MS) continue;
            const color = trailSpeedToColor(speedMpsForTrailColor(p.speed));
            L.circleMarker([p.lat, p.lng], {
                radius: 4,
                weight: 1,
                color: 'rgba(0,0,0,0.28)',
                fillColor: color,
                fillOpacity: 0.82,
                interactive: false,
            }).addTo(liveTrailLayer);
        }
    }
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
        let fill = critical ? '#fecaca' : online ? '#14b8a6' : '#94a3b8';
        let stroke = critical ? '#b91c1c' : online ? '#0f766e' : '#475569';
        if (isKriDemoMode()) {
            fill = '#60a5fa';
            stroke = '#1e40af';
        }
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
            if (SAFETY_THEME.warningsEmptyVisible) {
                warnBox.hidden = false;
                if (warnBox.tagName === 'DETAILS') warnBox.open = false;
                warnEl.innerHTML = `<p class="rnz-list-empty">${escapeHtml(SAFETY_THEME.warningsEmptyMessage || 'No active warnings.')}</p>`;
            } else {
                warnBox.hidden = true;
                warnEl.innerHTML = '';
            }
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
                        const boundary = SAFETY_THEME.boundaryLabel || 'boundary';
                        return `<li>${nameHtml} — ${escapeHtml(w.detail)} (outside ${escapeHtml(boundary)}).</li>`;
                    })
                    .join('') +
                '</ul>';
        }
    }

    if (document.body?.classList.contains('kri-page')) {
        updateKriHubStatsFromUi(warnings.length, countOnWaterBoats(parts));
    }
}

function renderCapsizeAlerts() {
    if (isKriDemoMode()) return;
    if (!SAFETY_THEME.enableCapsize || !window.AltitudeHdCapsizeAlarm) return;
    const listEl = document.getElementById('safetyCapsizeList');
    const alerts = window.AltitudeHdCapsizeAlarm.updateCapsizeAlerts(devices, positions);
    window.AltitudeHdCapsizeAlarm.renderCapsizePanel(listEl, alerts, () => {
        renderCapsizeAlerts();
    });
}

function rowsafeSnapshotFetch() {
    const bus = window.AltitudeHdTraccarSnapshot;
    if (bus) return bus.fetchSnapshot();
    return fetch(`${API_BASE}?action=snapshot`)
        .then(async (response) => {
            const data = await response.json().catch(() => ({}));
            return {
                ok: response.ok,
                status: response.status,
                data,
                error: response.ok ? null : data.error || `Request failed: ${response.status}`,
            };
        })
        .catch((err) => ({
            ok: false,
            status: 0,
            data: {},
            error: err.message || 'Network error',
        }));
}

async function updateData() {
    if (isKriDemoMode()) {
        applyDemoSnapshotToUi();
        return;
    }
    try {
        const result = await rowsafeSnapshotFetch();
        if (!result.ok) {
            showError(result.error || `Request failed: ${result.status}`);
            return;
        }
        const data = result.data;

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
        renderCapsizeAlerts();

        clearSnapshotError();
        renderFleetDevices();
        renderOnWaterBoats(parts);
        recordLiveTrailSamples();
        updateMapMarkers();
        redrawLiveTrail();
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

function renderOnWaterBoats(boundaryParts) {
    const el = document.getElementById('rnzOnWaterBoatsList');
    if (!el) return;

    const usesExclude = typeof SAFETY_THEME.onWaterExcludeGeofenceName === 'function';
    const parts = getOnWaterBoundaryParts(boundaryParts);
    const label = onWaterBoundaryLabel();

    if (usesExclude && (!parts || parts.length === 0)) {
        el.innerHTML =
            `<p class="rnz-list-empty">Define a ${escapeHtml(label)} geofence in Traccar to detect boats on the lake.</p>`;
        return;
    }

    if (!parts || parts.length === 0) {
        el.innerHTML =
            `<p class="rnz-list-empty">${escapeHtml(SAFETY_THEME.emptyBoundaryHint || 'Define geofences in Traccar to detect boats outside the boundary.')}</p>`;
        return;
    }

    const boats = [];
    for (const d of devices) {
        const pos = positions[d.id];
        if (!pos || typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number') continue;
        if (Number.isNaN(pos.latitude) || Number.isNaN(pos.longitude)) continue;
        if (!isMovingRecently(pos, ON_WATER_FIX_MAX_MIN, STOP_SPEED_MPS)) continue;
        if (isInsideBoundaryParts(pos.latitude, pos.longitude, parts)) continue;
        boats.push({ device: d, pos });
    }

    boats.sort((a, b) => String(a.device.name).localeCompare(String(b.device.name), undefined, { sensitivity: 'base' }));

    if (boats.length === 0) {
        el.innerHTML =
            `<p class="rnz-list-empty">No boats match right now (need last fix within 30 min, speed ≥ 0.5 m/s, outside ${escapeHtml(label)}).</p>`;
        return;
    }

    const placeholderLogo = 'assets/school-logos/placeholder-white.svg';

    el.innerHTML = boats
        .map(({ device, pos }) => {
            const kmh = (pos.speed * 3.6).toFixed(1);
            const fix = formatDateTime(pos.fixTime);
            const crew = deviceOnWaterCrew(device);
            const logoHtml = crew.logoUrl
                ? `<img class="rnz-onwater-logo" src="${escapeHtml(crew.logoUrl)}" alt="" loading="lazy">`
                : crew.clubName
                  ? `<img class="rnz-onwater-logo rnz-onwater-logo--placeholder" src="${placeholderLogo}" alt="">`
                  : '';
            const crewHtml = crew.clubName
                ? `<span class="rnz-onwater-crew">${escapeHtml(crew.clubName)}</span>`
                : '';
            return (
                `<button type="button" class="rnz-onwater-row device-name--fly" ` +
                `data-fly-lat="${pos.latitude}" data-fly-lng="${pos.longitude}" data-device-id="${device.id}" ` +
                `title="Show on map">` +
                `<span class="rnz-onwater-primary">` +
                `<span class="rnz-onwater-name">${escapeHtml(device.name)}</span>` +
                logoHtml +
                crewHtml +
                `</span>` +
                `<span class="rnz-onwater-meta">${kmh} km/h · last ${escapeHtml(fix)}</span>` +
                `</button>`
            );
        })
        .join('');
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

    const onWater = document.getElementById('rnzOnWaterBoatsList');
    if (onWater && onWater.dataset.rnzFlyBound !== '1') {
        onWater.dataset.rnzFlyBound = '1';
        onWater.addEventListener('click', handler);
    }

    const warnList = document.getElementById('rnzWarningsList');
    if (warnList && warnList.dataset.rnzFlyBound !== '1') {
        warnList.dataset.rnzFlyBound = '1';
        warnList.addEventListener('click', handler);
    }

    const capsizeList = document.getElementById('safetyCapsizeList');
    if (capsizeList && capsizeList.dataset.rnzFlyBound !== '1') {
        capsizeList.dataset.rnzFlyBound = '1';
        capsizeList.addEventListener('click', handler);
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
    const onWater = document.getElementById('rnzOnWaterBoatsList');
    if (onWater) {
        onWater.innerHTML = '';
    }
}

function updateRnzFullscreenLayoutVars() {
    const header = document.querySelector('.rnz-header');
    const footer = document.querySelector('.rnz-footer');
    const h = header ? Math.ceil(header.getBoundingClientRect().height) : 100;
    const f = footer ? Math.ceil(footer.getBoundingClientRect().height) : 52;
    document.documentElement.style.setProperty('--rnz-fs-header-h', `${h}px`);
    document.documentElement.style.setProperty('--rnz-fs-footer-h', `${f}px`);
}

function setRnzMapFullscreen(on) {
    document.body.classList.toggle('rnz-map-fullscreen', on);
    const exitBtn = document.getElementById('rnzMapFullscreenExitBtn');
    if (exitBtn) exitBtn.hidden = !on;
    if (on) updateRnzFullscreenLayoutVars();
    setTimeout(() => map && map.invalidateSize(), 80);
}

function wireRnzMapFullscreen() {
    const exitBtn = document.getElementById('rnzMapFullscreenExitBtn');
    const mapExpand = document.getElementById('rnzMapMobileExpandBtn');
    if (!exitBtn || exitBtn.dataset.bound === '1') return;
    exitBtn.dataset.bound = '1';
    exitBtn.addEventListener('click', () => setRnzMapFullscreen(false));
    if (mapExpand && mapExpand.dataset.bound !== '1') {
        mapExpand.dataset.bound = '1';
        mapExpand.addEventListener('click', () => setRnzMapFullscreen(true));
    }
    window.addEventListener('resize', () => {
        if (document.body.classList.contains('rnz-map-fullscreen')) {
            updateRnzFullscreenLayoutVars();
            setTimeout(() => map && map.invalidateSize(), 50);
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('rnz-map-fullscreen')) {
            setRnzMapFullscreen(false);
        }
    });
}

window.addEventListener('altitudehd:speed-color-range', () => {
    redrawLiveTrail();
});

window.addEventListener('altitudehd:map-refresh-rate', () => {
    if (isKriDemoMode()) return;
    if (isLiveUpdatesEnabled()) startPolling();
});

window.addEventListener('kri-demo-changed', () => {
    bootstrapMapData();
});

window.addEventListener('kri-race-updated', () => {
    if (isKriDemoMode()) applyDemoSnapshotToUi();
});

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    wireLiveToggle();
    wireFleetDockResize();
    wireRnzMapFullscreen();
    wireDeviceNameFlyTo();
    bootstrapMapData();
});
