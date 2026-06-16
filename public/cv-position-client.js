/**
 * Poll CV position from /api/cv-position and position a leader line on a 1920×1080 vMix overlay.
 *
 * Stream ID resolution (first match wins):
 *   1. URL ?streamId= / ?gpsId= / ?id=
 *   2. localStorage (set on monitor page or from a previous session)
 *   3. CV laptop setup API (?cvLaptop= or http://127.0.0.1:8790) → cloud.stream_id
 *
 * URL params:
 *   streamId  — explicit stream ID (overrides saved / laptop default)
 *   cvLaptop  — CV setup server base (default http://127.0.0.1:8790)
 *   venue     — karapiro | twizel (optional; uses payload venue when present)
 *   poll      — poll interval ms (default 200)
 *   api       — override CV position API base (default same origin)
 */
(function (global) {
    const DEFAULT_REF_W = 1280;
    const DEFAULT_REF_H = 720;
    const OUT_W = 1920;
    const OUT_H = 1080;
    const LS_STREAM_ID = 'altitudeHdCvStreamId';
    const LS_LAPTOP_API = 'altitudeHdCvLaptopApi';
    const DEFAULT_LAPTOP_API = 'http://127.0.0.1:8790';

    let cachedStreamId = '';
    let resolvePromise = null;

    function params() {
        return new URLSearchParams(location.search);
    }

    function apiBase() {
        const custom = params().get('api');
        if (custom) return custom.replace(/\/$/, '');
        return '';
    }

    function streamIdFromUrl() {
        return (
            params().get('streamId') ||
            params().get('gpsId') ||
            params().get('id') ||
            ''
        ).trim();
    }

    function laptopApiBase() {
        const fromUrl = params().get('cvLaptop');
        if (fromUrl) return fromUrl.replace(/\/$/, '');
        try {
            const stored = localStorage.getItem(LS_LAPTOP_API);
            if (stored) return stored.replace(/\/$/, '');
        } catch {
            /* ignore */
        }
        return DEFAULT_LAPTOP_API;
    }

    function streamId() {
        return streamIdFromUrl() || cachedStreamId || '';
    }

    async function fetchStreamIdFromLaptop() {
        const api = laptopApiBase();
        try {
            const res = await fetch(`${api}/api/cloud/status`, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                const id = String(data?.stream_id || '').trim();
                if (id) return id;
            }
            const cfgRes = await fetch(`${api}/api/config`, { cache: 'no-store' });
            if (!cfgRes.ok) return '';
            const cfg = await cfgRes.json();
            return String(cfg?.cloud?.stream_id || '').trim();
        } catch {
            return '';
        }
    }

    function saveStreamIdToStorage(id) {
        try {
            if (id) localStorage.setItem(LS_STREAM_ID, id);
            else localStorage.removeItem(LS_STREAM_ID);
        } catch {
            /* ignore */
        }
    }

    function setStreamId(id, opts = {}) {
        const trimmed = String(id || '').trim();
        cachedStreamId = trimmed;
        saveStreamIdToStorage(trimmed);
        if (opts.updateUrl !== false) {
            const u = new URL(location.href);
            if (trimmed) u.searchParams.set('streamId', trimmed);
            else {
                u.searchParams.delete('streamId');
                u.searchParams.delete('gpsId');
                u.searchParams.delete('id');
            }
            history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`);
        }
        return trimmed;
    }

    async function resolveStreamId() {
        const fromUrl = streamIdFromUrl();
        if (fromUrl) {
            cachedStreamId = fromUrl;
            saveStreamIdToStorage(fromUrl);
            return fromUrl;
        }

        const fromLaptop = await fetchStreamIdFromLaptop();
        if (fromLaptop) {
            cachedStreamId = fromLaptop;
            saveStreamIdToStorage(fromLaptop);
            return fromLaptop;
        }

        try {
            const stored = localStorage.getItem(LS_STREAM_ID);
            if (stored && stored.trim()) {
                cachedStreamId = stored.trim();
                return cachedStreamId;
            }
        } catch {
            /* ignore */
        }

        cachedStreamId = '';
        return '';
    }

    async function ensureStreamId() {
        if (streamIdFromUrl()) {
            cachedStreamId = streamIdFromUrl();
            return cachedStreamId;
        }
        if (cachedStreamId) return cachedStreamId;
        if (!resolvePromise) resolvePromise = resolveStreamId().finally(() => {
            resolvePromise = null;
        });
        return resolvePromise;
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

    async function fetchPosition(forStreamId) {
        const id = String(forStreamId || streamId()).trim();
        if (!id) throw new Error('Missing stream ID — set on monitor page or add ?streamId= to the URL');

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

    async function initOverlay() {
        const line = document.getElementById('cvLeaderLine');
        if (!line) return;

        await ensureStreamId();
        const id = streamId();
        const errEl = document.getElementById('cvError');
        if (!id && errEl) {
            errEl.hidden = false;
            errEl.textContent =
                'No stream ID — open cv-position-monitor.html on the CV laptop to set one, or add ?streamId= to this URL.';
        }
        tick();
        setInterval(tick, pollMs());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initOverlay();
        });
    } else {
        initOverlay();
    }

    global.AltitudeHdCvOverlay = {
        fetchPosition,
        mapPoint,
        venueOffset,
        streamId,
        streamIdFromUrl,
        laptopApiBase,
        fetchStreamIdFromLaptop,
        resolveStreamId,
        ensureStreamId,
        setStreamId,
        LS_STREAM_ID,
        LS_LAPTOP_API,
    };
})(window);
