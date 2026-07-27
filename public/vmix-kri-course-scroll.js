/**
 * KRI drone course underlay (u) — scrolling 2 km strip keyed to a follow-boat tracker.
 *
 * Modes:
 *   sim (default) — Karāpiro start→finish at ~4 m/s
 *   device        — CrewSight/Traccar deviceId projected onto Karāpiro start/finish
 *
 * URL params:
 *   ?sim=1|0          force simulation (default 1 when no deviceId)
 *   ?speed=4          sim speed m/s
 *   ?deviceId=123     live tracker device
 *   ?courseLanes=8    racing lanes drawn on the strip
 *   ?cvScale=1        enable CV lane-fit scaling (uses /api/cv-position boats)
 *   ?loop=1           restart sim at finish
 */
(function (global) {
    const INTRO_MS = 900;
    const OUTRO_MS = 900;
    const OUT_W = 1920;
    const OUT_H = 1080;
    const COURSE_IMG = 'assets/kri/course-8.png';
    const COURSE_LENGTH_M = 2000;
    const DEFAULT_SPEED_MPS = 4;
    const DEFAULT_LANES = 8;
    const IMG_NATIVE_W = 1000;
    const IMG_NATIVE_H = 20200;
    /** Fraction of strip width that is racing lanes (inside orange rails). */
    const LANE_BAND_LEFT = 0.07;
    const LANE_BAND_RIGHT = 0.93;
    /** Camera/follow boat sits at this fraction of the viewport height. */
    const CAMERA_Y_FRAC = 0.62;
    const BLACK_KEY = 22;

    /** Lake Karāpiro start / finish (same pins as kri-rowing-course-overlay). */
    const KARAPIRO_START = { lat: -37.943356, lng: 175.556788 };
    const KARAPIRO_FINISH = { lat: -37.929223, lng: 175.542716 };
    const EARTH_R = 6371000;

    let root = null;
    let viewport = null;
    let stripCanvas = null;
    let stripCtx = null;
    let laneLayer = null;
    let hudEl = null;
    let courseCanvas = null;
    let courseReady = null;
    let rafId = null;
    let lastTs = 0;
    let distanceM = 0;
    let speedMps = DEFAULT_SPEED_MPS;
    let laneCount = DEFAULT_LANES;
    let mode = 'sim';
    let deviceId = null;
    let loopSim = false;
    let cvScaleEnabled = false;
    let laneScale = 1;
    let laneOffsetX = 0;
    let raceContext = null;
    let pollTimer = null;
    let cvTimer = null;
    let running = false;

    function params() {
        return new URLSearchParams(location.search);
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function toRad(deg) {
        return (deg * Math.PI) / 180;
    }

    function haversineM(a, b) {
        const φ1 = toRad(a.lat);
        const φ2 = toRad(b.lat);
        const Δφ = toRad(b.lat - a.lat);
        const Δλ = toRad(b.lng - a.lng);
        const s =
            Math.sin(Δφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
        return 2 * EARTH_R * Math.asin(Math.sqrt(s));
    }

    function projectDistanceAlongCourse(lat, lng) {
        const start = KARAPIRO_START;
        const finish = KARAPIRO_FINISH;
        const ax =
            toRad(finish.lng - start.lng) *
            Math.cos(toRad((start.lat + finish.lat) / 2)) *
            EARTH_R;
        const ay = toRad(finish.lat - start.lat) * EARTH_R;
        const bx =
            toRad(lng - start.lng) * Math.cos(toRad((start.lat + lat) / 2)) * EARTH_R;
        const by = toRad(lat - start.lat) * EARTH_R;
        const denom = ax * ax + ay * ay || 1;
        const t = Math.max(0, Math.min(1, (bx * ax + by * ay) / denom));
        return t * COURSE_LENGTH_M;
    }

    function resolveMode() {
        const p = params();
        const fromUrl = parseInt(p.get('deviceId') || '', 10);
        const simParam = p.get('sim');
        if (Number.isFinite(fromUrl) && fromUrl >= 1 && simParam !== '1') {
            deviceId = fromUrl;
            return 'device';
        }
        deviceId = null;
        return 'sim';
    }

    function resolveSpeed() {
        const n = parseFloat(params().get('speed') || String(DEFAULT_SPEED_MPS));
        return Number.isFinite(n) && n > 0 ? Math.min(n, 12) : DEFAULT_SPEED_MPS;
    }

    function resolveLanes() {
        const n = parseInt(params().get('courseLanes') || String(DEFAULT_LANES), 10);
        return Number.isFinite(n) && n >= 1 ? Math.min(10, n) : DEFAULT_LANES;
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load ' + src));
            img.src = src;
        });
    }

    /** One-time black→alpha so the strip keys cleanly over the drone feed. */
    async function prepareCourseCanvas() {
        if (courseCanvas) return courseCanvas;
        if (courseReady) return courseReady;
        courseReady = (async () => {
            const img = await loadImage(COURSE_IMG);
            const w = img.naturalWidth || IMG_NATIVE_W;
            const h = img.naturalHeight || IMG_NATIVE_H;
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            const frame = ctx.getImageData(0, 0, w, h);
            const d = frame.data;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i] <= BLACK_KEY && d[i + 1] <= BLACK_KEY && d[i + 2] <= BLACK_KEY) {
                    d[i + 3] = 0;
                }
            }
            ctx.putImageData(frame, 0, 0);
            courseCanvas = c;
            return c;
        })();
        return courseReady;
    }

    function ensureRoot(stage) {
        if (root) return root;
        const host = stage || document.querySelector('.vg-stage');
        if (!host) return null;

        root = document.createElement('div');
        root.id = 'kriCourseScrollRoot';
        root.className = 'kri-course-scroll';
        root.setAttribute('role', 'img');
        root.setAttribute('aria-label', 'Rowing course underlay');

        viewport = document.createElement('div');
        viewport.className = 'kri-course-scroll__viewport';

        stripCanvas = document.createElement('canvas');
        stripCanvas.className = 'kri-course-scroll__strip';
        stripCanvas.width = OUT_W;
        stripCanvas.height = OUT_H;
        stripCtx = stripCanvas.getContext('2d');

        laneLayer = document.createElement('div');
        laneLayer.className = 'kri-course-scroll__lanes';

        hudEl = document.createElement('div');
        hudEl.className = 'kri-course-scroll__hud';
        hudEl.innerHTML =
            '<div class="kri-course-scroll__hud-inner">' +
            '<img class="kri-course-scroll__logo" src="assets/kri/kri-logo.png" alt="">' +
            '<div class="kri-course-scroll__hud-text">' +
            '<p class="kri-course-scroll__kicker">Karāpiro course</p>' +
            '<p class="kri-course-scroll__distance" id="kriCourseScrollDistance">0 m</p>' +
            '<p class="kri-course-scroll__meta" id="kriCourseScrollMeta">Simulation · 4.0 m/s</p>' +
            '</div></div>';

        viewport.appendChild(stripCanvas);
        viewport.appendChild(laneLayer);
        root.appendChild(viewport);
        root.appendChild(hudEl);
        host.appendChild(root);
        return root;
    }

    function pxPerMeter() {
        const src = courseCanvas || { height: IMG_NATIVE_H };
        return src.height / COURSE_LENGTH_M;
    }

    function stripLayout() {
        const src = courseCanvas || { width: IMG_NATIVE_W, height: IMG_NATIVE_H };
        const baseScale = OUT_W / src.width;
        const scale = baseScale * laneScale;
        const drawW = src.width * scale;
        const drawH = src.height * scale;
        const x = (OUT_W - drawW) / 2 + laneOffsetX;
        return { scale, drawW, drawH, x, src };
    }

    function cameraImageY() {
        return courseCanvas.height - distanceM * pxPerMeter();
    }

    function paintStrip() {
        if (!stripCtx || !courseCanvas) return;
        const { scale, drawW, x, src } = stripLayout();
        const camY = cameraImageY();
        const viewTopInImage = camY - (OUT_H * CAMERA_Y_FRAC) / scale;
        const destY = -viewTopInImage * scale;

        stripCtx.clearRect(0, 0, OUT_W, OUT_H);
        stripCtx.drawImage(src, 0, 0, src.width, src.height, x, destY, drawW, src.height * scale);
    }

    function laneCenterX(lane) {
        const { drawW, x } = stripLayout();
        const left = x + drawW * LANE_BAND_LEFT;
        const right = x + drawW * LANE_BAND_RIGHT;
        const band = right - left;
        const t = (lane - 0.5) / laneCount;
        return left + band * t;
    }

    function buildLaneCards(context) {
        if (!laneLayer) return;
        laneLayer.replaceChildren();
        const lanes = context?.lanes?.length
            ? context.lanes
            : Array.from({ length: laneCount }, (_, i) => ({
                  lane: i + 1,
                  shortLabel: 'L' + (i + 1),
                  label: 'Lane ' + (i + 1),
                  logoUrl: null,
              }));

        for (const entry of lanes) {
            const lane = Number(entry.lane);
            if (!Number.isFinite(lane) || lane < 1 || lane > laneCount) continue;
            const card = document.createElement('div');
            card.className = 'kri-course-scroll__lane';
            card.dataset.lane = String(lane);
            card.style.left = laneCenterX(lane) + 'px';

            const num = document.createElement('span');
            num.className = 'kri-course-scroll__lane-num';
            num.textContent = String(lane);

            const body = document.createElement('div');
            body.className = 'kri-course-scroll__lane-body';
            if (entry.logoUrl) {
                const img = document.createElement('img');
                img.className = 'kri-course-scroll__lane-logo';
                img.src = entry.logoUrl;
                img.alt = '';
                body.appendChild(img);
            }
            const code = document.createElement('span');
            code.className = 'kri-course-scroll__lane-code';
            code.textContent = entry.shortLabel || entry.label || 'L' + lane;
            body.appendChild(code);

            card.appendChild(num);
            card.appendChild(body);
            laneLayer.appendChild(card);
        }
    }

    function repositionLaneCards() {
        if (!laneLayer) return;
        laneLayer.querySelectorAll('.kri-course-scroll__lane').forEach((el) => {
            const lane = parseInt(el.dataset.lane || '0', 10);
            if (lane >= 1) el.style.left = laneCenterX(lane) + 'px';
        });
    }

    function updateHud() {
        const dist = document.getElementById('kriCourseScrollDistance');
        const meta = document.getElementById('kriCourseScrollMeta');
        if (dist) dist.textContent = Math.round(distanceM) + ' m / ' + COURSE_LENGTH_M + ' m';
        if (meta) {
            if (mode === 'device') {
                meta.textContent = 'CrewSight · device ' + deviceId;
            } else {
                meta.textContent = 'Simulation · ' + speedMps.toFixed(1) + ' m/s';
            }
            if (raceContext?.event) {
                meta.textContent += ' · ' + raceContext.event;
                if (raceContext.race) meta.textContent += ' · Race ' + raceContext.race;
            }
        }
    }

    async function applyCvScale() {
        if (!cvScaleEnabled || !global.AltitudeHdCvOverlay?.fetchPosition) return;
        try {
            const data = await global.AltitudeHdCvOverlay.fetchPosition();
            const boats = Array.isArray(data?.boats) ? data.boats : [];
            if (boats.length < 2) return;
            const xs = boats.map((b) => Number(b.x)).filter((n) => Number.isFinite(n));
            if (xs.length < 2) return;
            const span = Math.max(...xs) - Math.min(...xs);
            const refW = Number(data.refW) || 1280;
            if (span < refW * 0.08) return;
            const targetFrac = 0.7;
            const measuredFrac = span / refW;
            const next = Math.max(0.75, Math.min(1.35, (targetFrac / measuredFrac) * laneScale));
            laneScale += (next - laneScale) * 0.08;
            const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
            const desiredMid = OUT_W / 2;
            const mappedMid = (mid / refW) * OUT_W;
            laneOffsetX += (desiredMid - mappedMid - laneOffsetX) * 0.05;
        } catch {
            /* ignore */
        }
    }

    async function pollDevice() {
        if (mode !== 'device' || !deviceId) return;
        try {
            const res = await fetch('/api/positions', { cache: 'no-store' });
            if (!res.ok) return;
            const list = await res.json();
            const rows = Array.isArray(list) ? list : list?.positions || [];
            const hit = rows.find((p) => Number(p.deviceId) === Number(deviceId));
            if (!hit) return;
            const lat = Number(hit.latitude ?? hit.lat);
            const lng = Number(hit.longitude ?? hit.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            distanceM = projectDistanceAlongCourse(lat, lng);
        } catch {
            /* ignore */
        }
    }

    function frame(ts) {
        if (!running || !root) {
            rafId = null;
            return;
        }
        if (!lastTs) lastTs = ts;
        const dt = Math.min(0.05, (ts - lastTs) / 1000);
        lastTs = ts;

        if (mode === 'sim') {
            distanceM += speedMps * dt;
            if (distanceM >= COURSE_LENGTH_M) {
                if (loopSim) distanceM = 0;
                else distanceM = COURSE_LENGTH_M;
            }
        }

        paintStrip();
        repositionLaneCards();
        updateHud();
        rafId = requestAnimationFrame(frame);
    }

    function startLoop() {
        if (rafId != null) return;
        lastTs = 0;
        rafId = requestAnimationFrame(frame);
    }

    function stopLoop() {
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        lastTs = 0;
    }

    function clearPoll() {
        if (pollTimer != null) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        if (cvTimer != null) {
            clearInterval(cvTimer);
            cvTimer = null;
        }
    }

    function startPoll() {
        clearPoll();
        if (mode === 'device') {
            pollDevice();
            pollTimer = setInterval(pollDevice, 1000);
        }
        if (cvScaleEnabled) {
            applyCvScale();
            cvTimer = setInterval(applyCvScale, 500);
        }
    }

    async function show(opts) {
        opts = opts || {};
        ensureRoot(document.querySelector('.vg-stage'));
        if (!root) return;

        mode = opts.mode || resolveMode();
        speedMps = opts.speedMps || resolveSpeed();
        laneCount = opts.laneCount || resolveLanes();
        loopSim = params().get('loop') === '1' || !!opts.loop;
        cvScaleEnabled = params().get('cvScale') === '1' || !!opts.cvScale;
        raceContext = opts.raceContext || null;
        distanceM = Number.isFinite(opts.distanceM) ? opts.distanceM : 0;
        laneScale = 1;
        laneOffsetX = 0;
        running = true;

        root.classList.remove(
            'kri-course-scroll--outro',
            'kri-course-scroll--hold',
            'kri-course-scroll--visible',
        );
        root.classList.add('kri-course-scroll--intro');
        void root.offsetWidth;
        root.classList.add('kri-course-scroll--visible');

        await prepareCourseCanvas();
        buildLaneCards(raceContext);
        updateHud();
        paintStrip();
        startPoll();
        startLoop();

        await wait(INTRO_MS);
        if (!running) return;
        root.classList.remove('kri-course-scroll--intro');
        root.classList.add('kri-course-scroll--hold');
    }

    async function hide() {
        running = false;
        clearPoll();
        stopLoop();
        if (!root) return;
        root.classList.remove('kri-course-scroll--hold', 'kri-course-scroll--intro');
        root.classList.add('kri-course-scroll--outro');
        await wait(OUTRO_MS);
        destroy();
    }

    function destroy() {
        running = false;
        clearPoll();
        stopLoop();
        if (root) {
            root.classList.remove(
                'kri-course-scroll--visible',
                'kri-course-scroll--intro',
                'kri-course-scroll--hold',
                'kri-course-scroll--outro',
            );
        }
    }

    function remove() {
        destroy();
        raceContext = null;
        if (root) {
            root.remove();
            root = null;
            viewport = null;
            stripCanvas = null;
            stripCtx = null;
            laneLayer = null;
            hudEl = null;
        }
    }

    function updateRaceContext(ctx) {
        raceContext = ctx || null;
        buildLaneCards(raceContext);
        updateHud();
    }

    global.KriVmixCourseScroll = {
        INTRO_MS: INTRO_MS,
        OUTRO_MS: OUTRO_MS,
        COURSE_LENGTH_M: COURSE_LENGTH_M,
        show: show,
        hide: hide,
        destroy: destroy,
        remove: remove,
        updateRaceContext: updateRaceContext,
        getDistanceM: function () {
            return distanceM;
        },
        setDistanceM: function (m) {
            distanceM = Math.max(0, Math.min(COURSE_LENGTH_M, Number(m) || 0));
        },
    };
})(typeof window !== 'undefined' ? window : globalThis);
