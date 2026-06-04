/**
 * Regatta progression — RowIT format strings (draw/daysheet/results) with World Rowing fallback.
 */
(function (global) {
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
        'World Rowing (2025+): top 2 per heat advance directly; remaining next-round places go to the fastest non-qualifiers across heats. Repechages are eliminated.';

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

    function finalDest(letter) {
        const l = String(letter || '').trim().toUpperCase();
        return l ? `${l} Final` : 'Final';
    }

    function destFromMaadiToken(raw) {
        const t = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
        if (!t || /elim/i.test(t)) return null;
        if (t === 'S' || t === 'SF') return 'Semi-final';
        if (t === 'Q F' || t === 'QF' || t === 'Q') return 'Quarter-final';
        if (t === 'FA') return 'A Final';
        if (t === 'FB') return 'B Final';
        if (t === 'FC') return 'C Final';
        if (t === 'FD') return 'D Final';
        if (t === 'FE') return 'E Final';
        if (/^F[A-Z]$/.test(t)) return `${t.slice(1)} Final`;
        if (/final/i.test(t)) return t.replace(/\s*final/i, ' Final').replace(/^([A-Z])\s/, '$1 ');
        return t;
    }

    function placesFromMaadiSpec(spec) {
        const s = String(spec || '').trim();
        const range = s.match(/^(\d+)\s*-\s*(\d+)$/);
        if (range) {
            const from = parseInt(range[1], 10);
            const to = parseInt(range[2], 10);
            const places = [];
            for (let p = from; p <= to; p++) places.push(p);
            return places;
        }
        return s
            .split(/[,+]/)
            .map((x) => parseInt(x.trim(), 10))
            .filter((n) => Number.isFinite(n));
    }

    /**
     * Parse RowIT / Maadi progression string (draw/daysheet/results).
     * Supports: 1,2->A Final; 1-4=S; 5,6=FC; 1-4=Q F; Rest Elim
     * @param {string} raw
     */
    function parseRowitProgressionRules(raw) {
        const s = String(raw || '').trim();
        if (!s) return null;

        const fastestEach = s.match(/Fastest\s+(\d+)\s+to\s+Each\s+Final/i);
        if (fastestEach) {
            return { type: 'fastest-each', perFinal: parseInt(fastestEach[1], 10), raw: s };
        }

        const rules = {
            type: 'standard',
            direct: [],
            nfCount: 0,
            nfDest: 'A Final',
            lower: [],
            raw: s,
        };

        for (const m of s.matchAll(/([\d,\s-]+)\s*->\s*([^;+]+?)(?:\s*Final)?(?=[;+]|$)/gi)) {
            const places = placesFromMaadiSpec(m[1]);
            const dest = destFromMaadiToken(m[2].trim()) || finalDest(m[2].trim());
            if (places.length && dest) rules.direct.push({ places, dest });
        }

        for (const m of s.matchAll(/([\d,\s-]+)\s*=\s*([^;+]+)/gi)) {
            const places = placesFromMaadiSpec(m[1]);
            const dest = destFromMaadiToken(m[2].trim());
            if (places.length && dest) rules.direct.push({ places, dest });
        }

        const rangeMatch = s.match(/(\d+)\s*\.\.\s*(\d+)\s*->\s*(?:([A-Z])\s*)?Final/i);
        if (rangeMatch) {
            const from = parseInt(rangeMatch[1], 10);
            const to = parseInt(rangeMatch[2], 10);
            const places = [];
            for (let p = from; p <= to; p++) places.push(p);
            rules.direct.push({ places, dest: finalDest(rangeMatch[3]) });
            rules.nfDest = finalDest(rangeMatch[3]);
        } else if (!rules.direct.length) {
            const listMatch = s.match(/([\d.,\s]+)\s*->\s*(?:([A-Z])\s*)?Final/i);
            if (listMatch) {
                const places = listMatch[1]
                    .split(/[,.]/)
                    .map((x) => parseInt(x.trim(), 10))
                    .filter((n) => Number.isFinite(n));
                const dest = finalDest(listMatch[2]);
                if (places.length) rules.direct.push({ places, dest });
                rules.nfDest = dest;
            }
        }

        const nfMatch = s.match(/\+\s*(\d+)\s*NF/i);
        if (nfMatch) rules.nfCount = parseInt(nfMatch[1], 10);

        for (const m of s.matchAll(/NF\s*(\d+)\s*->\s*([A-Z])\s*Final/gi)) {
            rules.lower.push({ minPlace: parseInt(m[1], 10), dest: finalDest(m[2]) });
        }

        if (!rules.direct.length && !rules.nfCount && !rules.lower.length) return null;
        return rules;
    }

    /** Places that advance from a knockout round (QF/SF) given format string. */
    function advancingPlacesForRound(roundKind, format) {
        const kind = String(roundKind || '').toLowerCase();
        const rules = parseRowitProgressionRules(format);
        const places = new Set();
        if (rules?.direct?.length) {
            for (const d of rules.direct) {
                const dest = String(d.dest || '').toLowerCase().replace(/\s+/g, '');
                let match = false;
                if (kind === 'qf') match = /semi-final|^semi|^s$/.test(dest);
                else if (kind === 'sf') match = /afinal|^fa$/.test(dest);
                else if (kind === 'heat') match = /quarter|semi|final|^qf|^q$/.test(dest);
                if (match) for (const p of d.places) places.add(p);
            }
        }
        if (!places.size && (kind === 'qf' || kind === 'sf')) return new Set([1, 2, 3, 4]);
        return places;
    }

    function progPill(label, kind) {
        const clsMap = {
            direct: 'rrd-prog--direct',
            ft: 'rrd-prog--ft',
            lower: 'rrd-prog--lower',
            final: 'rrd-prog--final',
            rep: 'rrd-prog--ft',
            out: 'rrd-prog--out',
        };
        return { label, cls: clsMap[kind] || '' };
    }

    function resolveDirectProgression(place, rules) {
        for (const d of rules.direct || []) {
            if (d.places.includes(place)) return progPill(d.dest, 'direct');
        }
        return null;
    }

    function resolveLowerProgression(place, rules) {
        for (const l of rules.lower || []) {
            if (place >= l.minPlace) return progPill(l.dest, 'lower');
        }
        return null;
    }

    function computeRowitHeatProgression(options) {
        const heatResults = options.heatResults || [];
        if (!heatResults.length) {
            return { source: 'none', heats: [], summary: 'No heat results yet.', formatNotes: [] };
        }

        const formatNotes = [...new Set(heatResults.map((h) => h.format).filter(Boolean))];
        const primaryFormat = formatNotes[0] || '';
        const rules = parseRowitProgressionRules(primaryFormat);

        if (!rules) {
            return { source: 'rowit-unparsed', heats: [], summary: '', formatNotes, rules: null };
        }

        if (rules.type === 'fastest-each') {
            const pool = [];
            for (const heat of heatResults) {
                for (const p of heat.placings || []) {
                    if (p.place >= 90 || !p.competitor) continue;
                    const ms = parseRaceTimeMs(p.time);
                    if (!Number.isFinite(ms)) continue;
                    pool.push({
                        crew: p.competitor,
                        time: p.time,
                        timeMs: ms,
                        place: p.place,
                        heat: heat.division,
                        raceNum: heat.raceNum,
                    });
                }
            }
            pool.sort((a, b) => a.timeMs - b.timeMs);
            const per = rules.perFinal;
            const byHeat = new Map();
            for (const heat of heatResults) {
                byHeat.set(String(heat.division), { heatNum: heat.division, raceNum: heat.raceNum, format: heat.format, rows: [] });
            }
            for (const heat of heatResults) {
                const valid = (heat.placings || []).filter((p) => p.place < 90 && p.competitor).sort((a, b) => a.place - b.place);
                const bucket = byHeat.get(String(heat.division));
                for (const p of valid) {
                    const idx = pool.findIndex((x) => x.crew === p.competitor && x.raceNum === heat.raceNum);
                    let progression = progPill('—', 'out');
                    if (idx >= 0) {
                        const finalIdx = Math.floor(idx / per);
                        const letter = String.fromCharCode(65 + finalIdx);
                        progression = progPill(`${letter} Final`, finalIdx === 0 ? 'direct' : 'lower');
                    }
                    bucket.rows.push({
                        crew: p.competitor,
                        time: p.time,
                        place: p.place,
                        heat: heat.division,
                        raceNum: heat.raceNum,
                        progression,
                    });
                }
            }
            const heats = [...byHeat.values()].sort((a, b) => {
                const da = parseInt(a.heatNum, 10);
                const db = parseInt(b.heatNum, 10);
                if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
                return String(a.heatNum).localeCompare(String(b.heatNum));
            });
            return {
                source: 'rowit',
                rules,
                heats,
                formatNotes,
                summary: `RowIT: fastest ${per} to each final · ${pool.length} ranked times`,
            };
        }

        const nfPool = [];
        const byHeat = new Map();

        for (const heat of heatResults) {
            const heatKey = String(heat.division);
            if (!byHeat.has(heatKey)) {
                byHeat.set(heatKey, { heatNum: heat.division, raceNum: heat.raceNum, format: heat.format, rows: [] });
            }
            const heatRules = parseRowitProgressionRules(heat.format || primaryFormat) || rules;
            const valid = (heat.placings || []).filter((p) => p.place < 90 && p.competitor).sort((a, b) => a.place - b.place);

            for (const p of valid) {
                const row = {
                    crew: p.competitor,
                    time: p.time,
                    timeMs: parseRaceTimeMs(p.time),
                    place: p.place,
                    heat: heat.division,
                    raceNum: heat.raceNum,
                    progression: progPill('—', 'out'),
                };

                const direct = resolveDirectProgression(p.place, heatRules);
                if (direct) {
                    row.progression = direct;
                    byHeat.get(heatKey).rows.push(row);
                    continue;
                }

                const lower = resolveLowerProgression(p.place, heatRules);
                if (lower) {
                    row.progression = lower;
                    byHeat.get(heatKey).rows.push(row);
                    continue;
                }

                if (Number.isFinite(row.timeMs) && heatRules.nfCount > 0) {
                    nfPool.push({ row, heatRules });
                } else {
                    row.progression = progPill('—', 'out');
                }
                byHeat.get(heatKey).rows.push(row);
            }
        }

        nfPool.sort((a, b) => a.row.timeMs - b.row.timeMs);
        const nfLimit = rules.nfCount || nfPool[0]?.heatRules?.nfCount || 0;
        nfPool.forEach((entry, i) => {
            const dest = entry.heatRules.nfDest || rules.nfDest || 'A Final';
            entry.row.progression =
                i < nfLimit
                    ? progPill(`${i + 1}.NF → ${dest.replace(' Final', '')}`, 'ft')
                    : progPill(dest.replace(/^A /, 'B ') || 'B Final', 'lower');
        });

        const heats = [...byHeat.values()].sort((a, b) => {
            const da = parseInt(a.heatNum, 10);
            const db = parseInt(b.heatNum, 10);
            if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
            return String(a.heatNum).localeCompare(String(b.heatNum));
        });

        return {
            source: 'rowit',
            rules,
            heats,
            formatNotes,
            summary: `RowIT progression · ${primaryFormat || formatNotes.join(' · ')}`,
        };
    }

    function getSchemeForEntries(entryCount) {
        const n = Math.max(1, entryCount || 1);
        for (const scheme of ENTRY_SCHEMES) {
            if (n >= scheme.min && n <= scheme.max) return { ...scheme, entryCount: n };
        }
        const last = ENTRY_SCHEMES[ENTRY_SCHEMES.length - 1];
        return { ...last, entryCount: n };
    }

    function nextRoundShort(scheme) {
        if (scheme.qf > 0) return 'QF';
        if (scheme.sf > 0) return 'SF';
        return 'Final';
    }

    function computeWorldRowingHeatProgression(options) {
        const heatResults = options.heatResults || [];
        if (!heatResults.length) {
            return { source: 'world-rowing', heats: [], summary: 'No heat results yet.', formatNotes: [] };
        }

        const crewSet = new Set();
        for (const heat of heatResults) {
            for (const p of heat.placings || []) {
                if (p.competitor && p.place < 90) crewSet.add(p.competitor);
            }
        }
        const scheme = getSchemeForEntries(options.entryCount || crewSet.size);
        const nextShort = nextRoundShort(scheme);
        const byHeat = new Map();
        const nfPool = [];

        for (const heat of heatResults) {
            const heatKey = String(heat.division);
            if (!byHeat.has(heatKey)) {
                byHeat.set(heatKey, { heatNum: heat.division, raceNum: heat.raceNum, format: heat.format, rows: [] });
            }
            const valid = (heat.placings || []).filter((p) => p.place < 90 && p.competitor).sort((a, b) => a.place - b.place);

            for (const p of valid) {
                const row = {
                    crew: p.competitor,
                    time: p.time,
                    timeMs: parseRaceTimeMs(p.time),
                    place: p.place,
                    heat: heat.division,
                    raceNum: heat.raceNum,
                    progression: progPill('—', 'out'),
                };

                if (scheme.heats === 1 && scheme.directPerHeat >= 6) {
                    row.progression = progPill('A Final', 'final');
                } else if (p.place <= scheme.directPerHeat) {
                    row.progression = progPill(`${p.place}.H → ${nextShort}`, 'direct');
                } else if (Number.isFinite(row.timeMs)) {
                    nfPool.push(row);
                    byHeat.get(heatKey).rows.push(row);
                    continue;
                } else {
                    row.progression = progPill('Out', 'out');
                }
                byHeat.get(heatKey).rows.push(row);
            }
        }

        nfPool.sort((a, b) => a.timeMs - b.timeMs);
        nfPool.forEach((row, i) => {
            if (i < scheme.fastTimes) {
                row.progression = progPill(`${i + 1}.HT → ${nextShort}`, 'ft');
            } else {
                const finalIdx = Math.min(
                    scheme.finals.length - 1,
                    Math.floor((i - scheme.fastTimes) / Math.max(1, Math.ceil((nfPool.length - scheme.fastTimes) / scheme.finals.length))) + 1,
                );
                row.progression = progPill(`${scheme.finals[finalIdx] || 'B'} Final`, 'lower');
            }
        });

        const heats = [...byHeat.values()].sort((a, b) => {
            const da = parseInt(a.heatNum, 10);
            const db = parseInt(b.heatNum, 10);
            if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
            return String(a.heatNum).localeCompare(String(b.heatNum));
        });

        return {
            source: 'world-rowing',
            scheme,
            heats,
            formatNotes: [],
            summary: `World Rowing fallback · top ${scheme.directPerHeat} per heat → ${nextShort}${scheme.fastTimes ? ` · ${scheme.fastTimes} FT` : ''}`,
        };
    }

    /**
     * Resolve progression for an event: RowIT format (draw/daysheet/results) then World Rowing.
     */
    function computeEventHeatProgression(options) {
        const heatResults = options.heatResults || [];
        const formats = heatResults.map((h) => h.format).filter(Boolean);
        const hasRowit = formats.some((f) => parseRowitProgressionRules(f));

        if (hasRowit) {
            const rowit = computeRowitHeatProgression(options);
            if (rowit.heats.length) return rowit;
        }

        return computeWorldRowingHeatProgression(options);
    }

    function isMisassignedRepFormat(format) {
        return /repechage/i.test(String(format || ''));
    }

    function computeRepProgression(repResults) {
        const reps = repResults || [];
        if (!reps.length) return { reps: [], summary: '' };

        let sharedFormat = '';
        for (const rep of reps) {
            const fmt = String(rep.format || '').trim();
            if (fmt && parseRowitProgressionRules(fmt) && !isMisassignedRepFormat(fmt)) {
                sharedFormat = fmt;
                break;
            }
        }

        const blocks = reps.map((rep) => {
            const valid = (rep.placings || []).filter((p) => p.place < 90 && p.competitor).sort((a, b) => a.place - b.place);
            let format = String(rep.format || '').trim();
            if (!format || isMisassignedRepFormat(format)) format = sharedFormat;
            const rules = parseRowitProgressionRules(format);
            const rows = valid.map((p) => {
                let progression = progPill('—', 'out');
                if (rules) {
                    progression = resolveDirectProgression(p.place, rules) || resolveLowerProgression(p.place, rules) || progPill('—', 'out');
                } else if (p.place <= 2) {
                    progression = progPill('→ Next round', 'rep');
                }
                return {
                    crew: p.competitor,
                    time: p.time,
                    place: p.place,
                    raceNum: rep.raceNum,
                    progression,
                };
            });
            return {
                repNum: rep.division || rep.raceNum,
                raceNum: rep.raceNum,
                format,
                rows,
            };
        });
        return { reps: blocks, summary: `${reps.length} repechage race(s)` };
    }

    global.WorldRowingProgression = {
        ENTRY_SCHEMES,
        RULES_SUMMARY,
        parseRaceTimeMs,
        parseRowitProgressionRules,
        advancingPlacesForRound,
        getSchemeForEntries,
        computeEventHeatProgression,
        computeRowitHeatProgression,
        computeWorldRowingHeatProgression,
        computeRepProgression,
    };
})(typeof window !== 'undefined' ? window : globalThis);
