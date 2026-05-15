/**
 * Beach Sprints NZ–themed fleet map — same /api/traccar snapshot as main map.
 * Custom markers use a separate localStorage key from index.html.
 */
const API_BASE = '/api/traccar';
const REFRESH_INTERVAL = 10000;

const LS_BEACH_PINS = 'altitudeHdBeachSprintsMapPins_v1';

let devices = [];
let positions = {};
let map = null;
const markersByDeviceId = new Map();
let mapInitialFitDone = false;
let pollTimer = null;
let customPinsLayer = null;
let customMapPins = [];

function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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

function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    customPinsLayer = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
    window.addEventListener('resize', () => {
        if (map) map.invalidateSize();
    });
}

function scheduleMapResize() {
    if (!map || typeof map.invalidateSize !== 'function') return;
    queueMicrotask(() => map.invalidateSize());
    requestAnimationFrame(() => map.invalidateSize());
    setTimeout(() => map.invalidateSize(), 400);
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

function loadCustomMapPins() {
    try {
        const raw = localStorage.getItem(LS_BEACH_PINS);
        if (!raw) {
            customMapPins = [];
            return;
        }
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) {
            customMapPins = [];
            return;
        }
        customMapPins = arr
            .filter(
                (p) =>
                    p &&
                    typeof p.id === 'string' &&
                    typeof p.name === 'string' &&
                    Number.isFinite(p.lat) &&
                    Number.isFinite(p.lng)
            )
            .map((p) => ({
                id: String(p.id),
                name: String(p.name).slice(0, 120),
                lat: Number(p.lat),
                lng: Number(p.lng),
            }))
            .filter((p) => p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180);
    } catch {
        customMapPins = [];
    }
}

function saveCustomMapPins() {
    try {
        localStorage.setItem(LS_BEACH_PINS, JSON.stringify(customMapPins));
    } catch (e) {
        console.warn('Could not save beach sprints markers', e);
    }
}

function setBspMarkersStatus(text) {
    const el = document.getElementById('bspCustomMarkersStatus');
    if (el) el.textContent = text || '';
}

function syncCustomPinsToMap() {
    if (!customPinsLayer || !map) return;
    customPinsLayer.clearLayers();
    customMapPins.forEach((p) => {
        const marker = L.marker([p.lat, p.lng]).addTo(customPinsLayer);
        marker.bindPopup(
            `<div style="font-weight:700">${escapeHtml(p.name)}</div>` +
                `<div><strong>Lat:</strong> ${p.lat.toFixed(6)}</div>` +
                `<div><strong>Lon:</strong> ${p.lng.toFixed(6)}</div>`,
            { maxWidth: 260 }
        );
    });
}

function renderCustomMarkersList() {
    const el = document.getElementById('bspCustomMarkersList');
    if (!el) return;
    if (customMapPins.length === 0) {
        el.innerHTML = '<p class="bsp-markers-empty">No custom markers yet.</p>';
        return;
    }
    el.innerHTML =
        '<ul class="bsp-markers-ul">' +
        customMapPins
            .map(
                (p) =>
                    `<li class="bsp-markers-li">` +
                    `<span>` +
                    `<span class="bsp-markers-li-name">${escapeHtml(p.name)}</span>` +
                    `<span class="bsp-markers-li-coords">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>` +
                    `</span>` +
                    `<button type="button" class="bsp-btn bsp-markers-remove" data-bsp-remove="${encodeURIComponent(
                        p.id
                    )}">Remove</button>` +
                    `</li>`
            )
            .join('') +
        '</ul>';
}

function addCustomMapPinFromForm() {
    const nameInput = document.getElementById('bspCustomMarkerName');
    const latInput = document.getElementById('bspCustomMarkerLat');
    const lngInput = document.getElementById('bspCustomMarkerLng');
    const name = ((nameInput && nameInput.value) || '').trim() || 'Unnamed';
    const lat = latInput ? parseFloat(latInput.value) : NaN;
    const lng = lngInput ? parseFloat(lngInput.value) : NaN;

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        setBspMarkersStatus('Enter a valid latitude between −90 and 90.');
        return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        setBspMarkersStatus('Enter a valid longitude between −180 and 180.');
        return;
    }

    const id = `bsp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    customMapPins.push({ id, name, lat, lng });
    saveCustomMapPins();
    syncCustomPinsToMap();
    renderCustomMarkersList();
    if (latInput) latInput.value = '';
    if (lngInput) lngInput.value = '';
    setBspMarkersStatus('Marker added.');
}

function wireCustomMarkersPanel() {
    const addBtn = document.getElementById('bspCustomMarkerAddBtn');
    if (addBtn && addBtn.dataset.bound !== '1') {
        addBtn.dataset.bound = '1';
        addBtn.addEventListener('click', () => addCustomMapPinFromForm());
    }

    const listEl = document.getElementById('bspCustomMarkersList');
    if (listEl && listEl.dataset.bound !== '1') {
        listEl.dataset.bound = '1';
        listEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-bsp-remove]');
            if (!btn) return;
            const id = decodeURIComponent(btn.getAttribute('data-bsp-remove') || '');
            const before = customMapPins.length;
            customMapPins = customMapPins.filter((p) => p.id !== id);
            if (customMapPins.length === before) return;
            saveCustomMapPins();
            syncCustomPinsToMap();
            renderCustomMarkersList();
            setBspMarkersStatus('Marker removed.');
        });
    }

    const details = document.getElementById('bspCustomMarkersDetails');
    if (details && details.dataset.resizeBound !== '1') {
        details.dataset.resizeBound = '1';
        details.addEventListener('toggle', () => scheduleMapResize());
    }

    const latEl = document.getElementById('bspCustomMarkerLat');
    const lngEl = document.getElementById('bspCustomMarkerLng');
    if (latEl && lngEl && latEl.dataset.enterBound !== '1') {
        latEl.dataset.enterBound = '1';
        lngEl.dataset.enterBound = '1';
        const onEnter = (e) => {
            if (e.key === 'Enter') addCustomMapPinFromForm();
        };
        latEl.addEventListener('keydown', onEnter);
        lngEl.addEventListener('keydown', onEnter);
    }
}

function initCustomMapPins() {
    loadCustomMapPins();
    syncCustomPinsToMap();
    renderCustomMarkersList();
    wireCustomMarkersPanel();
}

function isPositionRecent(fixTime) {
    const fixTimeDate = new Date(fixTime);
    const now = new Date();
    const diffMinutes = (now - fixTimeDate) / (1000 * 60);
    return diffMinutes < 5;
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return String(dateString);
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
        const fill = online ? '#2dd4bf' : '#64748b';
        const stroke = online ? '#0f766e' : '#334155';

        let marker = markersByDeviceId.get(device.id);
        if (!marker) {
            marker = L.circleMarker(latlng, {
                radius: 11,
                weight: 2,
                color: stroke,
                fillColor: fill,
                fillOpacity: 0.92,
            }).addTo(map);
            markersByDeviceId.set(device.id, marker);
        } else {
            marker.setLatLng(latlng);
            marker.setStyle({ fillColor: fill, color: stroke });
        }

        const speedKmh = (position.speed * 3.6).toFixed(1);
        const fix = formatDateTime(position.fixTime);
        const addr = escapeHtml(position.address || 'Unknown');
        marker.bindPopup(
            `<div style="font-weight:700;font-size:14px">${escapeHtml(device.name)}</div>` +
                `<div><strong>Speed:</strong> ${speedKmh} km/h</div>` +
                `<div><strong>Last fix:</strong> ${fix}</div>` +
                `<div><strong>Location:</strong> ${addr}</div>`,
            { maxWidth: 260 }
        );

        latlngs.push(latlng);
    });

    [...markersByDeviceId.keys()].filter((id) => !seenIds.has(id)).forEach((id) => {
        markersByDeviceId.get(id)?.remove();
        markersByDeviceId.delete(id);
    });

    if (latlngs.length > 0 && !mapInitialFitDone) {
        map.fitBounds(L.latLngBounds(latlngs), { padding: [56, 56], maxZoom: 15 });
        mapInitialFitDone = true;
    }
}

function wireMapFullscreen() {
    const chk = document.getElementById('bspMapFullscreenToggle');
    const exitBtn = document.getElementById('bspMapFullscreenExitBtn');
    if (!chk || !exitBtn || chk.dataset.bound === '1') return;
    chk.dataset.bound = '1';
    const setFs = (on) => {
        document.body.classList.toggle('bsp-map-fullscreen', on);
        chk.checked = on;
        exitBtn.hidden = !on;
        scheduleMapResize();
    };
    chk.addEventListener('change', () => setFs(chk.checked));
    exitBtn.addEventListener('click', () => setFs(false));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('bsp-map-fullscreen')) {
            setFs(false);
        }
    });
}

function renderDevices() {
    const container = document.getElementById('bspDevicesContainer');
    if (!container) return;

    if (devices.length === 0) {
        container.innerHTML =
            '<div class="bsp-loading">No devices or positions for this account. Check Traccar access and server credentials.</div>';
        return;
    }

    let html = '';
    devices.forEach((device) => {
        const position = positions[device.id];
        const isOnline = position && isPositionRecent(position.fixTime);
        const speedKmh = position ? (position.speed * 3.6).toFixed(1) : 'N/A';
        const latitude = position ? position.latitude.toFixed(6) : 'N/A';
        const longitude = position ? position.longitude.toFixed(6) : 'N/A';
        const fixTime = position ? formatDateTime(position.fixTime) : 'N/A';
        const address = position ? position.address || 'Unknown' : 'Unknown';
        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? 'ONLINE' : 'OFFLINE';
        const speedClass = position && position.speed > 5 ? 'bsp-speed-warn' : '';

        html += `
            <div class="bsp-device-card" data-bsp-device-id="${device.id}">
                <div class="bsp-device-name">${escapeHtml(device.name)}</div>
                <div class="bsp-device-status ${statusClass}">${statusText}</div>
                <div class="bsp-info-row"><span class="bsp-info-label">Speed</span><span class="bsp-info-value ${speedClass}">${speedKmh} km/h</span></div>
                <div class="bsp-info-row"><span class="bsp-info-label">Lat</span><span class="bsp-info-value">${latitude}°</span></div>
                <div class="bsp-info-row"><span class="bsp-info-label">Lon</span><span class="bsp-info-value">${longitude}°</span></div>
                <div class="bsp-info-row"><span class="bsp-info-label">Last fix</span><span class="bsp-info-value">${fixTime}</span></div>
                <div class="bsp-info-row"><span class="bsp-info-label">Location</span><span class="bsp-info-value">${escapeHtml(address)}</span></div>
            </div>`;
    });
    container.innerHTML = html;
}

function wireDeviceCardFlyTo() {
    const container = document.getElementById('bspDevicesContainer');
    if (!container || container.dataset.flyBound === '1') return;
    container.dataset.flyBound = '1';
    container.addEventListener('click', (e) => {
        const card = e.target.closest('[data-bsp-device-id]');
        if (!card) return;
        const id = Number(card.getAttribute('data-bsp-device-id'));
        const pos = positions[id];
        if (!pos || typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number' || !map) return;
        map.flyTo([pos.latitude, pos.longitude], Math.max(map.getZoom(), 15), { duration: 0.6 });
    });
}

function updateTimestamp() {
    const now = new Date();
    const t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const el = document.getElementById('bspLastUpdate');
    if (el) el.textContent = `Last updated: ${t}`;
}

function showError(message) {
    const container = document.getElementById('bspDevicesContainer');
    if (container) {
        container.innerHTML = `<div class="bsp-loading" style="color:#fca5a5">${escapeHtml(message)}</div>`;
    }
}

async function authenticate() {
    try {
        const response = await fetch(`${API_BASE}?action=auth`);
        const session = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(session.error || `Authentication failed: ${response.status}`);
        }
        await updateData();
    } catch (error) {
        console.error('Beach sprints map auth error:', error);
        showError(error.message || 'Failed to authenticate with Traccar server');
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
        devices = mergeDevicesFromPositions(rawDevices, positions);

        renderDevices();
        wireDeviceCardFlyTo();
        updateMapMarkers();
        updateTimestamp();

        if (map) requestAnimationFrame(() => map.invalidateSize());
    } catch (error) {
        console.error('Beach sprints map snapshot error:', error);
        showError(error.message || 'Failed to load device data');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initCustomMapPins();
    wireMapFullscreen();
    wireLiveToggle();
    authenticate();
    startPolling();
});
