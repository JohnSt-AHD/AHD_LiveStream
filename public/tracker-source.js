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
        return source === 'rowing' ? 'RNZ recorder' : 'Traccar';
    }

    global.AltitudeHdTrackerSource = {
        STORAGE_KEY,
        EVENT_NAME,
        SOURCES,
        getSource,
        setSource,
        applySource,
        buildTraccarUrl,
        label,
    };
})(typeof window !== 'undefined' ? window : globalThis);
