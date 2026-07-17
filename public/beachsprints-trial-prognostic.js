/**
 * U19 trial — prognostic reference times vs World Rowing Beach Sprint U19 benchmarks.
 * World Rowing does not publish official beach-sprint world records; defaults are fast
 * U19 reference times from the 2025 World Rowing Beach Sprint Finals (Antalya).
 */
(function (global) {
    const LS_PROGNOSTIC = 'bsrTrialPrognostic_v1';

    /** @type {Record<string, { label: string, default: string, source: string }>} */
    const CLASSES = {
        CJW1X: {
            label: "Women's solo (CJW1X)",
            default: '2:52.0',
            source: '2025 WR Beach Sprint Finals U19 — leading women solo heats/finals (~2:50–3:05)',
        },
        CJM1X: {
            label: "Men's solo (CJM1X)",
            default: '2:22.0',
            source: '2025 WR Beach Sprint Finals U19 — leading men solo knockouts (~2:22–2:26)',
        },
        CJMix2X: {
            label: 'Mixed double (CJMix2X)',
            default: '2:35.0',
            source: '2025 WR Beach Sprint Finals U19 — U19 mix doubles time trial (~2:38)',
        },
        CJW2X: {
            label: "Women's double (CJW2X)",
            default: '2:48.0',
            source: '2025 WR Beach Sprint Finals U19 — U19 women doubles time trial (~2:51)',
        },
        CJM2X: {
            label: "Men's double (CJM2X)",
            default: '2:28.0',
            source: '2025 WR Beach Sprint Finals U19 — U19 men doubles A-final (~2:31)',
        },
    };

    let custom = {};

    function load() {
        try {
            const raw = localStorage.getItem(LS_PROGNOSTIC);
            custom = raw ? JSON.parse(raw) : {};
        } catch {
            custom = {};
        }
    }

    function save() {
        try {
            localStorage.setItem(LS_PROGNOSTIC, JSON.stringify(custom));
        } catch {
            /* ignore */
        }
    }

    function parseTimeToMs(str) {
        const s = String(str || '').trim();
        if (!s) return null;
        const parts = s.split(':');
        if (parts.length === 2) {
            const m = parseInt(parts[0], 10);
            const sec = parseFloat(parts[1]);
            if (Number.isFinite(m) && Number.isFinite(sec)) return (m * 60 + sec) * 1000;
        }
        const sec = parseFloat(s);
        return Number.isFinite(sec) ? sec * 1000 : null;
    }

    function formatMsShort(ms) {
        if (ms == null || !Number.isFinite(ms)) return '';
        const sec = ms / 1000;
        const m = Math.floor(sec / 60);
        const s = sec - m * 60;
        return `${m}:${s.toFixed(1).padStart(4, '0')}`;
    }

    function getReferenceTime(classCode) {
        const key = String(classCode || '').toUpperCase();
        const hit = CLASSES[key];
        if (!hit) return null;
        const raw = custom[key] || hit.default;
        return parseTimeToMs(raw);
    }

    function getReferenceDisplay(classCode) {
        const key = String(classCode || '').toUpperCase();
        return custom[key] || CLASSES[key]?.default || '';
    }

    function setReferenceTime(classCode, timeStr) {
        const key = String(classCode || '').toUpperCase();
        if (!CLASSES[key]) return;
        custom[key] = String(timeStr || '').trim();
        save();
    }

    function resetToDefaults() {
        custom = {};
        save();
    }

    /** Prognostic % — 100% = reference pace; higher = faster. */
    function prognosticPct(actualMs, classCode) {
        const ref = getReferenceTime(classCode);
        if (!ref || !actualMs || actualMs <= 0) return null;
        return (ref / actualMs) * 100;
    }

    function formatPrognosticPct(pct) {
        if (pct == null || !Number.isFinite(pct)) return '—';
        return `${pct.toFixed(1)}%`;
    }

    function prognosticClassForEvent(eventKey, row) {
        const ev = String(eventKey || '');
        if (ev === '1' || ev === '3') return 'CJW1X';
        if (ev === '2' || ev === '4') return 'CJM1X';
        if (ev === '5') return 'CJMix2X';
        if (ev === '6') {
            const label = String(row?.crewDefault || row?.slot?.crew || '').toUpperCase();
            if (label.includes('CJM2X')) return 'CJM2X';
            if (label.includes('CJW2X')) return 'CJW2X';
            return 'CJMix2X';
        }
        return null;
    }

    const MIX_MATRIX = [
        { label: 'M2+W2', raceNum: 23, lane: 1, run: 'MX1' },
        { label: 'M3+W3', raceNum: 23, lane: 2, run: 'MX1' },
        { label: 'M2+W3', raceNum: 24, lane: 1, run: 'MX2' },
        { label: 'M3+W2', raceNum: 24, lane: 2, run: 'MX2' },
    ];

    function renderPanelHtml() {
        let fields = '';
        for (const [code, meta] of Object.entries(CLASSES)) {
            fields +=
                `<div class="bsr-prog-field">` +
                `<label for="bsrProg_${code}">${meta.label}</label>` +
                `<input type="text" id="bsrProg_${code}" class="bsr-prog-input" data-prog-class="${code}" ` +
                `value="${getReferenceDisplay(code)}" placeholder="${meta.default}" title="${meta.source}">` +
                `</div>`;
        }
        return (
            `<section class="bsr-card bsr-prognostic-panel" id="bsrPrognosticPanel" hidden>` +
            `<h2 class="bsr-prognostic-title">Prognostic reference times</h2>` +
            `<p class="bsr-note">Defaults from fast U19 times at the 2025 World Rowing Beach Sprint Finals (Antalya). ` +
            `Edit to match your course — prognostic % = reference ÷ actual × 100 (100% = reference pace, higher is faster).</p>` +
            `<div class="bsr-prognostic-grid">${fields}</div>` +
            `<div class="bsr-prognostic-actions">` +
            `<button type="button" class="bsr-btn bsr-btn--small" id="bsrProgReset">Reset to WR defaults</button>` +
            `</div></section>`
        );
    }

    function bindPanel() {
        const panel = document.getElementById('bsrPrognosticPanel');
        if (!panel || panel.dataset.bound === '1') return;
        panel.dataset.bound = '1';
        panel.addEventListener('change', (e) => {
            const inp = e.target.closest('.bsr-prog-input');
            if (!inp) return;
            setReferenceTime(inp.dataset.progClass, inp.value);
            if (global.BsrTrialLive?.rerender) global.BsrTrialLive.rerender();
        });
        panel.addEventListener('input', (e) => {
            const inp = e.target.closest('.bsr-prog-input');
            if (!inp) return;
            setReferenceTime(inp.dataset.progClass, inp.value);
        });
        const resetBtn = document.getElementById('bsrProgReset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                resetToDefaults();
                panel.querySelectorAll('.bsr-prog-input').forEach((inp) => {
                    const code = inp.dataset.progClass;
                    inp.value = CLASSES[code]?.default || '';
                });
                if (global.BsrTrialLive?.rerender) global.BsrTrialLive.rerender();
            });
        }
    }

    function showPanel(show) {
        const panel = document.getElementById('bsrPrognosticPanel');
        if (!panel) return;
        panel.hidden = !show;
    }

    load();

    global.BsrTrialPrognostic = {
        CLASSES,
        MIX_MATRIX,
        getReferenceTime,
        getReferenceDisplay,
        setReferenceTime,
        resetToDefaults,
        prognosticPct,
        formatPrognosticPct,
        prognosticClassForEvent,
        parseTimeToMs,
        formatMsShort,
        renderPanelHtml,
        bindPanel,
        showPanel,
        reload: load,
    };
})(typeof window !== 'undefined' ? window : globalThis);
