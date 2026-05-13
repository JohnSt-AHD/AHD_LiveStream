// API Configuration
const API_BASE = '/api/traccar';

const REFRESH_INTERVAL = 10000;

let authToken = null;
let devices = [];
let positions = {};

let map = null;
let markersByDeviceId = new Map();
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
    }).setView([20, 0], 2);

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
        const fill = online ? '#22e88a' : '#9aa7b8';
        const stroke = online ? '#047857' : '#4b5563';

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
            `<div class="map-popup-title">${escapeHtml(device.name)}</div>` +
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
        const bounds = L.latLngBounds(latlngs);
        map.fitBounds(bounds, { padding: [56, 56], maxZoom: 15 });
        mapInitialFitDone = true;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    wireLiveToggle();
    authenticate();
    startPolling();
});

async function authenticate() {
    try {
        const response = await fetch(`${API_BASE}?action=auth`);
        const session = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(session.error || `Authentication failed: ${response.status}`);
        }

        authToken = session.token || true;

        console.log('Authentication successful');
        updateData();
    } catch (error) {
        console.error('Authentication error:', error);
        showError('Failed to authenticate with Traccar server');
    }
}

async function fetchDevices() {
    try {
        const response = await fetch(`${API_BASE}?action=devices`);

        if (!response.ok) {
            throw new Error(`Failed to fetch devices: ${response.status}`);
        }

        devices = await response.json();
        return devices;
    } catch (error) {
        console.error('Error fetching devices:', error);
        return [];
    }
}

async function fetchPositions() {
    try {
        const response = await fetch(`${API_BASE}?action=positions`);

        if (!response.ok) {
            throw new Error(`Failed to fetch positions: ${response.status}`);
        }

        const positionsList = await response.json();
        positions = {};

        positionsList.forEach((pos) => {
            positions[pos.deviceId] = pos;
        });

        return positions;
    } catch (error) {
        console.error('Error fetching positions:', error);
        return {};
    }
}

async function updateData() {
    await Promise.all([fetchDevices(), fetchPositions()]);

    renderDevices();
    updateMapMarkers();
    updateTimestamp();

    if (map) {
        requestAnimationFrame(() => map.invalidateSize());
    }
}

function renderDevices() {
    const container = document.getElementById('devicesContainer');

    if (devices.length === 0) {
        container.innerHTML = '<div class="error">No devices found</div>';
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
        const statusText = isOnline ? 'ONLINE' : 'OFFLINE';
        const speedClass = position && position.speed > 5 ? 'speed-warning' : 'speed-normal';

        html += `
            <div class="device-card">
                <div class="device-name">${escapeHtml(device.name)}</div>
                <div class="device-status ${statusClass}">${statusText}</div>
                <div class="device-info">
                    <div class="info-row">
                        <span class="info-label">Speed:</span>
                        <span class="info-value ${speedClass}">${speedKmh} km/h</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Latitude:</span>
                        <span class="info-value">${latitude}°</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Longitude:</span>
                        <span class="info-value">${longitude}°</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Course:</span>
                        <span class="info-value">${course}°</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Altitude:</span>
                        <span class="info-value">${altitude} m</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Last Update:</span>
                        <span class="info-value">${fixTime}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Location:</span>
                        <span class="info-value" style="word-break: break-word;">${escapeHtml(address)}</span>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function isPositionRecent(fixTime) {
    const fixTimeDate = new Date(fixTime);
    const now = new Date();
    const diffMs = now - fixTimeDate;
    const diffMinutes = diffMs / (1000 * 60);
    return diffMinutes < 5;
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function updateTimestamp() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    document.getElementById('lastUpdate').textContent = `Last updated: ${hours}:${minutes}:${seconds}`;
}

function showError(message) {
    const container = document.getElementById('devicesContainer');
    container.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}
