/**
 * KRI live stream — CV-linked leader card with tapered connector line.
 * Polls /api/cv-position and places the KRI leader box up-right at 45° from the leader.
 */
(function (global) {
    const INTRO_MS = 900;
    const OUTRO_MS = 900;
    const DEFAULT_LINE_LENGTH = 136;
    const BOX_DISTANCE_FACTOR = 0.75;
    const W_THIN = 1.5;
    const W_THICK = 14;
    const COS45 = Math.SQRT1_2;
    const SIN45 = Math.SQRT1_2;
    const OUT_W = 1920;
    const OUT_H = 1080;
    const DEFAULT_REF_W = 1280;
    const DEFAULT_REF_H = 720;
    const SMOOTH_TAU_MS = 280;

    let root = null;
    let svg = null;
    let connector = null;
    let cardWrap = null;
    let cardEl = null;
    let pollTimer = null;
    let activeRace = null;
    let activeLane = 4;
    let lineLength = DEFAULT_LINE_LENGTH;
    let lastAnchor = null;
    let rafId = null;
    let smoothAx = 0;
    let smoothAy = 0;
    let targetAx = 0;
    let targetAy = 0;
    let hasSmooth = false;
    let lastFrameTs = 0;

    function smoothTauMs() {
        const n = parseInt(params().get('smooth') || String(SMOOTH_TAU_MS), 10);
        if (n === 0) return 0;
        return Number.isFinite(n) ? Math.max(80, Math.min(n, 1200)) : SMOOTH_TAU_MS;
    }

    function stopSmoothLoop() {
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        lastFrameTs = 0;
    }

    function resetSmooth() {
        stopSmoothLoop();
        hasSmooth = false;
        smoothAx = 0;
        smoothAy = 0;
        targetAx = 0;
        targetAy = 0;
    }

    function setTargetAnchor(ax, ay) {
        targetAx = ax;
        targetAy = ay;
        if (!hasSmooth) {
            smoothAx = ax;
            smoothAy = ay;
            hasSmooth = true;
            applyAnchor(ax, ay);
            return;
        }
        if (rafId == null) startSmoothLoop();
    }

    function startSmoothLoop() {
        if (rafId != null) return;
        lastFrameTs = 0;
        rafId = requestAnimationFrame(smoothFrame);
    }

    function smoothFrame(ts) {
        if (!root || !hasSmooth) {
            rafId = null;
            return;
        }
        if (!lastFrameTs) lastFrameTs = ts;
        const dt = Math.min(48, ts - lastFrameTs);
        lastFrameTs = ts;
        const tau = smoothTauMs();
        if (tau <= 0) {
            smoothAx = targetAx;
            smoothAy = targetAy;
        } else {
            const blend = 1 - Math.exp(-dt / tau);
            smoothAx += (targetAx - smoothAx) * blend;
            smoothAy += (targetAy - smoothAy) * blend;
        }
        applyAnchor(smoothAx, smoothAy);
        const dx = targetAx - smoothAx;
        const dy = targetAy - smoothAy;
        if (dx * dx + dy * dy < 0.25) {
            smoothAx = targetAx;
            smoothAy = targetAy;
            applyAnchor(smoothAx, smoothAy);
            rafId = null;
            lastFrameTs = 0;
            return;
        }
        rafId = requestAnimationFrame(smoothFrame);
    }

    function params() {
        return new URLSearchParams(location.search);
    }

    function pollMs() {
        const n = parseInt(params().get('poll') || '200', 10);
        return Number.isFinite(n) ? Math.max(100, Math.min(n, 2000)) : 200;
    }

    function clearPoll() {
        if (pollTimer != null) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function ensureRoot(stage) {
        if (root) return root;
        const host = stage || document.querySelector('.vg-stage');
        if (!host) return null;

        root = document.createElement('div');
        root.id = 'kriCvLeaderRoot';
        root.className = 'kri-cv-leader';
        root.setAttribute('role', 'img');
        root.setAttribute('aria-label', 'CV leader');

        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('kri-cv-leader__svg');
        svg.setAttribute('viewBox', `0 0 ${OUT_W} ${OUT_H}`);
        svg.setAttribute('preserveAspectRatio', 'none');

        connector = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        connector.classList.add('kri-cv-leader__connector');
        connector.setAttribute('points', '');
        svg.appendChild(connector);

        cardWrap = document.createElement('div');
        cardWrap.className = 'kri-cv-leader__card-wrap';

        root.appendChild(svg);
        root.appendChild(cardWrap);
        host.appendChild(root);
        return root;
    }

    function buildCard(race, lane) {
        const build = global.VmixGraphics?.buildKriLeaderCard;
        if (!build) return null;
        return build(race, lane);
    }

    function mountCard(race, lane) {
        if (!cardWrap) return null;
        cardWrap.replaceChildren();
        cardEl = buildCard(race, lane);
        if (!cardEl) return null;
        cardWrap.appendChild(cardEl);
        const h = cardEl.offsetHeight;
        if (h > 0) lineLength = Math.max(80, h * 2);
        return cardEl;
    }

    function boxAnchor(ax, ay) {
        const dist = lineLength * BOX_DISTANCE_FACTOR;
        return {
            bx: ax + dist * COS45,
            by: ay - dist * SIN45,
        };
    }

    function lineUnit(ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        return { ux: dx / len, uy: dy / len, len };
    }

    /** Extend connector past the box anchor so the line reads as going behind the panel. */
    function connectorEnd(ax, ay, bx, by) {
        const { ux, uy } = lineUnit(ax, ay, bx, by);
        let extend = 40;
        if (cardEl) {
            const panel = cardEl.querySelector('.vg-kri-leader-panel');
            const w = (panel || cardEl).offsetWidth || cardEl.offsetWidth || 180;
            const h = cardEl.offsetHeight || 100;
            extend = Math.max(32, Math.min(w * 0.45, h * 0.55, 80));
        }
        return {
            ex: bx + ux * extend,
            ey: by + uy * extend,
        };
    }

    function connectorPoints(ax, ay, bx, by) {
        const { ux, uy } = lineUnit(ax, ay, bx, by);
        const px = -uy;
        const py = ux;
        const { ex, ey } = connectorEnd(ax, ay, bx, by);
        return [
            [ax + px * W_THIN, ay + py * W_THIN],
            [ax - px * W_THIN, ay - py * W_THIN],
            [ex - px * W_THICK, ey - py * W_THICK],
            [ex + px * W_THICK, ey + py * W_THICK],
        ]
            .map((pt) => pt.join(','))
            .join(' ');
    }

    function positionCard(bx, by) {
        if (!cardWrap) return;
        cardWrap.style.left = `${bx}px`;
        cardWrap.style.top = `${by}px`;
    }

    function applyAnchor(ax, ay) {
        if (!connector) return;
        const { bx, by } = boxAnchor(ax, ay);
        connector.setAttribute('points', connectorPoints(ax, ay, bx, by));
        positionCard(bx, by);
        lastAnchor = { ax, ay, bx, by };
    }

    function mapCvPoint(data) {
        const cv = global.AltitudeHdCvOverlay;
        if (!cv?.mapPoint) return null;
        const refW = Number(data.refW) || DEFAULT_REF_W;
        const refH = Number(data.refH) || DEFAULT_REF_H;
        const offset = data.offset || cv.venueOffset?.(data.venue) || { x: 0, y: 0 };
        return cv.mapPoint(data.x, data.y, refW, refH, offset);
    }

    async function tick() {
        if (!root || !global.AltitudeHdCvOverlay?.fetchPosition) return;
        try {
            const data = await global.AltitudeHdCvOverlay.fetchPosition();
            if (!data || data.stale) {
                root.classList.add('kri-cv-leader--stale');
                return;
            }
            root.classList.remove('kri-cv-leader--stale');
            const pt = mapCvPoint(data);
            if (!pt) return;
            const ax = Math.max(0, Math.min(OUT_W, pt.left));
            const ay = Math.max(0, Math.min(OUT_H, pt.top));
            setTargetAnchor(ax, ay);
        } catch {
            root.classList.add('kri-cv-leader--stale');
        }
    }

    function startPoll() {
        clearPoll();
        tick();
        pollTimer = setInterval(tick, pollMs());
    }

    async function show(opts = {}) {
        ensureRoot(document.querySelector('.vg-stage'));
        if (!root) return;

        if (global.AltitudeHdCvOverlay?.ensureStreamId) {
            await global.AltitudeHdCvOverlay.ensureStreamId();
        }

        activeRace = opts.race || null;
        activeLane = opts.lane ?? activeLane;
        mountCard(activeRace, activeLane);

        root.classList.remove(
            'kri-cv-leader--outro',
            'kri-cv-leader--hold',
            'kri-cv-leader--stale',
        );
        root.classList.add('kri-cv-leader--intro');
        void root.offsetWidth;
        root.classList.add('kri-cv-leader--visible');

        if (lastAnchor) {
            setTargetAnchor(lastAnchor.ax, lastAnchor.ay);
        } else {
            setTargetAnchor(OUT_W * 0.35, OUT_H * 0.55);
        }

        startPoll();
        await wait(INTRO_MS);
        root.classList.remove('kri-cv-leader--intro');
        root.classList.add('kri-cv-leader--hold');
    }

    async function hide() {
        clearPoll();
        if (!root) return;
        root.classList.remove('kri-cv-leader--hold', 'kri-cv-leader--intro');
        root.classList.add('kri-cv-leader--outro');
        await wait(OUTRO_MS);
        destroy();
    }

    function destroy() {
        clearPoll();
        stopSmoothLoop();
        if (root) {
            root.classList.remove(
                'kri-cv-leader--visible',
                'kri-cv-leader--intro',
                'kri-cv-leader--hold',
                'kri-cv-leader--outro',
                'kri-cv-leader--stale',
            );
        }
    }

    function remove() {
        clearPoll();
        stopSmoothLoop();
        resetSmooth();
        lastAnchor = null;
        activeRace = null;
        cardEl = null;
        if (root) {
            root.remove();
            root = null;
            svg = null;
            connector = null;
            cardWrap = null;
        }
    }

    function setLane(lane) {
        activeLane = lane;
        if (!activeRace || !root) return;
        mountCard(activeRace, activeLane);
        if (lastAnchor) setTargetAnchor(lastAnchor.ax, lastAnchor.ay);
    }

    global.KriVmixCvLeader = {
        INTRO_MS,
        OUTRO_MS,
        show,
        hide,
        destroy,
        remove,
        setLane,
    };
})(typeof window !== 'undefined' ? window : globalThis);
