// API Configuration
const API_BASE = '/api/traccar';

function mapRefreshMs() {
    return window.AltitudeHdMapRefresh?.getIntervalMs() ?? 10000;
}

let devices = [];
let positions = {};

let map = null;
let markersByDeviceId = new Map();
let mapInitialFitDone = false;
let pollTimer = null;

let historyLayer = null;
let customPinsLayer = null;
let historyDefaultsApplied = false;
let historySpeedChart = null;

const LS_CUSTOM_MAP_PINS = 'altitudeHdMainMapCustomPins_v1';
let customMapPins = [];

/** Default course markers (main map); seeded when no pins saved yet; draggable on map. */
const DEFAULT_MAIN_MAP_PINS = [
    { id: 'pin_default_start', name: 'start', lat: -37.943356, lng: 175.556788 },
    { id: 'pin_default_finish', name: 'finish', lat: -37.929223, lng: 175.542716 },
];

const MAX_ROUTE_POINTS_DRAW = 800;
let lastHistoryDeviceRoutes = null;

/** Recent GPS trace: keep samples ~2 min; colour by speed (same scale as history). */
const LIVE_TRAIL_TTL_MS = 2 * 60 * 1000;
const LIVE_TRAIL_DEDUPE_MOVE_M = 4;
const LIVE_TRAIL_DEDUPE_MS = 8000;

let liveTrailLayer = null;
const deviceLiveTrails = new Map();

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
    customPinsLayer = L.layerGroup().addTo(map);
    liveTrailLayer = L.layerGroup().addTo(map);

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

function populateSpeedRoutePinSelects() {
    const ids = ['speedRouteStartPin', 'speedRouteEndPin'];
    for (const selectId of ids) {
        const sel = document.getElementById(selectId);
        if (!sel) continue;
        const prev = sel.value;
        sel.innerHTML = '<option value="">(none)</option>';
        customMapPins.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`;
            sel.appendChild(opt);
        });
        if (prev && [...sel.options].some((o) => o.value === prev)) {
            sel.value = prev;
        }
    }
}

function getSpeedRouteGeoFromSelections() {
    const startId = document.getElementById('speedRouteStartPin')?.value;
    const endId = document.getElementById('speedRouteEndPin')?.value;
    if (!startId || !endId) return null;
    const s = customMapPins.find((p) => p.id === startId);
    const e = customMapPins.find((p) => p.id === endId);
    if (!s || !e) return null;
    return { sLat: s.lat, sLng: s.lng, eLat: e.lat, eLng: e.lng };
}

function speedMpsForColor(pos) {
    const s = typeof pos.speed === 'number' && !Number.isNaN(pos.speed) ? pos.speed : 0;
    return window.AltitudeHdSpeedColor.speedMpsForColor(s);
}

function speedToRainbowColor(speedMps) {
    return window.AltitudeHdSpeedColor.speedToRainbowColor(speedMps);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toR = (d) => (d * Math.PI) / 180;
    const dLat = toR(lat2 - lat1);
    const dLon = toR(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
            haversineMeters(last.lat, last.lng, pos.latitude, pos.longitude) < LIVE_TRAIL_DEDUPE_MOVE_M &&
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
            const color = speedToRainbowColor(speedMpsForColor({ speed: p.speed }));
            L.circleMarker([p.lat, p.lng], {
                radius: 4,
                weight: 1,
                color: 'rgba(0,0,0,0.32)',
                fillColor: color,
                fillOpacity: 0.82,
                interactive: false,
            }).addTo(liveTrailLayer);
        }
    }
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
        .sort((a, b) => positionTimeMs(a) - positionTimeMs(b));
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
    lastHistoryDeviceRoutes = null;
    const leg = document.getElementById('speedLegend');
    if (leg) leg.hidden = true;
    destroyHistoryChart();
}

function scheduleMapResize() {
    if (!map || typeof map.invalidateSize !== 'function') return;
    queueMicrotask(() => map.invalidateSize());
    requestAnimationFrame(() => map.invalidateSize());
    setTimeout(() => map.invalidateSize(), 400);
}

function loadCustomMapPins() {
    try {
        const raw = localStorage.getItem(LS_CUSTOM_MAP_PINS);
        if (!raw) {
            customMapPins = [];
            seedDefaultMainMapPinsIfEmpty();
            return;
        }
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) {
            customMapPins = [];
            seedDefaultMainMapPinsIfEmpty();
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
        seedDefaultMainMapPinsIfEmpty();
    } catch {
        customMapPins = [];
        seedDefaultMainMapPinsIfEmpty();
    }
}

function seedDefaultMainMapPinsIfEmpty() {
    if (customMapPins.length > 0) return;
    customMapPins = DEFAULT_MAIN_MAP_PINS.map((p) => ({ ...p }));
    saveCustomMapPins();
}

function saveCustomMapPins() {
    try {
        localStorage.setItem(LS_CUSTOM_MAP_PINS, JSON.stringify(customMapPins));
    } catch (e) {
        console.warn('Could not save custom markers', e);
    }
}

function setCustomMarkersStatus(text) {
    const el = document.getElementById('customMarkersStatus');
    if (el) el.textContent = text || '';
}

function syncCustomPinsToMap() {
    if (!customPinsLayer || !map) return;
    customPinsLayer.clearLayers();
    customMapPins.forEach((p) => {
        const marker = L.marker([p.lat, p.lng], { draggable: true }).addTo(customPinsLayer);
        marker.bindPopup(
            `<div class="map-popup-title">${escapeHtml(p.name)}</div>` +
                `<div><strong>Lat:</strong> ${p.lat.toFixed(6)}</div>` +
                `<div><strong>Lon:</strong> ${p.lng.toFixed(6)}</div>`,
            { maxWidth: 260 }
        );
        marker.on('dragend', () => {
            const ll = marker.getLatLng();
            p.lat = ll.lat;
            p.lng = ll.lng;
            saveCustomMapPins();
            renderCustomMarkersList();
            populateSpeedRoutePinSelects();
        });
    });
}

function renderCustomMarkersList() {
    const el = document.getElementById('customMarkersList');
    if (!el) return;
    if (customMapPins.length === 0) {
        el.innerHTML = '<p class="custom-markers-empty">No custom markers yet.</p>';
        return;
    }
    el.innerHTML =
        '<ul class="custom-markers-ul">' +
        customMapPins
            .map(
                (p) =>
                    `<li class="custom-markers-li">` +
                    `<span class="custom-markers-li-text">` +
                    `<span class="custom-markers-li-name">${escapeHtml(p.name)}</span>` +
                    `<span class="custom-markers-li-coords">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>` +
                    `</span>` +
                    `<button type="button" class="history-btn custom-markers-remove" data-remove-pin="${encodeURIComponent(
                        p.id
                    )}">Remove</button>` +
                    `</li>`
            )
            .join('') +
        '</ul>';
}

function addCustomMapPinFromForm() {
    const nameInput = document.getElementById('customMarkerName');
    const latInput = document.getElementById('customMarkerLat');
    const lngInput = document.getElementById('customMarkerLng');
    const name = ((nameInput && nameInput.value) || '').trim() || 'Unnamed';
    const lat = latInput ? parseFloat(latInput.value) : NaN;
    const lng = lngInput ? parseFloat(lngInput.value) : NaN;

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        setCustomMarkersStatus('Enter a valid latitude between −90 and 90.');
        return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        setCustomMarkersStatus('Enter a valid longitude between −180 and 180.');
        return;
    }

    const id = `pin_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    customMapPins.push({ id, name, lat, lng });
    saveCustomMapPins();
    syncCustomPinsToMap();
    renderCustomMarkersList();
    populateSpeedRoutePinSelects();
    if (latInput) latInput.value = '';
    if (lngInput) lngInput.value = '';
    setCustomMarkersStatus('Marker added.');
}

function wireCustomMarkersPanel() {
    const addBtn = document.getElementById('customMarkerAddBtn');
    if (addBtn && addBtn.dataset.bound !== '1') {
        addBtn.dataset.bound = '1';
        addBtn.addEventListener('click', () => {
            addCustomMapPinFromForm();
        });
    }

    const listEl = document.getElementById('customMarkersList');
    if (listEl && listEl.dataset.bound !== '1') {
        listEl.dataset.bound = '1';
        listEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-remove-pin]');
            if (!btn) return;
            const id = decodeURIComponent(btn.getAttribute('data-remove-pin') || '');
            const before = customMapPins.length;
            customMapPins = customMapPins.filter((p) => p.id !== id);
            if (customMapPins.length === before) return;
            saveCustomMapPins();
            syncCustomPinsToMap();
            renderCustomMarkersList();
            populateSpeedRoutePinSelects();
            setCustomMarkersStatus('Marker removed.');
        });
    }

    const details = document.getElementById('customMarkersDetails');
    if (details && details.dataset.resizeBound !== '1') {
        details.dataset.resizeBound = '1';
        details.addEventListener('toggle', () => scheduleMapResize());
    }

    const latEl = document.getElementById('customMarkerLat');
    const lngEl = document.getElementById('customMarkerLng');
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
    populateSpeedRoutePinSelects();
}

/** LayerGroup has no bringToFront in some Leaflet builds; fall back to per-layer. */
function bringHistoryRouteAboveTiles() {
    if (!historyLayer) return;
    if (typeof historyLayer.bringToFront === 'function') {
        historyLayer.bringToFront();
        return;
    }
    if (typeof historyLayer.eachLayer === 'function') {
        historyLayer.eachLayer((layer) => {
            if (layer && typeof layer.bringToFront === 'function') {
                layer.bringToFront();
            }
        });
    }
}

function colorForDeviceId(deviceId) {
    const golden = 137.508;
    const hue = (Number(deviceId) * golden) % 360;
    return `hsl(${hue}, 72%, 52%)`;
}

function destroyHistoryChart() {
    const canvas = document.getElementById('historySpeedChart');
    if (canvas && typeof Chart !== 'undefined' && typeof Chart.getChart === 'function') {
        const ch = Chart.getChart(canvas);
        if (ch) {
            ch.destroy();
        }
    }
    historySpeedChart = null;
    const dock = document.getElementById('historyChartDock');
    if (dock) {
        dock.setAttribute('hidden', '');
        dock.classList.remove('history-chart-dock--visible');
    }
    scheduleMapResize();
}

const MAX_CHART_POINTS_PER_DEVICE = 450;

/** Milliseconds for chart / ordering (Traccar may use ISO strings or epoch seconds). */
function positionTimeMs(p) {
    if (!p || typeof p !== 'object') return NaN;
    const raw = p.fixTime ?? p.deviceTime ?? p.serverTime;
    if (raw == null || raw === '') return NaN;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
    }
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : NaN;
}

function chartPointFromPosition(p) {
    const t = positionTimeMs(p);
    const rawSpeed = typeof p.speed === 'number' && !Number.isNaN(p.speed) ? p.speed : 0;
    const y = rawSpeed * 3.6;
    if (!Number.isFinite(t) || !Number.isFinite(y)) return null;
    return { x: t, y };
}

function replaceHistorySpeedCanvas() {
    const box = document.querySelector('#historyChartDock .history-chart-canvas-box');
    if (!box) return null;
    const old = document.getElementById('historySpeedChart');
    if (old && typeof Chart !== 'undefined' && typeof Chart.getChart === 'function') {
        const ch = Chart.getChart(old);
        if (ch) ch.destroy();
    }
    historySpeedChart = null;
    box.replaceChildren();
    const canvas = document.createElement('canvas');
    canvas.id = 'historySpeedChart';
    canvas.setAttribute('aria-label', 'Speed versus time chart');
    box.appendChild(canvas);
    return canvas;
}

function renderHistorySpeedChart(deviceRoutes) {
    const dock = document.getElementById('historyChartDock');
    if (!dock) {
        return false;
    }

    const chartCtor = typeof Chart !== 'undefined' ? Chart : typeof window !== 'undefined' ? window.Chart : undefined;
    if (typeof chartCtor !== 'function') {
        console.warn('Chart.js not loaded; speed chart skipped.');
        dock.setAttribute('hidden', '');
        dock.classList.remove('history-chart-dock--visible');
        return false;
    }

    destroyHistoryChart();

    const hasData = deviceRoutes.some((r) => r.points && r.points.length > 0);
    if (!hasData) {
        dock.setAttribute('hidden', '');
        dock.classList.remove('history-chart-dock--visible');
        return false;
    }

    const datasets = deviceRoutes
        .map(({ id, name, points }) => {
            const sorted = sortRoutePoints(points);
            const dec = decimateRoutePoints(sorted, MAX_CHART_POINTS_PER_DEVICE);
            const color = colorForDeviceId(id);
            const data = [];
            for (const p of dec) {
                const pt = chartPointFromPosition(p);
                if (pt) data.push(pt);
            }
            data.sort((a, b) => a.x - b.x);
            return {
                label: name || `Device ${id}`,
                data,
                borderColor: color,
                backgroundColor: color,
                fill: false,
                tension: 0.12,
                pointRadius: data.length <= 2 ? 4 : 0,
                pointHitRadius: 5,
                borderWidth: 2,
            };
        })
        .filter((ds) => ds.data.length > 0);

    if (datasets.length === 0) {
        dock.setAttribute('hidden', '');
        dock.classList.remove('history-chart-dock--visible');
        return false;
    }

    const canvas = replaceHistorySpeedCanvas();
    if (!canvas || !canvas.getContext('2d')) {
        dock.setAttribute('hidden', '');
        dock.classList.remove('history-chart-dock--visible');
        return false;
    }

    dock.removeAttribute('hidden');
    dock.classList.add('history-chart-dock--visible');
    void dock.offsetHeight;

    const chartOptions = {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
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
                    display: datasets.length > 1,
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
    };

    try {
        historySpeedChart = new chartCtor(canvas, chartOptions);
        queueMicrotask(() => {
            if (historySpeedChart) {
                historySpeedChart.resize();
            }
        });
        requestAnimationFrame(() => {
            if (historySpeedChart) {
                historySpeedChart.resize();
            }
        });
        scheduleMapResize();
        return true;
    } catch (err) {
        console.error('Chart create failed:', err);
        dock.setAttribute('hidden', '');
        dock.classList.remove('history-chart-dock--visible');
        scheduleMapResize();
        return false;
    }
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
                `<div><strong>Speed (colour scale):</strong> ${spd.toFixed(2)} m/s over ${window.AltitudeHdSpeedColor.getRange().minMps}–${window.AltitudeHdSpeedColor.getRange().maxMps} m/s</div>` +
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

    bringHistoryRouteAboveTiles();
    const legend = document.getElementById('speedLegend');
    if (legend) {
        legend.hidden = multi;
        if (!multi) window.AltitudeHdSpeedColor.updateSpeedLegend(legend);
    }

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
                const ts = window.AltitudeHdTrackerSource;
                if (ts) {
                    return ts.fetchRoute(deviceId, fromIso, toIso);
                }
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

        lastHistoryDeviceRoutes = deviceRoutes;
        renderHistoryRouteOnMap(deviceRoutes);
        const routeSummary = document.getElementById('historyStatus')?.textContent || '';
        const chartShown = renderHistorySpeedChart(deviceRoutes);

        let msg = routeSummary;
        if (typeof Chart === 'undefined') {
            msg = `${routeSummary} Chart.js did not load — check network or extensions; speed chart unavailable.`.trim();
        } else if (!chartShown && deviceRoutes.some((r) => r.points && r.points.length > 0)) {
            msg = `${routeSummary} Speed chart skipped (no valid time/speed points).`.trim();
        }
        if (errors.length) {
            msg = `Partial load — ${errors.join(' · ')}. ${msg}`.trim();
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

function applySpeedColorScaleFromInputs() {
    const minEl = document.getElementById('speedColorMinMps');
    const maxEl = document.getElementById('speedColorMaxMps');
    if (!minEl || !maxEl || !window.AltitudeHdSpeedColor) return;
    const ok = window.AltitudeHdSpeedColor.setRange(minEl.value, maxEl.value);
    if (!ok) {
        const cur = window.AltitudeHdSpeedColor.getRange();
        minEl.value = String(cur.minMps);
        maxEl.value = String(cur.maxMps);
    }
}

function wireSpeedColorScaleControls() {
    const minEl = document.getElementById('speedColorMinMps');
    const maxEl = document.getElementById('speedColorMaxMps');
    if (!minEl || !maxEl || !window.AltitudeHdSpeedColor) return;

    const cur = window.AltitudeHdSpeedColor.getRange();
    minEl.value = String(cur.minMps);
    maxEl.value = String(cur.maxMps);
    window.AltitudeHdSpeedColor.updateSpeedLegend(document.getElementById('speedLegend'));

    const onInput = () => applySpeedColorScaleFromInputs();
    minEl.addEventListener('change', onInput);
    maxEl.addEventListener('change', onInput);
}

function onSpeedColorScaleChanged() {
    const cur = window.AltitudeHdSpeedColor?.getRange();
    const minEl = document.getElementById('speedColorMinMps');
    const maxEl = document.getElementById('speedColorMaxMps');
    if (cur && minEl && maxEl) {
        minEl.value = String(cur.minMps);
        maxEl.value = String(cur.maxMps);
    }
    window.AltitudeHdSpeedColor?.updateSpeedLegend(document.getElementById('speedLegend'));
    redrawLiveTrail();
    if (lastHistoryDeviceRoutes?.length) {
        renderHistoryRouteOnMap(lastHistoryDeviceRoutes);
    }
}

function persistSpeedVmixSettings(deviceId, geo) {
    try {
        const payload = { deviceId: String(deviceId) };
        if (geo) {
            payload.rsLat = geo.sLat;
            payload.rsLng = geo.sLng;
            payload.reLat = geo.eLat;
            payload.reLng = geo.eLng;
        }
        localStorage.setItem('altitudeHdSpeedVmix_v1', JSON.stringify(payload));
    } catch {
        /* ignore */
    }
}

function buildSpeedScreenUrl() {
    const id = document.getElementById('speedScreenDevice')?.value;
    if (!id) return null;
    const transparent = document.getElementById('speedTransparentBg')?.checked;
    const u = new URL('speed.html', window.location.href);
    u.searchParams.set('deviceId', id);
    if (transparent) {
        u.searchParams.set('transparent', '1');
    }
    const geo = getSpeedRouteGeoFromSelections();
    if (geo) {
        u.searchParams.set('rsLat', String(geo.sLat));
        u.searchParams.set('rsLng', String(geo.sLng));
        u.searchParams.set('reLat', String(geo.eLat));
        u.searchParams.set('reLng', String(geo.eLng));
    }
    persistSpeedVmixSettings(id, geo);
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

function wireMapFullscreenMain() {
    const chk = document.getElementById('mapFullscreenToggle');
    const exitBtn = document.getElementById('mapFullscreenExitBtn');
    const mobileExpand = document.getElementById('mapMobileExpandBtn');
    if (!chk || !exitBtn || chk.dataset.bound === '1') return;
    chk.dataset.bound = '1';
    const setFs = (on) => {
        document.body.classList.toggle('map-fullscreen-main', on);
        chk.checked = on;
        exitBtn.hidden = !on;
        scheduleMapResize();
    };
    chk.addEventListener('change', () => setFs(chk.checked));
    exitBtn.addEventListener('click', () => setFs(false));
    if (mobileExpand && mobileExpand.dataset.bound !== '1') {
        mobileExpand.dataset.bound = '1';
        mobileExpand.addEventListener('click', () => setFs(true));
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('map-fullscreen-main')) {
            setFs(false);
        }
    });
}

function applyLiveMapVmixEmbed() {
    if (new URLSearchParams(location.search).get('vmix') !== '1') return;
    document.body.classList.add('live-map-vmix');
    const chk = document.getElementById('mapFullscreenToggle');
    if (chk) {
        document.body.classList.add('map-fullscreen-main');
        chk.checked = true;
    }
    scheduleMapResize();
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initCustomMapPins();
    wireMapFullscreenMain();
    applyLiveMapVmixEmbed();
    wireLiveToggle();
    wireHistoryPanel();
    wireSpeedLauncher();
    wireSpeedColorScaleControls();
    window.addEventListener('altitudehd:speed-color-range', onSpeedColorScaleChanged);
    window.addEventListener('altitudehd:map-refresh-rate', () => {
        if (isLiveUpdatesEnabled()) startPolling();
    });
    initHistoryDateDefaultsIfNeeded();
    updateData();
    startPolling();
});

async function onTrackerSourceChanged() {
    await updateData();
    if (lastHistoryDeviceRoutes?.length) {
        await loadHistoryRoute();
    }
}

window.trackerSourcePageRefresh = onTrackerSourceChanged;
window.addEventListener('altitudehd:tracker-source', onTrackerSourceChanged);

function liveMapSnapshotFetch() {
    const ts = window.AltitudeHdTrackerSource;
    if (ts) return ts.fetchSnapshot();
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
        const result = await liveMapSnapshotFetch();
        if (!result.ok) {
            showError(result.error || `Request failed: ${result.status}`);
            return;
        }
        const data = result.data;

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
