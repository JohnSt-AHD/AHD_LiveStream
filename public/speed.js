const API_BASE = '/api/traccar';

function parseNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

const params = new URLSearchParams(window.location.search);
const deviceId = parseInt(params.get('deviceId'), 10);
const pollMs = parseNum(params.get('interval'), 1000, 60000, 2500);
const transparent = params.get('transparent') === '1';

function parseFloatClamped(v, min, max) {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return NaN;
    return Math.min(max, Math.max(min, n));
}

/** Fixed overlay line on speed page (% viewport). Map start/finish lat/lng from URL. */
const ROUTE_LINE_START_X = 82;
const ROUTE_LINE_START_Y = 96;
const ROUTE_LINE_END_X = 97;
const ROUTE_LINE_END_Y = 96;

const routeCfg = (() => {
    if (!params.has('rsLat') || !params.has('rsLng') || !params.has('reLat') || !params.has('reLng')) {
        return null;
    }
    const rsLat = parseFloatClamped(params.get('rsLat'), -90, 90);
    const rsLng = parseFloatClamped(params.get('rsLng'), -180, 180);
    const reLat = parseFloatClamped(params.get('reLat'), -90, 90);
    const reLng = parseFloatClamped(params.get('reLng'), -180, 180);
    if (![rsLat, rsLng, reLat, reLng].every(Number.isFinite)) {
        return null;
    }
    return {
        rsLat,
        rsLng,
        reLat,
        reLng,
        d1x: ROUTE_LINE_START_X,
        d1y: ROUTE_LINE_START_Y,
        d2x: ROUTE_LINE_END_X,
        d2y: ROUTE_LINE_END_Y,
    };
})();

const routeLayer = document.getElementById('speedRouteLayer');
const routeLine = document.getElementById('speedRouteLine');
const routeMarkerStart = document.getElementById('speedRouteMarkerStart');
const routeMarkerEnd = document.getElementById('speedRouteMarkerEnd');
const routeDeviceDot = document.getElementById('speedRouteDeviceDot');

/** Progress 0–1 along start→finish from device position (projection onto segment, meters plane). */
function segmentProgressT(dLat, dLng, sLat, sLng, eLat, eLng) {
    const R = 6371000;
    const cosS = Math.cos((sLat * Math.PI) / 180);
    const mPerDegLat = (R * Math.PI) / 180;
    const mPerDegLng = (R * Math.PI) / 180;
    const dx = (dLng - sLng) * mPerDegLng * cosS;
    const dy = (dLat - sLat) * mPerDegLat;
    const vx = (eLng - sLng) * mPerDegLng * cosS;
    const vy = (eLat - sLat) * mPerDegLat;
    const vv = vx * vx + vy * vy;
    if (vv < 4) return 0;
    const t = (dx * vx + dy * vy) / vv;
    return Math.max(0, Math.min(1, t));
}

function layoutSpeedRouteOverlay() {
    if (!routeCfg || !routeLine || !routeMarkerStart || !routeMarkerEnd || !routeDeviceDot || !routeLayer) {
        return;
    }
    const { d1x, d1y, d2x, d2y } = routeCfg;
    routeLine.setAttribute('x1', String(d1x));
    routeLine.setAttribute('y1', String(d1y));
    routeLine.setAttribute('x2', String(d2x));
    routeLine.setAttribute('y2', String(d2y));
    routeMarkerStart.setAttribute('cx', String(d1x));
    routeMarkerStart.setAttribute('cy', String(d1y));
    routeMarkerEnd.setAttribute('cx', String(d2x));
    routeMarkerEnd.setAttribute('cy', String(d2y));
    routeDeviceDot.setAttribute('cx', String(d1x));
    routeDeviceDot.setAttribute('cy', String(d1y));
    routeLayer.hidden = false;
}

function updateSpeedRouteDot(lat, lng) {
    if (!routeCfg || !routeDeviceDot) return;
    const t = segmentProgressT(lat, lng, routeCfg.rsLat, routeCfg.rsLng, routeCfg.reLat, routeCfg.reLng);
    const cx = routeCfg.d1x + t * (routeCfg.d2x - routeCfg.d1x);
    const cy = routeCfg.d1y + t * (routeCfg.d2y - routeCfg.d1y);
    routeDeviceDot.setAttribute('cx', String(cx));
    routeDeviceDot.setAttribute('cy', String(cy));
}

if (routeCfg) {
    layoutSpeedRouteOverlay();
}

const card = document.getElementById('speedCard');
const errEl = document.getElementById('speedError');
const elSplit = document.getElementById('scSplit');

/** idle | playingIntro | pausedSpeed | rewinding — Space starts intro; O rewinds to start then idle. */
let overlayPhase = 'idle';

function updateCardVisibility() {
    if (!card) return;
    if (!errEl.hidden) {
        card.hidden = true;
        return;
    }
    card.hidden = overlayPhase !== 'pausedSpeed';
}

/** Time for 500 m at constant speed (m/s), as M:SS.d — no unit suffix. */
function formatSplit500FromMps(speedMps) {
    if (!Number.isFinite(speedMps) || speedMps < 0.01) return '—';
    let sec = 500 / speedMps;
    if (sec > 7200) return '—';
    sec = Math.round(sec * 10) / 10;

    let minutes = Math.floor(sec / 60);
    let sRem = Math.round((sec - minutes * 60) * 10) / 10;
    if (sRem >= 59.95) {
        minutes += 1;
        sRem = 0;
    }
    const intS = Math.floor(sRem + 1e-9);
    let tenth = Math.round((sRem - intS) * 10);
    if (tenth === 10) {
        const ns = intS + 1;
        if (ns >= 60) {
            minutes += 1;
            return `${minutes}:00.0`;
        }
        return `${minutes}:${String(ns).padStart(2, '0')}.0`;
    }
    return `${minutes}:${String(intS).padStart(2, '0')}.${tenth}`;
}

function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    updateCardVisibility();
}

function initSpeedBackgroundVideo() {
    const vid = document.getElementById('speedBgVideo');
    if (!vid) return;
    vid.muted = true;
    vid.defaultMuted = true;
    vid.loop = false;
    vid.pause();
    vid.currentTime = 0;

    let rewindRaf = null;

    function stopRewind() {
        if (rewindRaf != null) {
            cancelAnimationFrame(rewindRaf);
            rewindRaf = null;
        }
    }

    function startRewind() {
        stopRewind();
        vid.pause();
        let last = performance.now();
        function step(now) {
            rewindRaf = null;
            if (overlayPhase !== 'rewinding') return;
            const dt = Math.min(0.25, (now - last) / 1000);
            last = now;
            const t = vid.currentTime - dt;
            if (t <= 0.001) {
                vid.currentTime = 0;
                vid.pause();
                overlayPhase = 'idle';
                updateCardVisibility();
                return;
            }
            vid.currentTime = t;
            rewindRaf = requestAnimationFrame(step);
        }
        rewindRaf = requestAnimationFrame(step);
    }

    const canShowSpeedOverlay = () => Number.isFinite(deviceId) && deviceId >= 1;

    vid.addEventListener('timeupdate', () => {
        if (overlayPhase !== 'playingIntro') return;
        if (vid.currentTime < 1.99) return;
        vid.pause();
        const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 2;
        vid.currentTime = Math.max(0, Math.min(2, dur - 1 / 30));
        if (canShowSpeedOverlay() && errEl.hidden) {
            overlayPhase = 'pausedSpeed';
        } else {
            overlayPhase = 'idle';
        }
        updateCardVisibility();
    });

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            if (overlayPhase === 'playingIntro' || overlayPhase === 'rewinding') return;
            e.preventDefault();
            stopRewind();
            overlayPhase = 'playingIntro';
            vid.loop = false;
            vid.currentTime = 0;
            updateCardVisibility();
            vid.play().catch(() => {});
            return;
        }
        if (e.code === 'KeyO') {
            if (overlayPhase !== 'pausedSpeed') return;
            e.preventDefault();
            overlayPhase = 'rewinding';
            updateCardVisibility();
            startRewind();
        }
    });
}

if (!Number.isFinite(deviceId) || deviceId < 1) {
    showError('Missing or invalid deviceId. Open this page from the main map (Speed screen) or add ?deviceId=123 to the URL.');
} else {
    if (transparent) {
        document.body.classList.add('speed-transparent');
    }
    errEl.hidden = true;
    updateCardVisibility();
}

initSpeedBackgroundVideo();

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
    return list;
}

async function tick() {
    if (!Number.isFinite(deviceId) || deviceId < 1) return;
    try {
        const res = await fetch(`${API_BASE}?action=snapshot`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            elSplit.textContent = '—';
            elSplit.classList.remove('speed-warn');
            errEl.textContent = data.error || `Error ${res.status}`;
            errEl.hidden = false;
            updateCardVisibility();
            return;
        }
        errEl.hidden = true;

        const positionsMap = {};
        (Array.isArray(data.positions) ? data.positions : []).forEach((pos) => {
            if (pos && pos.deviceId != null) positionsMap[pos.deviceId] = pos;
        });
        const pos = positionsMap[deviceId];

        if (
            routeCfg &&
            pos &&
            typeof pos.latitude === 'number' &&
            typeof pos.longitude === 'number' &&
            !Number.isNaN(pos.latitude) &&
            !Number.isNaN(pos.longitude)
        ) {
            updateSpeedRouteDot(pos.latitude, pos.longitude);
        }

        if (!pos || typeof pos.speed !== 'number') {
            elSplit.textContent = '—';
            elSplit.classList.remove('speed-warn');
            updateCardVisibility();
            return;
        }

        elSplit.textContent = formatSplit500FromMps(pos.speed);
        elSplit.classList.toggle('speed-warn', pos.speed > 5);
        updateCardVisibility();
    } catch (e) {
        elSplit.textContent = '—';
        errEl.textContent = e.message || 'Network error';
        errEl.hidden = false;
        updateCardVisibility();
    }
}

if (Number.isFinite(deviceId) && deviceId >= 1) {
    tick();
    setInterval(tick, pollMs);
}
