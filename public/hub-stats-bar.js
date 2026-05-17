/**
 * Hub one-line stats bar — RowSafe warnings, on-water boats, distance today, regatta calendar.
 */
const HUB_STATS_API = '/api/traccar';
function hubStatsRefreshMs() {
    return window.AltitudeHdMapRefresh?.getIntervalMs() ?? 10000;
}
const HUB_STATS_DISTANCE_REFRESH_MS = 5 * 60 * 1000;
const HUB_STATS_ROUTE_MAX_POINTS = 400;

let hubStatsPollTimer = null;
let hubStatsLastDistanceM = null;
let hubStatsLastDistanceAt = 0;
let hubStatsLastDevices = [];
let hubStatsDistanceEverLoaded = false;

function hubStatsTodayRangeIso() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return {
        fromIso: start.toISOString(),
        toIso: new Date().toISOString(),
    };
}

function hubStatsPositionTimeMs(p) {
    if (!p || typeof p !== 'object') return NaN;
    const raw = p.fixTime ?? p.deviceTime ?? p.serverTime;
    if (raw == null || raw === '') return NaN;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
    }
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : NaN;
}

function hubStatsSortRoutePoints(points) {
    return points
        .filter(
            (p) =>
                p &&
                typeof p.latitude === 'number' &&
                typeof p.longitude === 'number' &&
                !Number.isNaN(p.latitude) &&
                !Number.isNaN(p.longitude),
        )
        .sort((a, b) => hubStatsPositionTimeMs(a) - hubStatsPositionTimeMs(b));
}

function hubStatsDecimateRoutePoints(points, max) {
    if (points.length <= max) return points;
    const step = Math.ceil(points.length / max);
    const out = [];
    for (let i = 0; i < points.length; i += step) {
        out.push(points[i]);
    }
    const last = points[points.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
}

function hubStatsRouteDistanceM(points) {
    const core = window.RnzSafetyCore;
    if (!core || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        total += core.haversineM(a.latitude, a.longitude, b.latitude, b.longitude);
    }
    return total;
}

function hubStatsFormatDistance(meters) {
    if (!Number.isFinite(meters) || meters <= 0) return '0 m';
    if (meters >= 10000) return `${(meters / 1000).toFixed(1)} km`;
    if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
    return `${Math.round(meters)} m`;
}

function hubStatsCalendarLabel() {
    const list = document.getElementById('hubCalendarList');
    if (list) {
        const now = new Date();
        let currentName = null;

        for (const item of list.querySelectorAll('.hub-calendar-item')) {
            const start = new Date(`${item.dataset.start}T00:00:00`);
            const end = new Date(`${item.dataset.end}T23:59:59`);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
            const name = item.querySelector('.hub-calendar-name')?.textContent?.trim();
            if (!name) continue;
            if (now >= start && now <= end) {
                currentName = name;
                break;
            }
        }

        if (currentName) return `Now: ${currentName}`;

        let nextItem = null;
        let nextStart = null;
        for (const item of list.querySelectorAll('.hub-calendar-item')) {
            const start = new Date(`${item.dataset.start}T00:00:00`);
            if (Number.isNaN(start.getTime()) || start <= now) continue;
            if (!nextStart || start < nextStart) {
                nextStart = start;
                nextItem = item;
            }
        }

        if (nextItem && nextStart) {
            const name = nextItem.querySelector('.hub-calendar-name')?.textContent?.trim() || 'Regatta';
            const days = Math.max(0, Math.ceil((nextStart - now) / 86400000));
            if (days === 0) return `Next: ${name} (today)`;
            if (days === 1) return `1 day to ${name}`;
            return `${days} days to ${name}`;
        }

        return 'No upcoming regattas';
    }

    if (window.HubRegattaEvents?.labelFromEvents) {
        return window.HubRegattaEvents.labelFromEvents(window.HubRegattaEvents.EVENTS);
    }

    return '—';
}

function hubStatsWireBarLinks() {
    const warnings = document.getElementById('hubStatWarnings');
    if (warnings && warnings.tagName === 'A') {
        if (document.getElementById('rnzWarningBox')) {
            warnings.href = '#rnzWarningBox';
            warnings.addEventListener('click', () => {
                const box = document.getElementById('rnzWarningBox');
                if (box) {
                    box.hidden = false;
                    if (box.tagName === 'DETAILS') box.open = true;
                }
            });
        } else {
            warnings.href = 'rowsafe-map.html#rnzWarningBox';
        }
    }

    const eventEl = document.getElementById('hubStatEvent');
    if (eventEl && eventEl.tagName === 'A' && !document.getElementById('hubCalendarList')) {
        eventEl.href = 'index.html#hub-calendar-title';
    }
}

function hubStatsSetItem(id, text, options = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (options.alert != null) {
        el.dataset.level = options.alert ? 'alert' : 'ok';
    }
}

async function hubStatsLoadDistanceToday(devices) {
    const core = window.RnzSafetyCore;
    if (!core || !devices.length) return 0;

    const { fromIso, toIso } = hubStatsTodayRangeIso();
    const settled = await Promise.allSettled(
        devices.map(async (device) => {
            const params = new URLSearchParams({
                action: 'route',
                deviceId: String(device.id),
                from: fromIso,
                to: toIso,
            });
            const res = await fetch(`${HUB_STATS_API}?${params.toString()}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || `Request failed (${res.status})`);
            }
            if (!Array.isArray(data)) return [];
            return data;
        }),
    );

    let totalM = 0;
    for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        const sorted = hubStatsSortRoutePoints(result.value);
        const decimated = hubStatsDecimateRoutePoints(sorted, HUB_STATS_ROUTE_MAX_POINTS);
        totalM += hubStatsRouteDistanceM(decimated);
    }
    return totalM;
}

async function hubStatsRefreshDistance(force) {
    const now = Date.now();
    if (!force && hubStatsLastDistanceAt && now - hubStatsLastDistanceAt < HUB_STATS_DISTANCE_REFRESH_MS) {
        return hubStatsLastDistanceM;
    }
    if (!hubStatsLastDevices.length) return hubStatsLastDistanceM;

    hubStatsSetItem('hubStatDistance', 'Distance today: …');
    try {
        hubStatsLastDistanceM = await hubStatsLoadDistanceToday(hubStatsLastDevices);
        hubStatsLastDistanceAt = now;
    } catch (err) {
        console.error('Hub stats distance:', err);
        hubStatsSetItem('hubStatDistance', 'Distance today: —');
        return null;
    }
    return hubStatsLastDistanceM;
}

function hubStatsIsSnapshotConsumerOnly() {
    return document.body?.classList.contains('rnz-page');
}

function hubStatsSnapshotFetch() {
    const bus = window.AltitudeHdTraccarSnapshot;
    if (bus) return bus.fetchSnapshot();
    return fetch(`${HUB_STATS_API}?action=snapshot`)
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

function hubStatsOnSnapshotError(err) {
    console.error('Hub stats bar:', err);
    hubStatsSetItem('hubStatWarnings', 'Warnings: —');
    hubStatsSetItem('hubStatOnWater', 'On water: —');
    hubStatsSetItem('hubStatDistance', 'Distance today: —');
    hubStatsSetItem('hubStatEvent', hubStatsCalendarLabel());
}

async function hubStatsApplySnapshot(data) {
    const core = window.RnzSafetyCore;
    if (!core) return;

    const positions = {};
    (Array.isArray(data.positions) ? data.positions : []).forEach((pos) => {
        if (pos && pos.deviceId != null) positions[pos.deviceId] = pos;
    });

    const devices = core.mergeDevicesFromPositions(data.devices, positions);
    hubStatsLastDevices = devices;

    const metrics = core.computeSafetyMetrics(devices, positions, data.geofences);
    if (window.HubWarningAlerts?.onSafetyRefresh) {
        window.HubWarningAlerts.onSafetyRefresh(metrics);
    }

    const warnText = metrics.boundaryReady
        ? `${metrics.warnings} warning${metrics.warnings === 1 ? '' : 's'}`
        : 'Warnings: —';
    hubStatsSetItem('hubStatWarnings', warnText, {
        alert: metrics.boundaryReady && metrics.warnings > 0,
    });

    const onWaterText = metrics.boundaryReady
        ? `${metrics.onWater} on water`
        : 'On water: —';
    hubStatsSetItem('hubStatOnWater', onWaterText);

    hubStatsSetItem('hubStatEvent', hubStatsCalendarLabel());

    const distanceM = await hubStatsRefreshDistance(!hubStatsDistanceEverLoaded);
    hubStatsDistanceEverLoaded = true;
    if (distanceM != null) {
        hubStatsSetItem('hubStatDistance', `Distance today: ${hubStatsFormatDistance(distanceM)}`);
    }
}

async function hubStatsRefresh() {
    if (hubStatsIsSnapshotConsumerOnly()) return;

    try {
        const result = await hubStatsSnapshotFetch();
        if (!result.ok) {
            throw new Error(result.error);
        }
        await hubStatsApplySnapshot(result.data);
    } catch (err) {
        hubStatsOnSnapshotError(err);
    }
}

function hubStatsOnTraccarSnapshot(e) {
    if (!document.getElementById('hubStatsBar')) return;
    const detail = e.detail;
    if (!detail) return;
    if (detail.ok) {
        hubStatsApplySnapshot(detail.data).catch(hubStatsOnSnapshotError);
    } else {
        hubStatsOnSnapshotError(new Error(detail.error || 'Snapshot failed'));
    }
}

function hubStatsStartPolling() {
    if (hubStatsPollTimer) clearInterval(hubStatsPollTimer);
    hubStatsPollTimer = setInterval(hubStatsRefresh, hubStatsRefreshMs());
}

window.addEventListener('altitudehd:map-refresh-rate', () => {
    if (!hubStatsIsSnapshotConsumerOnly()) hubStatsStartPolling();
});

if (document.body?.classList.contains('rnz-page')) {
    window.addEventListener('altitudehd:traccar-snapshot', hubStatsOnTraccarSnapshot);
}

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('hubStatsBar')) return;
    hubStatsWireBarLinks();
    if (!hubStatsIsSnapshotConsumerOnly()) {
        hubStatsRefresh();
        hubStatsStartPolling();
    }
});
