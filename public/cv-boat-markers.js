/**
 * On-video boat labels — logo + short name at CV slot positions.
 * Crew identity comes from live daysheet via AltitudeHdCvBoatMap.
 */
(function (global) {
    const OUT_W = 1920;
    const OUT_H = 1080;
    const DEFAULT_REF_W = 1280;
    const DEFAULT_REF_H = 720;
    const LOGO_PLACEHOLDER = 'assets/school-logos/placeholder-white.svg';

    let root = null;
    let pollTimer = null;

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

    function ensureRoot(stage) {
        if (root) return root;
        const host = stage || document.querySelector('.vg-stage');
        if (!host) return null;
        root = document.createElement('div');
        root.id = 'cvBoatMarkersRoot';
        root.className = 'cv-boat-markers';
        root.setAttribute('aria-hidden', 'true');
        host.appendChild(root);
        return root;
    }

    function mapPoint(data, x, y) {
        const cv = global.AltitudeHdCvOverlay;
        if (!cv?.mapPoint) return null;
        const refW = Number(data.refW) || DEFAULT_REF_W;
        const refH = Number(data.refH) || DEFAULT_REF_H;
        const offset = data.offset || cv.venueOffset?.(data.venue) || { x: 0, y: 0 };
        return cv.mapPoint(x, y, refW, refH, offset);
    }

    function liveRace() {
        const vg = global.VmixGraphics;
        if (!vg?.findRace || !vg?.getRaceParam) return null;
        return vg.findRace(vg.getRaceParam());
    }

    function lookup() {
        return global.VmixGraphics?.getLookup?.() || null;
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function markerHtml(boat) {
        const label = escapeHtml(boat.shortLabel || boat.label || `Boat ${boat.slot}`);
        const logo = escapeHtml(boat.logoUrl || LOGO_PLACEHOLDER);
        return (
            `<div class="cv-boat-markers__item" data-slot="${boat.slot}">` +
            `<img class="cv-boat-markers__logo" src="${logo}" alt="">` +
            `<span class="cv-boat-markers__name">${label}</span>` +
            `</div>`
        );
    }

    function render(data) {
        if (!root) return;
        if (!data || data.stale) {
            root.classList.add('cv-boat-markers--stale');
            return;
        }
        root.classList.remove('cv-boat-markers--stale');
        const race = liveRace();
        const map = global.AltitudeHdCvBoatMap;
        if (!race || !map?.enrichCvBoats) {
            root.replaceChildren();
            return;
        }
        const boats = map.enrichCvBoats(data, race, lookup());
        root.replaceChildren();
        for (const boat of boats) {
            const pt = mapPoint(data, boat.x, boat.y);
            if (!pt) continue;
            const wrap = document.createElement('div');
            wrap.className = 'cv-boat-markers__wrap';
            wrap.style.left = `${Math.max(0, Math.min(OUT_W, pt.left))}px`;
            wrap.style.top = `${Math.max(0, Math.min(OUT_H, pt.top))}px`;
            wrap.innerHTML = markerHtml(boat);
            root.appendChild(wrap);
        }
    }

    async function tick() {
        if (!root || !global.AltitudeHdCvOverlay?.fetchPosition) return;
        try {
            const data = await global.AltitudeHdCvOverlay.fetchPosition();
            render(data);
        } catch {
            root?.classList.add('cv-boat-markers--stale');
        }
    }

    function startPoll() {
        clearPoll();
        tick();
        pollTimer = setInterval(tick, pollMs());
    }

    function show() {
        ensureRoot(document.querySelector('.vg-stage'));
        if (!root) return;
        root.classList.add('cv-boat-markers--visible');
        startPoll();
    }

    function hide() {
        clearPoll();
        if (!root) return;
        root.classList.remove('cv-boat-markers--visible', 'cv-boat-markers--stale');
    }

    function remove() {
        clearPoll();
        if (root) {
            root.remove();
            root = null;
        }
    }

    document.addEventListener('altitudehd:liverace', () => {
        tick();
    });

    global.CvBoatMarkers = {
        show,
        hide,
        remove,
        render,
    };
})(typeof window !== 'undefined' ? window : globalThis);
