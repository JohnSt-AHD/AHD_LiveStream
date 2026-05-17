/**
 * Shared rainbow speed scale for map trails and history dots (localStorage).
 */
(function (global) {
    const LS_KEY = 'altitudeHdSpeedColorScale_v1';
    const DEFAULT_MIN_MPS = 0;
    const DEFAULT_MAX_MPS = 20;

    function readStored() {
        try {
            const raw = global.localStorage.getItem(LS_KEY);
            if (!raw) {
                return { minMps: DEFAULT_MIN_MPS, maxMps: DEFAULT_MAX_MPS };
            }
            const o = JSON.parse(raw);
            const minMps = Number(o.minMps);
            const maxMps = Number(o.maxMps);
            if (!Number.isFinite(minMps) || !Number.isFinite(maxMps) || maxMps <= minMps) {
                return { minMps: DEFAULT_MIN_MPS, maxMps: DEFAULT_MAX_MPS };
            }
            return { minMps, maxMps };
        } catch {
            return { minMps: DEFAULT_MIN_MPS, maxMps: DEFAULT_MAX_MPS };
        }
    }

    let cached = readStored();

    function emitChange() {
        global.dispatchEvent(
            new CustomEvent('altitudehd:speed-color-range', { detail: { ...cached } }),
        );
    }

    function getRange() {
        return { ...cached };
    }

    function setRange(minMps, maxMps) {
        const min = Number(minMps);
        const max = Number(maxMps);
        if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
            return false;
        }
        cached = { minMps: min, maxMps: max };
        try {
            global.localStorage.setItem(LS_KEY, JSON.stringify(cached));
        } catch {
            /* quota / private mode */
        }
        emitChange();
        return true;
    }

    function speedMpsForColor(speed) {
        const s = typeof speed === 'number' && !Number.isNaN(speed) ? speed : 0;
        return Math.min(cached.maxMps, Math.max(cached.minMps, s));
    }

    function speedToRainbowColor(speedMps) {
        const span = cached.maxMps - cached.minMps;
        const s = typeof speedMps === 'number' && !Number.isNaN(speedMps) ? speedMps : cached.minMps;
        const t = Math.min(1, Math.max(0, (s - cached.minMps) / span));
        const hue = t * 300;
        return `hsl(${hue}, 88%, 52%)`;
    }

    function updateSpeedLegend(legendEl) {
        if (!legendEl) return;
        const labels = legendEl.querySelector('.speed-legend-labels');
        if (!labels) return;
        const spans = labels.querySelectorAll('span');
        if (spans.length < 2) return;
        spans[0].textContent = String(cached.minMps);
        spans[1].textContent = String(cached.maxMps);
    }

    global.addEventListener('storage', (e) => {
        if (e.key !== LS_KEY) return;
        cached = readStored();
        emitChange();
    });

    global.AltitudeHdSpeedColor = {
        getRange,
        setRange,
        speedMpsForColor,
        speedToRainbowColor,
        updateSpeedLegend,
    };
})(typeof window !== 'undefined' ? window : globalThis);
