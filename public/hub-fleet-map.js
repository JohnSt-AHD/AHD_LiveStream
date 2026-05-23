/**
 * Hub landing page — dark fleet map preview (Karāpiro / Rowing NZ default view).
 */
const HUB_MAP_API = '/api/traccar';
function hubFleetRefreshMs() {
    return window.AltitudeHdMapRefresh?.getIntervalMs() ?? 10000;
}
const HUB_TRACE_MAX_POINTS = 500;

/** Lake Karāpiro / Rowing NZ — ~10 km map span at zoom 12. */
const HUB_MAP_CENTER = [-37.9305, 175.5485];
const HUB_MAP_ZOOM = 12;

let hubFleetMap = null;
let hubFleetMarkersLayer = null;
let hubFleetTracesLayer = null;
const hubFleetMarkers = new Map();
let hubFleetPollTimer = null;
let hubFleetTracesLoading = false;
let hubFleetLastDevices = [];
let hubFleetBaseStatus = '';
let hubFleetTraceStatusNote = '';

function hubFleetEscapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function hubFleetTracesEnabled() {
    const el = document.getElementById('hubFleetTracesToggle');
    return el ? el.checked : false;
}

function hubFleetSetStatus(text) {
    hubFleetBaseStatus = text || '';
    const el = document.getElementById('hubFleetMapStatus');
    if (el) el.textContent = hubFleetBaseStatus;
}

function hubFleetAppendStatus(suffix) {
    if (!suffix) return;
    const el = document.getElementById('hubFleetMapStatus');
    if (!el) return;
    el.textContent = hubFleetBaseStatus ? `${hubFleetBaseStatus} · ${suffix}` : suffix;
}

function hubFleetRestoreBaseStatus() {
    const el = document.getElementById('hubFleetMapStatus');
    if (el) el.textContent = hubFleetBaseStatus;
}

function hubFleetIsRecent(fixTime) {
    if (!fixTime) return false;
    const t = new Date(fixTime).getTime();
    if (Number.isNaN(t)) return false;
    return Date.now() - t < 5 * 60 * 1000;
}

function hubFleetMergeDevices(deviceList, positionsMap) {
    const list = Array.isArray(deviceList) ? deviceList.slice() : [];
    const seen = new Set(list.map((d) => d && d.id).filter((id) => id != null));
    for (const key of Object.keys(positionsMap)) {
        const id = Number(key);
        if (!Number.isFinite(id) || seen.has(id)) continue;
        const pos = positionsMap[key];
        let name = `Device ${id}`;
        if (pos && typeof pos.deviceName === 'string' && pos.deviceName.trim()) {
            name = pos.deviceName.trim();
        }
        list.push({ id, name });
        seen.add(id);
    }
    list.sort((a, b) =>
        String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }),
    );
    return list;
}

function hubFleetPositionTimeMs(p) {
    if (!p || typeof p !== 'object') return NaN;
    const raw = p.fixTime ?? p.deviceTime ?? p.serverTime;
    if (raw == null || raw === '') return NaN;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
    }
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : NaN;
}

function hubFleetSortRoutePoints(points) {
    return points
        .filter(
            (p) =>
                p &&
                typeof p.latitude === 'number' &&
                typeof p.longitude === 'number' &&
                !Number.isNaN(p.latitude) &&
                !Number.isNaN(p.longitude),
        )
        .sort((a, b) => hubFleetPositionTimeMs(a) - hubFleetPositionTimeMs(b));
}

function hubFleetDecimateRoutePoints(points, max) {
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

function hubFleetColorForDevice(deviceId) {
    const golden = 137.508;
    const hue = (Number(deviceId) * golden) % 360;
    return `hsl(${hue}, 72%, 52%)`;
}

/** LayerGroup has no bringToFront in Leaflet; raise each marker instead. */
function hubFleetBringMarkersToFront() {
    if (!hubFleetMarkersLayer) return;
    if (typeof hubFleetMarkersLayer.bringToFront === 'function') {
        hubFleetMarkersLayer.bringToFront();
        return;
    }
    if (typeof hubFleetMarkersLayer.eachLayer === 'function') {
        hubFleetMarkersLayer.eachLayer((layer) => {
            if (layer && typeof layer.bringToFront === 'function') {
                layer.bringToFront();
            }
        });
    }
}

function hubFleetTodayRangeIso() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return {
        fromIso: start.toISOString(),
        toIso: new Date().toISOString(),
    };
}

function hubFleetInitMap() {
    const el = document.getElementById('hubFleetMap');
    if (!el || typeof L === 'undefined') return;

    hubFleetMap = L.map(el, {
        zoomControl: true,
        attributionControl: true,
    }).setView(HUB_MAP_CENTER, HUB_MAP_ZOOM);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
    }).addTo(hubFleetMap);

    hubFleetTracesLayer = L.layerGroup();
    hubFleetMarkersLayer = L.layerGroup().addTo(hubFleetMap);

    setTimeout(() => hubFleetMap.invalidateSize(), 120);
    window.addEventListener('resize', () => {
        if (hubFleetMap) hubFleetMap.invalidateSize();
    });
}

function hubFleetClearTraces() {
    if (hubFleetTracesLayer) {
        hubFleetTracesLayer.clearLayers();
        if (hubFleetMap && hubFleetMap.hasLayer(hubFleetTracesLayer)) {
            hubFleetMap.removeLayer(hubFleetTracesLayer);
        }
    }
}

function hubFleetRenderTraces(deviceRoutes) {
    if (!hubFleetMap || !hubFleetTracesLayer) return { drawn: 0, points: 0 };

    hubFleetClearTraces();
    hubFleetTracesLayer.addTo(hubFleetMap);

    let drawn = 0;
    let points = 0;

    for (const { id, name, routePoints } of deviceRoutes) {
        if (!routePoints || routePoints.length < 2) continue;
        const latlngs = routePoints.map((p) => [p.latitude, p.longitude]);
        const color = hubFleetColorForDevice(id);
        L.polyline(latlngs, {
            color,
            weight: 3,
            opacity: 0.82,
            lineCap: 'round',
            lineJoin: 'round',
        })
            .bindTooltip(hubFleetEscapeHtml(name), { sticky: true, direction: 'top' })
            .addTo(hubFleetTracesLayer);
        drawn += 1;
        points += routePoints.length;
    }

    hubFleetBringMarkersToFront();

    return { drawn, points };
}

async function hubFleetLoadTodayTraces(devices) {
    if (!hubFleetTracesEnabled() || !devices.length) {
        hubFleetClearTraces();
        return;
    }
    if (hubFleetTracesLoading) return;

    hubFleetTracesLoading = true;
    const toggle = document.getElementById('hubFleetTracesToggle');
    if (toggle) toggle.disabled = true;
    hubFleetAppendStatus('loading today’s traces…');

    const { fromIso, toIso } = hubFleetTodayRangeIso();

    try {
        const settled = await Promise.allSettled(
            devices.map(async (device) => {
                const params = new URLSearchParams({
                    action: 'route',
                    deviceId: String(device.id),
                    from: fromIso,
                    to: toIso,
                });
                if (window.AltitudeHdTrackerSource) {
                    window.AltitudeHdTrackerSource.applySource(params);
                }
                const res = await fetch(`${HUB_MAP_API}?${params.toString()}`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const msg = data && data.error ? data.error : `Request failed (${res.status})`;
                    throw new Error(msg);
                }
                if (!Array.isArray(data)) {
                    throw new Error('Unexpected response from server.');
                }
                return data;
            }),
        );

        const routes = [];
        let failed = 0;

        for (let i = 0; i < settled.length; i++) {
            const device = devices[i];
            const result = settled[i];
            if (result.status === 'fulfilled') {
                const sorted = hubFleetSortRoutePoints(result.value);
                const decimated = hubFleetDecimateRoutePoints(sorted, HUB_TRACE_MAX_POINTS);
                if (decimated.length >= 2) {
                    routes.push({ id: device.id, name: device.name, routePoints: decimated });
                }
            } else {
                failed += 1;
            }
        }

        if (!hubFleetTracesEnabled()) {
            hubFleetClearTraces();
            return;
        }

        const stats = hubFleetRenderTraces(routes);
        const startLabel = new Date(fromIso).toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        });
        let traceNote = `traces ${stats.drawn} device${stats.drawn === 1 ? '' : 's'} · today (${startLabel})`;
        if (failed > 0) {
            traceNote += ` · ${failed} failed`;
        }
        hubFleetTraceStatusNote = traceNote;
        hubFleetRestoreBaseStatus();
        hubFleetAppendStatus(hubFleetTraceStatusNote);
    } catch (err) {
        console.error('Hub fleet traces:', err);
        hubFleetClearTraces();
        hubFleetRestoreBaseStatus();
        hubFleetAppendStatus(err.message || 'Could not load traces.');
    } finally {
        hubFleetTracesLoading = false;
        const toggleEl = document.getElementById('hubFleetTracesToggle');
        if (toggleEl) toggleEl.disabled = false;
    }
}

function hubFleetUpdateMarkers(devices, positions) {
    if (!hubFleetMap || !hubFleetMarkersLayer) return;

    const seen = new Set();
    let online = 0;

    for (const device of devices) {
        const pos = positions[device.id];
        if (
            !pos ||
            typeof pos.latitude !== 'number' ||
            typeof pos.longitude !== 'number' ||
            Number.isNaN(pos.latitude) ||
            Number.isNaN(pos.longitude)
        ) {
            const existing = hubFleetMarkers.get(device.id);
            if (existing) {
                hubFleetMarkersLayer.removeLayer(existing);
                hubFleetMarkers.delete(device.id);
            }
            continue;
        }

        seen.add(device.id);
        const latlng = [pos.latitude, pos.longitude];
        const recent = hubFleetIsRecent(pos.fixTime);
        if (recent) online += 1;

        const fill = recent ? '#2dd4bf' : '#64748b';
        const stroke = recent ? '#0d9488' : '#334155';

        let marker = hubFleetMarkers.get(device.id);
        if (!marker) {
            marker = L.circleMarker(latlng, {
                radius: 9,
                weight: 2,
                color: stroke,
                fillColor: fill,
                fillOpacity: 0.92,
            }).addTo(hubFleetMarkersLayer);
            hubFleetMarkers.set(device.id, marker);
        } else {
            marker.setLatLng(latlng);
            marker.setStyle({ fillColor: fill, color: stroke });
        }

        const speedKmh =
            typeof pos.speed === 'number' && !Number.isNaN(pos.speed)
                ? (pos.speed * 3.6).toFixed(1)
                : '—';
        marker.bindPopup(
            `<div style="font-weight:700;margin-bottom:4px">${hubFleetEscapeHtml(device.name)}</div>` +
                `<div><strong>Status:</strong> ${recent ? 'Online' : 'Offline'}</div>` +
                `<div><strong>Speed:</strong> ${speedKmh} km/h</div>`,
            { maxWidth: 240 },
        );
    }

    for (const [id, marker] of [...hubFleetMarkers.entries()]) {
        if (!seen.has(id)) {
            hubFleetMarkersLayer.removeLayer(marker);
            hubFleetMarkers.delete(id);
        }
    }

    hubFleetBringMarkersToFront();

    return { total: devices.length, online, plotted: seen.size };
}

function hubFleetIsSnapshotConsumerOnly() {
    return !!document.getElementById('hubStatsBar');
}

function hubFleetSnapshotFetch() {
    const bus = window.AltitudeHdTraccarSnapshot;
    if (bus) return bus.fetchSnapshot();
    const url = window.AltitudeHdTrackerSource
        ? window.AltitudeHdTrackerSource.buildTraccarUrl({ action: 'snapshot' })
        : `${HUB_MAP_API}?action=snapshot`;
    return fetch(url)
        .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            return {
                ok: res.ok,
                status: res.status,
                data,
                error: res.ok ? null : data.error || `Request failed (${res.status})`,
            };
        })
        .catch((err) => ({
            ok: false,
            status: 0,
            data: {},
            error: err.message || 'Network error',
        }));
}

function hubFleetApplySnapshot(data) {
    const positions = {};
    const posList = Array.isArray(data.positions) ? data.positions : [];
    posList.forEach((pos) => {
        if (pos && pos.deviceId != null) positions[pos.deviceId] = pos;
    });

    const devices = hubFleetMergeDevices(data.devices, positions);
    hubFleetLastDevices = devices;
    const stats = hubFleetUpdateMarkers(devices, positions);
    const now = new Date();
    const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    hubFleetSetStatus(
        `${stats.plotted} on map · ${stats.online} online · ${stats.total} devices · updated ${time}`,
    );
    if (hubFleetTracesEnabled() && hubFleetTraceStatusNote) {
        hubFleetRestoreBaseStatus();
        hubFleetAppendStatus(hubFleetTraceStatusNote);
    }
}

async function hubFleetRefresh() {
    if (hubFleetIsSnapshotConsumerOnly()) return;

    try {
        const result = await hubFleetSnapshotFetch();
        if (!result.ok) {
            throw new Error(result.error);
        }
        hubFleetApplySnapshot(result.data);
    } catch (err) {
        console.error('Hub fleet map:', err);
        hubFleetSetStatus(err.message || 'Could not load device positions.');
    }
}

function hubFleetOnTraccarSnapshot(e) {
    if (!document.getElementById('hubFleetMap')) return;
    const detail = e.detail;
    if (!detail) return;
    if (detail.ok) {
        try {
            hubFleetApplySnapshot(detail.data);
        } catch (err) {
            console.error('Hub fleet map:', err);
            hubFleetSetStatus(err.message || 'Could not load device positions.');
        }
    } else {
        hubFleetSetStatus(detail.error || 'Could not load device positions.');
    }
}

function hubFleetStartPolling() {
    if (hubFleetPollTimer) clearInterval(hubFleetPollTimer);
    hubFleetPollTimer = setInterval(hubFleetRefresh, hubFleetRefreshMs());
}

function hubFleetWireTracesToggle() {
    const toggle = document.getElementById('hubFleetTracesToggle');
    if (!toggle || toggle.dataset.bound === '1') return;
    toggle.dataset.bound = '1';
    toggle.addEventListener('change', async () => {
        if (toggle.checked) {
            await hubFleetLoadTodayTraces(hubFleetLastDevices);
        } else {
            hubFleetClearTraces();
            hubFleetTraceStatusNote = '';
            hubFleetRestoreBaseStatus();
        }
    });
}

window.addEventListener('altitudehd:map-refresh-rate', () => {
    if (!hubFleetIsSnapshotConsumerOnly()) hubFleetStartPolling();
});

if (document.getElementById('hubStatsBar')) {
    window.addEventListener('altitudehd:traccar-snapshot', hubFleetOnTraccarSnapshot);
}

window.hubFleetRefresh = hubFleetRefresh;

window.addEventListener('altitudehd:tracker-source', () => {
    if (!document.getElementById('hubFleetMap')) return;
    hubFleetRefresh();
    if (hubFleetTracesEnabled() && hubFleetLastDevices.length) {
        hubFleetLoadTodayTraces(hubFleetLastDevices);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('hubFleetMap')) return;
    hubFleetInitMap();
    hubFleetWireTracesToggle();
    if (!hubFleetIsSnapshotConsumerOnly()) {
        hubFleetRefresh();
        hubFleetStartPolling();
    }
});
