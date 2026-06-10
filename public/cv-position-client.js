/**
 * Poll CV position from /api/cv-position and position a leader line on a 1920×1080 vMix overlay.
 *
 * URL params:
 *   streamId  — same ID as GPS / livestream (required)
 *   venue     — karapiro | twizel (optional; uses payload venue when present)
 *   poll      — poll interval ms (default 200)
 *   api       — override API base (default same origin)
 */
(function (global) {
    const DEFAULT_REF_W = 1280;
    const DEFAULT_REF_H = 720;
    const OUT_W = 1920;
    const OUT_H = 1080;

    function params() {
        return new URLSearchParams(location.search);
    }

    function apiBase() {
        const custom = params().get('api');
        if (custom) return custom.replace(/\/$/, '');
        return '';
    }

    function streamId() {
        return (
            params().get('streamId') ||
            params().get('gpsId') ||
            params().get('id') ||
            ''
        ).trim();
    }

    function pollMs() {
        const n = parseInt(params().get('poll') || '200', 10);
        return Number.isFinite(n) ? Math.max(100, Math.min(n, 2000)) : 200;
    }

    function venueOffset(venue) {
        const v = String(venue || 'karapiro').toLowerCase();
        if (v === 'twizel') return { x: -140, y: -50 };
        return { x: 140, y: -50 };
    }

    function mapPoint(x, y, refW, refH, offset) {
        const sx = OUT_W / refW;
        const sy = OUT_H / refH;
        return {
            left: (Number(x) + offset.x) * sx,
            top: (Number(y) + offset.y) * sy,
        };
    }

    async function fetchPosition() {
        const id = streamId();
        if (!id) throw new Error('Missing ?streamId= on overlay URL');

        const url = `${apiBase()}/api/cv-position?streamId=${encodeURIComponent(id)}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (res.status === 404) return null;
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    }

    function applyPosition(data) {
        const line = document.getElementById('cvLeaderLine');
        const dot = document.getElementById('cvStatusDot');
        const errEl = document.getElementById('cvError');
        if (!line) return;

        if (!data || data.stale) {
            line.classList.add('cv-leader-line--stale');
            if (dot) dot.classList.toggle('cv-status-dot--live', Boolean(data && !data.stale));
            return;
        }

        const refW = Number(data.refW) || DEFAULT_REF_W;
        const refH = Number(data.refH) || DEFAULT_REF_H;
        const offset = data.offset || venueOffset(data.venue);
        const pt = mapPoint(data.x, data.y, refW, refH, offset);

        line.style.left = `${pt.left}px`;
        line.style.top = '0';
        line.style.height = `${OUT_H}px`;
        line.classList.remove('cv-leader-line--stale');
        line.hidden = false;

        if (dot) {
            dot.classList.add('cv-status-dot--live');
            dot.title = `x=${data.x} y=${data.y} auto=${data.auto}`;
        }
        if (errEl) errEl.hidden = true;
    }

    async function tick() {
        const errEl = document.getElementById('cvError');
        try {
            const data = await fetchPosition();
            applyPosition(data);
        } catch (e) {
            if (errEl) {
                errEl.hidden = false;
                errEl.textContent = e instanceof Error ? e.message : String(e);
            }
        }
    }

    function init() {
        const id = streamId();
        const errEl = document.getElementById('cvError');
        if (!id && errEl) {
            errEl.hidden = false;
            errEl.textContent =
                'Add ?streamId=YOUR_GPS_ID to the vMix browser URL (same ID as TouchDesigner GPS).';
        }
        tick();
        setInterval(tick, pollMs());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.AltitudeHdCvOverlay = { fetchPosition, mapPoint, venueOffset };
})(window);
