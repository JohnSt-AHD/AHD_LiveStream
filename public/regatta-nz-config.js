/**
 * Shared Regatta NZ spectator-app config (hub + /regatta-nz/).
 * Persists in localStorage; regatta code mirrors altitudeHdRegattaCode_v1.
 */
(function (root) {
    const LS_CODE = 'altitudeHdRegattaCode_v1';
    const LS_RNZ = 'altitudeHdRegattaNz_v1';
    const DEFAULT_CODE = 'nzmm2026';

    function normalizeCode(raw) {
        return String(raw || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '');
    }

    function defaults() {
        return {
            code: DEFAULT_CODE,
            livestreamUrl: '',
            livestreamActive: false,
            livestreamLabel: 'Watch the livestream',
            mode: 'sim',
            streamId: 'ged-sim',
        };
    }

    function loadCode() {
        try {
            const c = normalizeCode(localStorage.getItem(LS_CODE));
            if (c && c !== 'mads2026') return c;
        } catch {
            /* ignore */
        }
        return DEFAULT_CODE;
    }

    function saveCode(code) {
        const c = normalizeCode(code) || DEFAULT_CODE;
        try {
            localStorage.setItem(LS_CODE, c);
        } catch {
            /* ignore */
        }
        return c;
    }

    function load() {
        const base = defaults();
        base.code = loadCode();
        try {
            const raw = JSON.parse(localStorage.getItem(LS_RNZ) || '{}');
            if (raw && typeof raw === 'object') {
                if (raw.livestreamUrl != null) base.livestreamUrl = String(raw.livestreamUrl).trim();
                if (raw.livestreamActive != null) base.livestreamActive = Boolean(raw.livestreamActive);
                if (raw.livestreamLabel) base.livestreamLabel = String(raw.livestreamLabel).trim();
                if (raw.mode === 'live' || raw.mode === 'sim') base.mode = raw.mode;
                if (raw.streamId) {
                    const id = String(raw.streamId).trim();
                    if (/^[a-zA-Z0-9._-]{1,128}$/.test(id)) base.streamId = id;
                }
                const fromCfg = normalizeCode(raw.code);
                if (fromCfg) base.code = fromCfg;
            }
        } catch {
            /* ignore */
        }
        if (base.livestreamActive && !base.livestreamUrl) base.livestreamActive = false;
        return base;
    }

    function save(partial) {
        const next = Object.assign({}, load(), partial || {});
        next.code = saveCode(next.code || DEFAULT_CODE);
        next.livestreamUrl = String(next.livestreamUrl || '').trim();
        next.livestreamActive = Boolean(next.livestreamActive) && Boolean(next.livestreamUrl);
        next.livestreamLabel =
            String(next.livestreamLabel || '').trim() || defaults().livestreamLabel;
        next.mode = next.mode === 'live' ? 'live' : 'sim';
        const id = String(next.streamId || 'ged-sim').trim();
        next.streamId = /^[a-zA-Z0-9._-]{1,128}$/.test(id) ? id : 'ged-sim';
        try {
            localStorage.setItem(
                LS_RNZ,
                JSON.stringify({
                    code: next.code,
                    livestreamUrl: next.livestreamUrl,
                    livestreamActive: next.livestreamActive,
                    livestreamLabel: next.livestreamLabel,
                    mode: next.mode,
                    streamId: next.streamId,
                }),
            );
        } catch {
            /* ignore */
        }
        try {
            if (root.dispatchEvent) {
                root.dispatchEvent(
                    new CustomEvent('altitudehd:regatta-nz', { detail: Object.assign({}, next) }),
                );
            }
        } catch {
            /* ignore */
        }
        return next;
    }

    root.AltitudeHdRegattaNzConfig = {
        LS_CODE: LS_CODE,
        LS_RNZ: LS_RNZ,
        DEFAULT_CODE: DEFAULT_CODE,
        normalizeCode: normalizeCode,
        defaults: defaults,
        load: load,
        save: save,
        loadCode: loadCode,
        saveCode: saveCode,
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
