/**
 * World Rowing progression system (2025+, Rule 58 / Appendix R7).
 * Top 2 per heat qualify directly; remaining next-round slots filled by fastest times.
 * Repechages eliminated. See worldrowing.com progression documentation.
 */
(function (global) {
    /** @type {Array<{min:number,max:number,heats:number,directPerHeat:number,fastTimes:number,qf:number,sf:number,finals:string[]}>} */
    const ENTRY_SCHEMES = [
        { min: 1, max: 6, heats: 1, directPerHeat: 6, fastTimes: 0, qf: 0, sf: 0, finals: ['A'] },
        { min: 7, max: 12, heats: 2, directPerHeat: 2, fastTimes: 2, qf: 0, sf: 0, finals: ['A', 'B'] },
        { min: 13, max: 18, heats: 3, directPerHeat: 2, fastTimes: 6, qf: 0, sf: 2, finals: ['A', 'B', 'C'] },
        { min: 19, max: 24, heats: 4, directPerHeat: 2, fastTimes: 4, qf: 0, sf: 2, finals: ['A', 'B', 'C', 'D'] },
        { min: 25, max: 30, heats: 5, directPerHeat: 2, fastTimes: 14, qf: 4, sf: 2, finals: ['A', 'B', 'C', 'D', 'E'] },
        { min: 31, max: 36, heats: 6, directPerHeat: 2, fastTimes: 12, qf: 4, sf: 2, finals: ['A', 'B', 'C', 'D', 'E', 'F'] },
        { min: 37, max: 42, heats: 7, directPerHeat: 2, fastTimes: 10, qf: 4, sf: 2, finals: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
        { min: 43, max: 48, heats: 8, directPerHeat: 2, fastTimes: 8, qf: 4, sf: 2, finals: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] },
        { min: 49, max: 54, heats: 9, directPerHeat: 2, fastTimes: 6, qf: 4, sf: 2, finals: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] },
        { min: 55, max: 60, heats: 10, directPerHeat: 2, fastTimes: 4, qf: 4, sf: 2, finals: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] },
        { min: 61, max: 66, heats: 11, directPerHeat: 2, fastTimes: 2, qf: 4, sf: 2, finals: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] },
    ];

    const RULES_SUMMARY =
        'World Rowing (2025+): top 2 per heat advance directly; remaining next-round places go to the fastest non-qualifiers across heats. Repechages are eliminated. Quarter-finals for the top 24 entries, semi-finals for the top 12. Every crew races a final.';

    function parseRaceTimeMs(timeStr) {
        const s = String(timeStr || '').trim();
        if (!s || /^(scr|dns|dnf|rmv)$/i.test(s)) return NaN;
        const parts = s.split(':');
        if (parts.length === 2) {
            const m = parseInt(parts[0], 10);
            const sec = parseFloat(parts[1]);
            if (Number.isFinite(m) && Number.isFinite(sec)) return (m * 60 + sec) * 1000;
        }
        const sec = parseFloat(s);
        return Number.isFinite(sec) ? sec * 1000 : NaN;
    }

    function getSchemeForEntries(entryCount) {
        const n = Math.max(1, entryCount || 1);
        for (const scheme of ENTRY_SCHEMES) {
            if (n >= scheme.min && n <= scheme.max) return { ...scheme, entryCount: n };
        }
        const last = ENTRY_SCHEMES[ENTRY_SCHEMES.length - 1];
        return { ...last, entryCount: n };
    }

    function nextRoundLabel(scheme) {
        if (scheme.qf > 0) return 'Quarter-final';
        if (scheme.sf > 0) return 'Semi-final';
        return 'Final';
    }

    function nextRoundShort(scheme) {
        if (scheme.qf > 0) return 'QF';
        if (scheme.sf > 0) return 'SF';
        return 'Final';
    }

    /**
     * Parse RowIT progression note from results/daysheet (e.g. "1,2->A Final + 3 NF").
     * @param {string} raw
     */
    function parseRowitFormatNote(raw) {
        const s = String(raw || '').trim();
        if (!s) return null;
        const direct = [];
        const mDirect = s.match(/([\d.,]+)\s*->\s*([A-Z])\s*Final/i);
        if (mDirect) {
            mDirect[1].split(/[,.]/).forEach((p) => {
                const n = parseInt(p, 10);
                if (Number.isFinite(n)) direct.push(n);
            });
        }
        const nfMatch = s.match(/\+\s*(\d+)\s*NF/i);
        const nfPlaces = nfMatch ? parseInt(nfMatch[1], 10) : 0;
        const lowerFinal = s.match(/NF\s*(\d+)\s*->\s*([A-Z])\s*Final/i);
        return {
            raw: s,
            directPlaces: direct,
            nextFinalFastTimes: nfPlaces,
            lowerFinalFromPlace: lowerFinal ? parseInt(lowerFinal[1], 10) : null,
            lowerFinalLetter: lowerFinal ? lowerFinal[2].toUpperCase() : '',
        };
    }

    /**
     * Compute heat progression for one event using World Rowing rules.
     * @param {object} options
     * @param {Array<{raceNum:number,division:string,format:string,placings:Array<{place:number,competitor:string,time:string}>}>} options.heatResults
     * @param {number} [options.entryCount]
     */
    function computeHeatProgression(options) {
        const heatResults = options.heatResults || [];
        if (!heatResults.length) {
            return { scheme: null, rows: [], formatNotes: [], summary: 'No heat results yet.' };
        }

        const crewSet = new Set();
        for (const heat of heatResults) {
            for (const p of heat.placings || []) {
                if (p.competitor && p.place < 90) crewSet.add(p.competitor);
            }
        }
        const entryCount = options.entryCount || crewSet.size;
        const scheme = getSchemeForEntries(entryCount);
        const nextShort = nextRoundShort(scheme);
        const formatNotes = [...new Set(heatResults.map((h) => h.format).filter(Boolean))];

        const rows = [];
        const fastTimePool = [];

        for (const heat of heatResults) {
            const heatNum = heat.division || '?';
            const valid = (heat.placings || [])
                .filter((p) => p.place < 90 && p.competitor)
                .sort((a, b) => a.place - b.place);

            for (const p of valid) {
                const ms = parseRaceTimeMs(p.time);
                const row = {
                    crew: p.competitor,
                    time: p.time,
                    timeMs: ms,
                    place: p.place,
                    heat: heatNum,
                    raceNum: heat.raceNum,
                    format: heat.format || '',
                    progression: { label: '—', cls: '' },
                };

                if (scheme.heats === 1 && scheme.directPerHeat >= 6) {
                    row.progression = { label: 'A Final', cls: 'rrd-prog--final' };
                    rows.push(row);
                    continue;
                }

                if (p.place <= scheme.directPerHeat) {
                    row.progression = {
                        label: `${p.place}.${p.place}.H → ${nextShort}`,
                        cls: 'rrd-prog--direct',
                    };
                    rows.push(row);
                } else if (Number.isFinite(ms)) {
                    fastTimePool.push(row);
                } else {
                    row.progression = { label: 'Out', cls: 'rrd-prog--out' };
                    rows.push(row);
                }
            }
        }

        fastTimePool.sort((a, b) => a.timeMs - b.timeMs);
        const ftLimit = scheme.fastTimes;
        fastTimePool.forEach((row, i) => {
            if (i < ftLimit) {
                row.progression = {
                    label: `${i + 1}.HT → ${nextShort}`,
                    cls: 'rrd-prog--ft',
                };
            } else {
                const finalIdx = Math.min(
                    scheme.finals.length - 1,
                    Math.floor((i - ftLimit) / Math.max(1, Math.ceil((fastTimePool.length - ftLimit) / scheme.finals.length))) + 1,
                );
                const finalLetter = scheme.finals[finalIdx] || scheme.finals[scheme.finals.length - 1];
                row.progression = { label: `${finalLetter} Final`, cls: 'rrd-prog--lower' };
            }
            rows.push(row);
        });

        rows.sort((a, b) => {
            const order = { direct: 0, ft: 1, lower: 2, final: 3, out: 4, other: 5 };
            const rank = (r) => {
                const c = r.progression.cls || '';
                if (c.includes('direct')) return order.direct;
                if (c.includes('ft')) return order.ft;
                if (c.includes('lower')) return order.lower;
                if (c.includes('final')) return order.final;
                if (c.includes('out')) return order.out;
                return order.other;
            };
            const dr = rank(a) - rank(b);
            if (dr !== 0) return dr;
            if (Number.isFinite(a.timeMs) && Number.isFinite(b.timeMs)) return a.timeMs - b.timeMs;
            return a.place - b.place;
        });

        const summary =
            `${entryCount} entries · ${scheme.heats} heat(s) · ` +
            `top ${scheme.directPerHeat} per heat → ${nextShort}` +
            (scheme.fastTimes ? ` · ${scheme.fastTimes} fastest time(s)` : '') +
            ` · ${scheme.finals.length} final(s) (${scheme.finals.join(', ')})`;

        return {
            scheme,
            rows,
            formatNotes,
            rowitNotes: formatNotes.map(parseRowitFormatNote).filter(Boolean),
            summary,
            rulesSummary: RULES_SUMMARY,
        };
    }

    global.WorldRowingProgression = {
        ENTRY_SCHEMES,
        RULES_SUMMARY,
        parseRaceTimeMs,
        getSchemeForEntries,
        nextRoundLabel,
        nextRoundShort,
        parseRowitFormatNote,
        computeHeatProgression,
    };
})(typeof window !== 'undefined' ? window : globalThis);
