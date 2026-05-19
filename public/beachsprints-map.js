/**
 * Beach Sprints NZ–themed fleet map — same /api/traccar snapshot as main map.
 * Custom markers use a separate localStorage key from index.html.
 */
const API_BASE = '/api/traccar';
function mapRefreshMs() {
    return window.AltitudeHdMapRefresh?.getIntervalMs() ?? 10000;
}

const LS_BEACH_PINS = 'altitudeHdBeachSprintsMapPins_v1';
const LS_BEACH_BUOYS = 'altitudeHdBeachSprintsBuoys_v1';

const DEFAULT_BEACH_BUOYS = [
    { id: 'buoy_L1', label: 'L1', lat: -36.5922, lng: 174.7027 },
    { id: 'buoy_L2', label: 'L2', lat: -36.592, lng: 174.7035 },
    { id: 'buoy_L3', label: 'L3', lat: -36.5918, lng: 174.7045 },
    { id: 'buoy_R1', label: 'R1', lat: -36.5919, lng: 174.7026 },
    { id: 'buoy_R2', label: 'R2', lat: -36.5917, lng: 174.7035 },
    { id: 'buoy_R3', label: 'R3', lat: -36.5914, lng: 174.7043 },
];

let devices = [];
let positions = {};
let map = null;
const markersByDeviceId = new Map();
let mapInitialFitDone = false;
let pollTimer = null;
let historyLayer = null;
let customPinsLayer = null;
let historyDefaultsApplied = false;
let regattaDeepLinkApplied = false;
let historySpeedChart = null;
let customMapPins = [];
let courseBuoys = [];
let buoysLayer = null;
const buoyMarkersById = new Map();

const MAX_ROUTE_POINTS_DRAW = 800;
const MAX_CHART_POINTS_PER_DEVICE = 450;

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

const MAP_COURSE_ZOOM = 17;

function centerMapOnCourseOrigin(lat, lng, zoom = MAP_COURSE_ZOOM) {
    if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    map.setView([lat, lng], zoom);
    mapInitialFitDone = true;
}

function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([-36.59205, 174.70355], MAP_COURSE_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    historyLayer = L.layerGroup().addTo(map);
    buoysLayer = L.layerGroup().addTo(map);
    timingLinesLayer = L.layerGroup().addTo(map);
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
    const params = new URLSearchParams(location.search);
    if (params.get('bsrFrom') || params.get('bsrTo') || params.get('bsrDevice') || params.get('bsrDevices')) {
        historyDefaultsApplied = true;
        return;
    }
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

/** Deep-link from regatta dashboard: ?bsrFrom=&bsrTo=&bsrDevices=&bsrCompare=1&bsrCompareA=&bsrCompareB= */
async function applyRegattaDashboardDeepLink() {
    if (regattaDeepLinkApplied) return;
    const params = new URLSearchParams(location.search);
    const fromIso = params.get('bsrFrom');
    const toIso = params.get('bsrTo');
    const devicesParam = params.get('bsrDevices') || params.get('bsrDevice');
    if (!fromIso && !toIso && !devicesParam) return;

    regattaDeepLinkApplied = true;
    historyDefaultsApplied = true;

    const fromEl = document.getElementById('historyFrom');
    const toEl = document.getElementById('historyTo');
    if (fromIso && fromEl) {
        const d = new Date(fromIso);
        if (!Number.isNaN(d.getTime())) fromEl.value = toLocalInputValue(d);
    }
    if (toIso && toEl) {
        const d = new Date(toIso);
        if (!Number.isNaN(d.getTime())) toEl.value = toLocalInputValue(d);
    }

    const sel = document.getElementById('historyDevice');
    if (sel && devicesParam) {
        const ids = new Set(
            devicesParam
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
        );
        Array.from(sel.options).forEach((opt) => {
            opt.selected = ids.has(opt.value);
        });
    }

    if (fromIso && toIso && devicesParam) {
        await loadHistoryRoute();
    }

    const wantCompare = params.get('bsrCompare') === '1';
    const compareA = params.get('bsrCompareA');
    const compareB = params.get('bsrCompareB');
    if (wantCompare && compareA && compareB) {
        const selA = document.getElementById('bspCompareA');
        const selB = document.getElementById('bspCompareB');
        if (selA) selA.value = compareA;
        if (selB) selB.value = compareB;
        if (typeof openCompareWorkspace === 'function') {
            openCompareWorkspace();
        } else if (typeof renderRaceCompareDashboard === 'function') {
            renderRaceCompareDashboard();
        }
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

function speedMpsForColor(pos) {
    const s = typeof pos.speed === 'number' && !Number.isNaN(pos.speed) ? pos.speed : 0;
    return window.AltitudeHdSpeedColor.speedMpsForColor(s);
}

function speedToRainbowColor(speedMps) {
    return window.AltitudeHdSpeedColor.speedToRainbowColor(speedMps);
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
    destroyHistoryChart();
    lastHistoryRoutes = null;
    recomputeRaceTiming();
}

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
                `<div style="font-weight:700">History point</div>` +
                devLabel +
                `<div><strong>Speed (colour scale):</strong> ${spd.toFixed(2)} m/s over ${window.AltitudeHdSpeedColor.getRange().minMps}–${window.AltitudeHdSpeedColor.getRange().maxMps} m/s</div>` +
                `<div><strong>≈</strong> ${kmh.toFixed(1)} km/h</div>` +
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

    if (allBounds.length > 0) {
        map.fitBounds(L.latLngBounds(allBounds), { padding: [48, 48], maxZoom: 17 });
    }

    setHistoryStatus(parts.join(' · ') + '.');
    lastHistoryRoutes = deviceRoutes;
    recomputeRaceTiming();
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


const TIMING_LINES = [
    { id: 'line1', label: 'L1 – R1', buoyA: 'L1', buoyB: 'R1', hasTurn: false },
    { id: 'line2', label: 'L2 – R2', buoyA: 'L2', buoyB: 'R2', hasTurn: false },
    { id: 'line3', label: 'R3 – L3', buoyA: 'R3', buoyB: 'L3', hasTurn: true },
];

/** Each timing line is drawn and detected 50 m beyond the buoy pair on both sides. */
const TIMING_LINE_EXTENSION_M = 50;

let timingLinesLayer = null;
const liveTrailsByDeviceId = new Map();
let lastHistoryRoutes = null;
let timingStatsByDeviceId = new Map();

function getBuoyByLabel(label) {
    return courseBuoys.find((b) => b.label === label) || null;
}

function getTimingLineEndpoints(lineDef) {
    const a = getBuoyByLabel(lineDef.buoyA);
    const b = getBuoyByLabel(lineDef.buoyB);
    if (!a || !b) return null;
    return { a: { lat: a.lat, lng: a.lng }, b: { lat: b.lat, lng: b.lng } };
}

function localMetersToLatLng(x, y, refLat, refLng) {
    const cos = Math.cos((refLat * Math.PI) / 180);
    return {
        lat: refLat + y / 110540,
        lng: refLng + x / (111320 * cos),
    };
}

function extendTimingLineEndpoints(ep, extensionM = TIMING_LINE_EXTENSION_M) {
    if (!ep || extensionM <= 0) return ep;
    const refLat = (ep.a.lat + ep.b.lat) / 2;
    const refLng = (ep.a.lng + ep.b.lng) / 2;
    const am = latLngToLocalMeters(ep.a.lat, ep.a.lng, refLat, refLng);
    const bm = latLngToLocalMeters(ep.b.lat, ep.b.lng, refLat, refLng);
    const dx = bm.x - am.x;
    const dy = bm.y - am.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return ep;
    const ux = dx / len;
    const uy = dy / len;
    const startM = { x: am.x - ux * extensionM, y: am.y - uy * extensionM };
    const endM = { x: bm.x + ux * extensionM, y: bm.y + uy * extensionM };
    return {
        a: localMetersToLatLng(startM.x, startM.y, refLat, refLng),
        b: localMetersToLatLng(endM.x, endM.y, refLat, refLng),
    };
}

function getExtendedTimingLineEndpoints(lineDef) {
    const ep = getTimingLineEndpoints(lineDef);
    if (!ep) return null;
    return extendTimingLineEndpoints(ep);
}

function latLngToLocalMeters(lat, lng, refLat, refLng) {
    const cos = Math.cos((refLat * Math.PI) / 180);
    return {
        x: (lng - refLng) * 111320 * cos,
        y: (lat - refLat) * 110540,
    };
}

function segmentIntersectsLine(p0, p1, lineA, lineB) {
    const refLat = (lineA.lat + lineB.lat + p0.lat + p1.lat) / 4;
    const refLng = (lineA.lng + lineB.lng + p0.lng + p1.lng) / 4;
    const s0 = latLngToLocalMeters(p0.lat, p0.lng, refLat, refLng);
    const s1 = latLngToLocalMeters(p1.lat, p1.lng, refLat, refLng);
    const l0 = latLngToLocalMeters(lineA.lat, lineA.lng, refLat, refLng);
    const l1 = latLngToLocalMeters(lineB.lat, lineB.lng, refLat, refLng);

    const x1 = s0.x;
    const y1 = s0.y;
    const x2 = s1.x;
    const y2 = s1.y;
    const x3 = l0.x;
    const y3 = l0.y;
    const x4 = l1.x;
    const y4 = l1.y;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-9) return null;

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return t;
}

function findLineCrossings(sortedPoints, lineA, lineB) {
    const crossings = [];
    if (!sortedPoints || sortedPoints.length < 2) return crossings;

    for (let i = 1; i < sortedPoints.length; i++) {
        const p0 = sortedPoints[i - 1];
        const p1 = sortedPoints[i];
        const t0 = positionTimeMs(p0);
        const t1 = positionTimeMs(p1);
        if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;

        const frac = segmentIntersectsLine(
            { lat: p0.latitude, lng: p0.longitude },
            { lat: p1.latitude, lng: p1.longitude },
            lineA,
            lineB
        );
        if (frac == null) continue;

        const timeMs = t0 + frac * (t1 - t0);
        const prev = crossings[crossings.length - 1];
        if (prev && Math.abs(prev.timeMs - timeMs) < 400) continue;
        crossings.push({ timeMs, index: crossings.length + 1 });
    }
    return crossings;
}

function analyzeDeviceTiming(points) {
    const sorted = sortRoutePoints(points);
    const lines = TIMING_LINES.map((def) => {
        const ep = getExtendedTimingLineEndpoints(def);
        const crossings = ep ? findLineCrossings(sorted, ep.a, ep.b) : [];
        return { def, crossings };
    });

    const line1 = lines[0].crossings[0] || null;
    const line2 = lines[1].crossings[0] || null;
    const line3First = lines[2].crossings[0] || null;
    const line3Second = lines[2].crossings[1] || null;
    const raceStartMs = line1 ? line1.timeMs : null;

    return {
        lines,
        line1,
        line2,
        line3First,
        line3Second,
        turnTimeMs:
            line3First && line3Second ? line3Second.timeMs - line3First.timeMs : null,
        split12Ms: line1 && line2 ? line2.timeMs - line1.timeMs : null,
        split23Ms: line2 && line3First ? line3First.timeMs - line2.timeMs : null,
        raceStartMs,
    };
}

function getTimingDataSources() {
    if (lastHistoryRoutes && lastHistoryRoutes.length > 0) {
        return {
            mode: 'history',
            sources: lastHistoryRoutes.map((r) => ({
                deviceId: r.id,
                name: r.name || `Device ${r.id}`,
                points: r.points,
            })),
        };
    }
    const sources = [];
    liveTrailsByDeviceId.forEach((points, deviceId) => {
        if (!points || points.length < 2) return;
        const name = devices.find((d) => d.id === deviceId)?.name || `Device ${deviceId}`;
        sources.push({ deviceId, name, points });
    });
    return { mode: 'live', sources };
}

function recomputeRaceTiming() {
    timingStatsByDeviceId.clear();
    const { mode, sources } = getTimingDataSources();
    sources.forEach(({ deviceId, name, points }) => {
        timingStatsByDeviceId.set(deviceId, {
            deviceId,
            name,
            ...analyzeDeviceTiming(points),
        });
    });
    renderTimingPanel(mode);
    if (typeof renderRaceCompareDashboard === 'function') {
        renderRaceCompareDashboard();
    }
}

function isTimingLinesVisible() {
    const el = document.getElementById('bspTimingLinesToggle');
    return el ? el.checked : true;
}

function syncTimingLinesToMap() {
    if (!timingLinesLayer) return;
    timingLinesLayer.clearLayers();
    if (!isTimingLinesVisible()) return;

    TIMING_LINES.forEach((def) => {
        const ep = getExtendedTimingLineEndpoints(def);
        if (!ep) return;
        L.polyline(
            [
                [ep.a.lat, ep.a.lng],
                [ep.b.lat, ep.b.lng],
            ],
            {
                color: '#fbbf24',
                weight: 3,
                opacity: 0.92,
                dashArray: '10, 8',
                lineCap: 'round',
            }
        )
            .bindTooltip(def.label, { permanent: false, direction: 'center' })
            .addTo(timingLinesLayer);
    });
}

function formatCrossTimeMs(timeMs) {
    if (!Number.isFinite(timeMs)) return '—';
    const d = new Date(timeMs);
    if (Number.isNaN(d.getTime())) return '—';
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ds = String(Math.floor((timeMs % 1000) / 100));
    return `${h}:${m}:${s}.${ds}`;
}

function formatElapsedMs(ms, baseMs) {
    if (!Number.isFinite(ms) || !Number.isFinite(baseMs)) return '—';
    const delta = (ms - baseMs) / 1000;
    if (delta < 0) return '—';
    if (delta < 60) return `+${delta.toFixed(2)}s`;
    const m = Math.floor(delta / 60);
    const s = delta % 60;
    return `+${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function formatDurationMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(2)}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toFixed(1).padStart(4, '0')}`;
}

function renderTimingDeviceRows(statsList, lineDef, lineIndex) {
    if (!statsList.length) {
        return '<p class="bsp-timing-empty">No crossings detected yet.</p>';
    }

    const colCount = 3 + (lineIndex > 0 ? 1 : 0) + (lineDef.hasTurn ? 2 : 0);

    const rows = statsList
        .map((stats) => {
            const cross = stats.lines[lineIndex]?.crossings[0] || null;
            const cross2 =
                lineDef.hasTurn && stats.lines[lineIndex]?.crossings[1]
                    ? stats.lines[lineIndex].crossings[1]
                    : null;
            if (!cross) {
                return (
                    `<tr class="bsp-timing-row">` +
                    `<td>${escapeHtml(stats.name)}</td>` +
                    `<td colspan="${colCount - 1}" class="bsp-timing-muted">—</td>` +
                    `</tr>`
                );
            }
            const base = stats.raceStartMs;
            let extra = '';
            if (lineDef.hasTurn && cross2) {
                extra = `<td>${formatCrossTimeMs(cross2.timeMs)}</td>` +
                    `<td>${formatDurationMs(stats.turnTimeMs)}</td>`;
            } else if (lineDef.hasTurn) {
                extra = `<td class="bsp-timing-muted">—</td><td class="bsp-timing-muted">—</td>`;
            }
            let splitCell = '';
            if (lineIndex === 1 && stats.split12Ms != null) {
                splitCell = `<td>${formatDurationMs(stats.split12Ms)}</td>`;
            } else if (lineIndex === 2 && stats.split23Ms != null) {
                splitCell = `<td>${formatDurationMs(stats.split23Ms)}</td>`;
            } else if (lineIndex > 0) {
                splitCell = `<td class="bsp-timing-muted">—</td>`;
            }
            return (
                `<tr class="bsp-timing-row">` +
                `<td>${escapeHtml(stats.name)}</td>` +
                `<td>${formatCrossTimeMs(cross.timeMs)}</td>` +
                `<td>${formatElapsedMs(cross.timeMs, base)}</td>` +
                splitCell +
                extra +
                `</tr>`
            );
        })
        .join('');

    let header =
        `<tr><th>Device</th><th>Cross</th><th>From L1–R1</th>`;
    if (lineIndex === 1) header += `<th>Split</th>`;
    else if (lineIndex === 2) header += `<th>Split</th>`;
    if (lineDef.hasTurn) header += `<th>2nd cross</th><th>Turn</th>`;
    header += `</tr>`;

    return `<table class="bsp-timing-table"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
}

function renderTimingPanel(mode) {
    const sectionsEl = document.getElementById('bspTimingSections');
    const sourceEl = document.getElementById('bspTimingSource');
    if (!sectionsEl) return;

    const statsList = Array.from(timingStatsByDeviceId.values()).sort((a, b) =>
        String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })
    );

    if (sourceEl) {
        sourceEl.textContent =
            mode === 'history'
                ? 'Source: loaded route history'
                : 'Source: live GPS trail (10s updates)';
    }

    sectionsEl.innerHTML = TIMING_LINES.map((def, i) => {
        const summaryExtra = def.hasTurn ? ' · turn on 2nd cross' : '';
        return (
            `<details class="bsp-timing-section" open>` +
            `<summary class="bsp-timing-section-summary">${escapeHtml(def.label)}${summaryExtra}</summary>` +
            `<div class="bsp-timing-section-body">` +
            renderTimingDeviceRows(statsList, def, i) +
            `</div></details>`
        );
    }).join('');
}

function appendLiveTrailPoint(deviceId, position) {
    if (
        !position ||
        typeof position.latitude !== 'number' ||
        typeof position.longitude !== 'number' ||
        Number.isNaN(position.latitude) ||
        Number.isNaN(position.longitude)
    ) {
        return;
    }
    const t = positionTimeMs(position);
    if (!Number.isFinite(t)) return;

    let trail = liveTrailsByDeviceId.get(deviceId);
    if (!trail) trail = [];

    const last = trail[trail.length - 1];
    if (last) {
        const lastT = positionTimeMs(last);
        const sameTime = lastT === t;
        const samePos =
            Math.abs(last.latitude - position.latitude) < 1e-7 &&
            Math.abs(last.longitude - position.longitude) < 1e-7;
        if (sameTime && samePos) return;
    }

    trail.push({
        latitude: position.latitude,
        longitude: position.longitude,
        speed: position.speed,
        fixTime: position.fixTime,
        deviceTime: position.deviceTime,
        serverTime: position.serverTime,
    });
    if (trail.length > 8000) trail.splice(0, trail.length - 8000);
    liveTrailsByDeviceId.set(deviceId, trail);
}

function clearLiveTrails() {
    liveTrailsByDeviceId.clear();
}

function wireTimingPanel() {
    const linesToggle = document.getElementById('bspTimingLinesToggle');
    if (linesToggle && linesToggle.dataset.bound !== '1') {
        linesToggle.dataset.bound = '1';
        linesToggle.addEventListener('change', () => syncTimingLinesToMap());
    }

    const resetBtn = document.getElementById('bspTimingResetLiveBtn');
    if (resetBtn && resetBtn.dataset.bound !== '1') {
        resetBtn.dataset.bound = '1';
        resetBtn.addEventListener('click', () => {
            clearLiveTrails();
            if (!lastHistoryRoutes || lastHistoryRoutes.length === 0) {
                recomputeRaceTiming();
            }
        });
    }

    const details = document.getElementById('bspTimingDetails');
    if (details && details.dataset.resizeBound !== '1') {
        details.dataset.resizeBound = '1';
        details.addEventListener('toggle', () => scheduleMapResize());
    }
}

function initRaceTiming() {
    wireTimingPanel();
    syncTimingLinesToMap();
    recomputeRaceTiming();
    if (typeof initRaceCompare === 'function') {
        initRaceCompare();
    }
}

function onBuoysOrTimingGeometryChanged() {
    syncTimingLinesToMap();
    recomputeRaceTiming();
}

function isBuoysDragEnabled() {
    const el = document.getElementById('bspBuoysDragToggle');
    return el ? el.checked : false;
}

function setBuoysStatus(text) {
    const el = document.getElementById('bspBuoysStatus');
    if (el) el.textContent = text || '';
}

function loadCourseBuoys() {
    try {
        const raw = localStorage.getItem(LS_BEACH_BUOYS);
        if (!raw) {
            courseBuoys = [];
            seedDefaultCourseBuoysIfEmpty();
            return;
        }
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr) || arr.length === 0) {
            courseBuoys = [];
            seedDefaultCourseBuoysIfEmpty();
            return;
        }
        const parsed = arr
            .filter(
                (b) =>
                    b &&
                    typeof b.id === 'string' &&
                    typeof b.label === 'string' &&
                    Number.isFinite(b.lat) &&
                    Number.isFinite(b.lng)
            )
            .map((b) => ({
                id: String(b.id),
                label: String(b.label).slice(0, 8),
                lat: Number(b.lat),
                lng: Number(b.lng),
            }))
            .filter((b) => b.lat >= -90 && b.lat <= 90 && b.lng >= -180 && b.lng <= 180);
        const byId = new Map(parsed.map((b) => [b.id, b]));
        courseBuoys = DEFAULT_BEACH_BUOYS.map((def) => byId.get(def.id) || { ...def });
    } catch {
        courseBuoys = [];
        seedDefaultCourseBuoysIfEmpty();
    }
}

function seedDefaultCourseBuoysIfEmpty() {
    if (courseBuoys.length > 0) return;
    courseBuoys = DEFAULT_BEACH_BUOYS.map((b) => ({ ...b }));
    saveCourseBuoys();
}

function saveCourseBuoys() {
    try {
        localStorage.setItem(LS_BEACH_BUOYS, JSON.stringify(courseBuoys));
    } catch (e) {
        console.warn('Could not save beach sprints buoys', e);
    }
}

function buoyCircleIcon() {
    return L.divIcon({
        className: 'bsp-buoy-map-icon',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
    });
}

function syncBuoysToMap() {
    if (!buoysLayer || !map) return;
    buoysLayer.clearLayers();
    buoyMarkersById.clear();
    const dragOn = isBuoysDragEnabled();

    courseBuoys.forEach((b) => {
        const marker = L.marker([b.lat, b.lng], {
            draggable: dragOn,
            icon: buoyCircleIcon(),
            zIndexOffset: 650,
        }).addTo(buoysLayer);

        marker.bindPopup(
            '<div style="font-weight:700">' +
                escapeHtml(b.label) +
                '</div>' +
                '<div><strong>Lat:</strong> ' +
                b.lat.toFixed(6) +
                '</div>' +
                '<div><strong>Lon:</strong> ' +
                b.lng.toFixed(6) +
                '</div>',
            { maxWidth: 240 }
        );

        marker.on('dragend', () => {
            if (!isBuoysDragEnabled()) return;
            const ll = marker.getLatLng();
            b.lat = ll.lat;
            b.lng = ll.lng;
            saveCourseBuoys();
            renderBuoysList();
            onBuoysOrTimingGeometryChanged();
        });

        buoyMarkersById.set(b.id, marker);
    });
}

function applyBuoyCoordsFromInputs(buoyId) {
    const latEl = document.querySelector(`[data-buoy-lat="${buoyId}"]`);
    const lngEl = document.querySelector(`[data-buoy-lng="${buoyId}"]`);
    const buoy = courseBuoys.find((b) => b.id === buoyId);
    if (!buoy || !latEl || !lngEl) return false;

    const lat = parseFloat(latEl.value);
    const lng = parseFloat(lngEl.value);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        setBuoysStatus(`${buoy.label}: enter a valid latitude (−90 to 90).`);
        latEl.value = String(buoy.lat);
        return false;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        setBuoysStatus(`${buoy.label}: enter a valid longitude (−180 to 180).`);
        lngEl.value = String(buoy.lng);
        return false;
    }

    buoy.lat = lat;
    buoy.lng = lng;
    saveCourseBuoys();
    const marker = buoyMarkersById.get(buoyId);
    if (marker) marker.setLatLng([lat, lng]);
    setBuoysStatus('');
    onBuoysOrTimingGeometryChanged();
    return true;
}

function renderBuoysList() {
    const el = document.getElementById('bspBuoysList');
    if (!el) return;

    el.innerHTML = courseBuoys
        .map(
            (b) =>
                `<article class="bsp-buoy-card" data-buoy-id="${escapeHtml(b.id)}">` +
                `<h3 class="bsp-buoy-card-label">${escapeHtml(b.label)}</h3>` +
                `<label class="bsp-field bsp-buoy-field">` +
                `<span class="bsp-field-label">Latitude (°)</span>` +
                `<input type="number" step="any" data-buoy-lat="${escapeHtml(b.id)}" value="${b.lat}">` +
                `</label>` +
                `<label class="bsp-field bsp-buoy-field">` +
                `<span class="bsp-field-label">Longitude (°)</span>` +
                `<input type="number" step="any" data-buoy-lng="${escapeHtml(b.id)}" value="${b.lng}">` +
                `</label>` +
                `</article>`
        )
        .join('');
}

function wireBuoysPanel() {
    const dragToggle = document.getElementById('bspBuoysDragToggle');
    if (dragToggle && dragToggle.dataset.bound !== '1') {
        dragToggle.dataset.bound = '1';
        dragToggle.addEventListener('change', () => {
            syncBuoysToMap();
            window.BspCourseLayout?.onDragToggleChanged?.();
            setBuoysStatus(dragToggle.checked ? 'Drag buoys, flags, and start/finish on the map.' : '');
        });
    }

    const listEl = document.getElementById('bspBuoysList');
    if (listEl && listEl.dataset.bound !== '1') {
        listEl.dataset.bound = '1';
        listEl.addEventListener('change', (e) => {
            const input = e.target.closest('[data-buoy-lat], [data-buoy-lng]');
            if (!input) return;
            const card = input.closest('[data-buoy-id]');
            const buoyId = card?.getAttribute('data-buoy-id');
            if (!buoyId) return;
            applyBuoyCoordsFromInputs(buoyId);
        });
        listEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const input = e.target.closest('[data-buoy-lat], [data-buoy-lng]');
            if (!input) return;
            const card = input.closest('[data-buoy-id]');
            const buoyId = card?.getAttribute('data-buoy-id');
            if (!buoyId) return;
            e.preventDefault();
            applyBuoyCoordsFromInputs(buoyId);
        });
    }
}

function initCourseBuoys() {
    loadCourseBuoys();
    syncBuoysToMap();
    renderBuoysList();
    wireBuoysPanel();
    if (window.BspCourseLayout) {
        window.BspCourseLayout.init();
    }
}

window.BspMapApi = {
    getMap: () => map,
    getCourseBuoys: () => courseBuoys,
    setCourseBuoys: (arr) => {
        courseBuoys = (arr || []).map((b) => ({ ...b }));
        saveCourseBuoys();
    },
    syncBuoysToMap,
    renderBuoysList,
    onBuoysOrTimingGeometryChanged,
    isBuoysDragEnabled,
    scheduleMapResize,
    setBuoysStatus,
    centerMapOnCourseOrigin,
};

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
    const mobileExpand = document.getElementById('bspMapMobileExpandBtn');
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
    if (mobileExpand && mobileExpand.dataset.bound !== '1') {
        mobileExpand.dataset.bound = '1';
        mobileExpand.addEventListener('click', () => setFs(true));
    }
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

function beachSprintsSnapshotFetch() {
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
    try {
        const result = await beachSprintsSnapshotFetch();
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
        devices = mergeDevicesFromPositions(rawDevices, positions);

        initHistoryDateDefaultsIfNeeded();
        populateHistoryDeviceSelect();

        renderDevices();
        wireDeviceCardFlyTo();
        updateMapMarkers();
        devices.forEach((d) => {
            const pos = positions[d.id];
            if (pos) appendLiveTrailPoint(d.id, pos);
        });
        if (!lastHistoryRoutes || lastHistoryRoutes.length === 0) {
            recomputeRaceTiming();
        }
        updateTimestamp();

        if (map) requestAnimationFrame(() => map.invalidateSize());

        await applyRegattaDashboardDeepLink();
    } catch (error) {
        console.error('Beach sprints map snapshot error:', error);
        showError(error.message || 'Failed to load device data');
    }
}

window.addEventListener('altitudehd:map-refresh-rate', () => {
    if (isLiveUpdatesEnabled()) startPolling();
});

window.addEventListener('altitudehd:speed-color-range', () => {
    if (lastHistoryRoutes?.length) {
        renderHistoryRouteOnMap(lastHistoryRoutes);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initCourseBuoys();
    initRaceTiming();
    initCustomMapPins();
    initHistoryDateDefaultsIfNeeded();
    wireHistoryPanel();
    wireMapFullscreen();
    wireLiveToggle();
    updateData();
    startPolling();
});
