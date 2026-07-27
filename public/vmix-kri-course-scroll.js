/**
 * KRI drone course underlay (u) — procedural 2 km × 10-lane strip keyed to a follow-boat tracker.
 *
 * Geometry (Karāpiro-style):
 *   10 lanes, 10 m centres · OOB bands outside lanes 1 & 10 · markers every 250 m
 *   buoys along lane edges (same idea as kri-race-viewer) · Start / Finish labels
 *
 * Modes:
 *   sim (default) — start→finish at ~4 m/s
 *   device        — CrewSight/Traccar deviceId projected onto Karāpiro start/finish
 *
 * URL params:
 *   ?sim=1|0  ?speed=4  ?deviceId=123  ?courseLanes=10  ?cvScale=1  ?loop=1
 *   ?ppm=14   pixels per metre (lane scale); omit to auto-fit width
 */
(function (global) {
    const INTRO_MS = 900;
    const OUTRO_MS = 900;
    const OUT_W = 1920;
    const OUT_H = 1080;
    const COURSE_LENGTH_M = 2000;
    const DEFAULT_SPEED_MPS = 4;
    const LANE_COUNT = 10;
    const LANE_SPACING_M = 10;
    const OOB_WIDTH_M = 10;
    const MARKER_EVERY_M = 250;
    const BUOY_SPACING_M = 20;
    const ZONE_START_M = 100;
    const ZONE_FINISH_M = 250;
    const CAMERA_Y_FRAC = 0.62;
    const COURSE_PAD_FRAC = 0.88;

    const KARAPIRO_START = { lat: -37.943356, lng: 175.556788 };
    const KARAPIRO_FINISH = { lat: -37.929223, lng: 175.542716 };
    const EARTH_R = 6371000;

    const COLORS = {
        oob: 'rgba(239, 68, 68, 0.14)',
        oobEdge: 'rgba(248, 113, 113, 0.55)',
        laneLine: 'rgba(255, 255, 255, 0.28)',
        marker: 'rgba(56, 189, 248, 0.85)',
        markerMajor: 'rgba(125, 211, 252, 0.95)',
        start: '#22c55e',
        finish: '#ef4444',
        buoyCore: '#0079d1',
        buoyYellow: '#eab308',
        buoyStroke: '#ffffff',
        label: '#ffffff',
        labelShadow: 'rgba(8, 20, 40, 0.75)',
    };

    let root = null;
    let viewport = null;
    let stripCanvas = null;
    let stripCtx = null;
    let laneLayer = null;
    let hudEl = null;
    let rafId = null;
    let lastTs = 0;
    let distanceM = 0;
    let speedMps = DEFAULT_SPEED_MPS;
    let laneCount = LANE_COUNT;
    let mode = 'sim';
    let deviceId = null;
    let loopSim = false;
    let cvScaleEnabled = false;
    let laneScale = 1;
    let laneOffsetX = 0;
    let ppmOverride = null;
    let raceContext = null;
    let leaderLane = null;
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
        const n = parseInt(params().get('courseLanes') || String(LANE_COUNT), 10);
        return Number.isFinite(n) && n >= 1 ? Math.min(12, n) : LANE_COUNT;
    }

    function resolvePpm() {
        const n = parseFloat(params().get('ppm') || '');
        return Number.isFinite(n) && n > 0 ? n : null;
    }

    /** Total drawn width in metres: OOB + n lanes + OOB. */
    function courseWidthM() {
        return OOB_WIDTH_M * 2 + laneCount * LANE_SPACING_M;
    }

    function basePpm() {
        if (ppmOverride != null) return ppmOverride;
        return (OUT_W * COURSE_PAD_FRAC) / courseWidthM();
    }

    function effectivePpm() {
        return basePpm() * laneScale;
    }

    /** Lane centre X in screen space (lane 1 … n). */
    function laneCenterX(lane) {
        const ppm = effectivePpm();
        const totalW = courseWidthM() * ppm;
        const originX = (OUT_W - totalW) / 2 + laneOffsetX;
        const racingLeft = originX + OOB_WIDTH_M * ppm;
        return racingLeft + (lane - 0.5) * LANE_SPACING_M * ppm;
    }

    /** Outer edge X of racing band (lane 1 left / lane n right). */
    function racingBandX() {
        const ppm = effectivePpm();
        const totalW = courseWidthM() * ppm;
        const originX = (OUT_W - totalW) / 2 + laneOffsetX;
        return {
            left: originX + OOB_WIDTH_M * ppm,
            right: originX + (OOB_WIDTH_M + laneCount * LANE_SPACING_M) * ppm,
            originX,
            totalW,
            ppm,
        };
    }

    /** Map course distance (0=start … 2000=finish) to screen Y. */
    function distanceToScreenY(d) {
        const ppm = effectivePpm();
        const camY = OUT_H * CAMERA_Y_FRAC;
        return camY - (d - distanceM) * ppm;
    }

    function visibleDistanceWindow() {
        const ppm = effectivePpm();
        const camY = OUT_H * CAMERA_Y_FRAC;
        const topDist = distanceM + camY / ppm;
        const botDist = distanceM - (OUT_H - camY) / ppm;
        return {
            minD: Math.max(-50, botDist - 40),
            maxD: Math.min(COURSE_LENGTH_M + 50, topDist + 40),
        };
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

    function drawOob(ctx, band) {
        const { originX, left, right, totalW, ppm } = band;
        ctx.fillStyle = COLORS.oob;
        ctx.fillRect(originX, 0, left - originX, OUT_H);
        ctx.fillRect(right, 0, originX + totalW - right, OUT_H);

        ctx.strokeStyle = COLORS.oobEdge;
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(left, 0);
        ctx.lineTo(left, OUT_H);
        ctx.moveTo(right, 0);
        ctx.lineTo(right, OUT_H);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.save();
        ctx.fillStyle = 'rgba(254, 202, 202, 0.75)';
        ctx.font = '800 15px "Barlow Condensed", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        const oobMidL = (originX + left) / 2;
        const oobMidR = (right + originX + totalW) / 2;
        ctx.translate(oobMidL, OUT_H * 0.5);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('OUT OF BOUNDS', 0, 0);
        ctx.restore();
        ctx.save();
        ctx.fillStyle = 'rgba(254, 202, 202, 0.75)';
        ctx.font = '800 15px "Barlow Condensed", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.translate(oobMidR, OUT_H * 0.5);
        ctx.rotate(Math.PI / 2);
        ctx.fillText('OUT OF BOUNDS', 0, 0);
        ctx.restore();
    }

    function drawLaneLines(ctx, band) {
        const { left, ppm } = band;
        ctx.strokeStyle = COLORS.laneLine;
        ctx.lineWidth = 1.25;
        for (let i = 0; i <= laneCount; i++) {
            const x = left + i * LANE_SPACING_M * ppm;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, OUT_H);
            ctx.stroke();
        }
    }

    function buoyColor(d) {
        if (d <= ZONE_START_M || d >= COURSE_LENGTH_M - ZONE_FINISH_M) {
            return COLORS.buoyYellow;
        }
        return COLORS.buoyCore;
    }

    function drawBuoys(ctx, band, minD, maxD) {
        const { left, ppm } = band;
        const r = Math.max(3.5, Math.min(6, ppm * 0.45));
        for (let i = 0; i <= laneCount; i++) {
            const x = left + i * LANE_SPACING_M * ppm;
            const start = Math.ceil(Math.max(BUOY_SPACING_M, minD) / BUOY_SPACING_M) * BUOY_SPACING_M;
            for (let d = start; d < COURSE_LENGTH_M && d <= maxD; d += BUOY_SPACING_M) {
                const y = distanceToScreenY(d);
                if (y < -10 || y > OUT_H + 10) continue;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = buoyColor(d);
                ctx.fill();
                ctx.strokeStyle = COLORS.buoyStroke;
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
        }
    }

    function drawCheckerFinish(ctx, x0, x1, y, thickness) {
        const cells = 16;
        const cellW = (x1 - x0) / cells;
        const half = thickness / 2;
        for (let i = 0; i < cells; i++) {
            ctx.fillStyle = i % 2 === 0 ? '#0f172a' : '#f8fafc';
            ctx.fillRect(x0 + i * cellW, y - half, cellW + 0.5, thickness);
        }
    }

    function drawStrokeLabel(ctx, text, x, y, opts) {
        ctx.save();
        ctx.font = opts.font || '800 18px "Barlow Condensed", "Segoe UI", sans-serif';
        ctx.textAlign = opts.align || 'left';
        ctx.textBaseline = opts.baseline || 'middle';
        ctx.lineWidth = 4;
        ctx.strokeStyle = COLORS.labelShadow;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = opts.fill || COLORS.label;
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    function drawDistanceMarkers(ctx, band, minD, maxD) {
        const { left, right } = band;
        for (let d = 0; d <= COURSE_LENGTH_M; d += MARKER_EVERY_M) {
            if (d < minD - 20 || d > maxD + 20) continue;
            const y = distanceToScreenY(d);
            if (y < -40 || y > OUT_H + 40) continue;

            const isMajor = d === 0 || d === COURSE_LENGTH_M || d % 500 === 0;
            ctx.strokeStyle = isMajor ? COLORS.markerMajor : COLORS.marker;
            ctx.lineWidth = isMajor ? 3 : 2;
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();

            if (d === 0) {
                ctx.strokeStyle = COLORS.start;
                ctx.lineWidth = 4;
                ctx.shadowColor = 'rgba(34, 197, 94, 0.55)';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.moveTo(left, y);
                ctx.lineTo(right, y);
                ctx.stroke();
                ctx.shadowBlur = 0;
                drawStrokeLabel(ctx, 'START', left + 10, y - 16, {
                    fill: '#dcfce7',
                    font: '800 22px "Barlow Condensed", "Segoe UI", sans-serif',
                });
            } else if (d === COURSE_LENGTH_M) {
                drawCheckerFinish(ctx, left, right, y, 14);
                ctx.strokeStyle = COLORS.finish;
                ctx.lineWidth = 3;
                ctx.shadowColor = 'rgba(239, 68, 68, 0.5)';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.moveTo(left, y);
                ctx.lineTo(right, y);
                ctx.stroke();
                ctx.shadowBlur = 0;
                drawStrokeLabel(ctx, 'FINISH', right - 10, y - 16, {
                    align: 'end',
                    fill: '#fee2e2',
                    font: '800 22px "Barlow Condensed", "Segoe UI", sans-serif',
                });
            } else {
                const label = d + ' m';
                drawStrokeLabel(ctx, label, left + 8, y - 12, {
                    fill: '#e0f2fe',
                    font: '700 16px "Barlow Condensed", "Segoe UI", sans-serif',
                });
            }
        }
    }

    function drawLaneNumbers(ctx, band) {
        const { left, ppm } = band;
        ctx.font = '800 13px "Barlow Condensed", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let lane = 1; lane <= laneCount; lane++) {
            const x = left + (lane - 0.5) * LANE_SPACING_M * ppm;
            const y = 28;
            ctx.fillStyle = 'rgba(0, 96, 191, 0.88)';
            const bx = x - 12;
            const by = y - 11;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(bx, by, 24, 22, 4);
            } else {
                ctx.rect(bx, by, 24, 22);
            }
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(String(lane), x, y + 1);
        }
    }

    function paintStrip() {
        if (!stripCtx) return;
        const ctx = stripCtx;
        ctx.clearRect(0, 0, OUT_W, OUT_H);

        const band = racingBandX();
        const { minD, maxD } = visibleDistanceWindow();

        drawOob(ctx, band);
        drawLaneLines(ctx, band);
        drawBuoys(ctx, band, minD, maxD);
        drawDistanceMarkers(ctx, band, minD, maxD);
        drawLaneNumbers(ctx, band);
    }

    function buildLaneCards(context) {
        if (!laneLayer) return;
        laneLayer.replaceChildren();
        const byLane = new Map();
        for (const entry of context?.lanes || []) {
            byLane.set(Number(entry.lane), entry);
        }

        for (let lane = 1; lane <= laneCount; lane++) {
            const entry = byLane.get(lane) || {
                lane,
                shortLabel: '',
                label: '',
                logoUrl: null,
            };
            const card = document.createElement('div');
            card.className = 'kri-course-scroll__lane';
            if (!entry.shortLabel && !entry.label) {
                card.classList.add('kri-course-scroll__lane--empty');
            }
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
            code.textContent = entry.shortLabel || entry.label || '—';
            body.appendChild(code);

            card.appendChild(num);
            card.appendChild(body);
            laneLayer.appendChild(card);
        }
        applyLeaderHighlight();
    }

    function applyLeaderHighlight() {
        if (!laneLayer) return;
        laneLayer.querySelectorAll('.kri-course-scroll__lane').forEach((el) => {
            const lane = parseInt(el.dataset.lane || '0', 10);
            const isLeader = leaderLane != null && lane === leaderLane;
            el.classList.toggle('kri-course-scroll__lane--leader', isLeader);
            let badge = el.querySelector('.kri-course-scroll__leader-badge');
            if (isLeader) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'kri-course-scroll__leader-badge';
                    badge.textContent = 'Leader';
                    el.insertBefore(badge, el.firstChild);
                }
            } else if (badge) {
                badge.remove();
            }
        });
    }

    function setLeaderLane(lane) {
        const n = parseInt(String(lane), 10);
        if (!Number.isFinite(n) || n < 1 || n > laneCount) return leaderLane;
        if (leaderLane === n) {
            applyLeaderHighlight();
            return leaderLane;
        }
        leaderLane = n;
        applyLeaderHighlight();
        return leaderLane;
    }

    function getLeaderLane() {
        return leaderLane;
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
        if (dist) {
            dist.textContent = Math.round(distanceM) + ' m / ' + COURSE_LENGTH_M + ' m';
        }
        if (meta) {
            if (mode === 'device') {
                meta.textContent = 'CrewSight · device ' + deviceId;
            } else {
                meta.textContent = 'Simulation · ' + speedMps.toFixed(1) + ' m/s';
            }
            meta.textContent += ' · ' + laneCount + ' lanes × ' + LANE_SPACING_M + ' m';
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
        ppmOverride = opts.ppm != null ? opts.ppm : resolvePpm();
        loopSim = params().get('loop') === '1' || !!opts.loop;
        cvScaleEnabled = params().get('cvScale') === '1' || !!opts.cvScale;
        raceContext = opts.raceContext || null;
        const fromOpts = parseInt(String(opts.leaderLane ?? ''), 10);
        leaderLane =
            Number.isFinite(fromOpts) && fromOpts >= 1 && fromOpts <= laneCount
                ? fromOpts
                : null;
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
        leaderLane = null;
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
        LANE_COUNT: LANE_COUNT,
        LANE_SPACING_M: LANE_SPACING_M,
        show: show,
        hide: hide,
        destroy: destroy,
        remove: remove,
        updateRaceContext: updateRaceContext,
        setLeaderLane: setLeaderLane,
        getLeaderLane: getLeaderLane,
        getDistanceM: function () {
            return distanceM;
        },
        setDistanceM: function (m) {
            distanceM = Math.max(0, Math.min(COURSE_LENGTH_M, Number(m) || 0));
        },
    };
})(typeof window !== 'undefined' ? window : globalThis);
