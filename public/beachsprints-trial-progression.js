/**
 * U19 trial — resolve Wx/Mx seed labels and bracket refs to athlete codes/names.
 */
(function (global) {
    const TRIAL_CODE = 'u19_ct_26';

    /** Division id → race number for play-in / semi winners. */
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

    function isAthleteCode(code) {
        const c = String(code || '').trim();
        if (/^[WM]\d+$/i.test(c)) return false;
        if (/^winner /i.test(c)) return false;
        if (/^loser /i.test(c)) return false;
        if (/^(WSF|MSF)\d*$/i.test(c)) return false;
        return /^[A-Z]{2,5}$/i.test(c);
    }

    function isBracketLabel(label) {
        const s = String(label || '').trim();
        return (
            /^winner /i.test(s) ||
            /^loser /i.test(s) ||
            /^[WM]\d+$/i.test(s) ||
            /^(WSF|MSF)\d*$/i.test(s) ||
            /^\d+$/.test(s)
        );
    }

    function seedLabelForCode(code) {
        const c = String(code || '').toUpperCase();
        if (!c) return '';
        const w = rankings().women || [];
        const m = rankings().men || [];
        const wi = w.findIndex((x) => String(x).toUpperCase() === c);
        if (wi >= 0) return `W${wi + 1}`;
        const mi = m.findIndex((x) => String(x).toUpperCase() === c);
        if (mi >= 0) return `M${mi + 1}`;
        return '';
    }

    /** e.g. Hazel Church (W6) */
    function formatAthleteDisplay(code) {
        const c = String(code || '').trim().toUpperCase();
        if (!isAthleteCode(c)) return '';
        const name = athleteName(c);
        const seed = seedLabelForCode(c);
        return seed ? `${name} (${seed})` : name;
    }

    function formatPendingLabel(raw) {
        const s = String(raw || '').trim();
        if (/^winner /i.test(s)) return s.replace(/^winner /i, 'Winner ');
        if (/^loser /i.test(s)) return s.replace(/^loser /i, 'Loser ');
        return s;
    }

    function resolvedDisplay(code, raw) {
        if (code && isAthleteCode(code)) return formatAthleteDisplay(code);
        return formatPendingLabel(raw || code);
    }

    function rankCode(gender, n) {
        const idx = parseInt(n, 10) - 1;
        if (idx < 0) return '';
        const list = gender === 'W' ? rankings().women : rankings().men;
        return list[idx] || '';
    }

    function mixMatrixSubstitution(gender, n) {
        const key = `${String(gender || '').toUpperCase()}${n}`;
        const sub = global.BsrTrialLive?.getTrialMeta?.()?.mixMatrixSubstitutions?.[key];
        return sub ? String(sub).toUpperCase() : '';
    }

    /** Rank code for mix matrix pairs only (Event 5) — allows substitutions without changing TT seeding. */
    function matrixRankCode(gender, n) {
        const sub = mixMatrixSubstitution(gender, n);
        if (sub) return sub;
        return rankCode(gender, n);
    }

    function formatMatrixSeedDisplay(seed) {
        const m = String(seed || '').match(/^([WM])(\d+)$/i);
        if (!m) return formatAthleteDisplay(seed) || seed;
        const code = matrixRankCode(m[1].toUpperCase(), m[2]);
        return code ? formatAthleteDisplay(code) : `${m[1].toUpperCase()}${m[2]}`;
    }

    function raceWinnerCode(raceNum) {
        const api = global.BsrRegatta;
        if (!api?.getRaceResult) return '';
        const res = api.getRaceResult(raceNum);
        const win = res?.placings?.find((p) => p.place === 1);
        const code = win?.competitor || '';
        return isAthleteCode(code) ? code.toUpperCase() : normalizeWinnerCode(code, raceNum);
    }

    function normalizeWinnerCode(competitor, raceNum) {
        const api = global.BsrRegatta;
        const race = api?.getRace?.(raceNum);
        if (!race || !competitor) return '';
        const hit = resolveLane(race, competitor);
        return hit?.code && isAthleteCode(hit.code) ? hit.code.toUpperCase() : '';
    }

    function raceLoserCode(raceNum) {
        const api = global.BsrRegatta;
        if (!api?.getRaceResult) return '';
        const res = api.getRaceResult(raceNum);
        const lose = res?.placings?.find((p) => p.place === 2);
        const code = lose?.competitor || '';
        if (isAthleteCode(code)) return code.toUpperCase();
        return normalizeWinnerCode(code, raceNum);
    }

    function loserBySemiRef(ref) {
        const raceNum = DIVISION_WINNER[String(ref || '').toUpperCase()];
        if (!raceNum) return '';
        return raceLoserCode(raceNum);
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
        const mc = matrixRankCode('M', m[1]);
        const wc = matrixRankCode('W', m[2]);
        if (!mc && !wc) return { code: label, display: label, raw: label };
        const wPart = wc ? formatAthleteDisplay(wc) : `W${m[2]}`;
        const mPart = mc ? formatAthleteDisplay(mc) : `M${m[1]}`;
        const code = wc && mc ? `${wc}+${mc}` : label;
        return { code, display: `${wPart} + ${mPart}`, raw: label };
    }

    function resolveDoublesLabel(label) {
        const s = String(label || '').trim();
        const codePair = s.match(/(?:CJW2X|CJM2X|CJMix2X)\s+([A-Z]{2,5})\+([A-Z]{2,5})/i);
        if (codePair) {
            const a = codePair[1].toUpperCase();
            const b = codePair[2].toUpperCase();
            if (isAthleteCode(a) && isAthleteCode(b)) {
                return {
                    code: `${a}+${b}`,
                    display: `${formatAthleteDisplay(a)} + ${formatAthleteDisplay(b)}`,
                    raw: label,
                };
            }
        }
        const barePair = s.match(/^([A-Z]{2,5})\+([A-Z]{2,5})$/i);
        if (barePair) {
            const a = barePair[1].toUpperCase();
            const b = barePair[2].toUpperCase();
            if (isAthleteCode(a) && isAthleteCode(b)) {
                return {
                    code: `${a}+${b}`,
                    display: `${formatAthleteDisplay(a)} + ${formatAthleteDisplay(b)}`,
                    raw: label,
                };
            }
        }
        const pair = s.match(/W(\d)\+W(\d)/i);
        if (pair) {
            const a = rankCode('W', pair[1]);
            const b = rankCode('W', pair[2]);
            if (a || b) {
                const parts = [a, b].map((c) => (c ? formatAthleteDisplay(c) : '')).filter(Boolean);
                return {
                    code: [a, b].filter(Boolean).join('+'),
                    display: parts.join(' + '),
                    raw: label,
                };
            }
        }
        const mpair = s.match(/M(\d)\+M(\d)/i);
        if (mpair) {
            const a = rankCode('M', mpair[1]);
            const b = rankCode('M', mpair[2]);
            if (a || b) {
                const parts = [a, b].map((c) => (c ? formatAthleteDisplay(c) : '')).filter(Boolean);
                return {
                    code: [a, b].filter(Boolean).join('+'),
                    display: parts.join(' + '),
                    raw: label,
                };
            }
        }
        if (/^CJMix2X/i.test(s)) {
            const mixPair = s.match(/CJMix2X\s+([A-Z]{2,5})\+([A-Z]{2,5})/i);
            if (mixPair) {
                const a = mixPair[1].toUpperCase();
                const b = mixPair[2].toUpperCase();
                if (isAthleteCode(a) && isAthleteCode(b)) {
                    return {
                        code: `${a}+${b}`,
                        display: `${formatAthleteDisplay(a)} + ${formatAthleteDisplay(b)}`,
                        raw: label,
                    };
                }
            }
            return { code: s, display: s, raw: label };
        }
        return null;
    }

    function winnerFromPlayIn(gender, which) {
        if (gender === 'M') {
            return which === 'low' ? winnerByDivision('MP1') : '';
        }
        if (which === 'high') return winnerByDivision('WP1');
        if (which === 'low') return winnerByDivision('WP2');
        return '';
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
                display: resolvedDisplay(code, raw),
                raw,
            };
        }

        if (/^winner \(3 v 6\)$/i.test(raw)) {
            const code = winnerFromPlayIn(gender, 'high');
            return { code: code || raw, display: resolvedDisplay(code, raw), raw };
        }
        if (/^winner \(4 v 5\)$/i.test(raw)) {
            const code = winnerFromPlayIn(gender, 'low');
            return { code: code || raw, display: resolvedDisplay(code, raw), raw };
        }

        const loserSf = raw.match(/^loser \((WSF|MSF)(\d+)\)$/i);
        if (loserSf) {
            const code = loserBySemiRef(`${loserSf[1].toUpperCase()}${loserSf[2]}`);
            return { code: code || raw, display: resolvedDisplay(code, raw), raw };
        }

        const sf = raw.match(/^(WSF|MSF)(\d+)$/i);
        if (sf) {
            const code = winnerByDivision(`${sf[1].toUpperCase()}${sf[2]}`);
            return { code: code || raw, display: resolvedDisplay(code, raw), raw };
        }

        if (/^\d+$/.test(raw) && gender) {
            const code = rankCode(gender, raw);
            return { code: code || raw, display: resolvedDisplay(code, raw), raw };
        }

        if (isAthleteCode(raw)) {
            const code = raw.toUpperCase();
            return { code, display: formatAthleteDisplay(code), raw };
        }

        return { code: raw, display: raw, raw };
    }

    function formatCrewsForSchedule(race) {
        if (!race?.lanes?.length) return '';
        return race.lanes
            .map((l) => {
                const r = resolveLane(race, l.crew);
                return r.display || r.code || l.crew;
            })
            .join(' vs ');
    }

    function formatResultLine(place, competitor, time) {
        const label = formatAthleteDisplay(competitor) || athleteName(competitor);
        return `${place}. ${label} (${time || '—'})`;
    }

    function refreshViews() {
        const api = global.BsrRegatta;
        if (api?.refreshTrialProgression) api.refreshTrialProgression();
        if (global.BsrTrialLive?.rerender) global.BsrTrialLive.rerender();
    }

    global.BsrTrialProgression = {
        TRIAL_CODE,
        isTrial,
        resolveLane,
        formatCrewsForSchedule,
        formatAthleteDisplay,
        formatResultLine,
        seedLabelForCode,
        isBracketLabel,
        isAthleteCode,
        refreshViews,
        rankCode,
        matrixRankCode,
        formatMatrixSeedDisplay,
        athleteName,
    };
})(typeof window !== 'undefined' ? window : globalThis);
