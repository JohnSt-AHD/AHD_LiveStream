/**
 * KRI CV draw overlay (h) — one connector + crew card per CV slot (daysheet draw).
 * Crew text is fixed at show; lines track CV boat positions; race leader gets gold glow.
 */
(function (global) {
    const INTRO_MS = 2500;
    const OUTRO_MS = 2500;
    const W_THIN = 1;
    const W_THICK = 7;
    const CARD_SCALE = 0.5;
    const OUT_W = 1920;
    const OUT_H = 1080;
    const DEFAULT_REF_W = 1280;
    const DEFAULT_REF_H = 720;
    const SMOOTH_TAU_MS = 280;
    const DEFAULT_BOAT_COUNT = 8;

    let root = null;
    let svg = null;
    let pollTimer = null;
    let activeRace = null;
    let raceBoatCount = DEFAULT_BOAT_COUNT;
    let instances = [];
    let leaderSlot = null;
    let rafId = null;
    let lastFrameTs = 0;

    function params() {
        return new URLSearchParams(location.search);
    }

    function pollMs() {
        const n = parseInt(params().get('poll') || '200', 10);
        return Number.isFinite(n) ? Math.max(100, Math.min(n, 2000)) : 200;
    }

    function smoothTauMs() {
        const n = parseInt(params().get('smooth') || String(SMOOTH_TAU_MS), 10);
        if (n === 0) return 0;
        return Number.isFinite(n) ? Math.max(80, Math.min(n, 1200)) : SMOOTH_TAU_MS;
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

    async function resolveRaceBoatCount() {
        const fromUrl = parseInt(params().get('raceBoats') || '', 10);
        if (Number.isFinite(fromUrl) && fromUrl >= 1) {
            return Math.min(16, fromUrl);
        }
        const cv = global.AltitudeHdCvOverlay;
        if (cv?.fetchPosition) {
            try {
                const data = await cv.fetchPosition();
                const fromPost = parseInt(data?.race_boat_count || data?.raceBoatCount || '', 10);
                if (Number.isFinite(fromPost) && fromPost >= 1) {
                    return Math.min(16, fromPost);
                }
            } catch {
                /* ignore */
            }
        }
        const api = cv?.laptopApiBase?.();
        if (api) {
            try {
                const res = await fetch(`${api}/api/config`, { cache: 'no-store' });
                if (res.ok) {
                    const cfg = await res.json();
                    const n = parseInt(cfg?.race_boat_count, 10);
                    if (Number.isFinite(n) && n >= 1) return Math.min(16, n);
                }
            } catch {
                /* ignore */
            }
        }
        return DEFAULT_BOAT_COUNT;
    }

    function cardStation(slot, count) {
        const marginTop = 64;
        const marginBottom = 64;
        const avail = OUT_H - marginTop - marginBottom;
        const step = avail / Math.max(1, count);
        return {
            bx: OUT_W - 28,
            by: marginTop + (slot - 0.5) * step,
        };
    }

    function lineUnit(ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        return { ux: dx / len, uy: dy / len, len };
    }

    function connectorPoints(ax, ay, bx, by, extend) {
        const { ux, uy } = lineUnit(ax, ay, bx, by);
        const px = -uy;
        const py = ux;
        const ex = bx + ux * extend;
        const ey = by + uy * extend;
        return [
            [ax + px * W_THIN, ay + py * W_THIN],
            [ax - px * W_THIN, ay - py * W_THIN],
            [ex - px * W_THICK, ey - py * W_THICK],
            [ex + px * W_THICK, ey + py * W_THICK],
        ]
            .map((pt) => pt.join(','))
            .join(' ');
    }

    function mapCvPoint(data, x, y) {
        const cv = global.AltitudeHdCvOverlay;
        if (!cv?.mapPoint) return null;
        const refW = Number(data.refW) || DEFAULT_REF_W;
        const refH = Number(data.refH) || DEFAULT_REF_H;
        const offset = data.offset || cv.venueOffset?.(data.venue) || { x: 0, y: 0 };
        return cv.mapPoint(x, y, refW, refH, offset);
    }

    function ensureRoot(stage) {
        if (root) return root;
        const host = stage || document.querySelector('.vg-stage');
        if (!host) return null;

        root = document.createElement('div');
        root.id = 'kriCvDrawRoot';
        root.className = 'kri-cv-draw';
        root.setAttribute('role', 'img');
        root.setAttribute('aria-label', 'CV draw boats');

        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('kri-cv-draw__svg');
        svg.setAttribute('viewBox', `0 0 ${OUT_W} ${OUT_H}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        root.appendChild(svg);
        host.appendChild(root);
        return root;
    }

    function destroyInstances() {
        instances = [];
        if (svg) svg.replaceChildren();
    }

    function mountInstances(race, count, boatDirection) {
        destroyInstances();
        const map = global.AltitudeHdCvBoatMap;
        const lookup = global.VmixGraphics?.getLookup?.() || null;
        const build = global.VmixGraphics?.buildKriCvDrawCard;
        if (!race || !map || !build) return;

        for (let slot = 1; slot <= count; slot++) {
            const draw = map.mapSlotToDraw(slot, race, boatDirection, lookup);
            if (!draw?.lane) continue;

            const connector = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            connector.classList.add('kri-cv-draw__connector');
            connector.dataset.slot = String(slot);
            svg.appendChild(connector);

            const cardWrap = document.createElement('div');
            cardWrap.className = 'kri-cv-draw__card-wrap';
            cardWrap.dataset.slot = String(slot);
            const station = cardStation(slot, count);
            cardWrap.style.left = `${station.bx}px`;
            cardWrap.style.top = `${station.by}px`;

            const cardEl = build(race, draw.lane, { slot, isLeader: false });
            if (!cardEl) continue;
            cardWrap.appendChild(cardEl);
            root.appendChild(cardWrap);

            instances.push({
                slot,
                drawLane: draw.lane,
                connector,
                cardWrap,
                cardEl,
                station,
                ax: 0,
                ay: 0,
                targetAx: 0,
                targetAy: 0,
                hasPos: false,
                hasSmooth: false,
            });
        }
    }

    function applyConnector(inst, ax, ay) {
        const { bx, by } = inst.station;
        const card = inst.cardEl;
        let extend = 36;
        if (card) {
            const panel = card.querySelector('.vg-kri-leader-panel') || card;
            const w = (panel.offsetWidth || 160) * CARD_SCALE;
            extend = Math.max(14, Math.min(w * 0.45, 40));
        }
        inst.connector.setAttribute('points', connectorPoints(ax, ay, bx, by, extend));
        inst.connector.classList.toggle('kri-cv-draw__connector--hidden', !inst.hasPos);
    }

    function setLeaderGlow(slot) {
        if (leaderSlot === slot) return;
        leaderSlot = slot;
        for (const inst of instances) {
            const panel = inst.cardEl?.querySelector('.vg-kri-leader-panel');
            const badgeWrap = inst.cardEl?.querySelector('.vg-kri-leader-badges');
            if (!panel) continue;
            const isLeader = inst.slot === slot;
            panel.classList.toggle('vg-kri-cv-draw-panel--leader-glow', isLeader);
            inst.cardEl.classList.toggle('vg-kri-cv-draw-card--leader', isLeader);
            if (badgeWrap) {
                let leaderBadge = badgeWrap.querySelector('.vg-leader-badge');
                if (isLeader && !leaderBadge) {
                    leaderBadge = document.createElement('p');
                    leaderBadge.className = 'vg-leader-badge';
                    leaderBadge.textContent = 'Leader';
                    badgeWrap.insertBefore(leaderBadge, badgeWrap.firstChild);
                } else if (!isLeader && leaderBadge) {
                    leaderBadge.remove();
                }
            }
        }
    }

    function pickLeaderSlot(enriched, data) {
        if (!enriched?.length) return null;
        const lx = Number(data?.x);
        const ly = Number(data?.y);
        if (!Number.isFinite(lx) || !Number.isFinite(ly)) return null;
        let best = null;
        let bestDist = Infinity;
        for (const boat of enriched) {
            const dist = Math.abs(Number(boat.x) - lx) + Math.abs(Number(boat.y) - ly);
            if (dist < bestDist) {
                bestDist = dist;
                best = boat.slot;
            }
        }
        return best;
    }

    function smoothFrame(ts) {
        if (!root) {
            rafId = null;
            return;
        }
        if (!lastFrameTs) lastFrameTs = ts;
        const dt = Math.min(48, ts - lastFrameTs);
        lastFrameTs = ts;
        const tau = smoothTauMs();
        let moving = false;

        for (const inst of instances) {
            if (!inst.hasPos) continue;
            if (tau <= 0) {
                inst.ax = inst.targetAx;
                inst.ay = inst.targetAy;
            } else {
                const blend = 1 - Math.exp(-dt / tau);
                inst.ax += (inst.targetAx - inst.ax) * blend;
                inst.ay += (inst.targetAy - inst.ay) * blend;
                if (
                    Math.abs(inst.targetAx - inst.ax) > 0.25 ||
                    Math.abs(inst.targetAy - inst.ay) > 0.25
                ) {
                    moving = true;
                }
            }
            applyConnector(inst, inst.ax, inst.ay);
        }

        if (moving) {
            rafId = requestAnimationFrame(smoothFrame);
        } else {
            rafId = null;
            lastFrameTs = 0;
        }
    }

    function requestSmooth() {
        if (rafId == null) {
            lastFrameTs = 0;
            rafId = requestAnimationFrame(smoothFrame);
        }
    }

    function updatePositions(data) {
        const race = activeRace || global.VmixGraphics?.findRace?.(global.VmixGraphics?.getRaceParam?.());
        const map = global.AltitudeHdCvBoatMap;
        if (!race || !map) return;

        const enriched = map.enrichCvBoats(data, race, global.VmixGraphics?.getLookup?.() || null);
        const bySlot = {};
        for (const boat of enriched) bySlot[boat.slot] = boat;

        for (const inst of instances) {
            const boat = bySlot[inst.slot];
            if (!boat) {
                inst.hasPos = false;
                inst.connector.classList.add('kri-cv-draw__connector--hidden');
                continue;
            }
            const pt = mapCvPoint(data, boat.x, boat.y);
            if (!pt) continue;
            inst.targetAx = Math.max(0, Math.min(OUT_W, pt.left));
            inst.targetAy = Math.max(0, Math.min(OUT_H, pt.top));
            if (!inst.hasSmooth) {
                inst.ax = inst.targetAx;
                inst.ay = inst.targetAy;
                inst.hasSmooth = true;
            }
            inst.hasPos = true;
            applyConnector(inst, inst.ax, inst.ay);
        }

        setLeaderGlow(pickLeaderSlot(enriched, data));
        requestSmooth();
    }

    async function tick() {
        if (!root || !global.AltitudeHdCvOverlay?.fetchPosition) return;
        try {
            const data = await global.AltitudeHdCvOverlay.fetchPosition();
            if (!data || data.stale) {
                root.classList.add('kri-cv-draw--stale');
                return;
            }
            root.classList.remove('kri-cv-draw--stale');
            updatePositions(data);
        } catch {
            root.classList.add('kri-cv-draw--stale');
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

        activeRace = opts.race || global.VmixGraphics?.findRace?.(global.VmixGraphics?.getRaceParam?.()) || null;
        raceBoatCount = opts.boatCount || (await resolveRaceBoatCount());
        const direction =
            opts.boatDirection ||
            (await global.AltitudeHdCvOverlay?.fetchPosition?.().catch(() => null))?.boat_direction ||
            'left_to_right';

        mountInstances(activeRace, raceBoatCount, direction);
        leaderSlot = null;

        root.classList.remove('kri-cv-draw--outro', 'kri-cv-draw--hold', 'kri-cv-draw--stale');
        root.classList.add('kri-cv-draw--intro');
        void root.offsetWidth;
        root.classList.add('kri-cv-draw--visible');

        startPoll();
        await wait(INTRO_MS);
        root.classList.remove('kri-cv-draw--intro');
        root.classList.add('kri-cv-draw--hold');
    }

    async function hide() {
        clearPoll();
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (!root) return;
        root.classList.remove('kri-cv-draw--hold', 'kri-cv-draw--intro');
        root.classList.add('kri-cv-draw--outro');
        await wait(OUTRO_MS);
        destroy();
    }

    function destroy() {
        clearPoll();
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (root) {
            root.classList.remove(
                'kri-cv-draw--visible',
                'kri-cv-draw--intro',
                'kri-cv-draw--hold',
                'kri-cv-draw--outro',
                'kri-cv-draw--stale',
            );
        }
    }

    function remove() {
        destroy();
        destroyInstances();
        leaderSlot = null;
        activeRace = null;
        if (root) {
            root.remove();
            root = null;
            svg = null;
        }
    }

    global.KriVmixCvDraw = {
        INTRO_MS,
        OUTRO_MS,
        show,
        hide,
        destroy,
        remove,
    };
})(typeof window !== 'undefined' ? window : globalThis);
