const API_BASE = '/api/traccar';

function parseNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

const params = new URLSearchParams(window.location.search);
const deviceId = parseInt(params.get('deviceId'), 10);
const pollMs = parseNum(params.get('interval'), 1000, 60000, 2500);
const vmixHost = params.get('vmix') === '1';
const transparent = vmixHost || params.get('transparent') === '1';
const overlayOnly = vmixHost && params.get('overlayOnly') === '1';

function parseFloatClamped(v, min, max) {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return NaN;
    return Math.min(max, Math.max(min, n));
}

/** Fixed overlay line on speed page (% viewport). Map start/finish lat/lng from URL. */
const ROUTE_LINE_START_X = 81.5;
const ROUTE_LINE_START_Y = 96;
const ROUTE_LINE_END_X = 96.5;
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
const routeDeviceArrow = document.getElementById('speedRouteDeviceArrow');

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

function speedRouteArrowTransform(cx, cy) {
    const { d1x, d1y, d2x, d2y } = routeCfg;
    const angleDeg =
        (Math.atan2(d2y - d1y, d2x - d1x) * 180) / Math.PI;
    return `translate(${cx},${cy}) rotate(${angleDeg})`;
}

function layoutSpeedRouteOverlay() {
    if (!routeCfg || !routeLine || !routeMarkerStart || !routeMarkerEnd || !routeDeviceArrow || !routeLayer) {
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
    routeDeviceArrow.setAttribute('transform', speedRouteArrowTransform(d1x, d1y));
    routeLayer.hidden = false;
}

function updateSpeedRouteArrow(lat, lng) {
    if (!routeCfg || !routeDeviceArrow) return;
    const t = segmentProgressT(lat, lng, routeCfg.rsLat, routeCfg.rsLng, routeCfg.reLat, routeCfg.reLng);
    const cx = routeCfg.d1x + t * (routeCfg.d2x - routeCfg.d1x);
    const cy = routeCfg.d1y + t * (routeCfg.d2y - routeCfg.d1y);
    routeDeviceArrow.setAttribute('transform', speedRouteArrowTransform(cx, cy));
}

if (routeCfg) {
    layoutSpeedRouteOverlay();
}

const card = document.getElementById('speedCard');
const errEl = document.getElementById('speedError');
const elSplit = document.getElementById('scSplit');

/** idle | playingIntro | pausedSpeed | rewinding — Space starts intro; O rewinds to start then idle. */
let overlayPhase = 'idle';

function notifyVmixHost(phase) {
    if (!vmixHost || window.parent === window) return;
    window.parent.postMessage({ type: 'altitudehd:vg', phase }, '*');
}

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

    if (overlayOnly) {
        const wrap = document.querySelector('.speed-bg-video-wrap');
        if (wrap) wrap.hidden = true;
        if (vmixHost) {
            window.addEventListener('message', (e) => {
                if (e.data?.type !== 'altitudehd:vg') return;
                const phase = e.data.phase;
                if (phase === 'intro') {
                    overlayPhase = 'routeVisible';
                    if (routeCfg) layoutSpeedRouteOverlay();
                    updateCardVisibility();
                } else if (phase === 'hold') {
                    overlayPhase = 'pausedSpeed';
                    updateCardVisibility();
                } else if (phase === 'clear') {
                    overlayPhase = 'idle';
                    if (routeLayer) {
                        routeLayer.hidden = true;
                        routeLayer.setAttribute('aria-hidden', 'true');
                    }
                    updateCardVisibility();
                }
            });
        }
        return;
    }

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
                notifyVmixHost('idle');
                return;
            }
            vid.currentTime = t;
            rewindRaf = requestAnimationFrame(step);
        }
        rewindRaf = requestAnimationFrame(step);
    }

    const canShowSpeedOverlay = () => Number.isFinite(deviceId) && deviceId >= 1;

    function playIntro() {
        if (overlayPhase === 'playingIntro' || overlayPhase === 'rewinding') return;
        stopRewind();
        overlayPhase = 'playingIntro';
        vid.loop = false;
        vid.currentTime = 0;
        updateCardVisibility();
        vid.play().catch(() => {});
    }

    vid.addEventListener('timeupdate', () => {
        if (overlayPhase !== 'playingIntro') return;
        if (vid.currentTime < 1.99) return;
        vid.pause();
        const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 2;
        vid.currentTime = Math.max(0, Math.min(2, dur - 1 / 30));
        if (canShowSpeedOverlay() && errEl.hidden) {
            overlayPhase = 'pausedSpeed';
            notifyVmixHost('hold');
        } else {
            overlayPhase = 'idle';
        }
        updateCardVisibility();
    });

    if (vmixHost) {
        window.addEventListener('message', (e) => {
            if (e.data?.type !== 'altitudehd:vg') return;
            const phase = e.data.phase;
            if (phase === 'intro') playIntro();
            else if (phase === 'outro' && overlayPhase === 'pausedSpeed') {
                overlayPhase = 'rewinding';
                updateCardVisibility();
                startRewind();
            } else if (phase === 'clear') {
                stopRewind();
                overlayPhase = 'idle';
                vid.pause();
                vid.currentTime = 0;
                updateCardVisibility();
            }
        });
    } else {
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                playIntro();
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
}

if (transparent) {
    document.body.classList.add('speed-transparent');
}
if (overlayOnly) {
    document.body.classList.add('speed-overlay-only');
}

if (!Number.isFinite(deviceId) || deviceId < 1) {
    if (vmixHost) {
        errEl.textContent =
            'Set device on hub map (Speed screen → Open speed page once) or add ?deviceId= to the URL.';
        errEl.hidden = false;
    } else {
        showError(
            'Missing or invalid deviceId. Open this page from the main map (Speed screen) or add ?deviceId=123 to the URL.',
        );
    }
} else {
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
            updateSpeedRouteArrow(pos.latitude, pos.longitude);
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
