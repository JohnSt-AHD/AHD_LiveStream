/**
 * U19 trial — resolve Wx/Mx seed labels and bracket refs to athlete codes/names.
 */
(function (global) {
    const TRIAL_CODE = 'u19_ct_26';

    /** Division id → winner slot ref for semi/final lane labels. */
    const DIVISION_WINNER = {
        WP1: 12,
        WP2: 13,
        WSF1: 14,
        WSF2: 15,
        MP1: 18,
        MSF1: 19,
        MSF2: 20,
    };

    function isTrial() {
        const code = global.BsrRegatta?.getRegattaCode?.() || '';
        return String(code).toLowerCase() === TRIAL_CODE;
    }

    function rankings() {
        return global.BsrTrialLive?.getRankings?.() || { women: [], men: [] };
    }

    function athleteName(code) {
        const meta = global.BsrTrialLive?.getAthleteMeta?.(code);
        return meta?.name || code || '—';
    }

    function rankCode(gender, n) {
        const idx = parseInt(n, 10) - 1;
        if (idx < 0) return '';
        const list = gender === 'W' ? rankings().women : rankings().men;
        return list[idx] || '';
    }

    function raceWinnerCode(raceNum) {
        const api = global.BsrRegatta;
        if (!api?.getRaceResult) return '';
        const res = api.getRaceResult(raceNum);
        const win = res?.placings?.find((p) => p.place === 1);
        return win?.competitor || '';
    }

    function winnerByDivision(division) {
        const raceNum = DIVISION_WINNER[String(division || '').toUpperCase()];
        if (!raceNum) return '';
        return raceWinnerCode(raceNum);
    }

    function eventGender(eventNum) {
        const n = parseInt(eventNum, 10);
        if (n === 1 || n === 3) return 'W';
        if (n === 2 || n === 4) return 'M';
        return '';
    }

    function resolveMixPair(label) {
        const m = String(label || '').match(/^M(\d)\+W(\d)$/i);
        if (!m) return null;
        const mc = rankCode('M', m[1]);
        const wc = rankCode('W', m[2]);
        if (!mc && !wc) return { code: label, display: label };
        const display = `${athleteName(wc)} + ${athleteName(mc)}`;
        const code = wc && mc ? `${wc}+${mc}` : label;
        return { code, display, raw: label };
    }

    function resolveDoublesLabel(label) {
        const s = String(label || '').trim();
        const pair = s.match(/W(\d)\+W(\d)/i);
        if (pair) {
            const a = rankCode('W', pair[1]);
            const b = rankCode('W', pair[2]);
            if (a || b) {
                return {
                    code: [a, b].filter(Boolean).join('+'),
                    display: `${athleteName(a)} + ${athleteName(b)}`,
                    raw: label,
                };
            }
        }
        const mpair = s.match(/M(\d)\+M(\d)/i);
        if (mpair) {
            const a = rankCode('M', mpair[1]);
            const b = rankCode('M', mpair[2]);
            if (a || b) {
                return {
                    code: [a, b].filter(Boolean).join('+'),
                    display: `${athleteName(a)} + ${athleteName(b)}`,
                    raw: label,
                };
            }
        }
        if (/^CJMix2X/i.test(s)) {
            return { code: s, display: s, raw: label };
        }
        return null;
    }

    /**
     * @param {object} race — regatta race row
     * @param {string} label — daysheet lane label
     */
    function resolveLane(race, label) {
        const raw = String(label || '').trim();
        if (!raw) return { code: '', display: '—', raw };

        const gender = eventGender(race?.eventNum);

        const mix = resolveMixPair(raw);
        if (mix) return mix;

        const dbl = resolveDoublesLabel(raw);
        if (dbl) return dbl;

        const wm = raw.match(/^([WM])(\d+)$/i);
        if (wm) {
            const code = rankCode(wm[1].toUpperCase(), wm[2]);
            return {
                code: code || raw,
                display: code ? athleteName(code) : raw,
                raw,
            };
        }

        if (/^winner \(3 v 6\)$/i.test(raw)) {
            const code = gender === 'M' ? winnerByDivision('MP1') : winnerByDivision('WP1');
            return {
                code: code || raw,
                display: code ? athleteName(code) : raw,
                raw,
            };
        }
        if (/^winner \(4 v 5\)$/i.test(raw)) {
            const code = gender === 'M' ? winnerByDivision('MP1') : winnerByDivision('WP2');
            return {
                code: code || raw,
                display: code ? athleteName(code) : raw,
                raw,
            };
        }

        const sf = raw.match(/^(WSF|MSF)(\d+)$/i);
        if (sf) {
            const code = winnerByDivision(`${sf[1].toUpperCase()}${sf[2]}`);
            return {
                code: code || raw,
                display: code ? athleteName(code) : raw,
                raw,
            };
        }

        if (/^\d+$/.test(raw) && gender) {
            const code = rankCode(gender, raw);
            return {
                code: code || raw,
                display: code ? athleteName(code) : raw,
                raw,
            };
        }

        if (/^[A-Z]{2,5}$/.test(raw)) {
            return { code: raw, display: athleteName(raw), raw };
        }

        return { code: raw, display: raw, raw };
    }

    function formatCrewsForSchedule(race) {
        if (!race?.lanes?.length) return '';
        return race.lanes
            .map((l) => {
                const r = resolveLane(race, l.crew);
                if (r.code && r.display !== r.raw && r.raw) {
                    return `${r.display} (${r.raw})`;
                }
                return r.display || r.code || l.crew;
            })
            .join(' vs ');
    }

    function refreshViews() {
        const api = global.BsrRegatta;
        if (!api?.refreshTrialProgression) return;
        api.refreshTrialProgression();
    }

    global.BsrTrialProgression = {
        TRIAL_CODE,
        isTrial,
        resolveLane,
        formatCrewsForSchedule,
        refreshViews,
        rankCode,
        athleteName,
    };
})(typeof window !== 'undefined' ? window : globalThis);
