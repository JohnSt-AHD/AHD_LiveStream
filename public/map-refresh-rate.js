/**
 * Shared Traccar map poll interval (localStorage) for hub + fleet map pages.
 */
(function (global) {
    const LS_KEY = 'altitudeHdMapRefreshMs_v1';
    const DEFAULT_MS = 10000;
    const MIN_MS = 3000;
    const MAX_MS = 60000;

    const PRESETS = [
        { ms: 3000, label: '3 seconds' },
        { ms: 5000, label: '5 seconds' },
        { ms: 10000, label: '10 seconds' },
        { ms: 15000, label: '15 seconds' },
        { ms: 30000, label: '30 seconds' },
    ];

    function clampMs(ms) {
        const n = Math.round(Number(ms));
        if (!Number.isFinite(n)) return DEFAULT_MS;
        return Math.min(MAX_MS, Math.max(MIN_MS, n));
    }

    function readStored() {
        try {
            const raw = global.localStorage.getItem(LS_KEY);
            if (raw == null || raw === '') return DEFAULT_MS;
            return clampMs(Number(raw));
        } catch {
            return DEFAULT_MS;
        }
    }

    let cached = readStored();

    function emitChange() {
        global.dispatchEvent(
            new CustomEvent('altitudehd:map-refresh-rate', { detail: { ms: cached } }),
        );
        updateHintElements();
    }

    function formatShort(ms) {
        const n = clampMs(ms);
        if (n % 1000 === 0) {
            const sec = n / 1000;
            return sec === 1 ? 'every 1s' : `every ${sec}s`;
        }
        return `every ${(n / 1000).toFixed(1)}s`;
    }

    function updateHintElements() {
        const short = formatShort(cached);
        global.document.querySelectorAll('[data-map-refresh-hint]').forEach((el) => {
            el.textContent = short;
        });
    }

    function getIntervalMs() {
        return cached;
    }

    function setIntervalMs(ms) {
        const next = clampMs(ms);
        cached = next;
        try {
            global.localStorage.setItem(LS_KEY, String(next));
        } catch {
            /* quota / private mode */
        }
        emitChange();
        return next;
    }

    function getPresets() {
        return PRESETS.slice();
    }

    function presetLabelForMs(ms) {
        const match = PRESETS.find((p) => p.ms === clampMs(ms));
        return match ? match.label : formatShort(ms);
    }

    global.AltitudeHdMapRefresh = {
        getIntervalMs,
        setIntervalMs,
        getPresets,
        formatShort,
        presetLabelForMs,
        DEFAULT_MS,
        MIN_MS,
        MAX_MS,
    };

    global.addEventListener('storage', (e) => {
        if (e.key !== LS_KEY) return;
        cached = readStored();
        emitChange();
    });

    if (global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', updateHintElements);
    } else {
        updateHintElements();
    }
})(typeof window !== 'undefined' ? window : globalThis);
