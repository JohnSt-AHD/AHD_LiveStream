/**
 * RowSafe-themed map page — same /api/traccar snapshot as the main app.
 * Standalone script (no shared bundle).
 */
const API_BASE = '/api/traccar';
const REFRESH_INTERVAL = 10000;

let authToken = null;
let devices = [];
let positions = {};

let map = null;
const markersByDeviceId = new Map();
let mapInitialFitDone = false;
let pollTimer = null;

function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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

function mergeDevicesFromPositions(deviceList, positionsMap) {
    const list = Array.isArray(deviceList) ? deviceList.slice() : [];
    const seen = new Set(list.map((d) => d && d.id).filter((id) => id != null));

    for (const key of Object.keys(positionsMap)) {
        const id = Number(key);
        if (!Number.isFinite(id) || seen.has(id)) {
            continue;
        }
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
    const diffMs = now - fixTimeDate;
    return diffMs / (1000 * 60) < 5;
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
        const fill = online ? '#14b8a6' : '#94a3b8';
        const stroke = online ? '#0f766e' : '#475569';

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
            if (pos && pos.deviceId != null) {
                positions[pos.deviceId] = pos;
            }
        });

        devices = mergeDevicesFromPositions(rawDevices, positions);

        renderDevices();
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

function renderDevices() {
    const container = document.getElementById('devicesContainer');

    if (devices.length === 0) {
        container.innerHTML =
            '<div class="rnz-error">No devices or positions for this account. Check Vercel environment variables (Traccar credentials).</div>';
        return;
    }

    let html = '';

    devices.forEach((device) => {
        const position = positions[device.id];
        const isOnline = position && isPositionRecent(position.fixTime);
        const speedKmh = position ? (position.speed * 3.6).toFixed(1) : 'N/A';
        const latitude = position ? position.latitude.toFixed(6) : 'N/A';
        const longitude = position ? position.longitude.toFixed(6) : 'N/A';
        const course = position ? position.course.toFixed(0) : 'N/A';
        const altitude = position ? position.altitude.toFixed(1) : 'N/A';
        const fixTime = position ? formatDateTime(position.fixTime) : 'N/A';
        const address = position ? position.address || 'Unknown' : 'Unknown';

        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? 'Recent fix' : 'Stale fix';
        const speedClass = position && position.speed > 5 ? 'rnz-speed-warn' : '';

        html += `
            <div class="rnz-device-card">
                <div class="rnz-device-name">${escapeHtml(device.name)}</div>
                <div class="rnz-device-status ${statusClass}">${statusText}</div>
                <div class="rnz-device-info">
                    <div class="rnz-info-row">
                        <span class="rnz-info-label">Speed</span>
                        <span class="rnz-info-value ${speedClass}">${speedKmh} km/h</span>
                    </div>
                    <div class="rnz-info-row">
                        <span class="rnz-info-label">Latitude</span>
                        <span class="rnz-info-value">${latitude}°</span>
                    </div>
                    <div class="rnz-info-row">
                        <span class="rnz-info-label">Longitude</span>
                        <span class="rnz-info-value">${longitude}°</span>
                    </div>
                    <div class="rnz-info-row">
                        <span class="rnz-info-label">Course</span>
                        <span class="rnz-info-value">${course}°</span>
                    </div>
                    <div class="rnz-info-row">
                        <span class="rnz-info-label">Altitude</span>
                        <span class="rnz-info-value">${altitude} m</span>
                    </div>
                    <div class="rnz-info-row">
                        <span class="rnz-info-label">Last update</span>
                        <span class="rnz-info-value">${fixTime}</span>
                    </div>
                    <div class="rnz-info-row">
                        <span class="rnz-info-label">Location</span>
                        <span class="rnz-info-value">${escapeHtml(address)}</span>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function updateTimestamp() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const el = document.getElementById('lastUpdate');
    if (el) el.textContent = `Last updated: ${h}:${m}:${s}`;
}

function showError(message) {
    const container = document.getElementById('devicesContainer');
    container.innerHTML = `<div class="rnz-error">${escapeHtml(message)}</div>`;
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    wireLiveToggle();
    authenticate();
    startPolling();
});
