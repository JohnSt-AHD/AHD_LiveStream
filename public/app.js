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

let historyLayer = null;
let historyDefaultsApplied = false;
let historySpeedChart = null;

const SPEED_COLOR_MAX_MS = 20;
const MAX_ROUTE_POINTS_DRAW = 800;

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

    historyLayer = L.layerGroup().addTo(map);

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

function toLocalInputValue(d) {
    const pad = (n) => String(n).padStart(2, '0');
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const h = pad(d.getHours());
    const min = pad(d.getMinutes());
    return `${y}-${m}-${day}T${h}:${min}`;
}

function initHistoryDateDefaultsIfNeeded() {
    if (historyDefaultsApplied) return;
    const fromEl = document.getElementById('historyFrom');
    const toEl = document.getElementById('historyTo');
    if (!fromEl || !toEl) return;
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    fromEl.value = toLocalInputValue(start);
    toEl.value = toLocalInputValue(now);
    historyDefaultsApplied = true;
}

function populateDeviceSelect(selectId, placeholder) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
    devices.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = String(d.id);
        opt.textContent = d.name || `Device ${d.id}`;
        sel.appendChild(opt);
    });
    if (prev && [...sel.options].some((o) => o.value === prev)) {
        sel.value = prev;
    }
}

function populateHistoryDeviceSelect() {
    const sel = document.getElementById('historyDevice');
    if (!sel) return;
    const prev = new Set(Array.from(sel.selectedOptions || []).map((o) => o.value));
    sel.innerHTML = '';
    devices.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = String(d.id);
        opt.textContent = d.name || `Device ${d.id}`;
        if (prev.has(opt.value)) opt.selected = true;
        sel.appendChild(opt);
    });
}

function populateSpeedScreenDeviceSelect() {
    populateDeviceSelect('speedScreenDevice', 'Choose device…');
}

function speedMpsForColor(pos) {
    const s = typeof pos.speed === 'number' && !Number.isNaN(pos.speed) ? pos.speed : 0;
    return Math.min(SPEED_COLOR_MAX_MS, Math.max(0, s));
}

function speedToRainbowColor(speedMps) {
    const t = Math.min(1, Math.max(0, speedMps / SPEED_COLOR_MAX_MS));
    const hue = t * 300;
    return `hsl(${hue}, 88%, 52%)`;
}

function sortRoutePoints(points) {
    return points
        .filter(
            (p) =>
                p &&
                typeof p.latitude === 'number' &&
                typeof p.longitude === 'number' &&
                !Number.isNaN(p.latitude) &&
                !Number.isNaN(p.longitude)
        )
        .sort((a, b) => new Date(a.fixTime || a.deviceTime) - new Date(b.fixTime || b.deviceTime));
}

function decimateRoutePoints(points, max) {
    if (points.length <= max) return points;
    const step = Math.ceil(points.length / max);
    const out = [];
    for (let i = 0; i < points.length; i += step) {
        out.push(points[i]);
    }
    const last = points[points.length - 1];
    if (out[out.length - 1] !== last) {
        out.push(last);
    }
    return out;
}

function setHistoryStatus(text) {
    const el = document.getElementById('historyStatus');
    if (el) el.textContent = text || '';
}

function clearHistoryMap() {
    if (historyLayer) {
        historyLayer.clearLayers();
    }
    const leg = document.getElementById('speedLegend');
    if (leg) leg.hidden = true;
    destroyHistoryChart();
}

function colorForDeviceId(deviceId) {
    const golden = 137.508;
    const hue = (Number(deviceId) * golden) % 360;
    return `hsl(${hue}, 72%, 52%)`;
}

function destroyHistoryChart() {
    if (historySpeedChart) {
        historySpeedChart.destroy();
        historySpeedChart = null;
    }
    const wrap = document.getElementById('historyChartWrap');
    if (wrap) wrap.hidden = true;
}

const MAX_CHART_POINTS_PER_DEVICE = 450;

function renderHistorySpeedChart(deviceRoutes) {
    const wrap = document.getElementById('historyChartWrap');
    const canvas = document.getElementById('historySpeedChart');
    if (!wrap || !canvas || typeof Chart === 'undefined') {
        return;
    }

    destroyHistoryChart();

    const hasData = deviceRoutes.some((r) => r.points && r.points.length > 0);
    if (!hasData) {
        wrap.hidden = true;
        return;
    }

    wrap.hidden = false;

    const datasets = deviceRoutes.map(({ id, name, points }) => {
        const sorted = sortRoutePoints(points);
        const dec = decimateRoutePoints(sorted, MAX_CHART_POINTS_PER_DEVICE);
        const color = colorForDeviceId(id);
        return {
            label: name || `Device ${id}`,
            data: dec.map((p) => ({
                x: new Date(p.fixTime || p.deviceTime).getTime(),
                y: (typeof p.speed === 'number' && !Number.isNaN(p.speed) ? p.speed : 0) * 3.6,
            })),
            borderColor: color,
            backgroundColor: color,
            fill: false,
            tension: 0.12,
            pointRadius: 0,
            pointHitRadius: 5,
            borderWidth: 2,
        };
    });

    historySpeedChart = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            parsing: false,
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Time', color: '#9ad8ff' },
                    ticks: {
                        color: '#aaa',
                        maxTicksLimit: 8,
                        callback(value) {
                            const d = new Date(value);
                            return Number.isNaN(d.getTime())
                                ? ''
                                : d.toLocaleString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                  });
                        },
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' },
                },
                y: {
                    title: { display: true, text: 'Speed (km/h)', color: '#9ad8ff' },
                    ticks: { color: '#aaa' },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' },
                },
            },
            plugins: {
                legend: {
                    display: deviceRoutes.length > 1,
                    labels: { color: '#e0e0e0', boxWidth: 12 },
                },
                tooltip: {
                    callbacks: {
                        title(items) {
                            if (!items.length) return '';
                            const x = items[0].parsed.x;
                            const d = new Date(x);
                            return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
                        },
                        label(item) {
                            return `${item.dataset.label}: ${item.formattedValue} km/h`;
                        },
                    },
                },
            },
        },
    });
}

function formatDateTimeFull(dateString) {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) {
        return String(dateString);
    }
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

function renderHistoryRouteOnMap(deviceRoutes) {
    if (!historyLayer || !map) return;
    historyLayer.clearLayers();

    if (!Array.isArray(deviceRoutes) || deviceRoutes.length === 0) {
        setHistoryStatus('No devices to draw.');
        const leg = document.getElementById('speedLegend');
        if (leg) leg.hidden = true;
        destroyHistoryChart();
        return;
    }

    const multi = deviceRoutes.length > 1;
    const allBounds = [];
    const parts = [];

    for (const { id, name, points } of deviceRoutes) {
        const sorted = sortRoutePoints(points);
        if (sorted.length === 0) {
            parts.push(`${name || id}: 0 positions`);
            continue;
        }

        const decimated = decimateRoutePoints(sorted, MAX_ROUTE_POINTS_DRAW);
        const routeColor = colorForDeviceId(id);

        for (let i = 0; i < decimated.length; i++) {
            const p = decimated[i];
            const latlng = [p.latitude, p.longitude];
            allBounds.push(latlng);
            const spd = speedMpsForColor(p);
            const segmentColor = multi ? routeColor : speedToRainbowColor(spd);

            if (i > 0) {
                const prev = decimated[i - 1];
                L.polyline(
                    [
                        [prev.latitude, prev.longitude],
                        latlng,
                    ],
                    {
                        color: segmentColor,
                        weight: 4,
                        opacity: 0.88,
                        lineCap: 'round',
                        lineJoin: 'round',
                    }
                ).addTo(historyLayer);
            }

            const rawSpeed = typeof p.speed === 'number' && !Number.isNaN(p.speed) ? p.speed : 0;
            const kmh = rawSpeed * 3.6;
            const devLabel = multi ? `<div><strong>Device:</strong> ${escapeHtml(name || `Device ${id}`)}</div>` : '';
            const popup =
                `<div class="map-popup-title">History point</div>` +
                devLabel +
                `<div><strong>Speed (colour scale):</strong> ${spd.toFixed(2)} m/s over 0–${SPEED_COLOR_MAX_MS} m/s</div>` +
                `<div><strong>≈</strong> ${kmh.toFixed(1)} km/h (same factor as live panel)</div>` +
                `<div><strong>Time:</strong> ${escapeHtml(formatDateTimeFull(p.fixTime || p.deviceTime))}</div>`;

            const markerFill = multi ? routeColor : speedToRainbowColor(spd);

            L.circleMarker(latlng, {
                radius: 5,
                weight: 1,
                color: '#1a1a1a',
                fillColor: markerFill,
                fillOpacity: 0.95,
            })
                .bindPopup(popup, { maxWidth: 300 })
                .addTo(historyLayer);
        }

        let seg = `${name || id}: ${sorted.length} positions`;
        if (sorted.length > decimated.length) {
            seg += ` (map ${decimated.length})`;
        }
        parts.push(seg);
    }

    historyLayer.bringToFront();
    const legend = document.getElementById('speedLegend');
    if (legend) legend.hidden = multi;

    if (allBounds.length > 0) {
        map.fitBounds(L.latLngBounds(allBounds), { padding: [48, 48], maxZoom: 17 });
    }

    setHistoryStatus(parts.join(' · ') + '.');
}

async function loadHistoryRoute() {
    const sel = document.getElementById('historyDevice');
    const ids = Array.from(sel?.selectedOptions || [])
        .map((o) => o.value)
        .filter(Boolean);
    const fromLocal = document.getElementById('historyFrom')?.value;
    const toLocal = document.getElementById('historyTo')?.value;

    if (ids.length === 0) {
        setHistoryStatus('Select one or more devices (Ctrl/Cmd+click).');
        return;
    }
    if (!fromLocal || !toLocal) {
        setHistoryStatus('Set both From and To times.');
        return;
    }

    const fromIso = new Date(fromLocal).toISOString();
    const toIso = new Date(toLocal).toISOString();
    if (new Date(fromIso) >= new Date(toIso)) {
        setHistoryStatus('"To" must be after "From".');
        return;
    }

    setHistoryStatus('Loading routes…');
    destroyHistoryChart();

    try {
        const settled = await Promise.allSettled(
            ids.map(async (deviceId) => {
                const params = new URLSearchParams({
                    action: 'route',
                    deviceId: String(deviceId),
                    from: fromIso,
                    to: toIso,
                });
                const res = await fetch(`${API_BASE}?${params.toString()}`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const msg = data && data.error ? data.error : `Request failed (${res.status})`;
                    throw new Error(msg);
                }
                if (!Array.isArray(data)) {
                    throw new Error('Unexpected response from server.');
                }
                return data;
            })
        );

        const deviceRoutes = [];
        const errors = [];

        for (let i = 0; i < settled.length; i++) {
            const id = Number(ids[i]);
            const name = devices.find((d) => d.id === id)?.name || `Device ${id}`;
            const s = settled[i];
            if (s.status === 'fulfilled') {
                deviceRoutes.push({ id, name, points: s.value });
            } else {
                const reason = s.reason && s.reason.message ? s.reason.message : 'Failed';
                errors.push(`${name}: ${reason}`);
            }
        }

        if (deviceRoutes.length === 0) {
            setHistoryStatus(errors.length ? errors.join(' · ') : 'No routes loaded.');
            return;
        }

        renderHistoryRouteOnMap(deviceRoutes);
        const routeSummary = document.getElementById('historyStatus')?.textContent || '';
        renderHistorySpeedChart(deviceRoutes);

        let msg = routeSummary;
        if (errors.length) {
            msg = `Partial load — ${errors.join(' · ')}. ${routeSummary}`.trim();
        }
        setHistoryStatus(msg);
    } catch (error) {
        console.error('Route load error:', error);
        setHistoryStatus(error.message || 'Failed to load route.');
    }
}

function wireHistoryPanel() {
    document.getElementById('historyLoadBtn')?.addEventListener('click', () => loadHistoryRoute());
    document.getElementById('historyClearBtn')?.addEventListener('click', () => {
        clearHistoryMap();
        setHistoryStatus('Route cleared.');
    });
}

function buildSpeedScreenUrl() {
    const id = document.getElementById('speedScreenDevice')?.value;
    if (!id) return null;
    const x = document.getElementById('speedPosX')?.value ?? '72';
    const y = document.getElementById('speedPosY')?.value ?? '10';
    const w = document.getElementById('speedPosW')?.value ?? '28';
    const transparent = document.getElementById('speedTransparentBg')?.checked;
    const u = new URL('speed.html', window.location.href);
    u.searchParams.set('deviceId', id);
    u.searchParams.set('x', String(x));
    u.searchParams.set('y', String(y));
    u.searchParams.set('w', String(w));
    if (transparent) {
        u.searchParams.set('transparent', '1');
    }
    return u.toString();
}

function wireSpeedLauncher() {
    document.getElementById('openSpeedScreenBtn')?.addEventListener('click', () => {
        const url = buildSpeedScreenUrl();
        const status = document.getElementById('speedLauncherStatus');
        if (!url) {
            if (status) status.textContent = 'Choose a device first.';
            return;
        }
        if (status) status.textContent = '';
        window.open(url, '_blank', 'noopener,noreferrer');
    });

    document.getElementById('copySpeedLinkBtn')?.addEventListener('click', async () => {
        const url = buildSpeedScreenUrl();
        const status = document.getElementById('speedLauncherStatus');
        if (!url) {
            if (status) status.textContent = 'Choose a device first.';
            return;
        }
        try {
            await navigator.clipboard.writeText(url);
            if (status) {
                status.textContent = 'Link copied to clipboard.';
                setTimeout(() => {
                    if (status.textContent === 'Link copied to clipboard.') {
                        status.textContent = '';
                    }
                }, 2500);
            }
        } catch {
            window.prompt('Copy this URL:', url);
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
    wireHistoryPanel();
    wireSpeedLauncher();
    initHistoryDateDefaultsIfNeeded();
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

/**
 * If /api/devices is empty but we have positions, show those deviceIds so map/list still work.
 */
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
        const posList = Array.isArray(data.positions) ? data.positions : [];
        posList.forEach((pos) => {
            if (pos && pos.deviceId != null) {
                positions[pos.deviceId] = pos;
            }
        });

        devices = mergeDevicesFromPositions(rawDevices, positions);

        initHistoryDateDefaultsIfNeeded();
        populateHistoryDeviceSelect();
        populateSpeedScreenDeviceSelect();

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
            '<div class="error">No devices or positions for this account. Check Traccar user access and Vercel env credentials (TRACCAR_EMAIL / TRACCAR_PASSWORD).</div>';
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
