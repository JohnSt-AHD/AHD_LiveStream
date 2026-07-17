/**
 * U19 trial — prognostic reference times vs World Rowing Beach Sprint U19 benchmarks.
 * World Rowing does not publish official beach-sprint world records; defaults are fast
 * U19 reference times from the 2025 World Rowing Beach Sprint Finals (Antalya).
 */
(function (global) {
    const LS_PROGNOSTIC = 'bsrTrialPrognostic_v1';
    const LS_DERIVED = 'bsrTrialPrognosticDerived_v1';

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

    /** Pair times per matrix race (lane match). */
    const MIX_MATRIX = [
        { label: 'M2+W2', raceNum: 23, lane: 1, run: 'MX1' },
        { label: 'M3+W3', raceNum: 23, lane: 2, run: 'MX1' },
        { label: 'M2+W3', raceNum: 24, lane: 1, run: 'MX2' },
        { label: 'M3+W2', raceNum: 24, lane: 2, run: 'MX2' },
    ];

    /** Each matrix athlete — two pair races summed for ranking. */
    const MIX_ATHLETE_MATRIX = [
        {
            code: 'M2',
            races: [
                { run: 'MX1', pair: 'M2+W2', raceNum: 23 },
                { run: 'MX2', pair: 'M2+W3', raceNum: 24 },
            ],
        },
        {
            code: 'M3',
            races: [
                { run: 'MX1', pair: 'M3+W3', raceNum: 23 },
                { run: 'MX2', pair: 'M3+W2', raceNum: 24 },
            ],
        },
        {
            code: 'W2',
            races: [
                { run: 'MX1', pair: 'M2+W2', raceNum: 23 },
                { run: 'MX2', pair: 'M3+W2', raceNum: 24 },
            ],
        },
        {
            code: 'W3',
            races: [
                { run: 'MX1', pair: 'M3+W3', raceNum: 23 },
                { run: 'MX2', pair: 'M2+W3', raceNum: 24 },
            ],
        },
    ];

    /** W1/M1 solo ref rows before each matrix H2H (same race number, synthetic lanes). */
    const MIX_REF_RUNS = [
        { raceNum: 23, run: 'MX1' },
        { raceNum: 24, run: 'MX2' },
    ];

    let custom = {};
    /** @type {Record<string, { ms: number, source: string, at: number }>} */
    let derived = {};
    let suppressPanelInput = false;

    /** Canonical class keys — CJMix2X must stay mixed-case (toUpperCase → CJMIX2X misses CLASSES). */
    function normalizeClassCode(classCode) {
        const raw = String(classCode || '').trim();
        if (!raw) return '';
        const upper = raw.toUpperCase();
        if (upper === 'CJMIX2X') return 'CJMix2X';
        return upper;
    }

    function load() {
        try {
            const raw = localStorage.getItem(LS_PROGNOSTIC);
            custom = raw ? JSON.parse(raw) : {};
        } catch {
            custom = {};
        }
        try {
            const raw = localStorage.getItem(LS_DERIVED);
            derived = raw ? JSON.parse(raw) : {};
        } catch {
            derived = {};
        }
        if (custom.CJMIX2X != null && custom.CJMix2X == null) {
            custom.CJMix2X = custom.CJMIX2X;
            delete custom.CJMIX2X;
            save();
        }
        if (derived.CJMIX2X != null && derived.CJMix2X == null) {
            derived.CJMix2X = derived.CJMIX2X;
            delete derived.CJMIX2X;
            saveDerived();
        }
    }

    function save() {
        try {
            localStorage.setItem(LS_PROGNOSTIC, JSON.stringify(custom));
        } catch {
            /* ignore */
        }
    }

    function saveDerived() {
        try {
            localStorage.setItem(LS_DERIVED, JSON.stringify(derived));
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

    function msToInputDisplay(ms) {
        if (ms == null || !Number.isFinite(ms)) return '';
        return formatMsShort(ms);
    }

    function getDerivedMeta(classCode) {
        const key = normalizeClassCode(classCode);
        return derived[key] || null;
    }

    function setDerivedReference(classCode, ms, source) {
        const key = normalizeClassCode(classCode);
        if (!CLASSES[key] || !Number.isFinite(ms) || ms <= 0) return;
        derived[key] = { ms, source: String(source || ''), at: Date.now() };
        custom[key] = msToInputDisplay(ms);
        saveDerived();
        save();
        refreshPanelInputs();
    }

    function clearDerivedReference(classCode) {
        const key = normalizeClassCode(classCode);
        delete derived[key];
        saveDerived();
    }

    function refreshPanelInputs() {
        const panel = document.getElementById('bsrPrognosticPanel');
        if (!panel) return;
        suppressPanelInput = true;
        panel.querySelectorAll('.bsr-prog-input').forEach((inp) => {
            const code = inp.dataset.progClass;
            inp.value = getReferenceDisplay(code);
            const meta = getDerivedMeta(code);
            inp.title = meta?.source || CLASSES[code]?.source || '';
        });
        suppressPanelInput = false;
        const note = document.getElementById('bsrProgDerivedNote');
        if (note) note.innerHTML = renderDerivedNoteHtml();
    }

    function getReferenceTime(classCode, opts = {}) {
        const key = normalizeClassCode(classCode);
        const hit = CLASSES[key];
        if (!hit) return null;
        let ms = null;
        const meta = derived[key];
        if (meta?.ms) ms = meta.ms;
        if (ms == null) {
            const raw = custom[key] || hit.default;
            ms = parseTimeToMs(raw);
        }
        if (!Number.isFinite(ms)) return null;
        if (opts.twoRaceTotal && key === 'CJMix2X') return ms * 2;
        return ms;
    }

    function getReferenceDisplay(classCode) {
        const key = normalizeClassCode(classCode);
        if (derived[key]?.ms) return msToInputDisplay(derived[key].ms);
        return custom[key] || CLASSES[key]?.default || '';
    }

    function setReferenceTime(classCode, timeStr, opts = {}) {
        const key = normalizeClassCode(classCode);
        if (!CLASSES[key]) return;
        const next = String(timeStr || '').trim();
        custom[key] = next;
        if (!opts.keepDerived) {
            const parsed = parseTimeToMs(next);
            const meta = derived[key];
            if (!meta?.ms || !Number.isFinite(parsed) || Math.abs(parsed - meta.ms) > 15) {
                delete derived[key];
                saveDerived();
            }
        }
        save();
    }

    function resetToDefaults() {
        custom = {};
        derived = {};
        save();
        saveDerived();
    }

    /** Derive per-race mix target from W1 + M1 solo ref times (average pace). */
    function deriveMixReferenceFromSolos(w1Ms, m1Ms, source) {
        if (!Number.isFinite(w1Ms) || !Number.isFinite(m1Ms)) return null;
        const mixMs = (w1Ms + m1Ms) / 2;
        setDerivedReference('CJMix2X', mixMs, source || `Avg W1 (${formatMsShort(w1Ms)}) + M1 (${formatMsShort(m1Ms)}) solo refs`);
        return mixMs;
    }

    function mixPrognosticDebug() {
        const ref = getReferenceTime('CJMix2X');
        const meta = getDerivedMeta('CJMix2X');
        return {
            refMs: ref,
            refDisplay: getReferenceDisplay('CJMix2X'),
            source: meta?.source || 'WR default / manual',
            derived: !!meta?.ms,
            twoRaceRefMs: ref != null ? ref * 2 : null,
        };
    }

    /** Session 3 — selected mix pair time as doubles TT target. */
    function setDoublesReferenceFromMixPair(pairMs, pairLabel) {
        if (!Number.isFinite(pairMs) || pairMs <= 0) return;
        const src = `Selected ${pairLabel || 'mix pair'} (${formatMsShort(pairMs)})`;
        setDerivedReference('CJW2X', pairMs, src);
        setDerivedReference('CJM2X', pairMs, src);
    }

    /** Prognostic % — 100% = reference pace; higher = faster. */
    function prognosticPct(actualMs, classCode, opts = {}) {
        const ref = getReferenceTime(classCode, opts);
        if (!ref || !actualMs || actualMs <= 0) return null;
        return (ref / actualMs) * 100;
    }

    function formatPrognosticPct(pct) {
        if (pct == null || !Number.isFinite(pct)) return '—';
        return `${pct.toFixed(1)}%`;
    }

    function prognosticClassForEvent(eventKey, row) {
        const ev = String(eventKey || '');
        if (row?.rowKind === 'prog-ref') return row.refClass || null;
        if (ev === '1' || ev === '3') return 'CJW1X';
        if (ev === '2' || ev === '4') return 'CJM1X';
        if (ev === '5') {
            if (row?.rowKind === 'mix-h2h' || row?.lane === 1 || row?.lane === 2) return 'CJMix2X';
            return 'CJMix2X';
        }
        if (ev === '6') {
            const label = String(row?.crewDefault || row?.slot?.crew || row?.crew || '').toUpperCase();
            if (label.includes('CJM2X')) return 'CJM2X';
            if (label.includes('CJW2X')) return 'CJW2X';
            if (label.includes('CJMIX2X') || label.includes('CJMix2X')) return 'CJMix2X';
            return 'CJMix2X';
        }
        return null;
    }

    function renderDerivedNoteHtml() {
        const lines = Object.entries(derived)
            .filter(([code]) => CLASSES[code])
            .map(([code, meta]) => {
                return `<li><strong>${CLASSES[code].label}:</strong> ${formatMsShort(meta.ms)} — ${meta.source || 'derived'}</li>`;
            });
        if (!lines.length) {
            return '<p class="bsr-note">Derived refs appear when W1/M1 prognostic runs are saved (Event 5) or the mix pair is published (Event 6 doubles target).</p>';
        }
        return `<ul class="bsr-prog-derived-list">${lines.join('')}</ul>`;
    }

    function renderPanelHtml() {
        let fields = '';
        for (const [code, meta] of Object.entries(CLASSES)) {
            const derivedMeta = getDerivedMeta(code);
            const title = derivedMeta?.source || meta.source;
            fields +=
                `<div class="bsr-prog-field">` +
                `<label for="bsrProg_${code}">${meta.label}${derivedMeta ? ' <span class="bsr-prog-derived-tag">derived</span>' : ''}</label>` +
                `<input type="text" id="bsrProg_${code}" class="bsr-prog-input" data-prog-class="${code}" ` +
                `value="${getReferenceDisplay(code)}" placeholder="${meta.default}" title="${title}">` +
                `</div>`;
        }
        return (
            `<section class="bsr-card bsr-prognostic-panel" id="bsrPrognosticPanel" hidden>` +
            `<h2 class="bsr-prognostic-title">Prognostic reference times</h2>` +
            `<p class="bsr-note">Defaults from fast U19 times at the 2025 World Rowing Beach Sprint Finals (Antalya). ` +
            `Edit to override — prognostic % = reference ÷ actual × 100 (100% = reference pace, higher is faster).</p>` +
            `<div id="bsrProgDerivedNote">${renderDerivedNoteHtml()}</div>` +
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
            if (!inp || suppressPanelInput) return;
            setReferenceTime(inp.dataset.progClass, inp.value);
            if (global.BsrTrialLive?.rerender) global.BsrTrialLive.rerender();
        });
        panel.addEventListener('input', (e) => {
            const inp = e.target.closest('.bsr-prog-input');
            if (!inp || suppressPanelInput) return;
            setReferenceTime(inp.dataset.progClass, inp.value, { keepDerived: true });
        });
        const resetBtn = document.getElementById('bsrProgReset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                resetToDefaults();
                panel.querySelectorAll('.bsr-prog-input').forEach((inp) => {
                    const code = inp.dataset.progClass;
                    inp.value = CLASSES[code]?.default || '';
                });
                const note = document.getElementById('bsrProgDerivedNote');
                if (note) note.innerHTML = renderDerivedNoteHtml();
                if (global.BsrTrialLive?.rerender) global.BsrTrialLive.rerender();
            });
        }
    }

    function showPanel(show) {
        const panel = document.getElementById('bsrPrognosticPanel');
        if (!panel) return;
        panel.hidden = !show;
    }

    function reload() {
        load();
        refreshPanelInputs();
    }

    function exportForServer() {
        return {
            custom: { ...custom },
            derived: { ...derived },
        };
    }

    function importFromServer(payload) {
        if (!payload || typeof payload !== 'object') return;
        if (payload.custom && typeof payload.custom === 'object') {
            custom = { ...custom, ...payload.custom };
            save();
        }
        if (payload.derived && typeof payload.derived === 'object') {
            derived = { ...payload.derived };
            saveDerived();
        }
        refreshPanelInputs();
    }

    load();

    global.BsrTrialPrognostic = {
        CLASSES,
        MIX_MATRIX,
        MIX_ATHLETE_MATRIX,
        MIX_REF_RUNS,
        getReferenceTime,
        getReferenceDisplay,
        getDerivedMeta,
        setReferenceTime,
        setDerivedReference,
        deriveMixReferenceFromSolos,
        setDoublesReferenceFromMixPair,
        resetToDefaults,
        prognosticPct,
        formatPrognosticPct,
        prognosticClassForEvent,
        normalizeClassCode,
        parseTimeToMs,
        formatMsShort,
        mixPrognosticDebug,
        renderPanelHtml,
        renderDerivedNoteHtml,
        refreshPanelInputs,
        bindPanel,
        showPanel,
        reload,
        exportForServer,
        importFromServer,
    };
})(typeof window !== 'undefined' ? window : globalThis);
