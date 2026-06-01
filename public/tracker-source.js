/**
 * Client-side Traccar vs RNZ rowing tracker source (persisted in localStorage).
 */
(function (global) {
    const STORAGE_KEY = 'altitudehd:tracker-source';
    const EVENT_NAME = 'altitudehd:tracker-source';
    const SOURCES = ['traccar', 'rowing'];

    function normalize(value) {
        const v = String(value || '').toLowerCase();
        return v === 'rowing' || v === 'rnz' ? 'rowing' : 'traccar';
    }

    function getSource() {
        try {
            return normalize(localStorage.getItem(STORAGE_KEY));
        } catch {
            return 'traccar';
        }
    }

    function setSource(next) {
        const value = normalize(next);
        try {
            localStorage.setItem(STORAGE_KEY, value);
        } catch {
            /* ignore */
        }
        global.dispatchEvent(
            new CustomEvent(EVENT_NAME, { detail: { source: value } }),
        );
        return value;
    }

    /** @param {URLSearchParams|Record<string,string>} params */
    function applySource(params) {
        const source = getSource();
        if (params instanceof URLSearchParams) {
            params.set('source', source);
            return params;
        }
        return { ...params, source };
    }

    function buildTraccarUrl(query = {}) {
        const params = new URLSearchParams(applySource(query));
        return `/api/traccar?${params.toString()}`;
    }

    function label(source) {
        return source === 'rowing' ? 'Recorder (RNZ/KRI)' : 'Traccar';
    }

    /** Snapshot fetch — prefers shared bus; falls back to direct API with source param. */
    async function fetchSnapshot(options = {}) {
        const bus = global.AltitudeHdTraccarSnapshot;
        if (bus && !options.direct) {
            return bus.fetchSnapshot(options);
        }
        try {
            const res = await fetch(buildTraccarUrl({ action: 'snapshot' }));
            const data = await res.json().catch(() => ({}));
            return {
                ok: res.ok,
                status: res.status,
                data,
                error: res.ok ? null : data.error || `Request failed (${res.status})`,
            };
        } catch (err) {
            return {
                ok: false,
                status: 0,
                data: {},
                error: err.message || 'Network error',
            };
        }
    }

    /** Route history for live map / beach sprints (respects current source). */
    async function fetchRoute(deviceId, fromIso, toIso) {
        const res = await fetch(
            buildTraccarUrl({
                action: 'route',
                deviceId: String(deviceId),
                from: String(fromIso),
                to: String(toIso),
            }),
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = data && data.error ? data.error : `Request failed (${res.status})`;
            throw new Error(msg);
        }
        if (!Array.isArray(data)) {
            throw new Error('Unexpected response from server.');
        }
        return data;
    }

    global.AltitudeHdTrackerSource = {
        STORAGE_KEY,
        EVENT_NAME,
        SOURCES,
        getSource,
        setSource,
        applySource,
        buildTraccarUrl,
        fetchSnapshot,
        fetchRoute,
        label,
    };
})(typeof window !== 'undefined' ? window : globalThis);
