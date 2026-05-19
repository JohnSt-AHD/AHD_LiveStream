/**
 * Beach Sprints regatta dashboard — race-by-race insight from RowIT CSV + Traccar GPS.
 * Default regatta: cnzb2026 (NZ Coastal Beach Sprint Champs, Titahi Bay Apr 2026).
 */
(function () {
    const DEFAULT_REGATTA = 'cnzb2026';
    const ROWIT_CSV_BASES = ['https://l.rowit.nz/altitude', 'https://rowit.nz/altitude'];
    const LOCAL_REGATTA_CSV = {
        cnzb2026: { results: 'data/cnzb2026-results.csv' },
    };
    const REGATTA_META = {
        cnzb2026: {
            name: 'NZ Coastal Beach Sprint Champs 2026',
            location: 'Titahi Bay, Wellington',
            venue: 'Titahi Bay',
        },
    };
    const LS_REGATTA = 'bsrRegattaCode_v1';
    const LS_GPS_OFFSET = 'bsrGpsOffsetMin_v1';
    const LS_DEVICE_ALIASES = 'bsrDeviceAliases_v1';
    const LS_LANE_DEVICES = 'bsrLaneDevices_v1';
    const LS_REGATTA_PRESETS = 'bsrRegattaPresets_v1';
    const LS_PROGRESSION_VIEW = 'bsrProgressionView_v1';
    const LS_BUOY_SOURCE = 'bsrBuoySource_v1';

    const BOAT_ALIASES = ['boat_1', 'boat_2', 'boat_3', 'boat_4', 'boat_5', 'boat_6'];
    const ROUND_ORDER = ['tt', 'heat', 'rep', 'qf', 'sf', 'final', 'other'];
    const ROUND_LABELS = {
        tt: 'Time trial',
        heat: 'Heats',
        rep: 'Repechage',
        qf: 'Quarter-final',
        sf: 'Semi-final',
        final: 'Final',
        other: 'Other',
    };

    const COURSE_LABELS = {
        main: 'Main Course (lanes 1–2)',
        north: 'North Course (lanes 4–5)',
        both: 'Both courses',
    };

    const MONTHS = {
        january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
        may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
        september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
        december: 11, dec: 11,
    };

    const state = {
        regattaCode: DEFAULT_REGATTA,
        races: [],
        results: new Map(),
        competitors: new Map(),
        events: [],
        eventsByNum: new Map(),
        lookup: null,
        clubIndex: new Map(),
        devices: [],
        selectedRaceNum: null,
        gpsOffsetMin: 0,
        deviceAliases: {},
        laneDevices: {},
        progressionView: 'linear',
        filterDay: '',
        filterEvent: '',
        selectedEventKey: '',
        gpsDayStatus: new Map(),
        miniMap: null,
        speedChart: null,
        splitsChart: null,
        turnChart: null,
        cumulativeChart: null,
        miniMapLayers: [],
        buoySource: 'gps',
        lastBuoyFitNote: '',
        loading: false,
    };

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parseCsvLine(line) {
        const out = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQ) {
                if (c === '"' && line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else if (c === '"') inQ = false;
                else cur += c;
            } else if (c === '"') inQ = true;
            else if (c === ',') {
                out.push(cur);
                cur = '';
            } else cur += c;
        }
        out.push(cur);
        return out;
    }

    function parseDayHeader(line) {
        const m = line.match(/DAY\s+\d+:\s+\w+\s+(\d{1,2})(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/i);
        if (!m) return null;
        const month = MONTHS[m[2].toLowerCase()];
        if (month === undefined) return null;
        return {
            date: new Date(parseInt(m[3], 10), month, parseInt(m[1], 10)),
            label: line.trim(),
        };
    }

    function parseRaceLabel(raw) {
        const s = String(raw || '').trim();
        const withLetter = s.match(/^(\d+)\s*\(([A-Za-z])\)\s*$/);
        if (withLetter) {
            return {
                raceNum: parseInt(withLetter[1], 10),
                label: `${withLetter[1]} (${withLetter[2].toUpperCase()})`,
            };
        }
        const plain = s.match(/^(\d+)$/);
        if (plain) {
            return { raceNum: parseInt(plain[1], 10), label: plain[1] };
        }
        return { raceNum: null, label: s };
    }

    function parseTimeOnDay(timeStr, dayDate) {
        const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
        if (!m || !dayDate) return null;
        return new Date(
            dayDate.getFullYear(),
            dayDate.getMonth(),
            dayDate.getDate(),
            parseInt(m[1], 10),
            parseInt(m[2], 10),
            0,
            0,
        );
    }

    function isCrewCell(raw) {
        const s = String(raw || '').trim();
        if (!s || s === '-' || /^-+\s*$/.test(s)) return false;
        if (/cancelled/i.test(s)) return false;
        return true;
    }

    function parseLanes(cols, headerCols) {
        if (headerCols?.length) {
            const lanes = [];
            for (let i = 0; i < headerCols.length; i++) {
                const h = (headerCols[i] || '').trim().toLowerCase();
                const m = h.match(/^lane[_\s-]?(\d+)$/);
                if (!m) continue;
                const crew = (cols[i] || '').trim();
                if (!isCrewCell(crew)) continue;
                lanes.push({ lane: parseInt(m[1], 10), crew });
            }
            lanes.sort((a, b) => a.lane - b.lane);
            if (lanes.length) return lanes;
        }
        const lanes = [];
        for (let lane = 1; lane <= 9; lane++) {
            const idx = 5 + lane;
            if (idx >= cols.length) break;
            const crew = (cols[idx] || '').trim();
            if (isCrewCell(crew)) lanes.push({ lane, crew });
        }
        return lanes;
    }

    function parseDaysheet(text) {
        const races = [];
        let dayDate = null;
        let dayLabel = '';
        let headerCols = null;
        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (/^DAY\s+\d+:/i.test(trimmed)) {
                const day = parseDayHeader(trimmed);
                dayDate = day?.date;
                dayLabel = trimmed;
                headerCols = null;
                continue;
            }
            if (!dayDate) continue;
            if (/^Race,/i.test(trimmed)) {
                headerCols = parseCsvLine(trimmed);
                continue;
            }
            const cols = parseCsvLine(trimmed);
            if (cols.length < 5) continue;
            const info = parseRaceLabel(cols[0]);
            if (!info.raceNum) continue;
            const startAt = parseTimeOnDay(cols[1], dayDate);
            if (!startAt) continue;
            const lanes = parseLanes(cols, headerCols);
            const round = cols[4].trim();
            races.push({
                raceNum: info.raceNum,
                race: info.label,
                startAt,
                eventNum: cols[2].trim(),
                eventName: cols[3].trim(),
                round,
                division: cols[5] ? cols[5].trim() : '',
                lanes,
                course: inferCourseFromLanes(lanes),
                progression: headerCols ? '' : cols[cols.length - 1] ? cols[cols.length - 1].trim() : '',
                dayLabel,
            });
        }
        races.sort((a, b) => a.startAt - b.startAt);
        return races;
    }

    function parseResultPlacings(cols) {
        const placings = [];
        for (let i = 6; i + 2 < cols.length; i += 3) {
            const place = parseInt(cols[i], 10);
            const competitor = cols[i + 1].trim();
            const time = cols[i + 2].trim();
            if (!Number.isFinite(place) || place < 1 || !competitor) continue;
            placings.push({ place, competitor, time });
        }
        return placings;
    }

    function mergeResultPlacings(existing, incoming) {
        const byComp = new Map();
        for (const p of [...existing, ...incoming]) {
            const key = p.competitor.toLowerCase();
            const cur = byComp.get(key);
            const rank = (place) => (place >= 90 ? 999 : place);
            if (!cur || rank(p.place) < rank(cur.place)) {
                byComp.set(key, p);
            } else if (
                cur &&
                rank(p.place) === rank(cur.place) &&
                p.time &&
                (!cur.time || cur.time.length < p.time.length)
            ) {
                byComp.set(key, p);
            }
        }
        return [...byComp.values()].sort((a, b) => {
            const ra = a.place >= 90 ? 999 : a.place;
            const rb = b.place >= 90 ? 999 : b.place;
            return ra - rb;
        });
    }

    function parseResults(text) {
        const map = new Map();
        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || !/^\d/.test(trimmed)) continue;
            const cols = parseCsvLine(trimmed);
            const raceNum = parseInt(cols[0], 10);
            if (!Number.isFinite(raceNum)) continue;
            const placings = parseResultPlacings(cols);
            const row = {
                status: cols[5]?.trim() || '',
                eventNum: cols[1]?.trim() || '',
                round: cols[2]?.trim() || '',
                division: cols[3]?.trim() || '',
                placings,
            };
            if (map.has(raceNum)) {
                const prev = map.get(raceNum);
                prev.placings = mergeResultPlacings(prev.placings, placings);
                if (!prev.status && row.status) prev.status = row.status;
            } else {
                map.set(raceNum, row);
            }
        }
        return map;
    }

    function parseCompetitors(text) {
        const map = new Map();
        let dayDate = null;
        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (/^DAY\s+\d+:/i.test(trimmed)) {
                dayDate = parseDayHeader(trimmed)?.date;
                continue;
            }
            if (!dayDate || /^Race,/i.test(trimmed)) continue;
            const cols = parseCsvLine(trimmed);
            const info = parseRaceLabel(cols[0]);
            if (!info.raceNum) continue;
            const division = cols[5] ? cols[5].trim() : '';
            map.set(`${info.label}|${division}`, {
                race: info.label,
                raceNum: info.raceNum,
                division,
                names: cols[6] ? cols[6].trim() : '',
            });
        }
        return map;
    }

    function parseEvents(text) {
        const events = [];
        const byNum = new Map();
        let header = null;

        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const cols = parseCsvLine(trimmed);
            if (/^event/i.test(cols[0] || '')) {
                header = cols.map((c) => String(c || '').toLowerCase().trim());
                continue;
            }
            const eventNum = (cols[0] || '').trim();
            if (!eventNum || (!/^\d/.test(eventNum) && !/^e\d/i.test(eventNum))) continue;

            const row = {
                eventNum,
                name: (cols[1] || '').trim(),
                raw: cols,
            };

            if (header) {
                header.forEach((h, i) => {
                    const v = cols[i]?.trim();
                    if (!v) return;
                    if (h === 'name' || h.includes('description') || h.includes('title')) row.name = v;
                    else if (h.includes('class')) row.classCode = v;
                    else if (h.includes('gender') || h === 'sex') row.gender = v;
                    else if (h.includes('boat') || h.includes('discipline')) row.boat = v;
                    else if (h.includes('lane')) row.laneCount = v;
                    else if (h.includes('draw') || h.includes('entries')) row.drawSize = v;
                    else if (h.includes('division') || h === 'div') row.division = v;
                    else if (h.includes('progression') || h.includes('format')) row.format = v;
                    else if (h.includes('distance')) row.distance = v;
                });
            } else {
                if (cols[2]) row.classCode = cols[2].trim();
                if (cols[3]) row.gender = cols[3].trim();
                if (cols[4]) row.boat = cols[4].trim();
                if (cols[5]) row.laneCount = cols[5].trim();
                if (cols[6]) row.drawSize = cols[6].trim();
            }

            row.displayName = expandEventName(row.name || row.classCode || eventNum);
            events.push(row);
            byNum.set(eventNum, row);
            byNum.set(String(parseInt(eventNum, 10)), row);
        }
        state.eventsByNum = byNum;
        return events;
    }

    function normalizeRegattaCode(raw) {
        return (
            String(raw || '')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, '') || DEFAULT_REGATTA
        );
    }

    function csvUrlCandidates(code, file) {
        const c = normalizeRegattaCode(code);
        if (window.AltitudeHdHub?.buildCsvUrlCandidates) {
            return window.AltitudeHdHub.buildCsvUrlCandidates(c, file);
        }
        return ROWIT_CSV_BASES.map((base) => `${base}/${c}/${file}.csv`);
    }

    function csvUrl(code, file) {
        return csvUrlCandidates(code, file)[0];
    }

    async function fetchCsvText(url) {
        const trimmed = String(url || '').trim();
        if (!trimmed) throw new Error('No CSV URL');
        try {
            const res = await fetch(`/api/fetch-csv?url=${encodeURIComponent(trimmed)}`);
            if (res.ok) return res.text();
        } catch {
            /* fallback */
        }
        const res = await fetch(trimmed);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
    }

    async function fetchRegattaCsv(code, file) {
        const candidates = csvUrlCandidates(code, file);
        let lastErr = null;
        for (const url of candidates) {
            try {
                return await fetchCsvText(url);
            } catch (err) {
                lastErr = err;
            }
        }
        const localPath = LOCAL_REGATTA_CSV[normalizeRegattaCode(code)]?.[file];
        if (localPath) {
            const res = await fetch(localPath);
            if (res.ok) return res.text();
        }
        throw lastErr || new Error(`Could not load ${file}.csv`);
    }

    function normalizeClubKey(s) {
        return String(s || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function buildClubIndex() {
        const index = new Map();
        if (!state.lookup?.clubs) {
            state.clubIndex = index;
            return index;
        }
        for (const [id, c] of Object.entries(state.lookup.clubs)) {
            const keys = new Set([
                id,
                c.id,
                c.name,
                c.name?.replace(/\s+Rowing Club$/i, ''),
                c.name?.replace(/\s+College$/i, ''),
            ]);
            for (const k of keys) {
                const nk = normalizeClubKey(k);
                if (nk && !index.has(nk)) index.set(nk, id);
            }
            const words = normalizeClubKey(c.name).split(' ').filter((w) => w.length > 3);
            if (words.length >= 2) {
                const abbrev = words.map((w) => w[0]).join('');
                if (abbrev.length >= 2 && !index.has(abbrev)) index.set(abbrev, id);
            }
        }
        state.clubIndex = index;
        return index;
    }

    function levenshtein(a, b) {
        const m = a.length;
        const n = b.length;
        if (!m) return n;
        if (!n) return m;
        let prev = new Array(n + 1);
        let curr = new Array(n + 1);
        for (let j = 0; j <= n; j++) prev[j] = j;
        for (let i = 1; i <= m; i++) {
            curr[0] = i;
            for (let j = 1; j <= n; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
            }
            const swap = prev;
            prev = curr;
            curr = swap;
        }
        return prev[n];
    }

    function rankClubIdForCode(code, id) {
        const typeRank = { s: 0, c: 1, t: 2, '': 3, x: 9 };
        const club = state.lookup?.clubs?.[id];
        const tr = typeRank[club?.type] ?? 5;
        const lenDiff = id.length - code.length;
        return [tr, lenDiff, id];
    }

    /** RowIT composite crews use CODE* — map to nearest club/school in lookup. */
    function findClosestClubByCode(code) {
        const clubs = state.lookup?.clubs || {};
        const c = String(code || '').toLowerCase();
        if (!c) return { clubId: '', match: 'none' };

        const starId = `${c}*`;
        if (clubs[starId]) return { clubId: starId, match: 'composite-star' };
        if (clubs[c]) return { clubId: c, match: 'code' };

        const prefixHits = Object.keys(clubs)
            .filter((id) => id !== 'comp' && id.startsWith(c))
            .sort((a, b) => {
                const ra = rankClubIdForCode(c, a);
                const rb = rankClubIdForCode(c, b);
                return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
            });
        if (prefixHits.length) return { clubId: prefixHits[0], match: 'composite-prefix' };

        const head = c.slice(0, 2);
        const fuzzyHits = Object.keys(clubs)
            .filter((id) => id !== 'comp' && id.length >= c.length && id.startsWith(head))
            .map((id) => ({
                id,
                dist: levenshtein(c, id.slice(0, c.length)),
                len: id.length,
            }))
            .filter((x) => x.dist <= 1)
            .sort((a, b) => a.dist - b.dist || a.len - b.len || a.id.localeCompare(b.id));
        if (fuzzyHits.length) return { clubId: fuzzyHits[0].id, match: 'composite-fuzzy' };

        if (clubs.comp) return { clubId: 'comp', match: 'composite-generic' };
        return { clubId: '', match: 'none' };
    }

    function parseClubFromCrew(crew) {
        const s = String(crew || '').trim();
        if (!s) return { id: '', label: '', crewNum: '', isComposite: false };
        const m = s.match(/^([A-Za-z]{2,5})(\*?)(?:\s+(\d+))?$/);
        if (m) {
            return {
                id: m[1].toLowerCase(),
                label: s,
                crewNum: m[3] || '',
                isComposite: m[2] === '*',
            };
        }
        return { id: '', label: s, crewNum: '', isComposite: s.includes('*') };
    }

    function resolveClubFromCrew(crew) {
        const parsed = parseClubFromCrew(crew);

        if (parsed.isComposite && parsed.id) {
            const nearest = findClosestClubByCode(parsed.id);
            if (nearest.clubId) {
                return {
                    clubId: nearest.clubId,
                    label: parsed.label,
                    match: nearest.match,
                    isComposite: true,
                    baseCode: parsed.id,
                };
            }
        }

        if (parsed.id && state.lookup?.clubs?.[parsed.id]) {
            return { clubId: parsed.id, label: parsed.label, match: 'code', isComposite: false };
        }

        const key = normalizeClubKey(crew);
        if (!key) return { clubId: '', label: parsed.label || crew, match: 'none' };

        if (state.clubIndex.has(key)) {
            return {
                clubId: state.clubIndex.get(key),
                label: parsed.label || crew,
                match: 'exact',
                isComposite: parsed.isComposite,
                baseCode: parsed.id,
            };
        }

        let bestId = '';
        let bestScore = 0;
        for (const [id, c] of Object.entries(state.lookup?.clubs || {})) {
            const nameKey = normalizeClubKey(c.name);
            if (!nameKey) continue;
            if (key === nameKey || key.includes(nameKey) || nameKey.includes(key)) {
                const score =
                    Math.min(key.length, nameKey.length) / Math.max(key.length, nameKey.length);
                if (score > bestScore) {
                    bestScore = score;
                    bestId = id;
                }
            }
            const tokens = key.split(' ');
            const nameTokens = nameKey.split(' ');
            const overlap = tokens.filter((t) => t.length > 2 && nameTokens.includes(t)).length;
            if (overlap >= 2 && overlap / Math.max(tokens.length, nameTokens.length) > bestScore) {
                bestScore = overlap / Math.max(tokens.length, nameTokens.length);
                bestId = id;
            }
        }
        if (bestId && bestScore >= 0.45) {
            return {
                clubId: bestId,
                label: parsed.label || crew,
                match: 'fuzzy',
                isComposite: parsed.isComposite,
                baseCode: parsed.id,
            };
        }
        return {
            clubId: parsed.id || '',
            label: parsed.label || crew,
            match: 'none',
            isComposite: parsed.isComposite,
            baseCode: parsed.id,
        };
    }

    function clubInfo(clubIdOrCrew) {
        const isDirectId =
            typeof clubIdOrCrew === 'string' &&
            state.lookup?.clubs?.[clubIdOrCrew] &&
            !clubIdOrCrew.includes('*');
        const resolved = isDirectId
            ? { clubId: clubIdOrCrew, match: 'code' }
            : resolveClubFromCrew(clubIdOrCrew);
        const clubId = resolved.clubId || clubIdOrCrew;
        if (!clubId || !state.lookup?.clubs) {
            return {
                name: clubId ? String(clubId).toUpperCase() : '—',
                logoUrl: null,
                clubId: clubId || '',
                match: resolved.match,
            };
        }
        const c = state.lookup.clubs[clubId];
        if (!c) {
            return {
                name: String(clubId).toUpperCase(),
                logoUrl: null,
                clubId,
                match: resolved.match,
            };
        }
        return {
            name: c.name || String(clubId).toUpperCase(),
            logoUrl: c.logo ? `assets/school-logos/${encodeURIComponent(c.logo)}` : null,
            clubId,
            match: resolved.match,
            isComposite: resolved.isComposite,
            baseCode: resolved.baseCode,
        };
    }

    function expandEventName(code) {
        if (!code || !state.lookup) return code;
        let s = String(code).trim();
        const parts = s.split(/\s+/);
        const out = [];
        for (const p of parts) {
            const low = p.toLowerCase();
            if (state.lookup.gender?.[low]) out.push(state.lookup.gender[low]);
            else if (state.lookup.class?.[low]) out.push(state.lookup.class[low]);
            else if (state.lookup.boat?.[low]) out.push(state.lookup.boat[low]);
            else out.push(p);
        }
        return out.join(' ');
    }

    function eventMetaForRace(race) {
        return (
            state.eventsByNum.get(race.eventNum) ||
            state.eventsByNum.get(String(parseInt(race.eventNum, 10))) ||
            null
        );
    }

    function competitorNames(race) {
        const key = `${race.race}|${race.division}`;
        const row = state.competitors.get(key);
        if (row?.names) return row.names;
        for (const [, v] of state.competitors) {
            if (v.raceNum === race.raceNum && v.division === race.division) {
                return v.names;
            }
        }
        return '';
    }

    function inferCourseFromLanes(lanes) {
        const nums = new Set((lanes || []).map((l) => l.lane));
        const main = nums.has(1) || nums.has(2);
        const north = nums.has(4) || nums.has(5);
        if (main && north) return 'both';
        if (north) return 'north';
        if (main) return 'main';
        return '';
    }

    function isTimeTrialRace(race) {
        return classifyRound(race.round) === 'tt';
    }

    function classifyRound(round) {
        const r = String(round || '').toLowerCase();
        if (/time\s*trial|\btt\b/.test(r)) return 'tt';
        if (r === 'r' || /rep/.test(r)) return 'rep';
        if (r === 'q' || /quarter|\bqf\b/.test(r)) return 'qf';
        if (r === 's' || /semi|\bsf\b/.test(r)) return 'sf';
        if (r === 'f' || /final|\bf\b/.test(r)) return 'final';
        if (r === 'h' || /heat/.test(r)) return 'heat';
        return 'other';
    }

    function expandRoundLabel(round) {
        const r = String(round || '').trim();
        const map = {
            h: 'Heat',
            q: 'Quarter-final',
            s: 'Semi-final',
            f: 'Final',
            r: 'Repechage',
            e: 'Exhibition',
        };
        return map[r.toLowerCase()] || r;
    }

    function eventKey(race) {
        return String(race?.eventNum ?? '').trim();
    }

    function eventMatchesNum(raceOrRes, eventNum) {
        return String(raceOrRes?.eventNum ?? raceOrRes) === String(eventNum);
    }

    function getRegattaMeta(code) {
        const c = normalizeRegattaCode(code);
        return (
            REGATTA_META[c] || {
                name: c.toUpperCase(),
                location: '',
                venue: '',
            }
        );
    }

    function parseRaceTimeMs(timeStr) {
        const s = String(timeStr || '').trim();
        if (!s) return NaN;
        const parts = s.split(':');
        if (parts.length === 2) {
            const m = parseInt(parts[0], 10);
            const sec = parseFloat(parts[1]);
            if (Number.isFinite(m) && Number.isFinite(sec)) return (m * 60 + sec) * 1000;
        }
        const sec = parseFloat(s);
        return Number.isFinite(sec) ? sec * 1000 : NaN;
    }

    function countUniqueCompetitors() {
        const crews = new Set();
        for (const race of state.races) {
            for (const lane of race.lanes) {
                if (lane.crew) crews.add(normalizeClubKey(lane.crew));
            }
        }
        for (const res of state.results.values()) {
            for (const p of res.placings || []) {
                if (p.competitor) crews.add(normalizeClubKey(p.competitor));
            }
        }
        crews.delete('');
        return crews.size;
    }

    function getRegattaDateRange() {
        const dates = state.races.map((r) => r.startAt).filter(Boolean);
        if (!dates.length) return null;
        const min = new Date(Math.min(...dates.map((d) => d.getTime())));
        const max = new Date(Math.max(...dates.map((d) => d.getTime())));
        return { min, max };
    }

    function getEventGroup(key) {
        return buildEventGroups().find((g) => g.key === key) || null;
    }

    function inferProgressionCutoff(group) {
        const meta = eventMetaForRace({ eventNum: group.eventNum, division: group.division });
        const draw = parseInt(meta?.drawSize, 10);
        if (draw >= 16) return 8;
        if (draw >= 8) return 4;
        const n = buildQualifyingStandings(group).length;
        if (n >= 12) return 8;
        if (n >= 6) return 4;
        return Math.max(2, Math.ceil(n / 2));
    }

    function inferRepCutoff(group) {
        const standings = buildQualifyingStandings(group);
        const direct = inferProgressionCutoff(group);
        const meta = eventMetaForRace({ eventNum: group.eventNum, division: group.division });
        const draw = parseInt(meta?.drawSize, 10);
        if (draw >= 16) return Math.min(standings.length, 16);
        const repRaceCount = [...state.results.values()].filter(
            (r) => eventMatchesNum(r, group.eventNum) && classifyRound(r.round) === 'rep',
        ).length;
        if (repRaceCount > 0) return Math.min(standings.length, direct + repRaceCount * 2);
        return standings.length;
    }

    function inferTt2AdvanceCutoff(group) {
        const repRaceCount = [...state.results.values()].filter(
            (r) => eventMatchesNum(r, group.eventNum) && classifyRound(r.round) === 'rep',
        ).length;
        return repRaceCount > 0 ? repRaceCount : 4;
    }

    function crewsInKnockoutRound(group, kind) {
        const set = new Set();
        for (const res of state.results.values()) {
            if (!eventMatchesNum(res, group.eventNum)) continue;
            if (classifyRound(res.round) !== kind) continue;
            for (const p of res.placings || []) {
                if (p.competitor) set.add(normalizeClubKey(p.competitor));
            }
        }
        return set;
    }

    function crewWasWinnerInRound(crewKey, group, kind) {
        for (const res of state.results.values()) {
            if (!eventMatchesNum(res, group.eventNum)) continue;
            if (classifyRound(res.round) !== kind) continue;
            const win = res.placings?.find((p) => p.place === 1);
            if (win && normalizeClubKey(win.competitor) === crewKey) return true;
        }
        return false;
    }

    function tt1StandingsRankMap(group) {
        const map = new Map();
        buildQualifyingStandings(group).forEach((row, i) => {
            map.set(normalizeClubKey(row.crew), i + 1);
        });
        return map;
    }

    function resolveProgressionLabel(crewKey, group, ctx) {
        const { column, tt1Rank, tt2Rank, directCutoff, repCutoff, tt2AdvanceCutoff } = ctx;
        const inFin = crewsInKnockoutRound(group, 'final');
        const inSf = crewsInKnockoutRound(group, 'sf');
        const inQf = crewsInKnockoutRound(group, 'qf');
        const inRep = crewsInKnockoutRound(group, 'rep');

        if (inFin.has(crewKey)) return { label: 'Final', cls: 'bsr-tt-prog--final' };
        if (inSf.has(crewKey)) return { label: 'SF', cls: 'bsr-tt-prog--sf' };
        if (inQf.has(crewKey)) return { label: 'QF', cls: 'bsr-tt-prog--qf' };

        if (column === 'tt2') {
            if (inRep.has(crewKey)) {
                return crewWasWinnerInRound(crewKey, group, 'rep')
                    ? { label: 'QF', cls: 'bsr-tt-prog--qf' }
                    : { label: 'Out', cls: 'bsr-tt-prog--out' };
            }
            if (tt2Rank && tt2Rank <= tt2AdvanceCutoff) {
                return { label: 'QF', cls: 'bsr-tt-prog--qf' };
            }
            return { label: 'Out', cls: 'bsr-tt-prog--out' };
        }

        const rank = tt1Rank || 999;
        if (rank > repCutoff) return { label: 'Out', cls: 'bsr-tt-prog--out' };
        if (rank > directCutoff) {
            if (inRep.has(crewKey)) {
                return crewWasWinnerInRound(crewKey, group, 'rep')
                    ? { label: 'QF', cls: 'bsr-tt-prog--qf' }
                    : { label: 'Rep', cls: 'bsr-tt-prog--rep' };
            }
            return { label: 'TT2', cls: 'bsr-tt-prog--tt2' };
        }
        if (rank <= directCutoff) return { label: 'QF', cls: 'bsr-tt-prog--qf' };
        return { label: '—', cls: '' };
    }

    function collectQualifyingTimes(group, roundKinds) {
        const entries = [];
        const seen = new Set();
        for (const [raceNum, res] of state.results) {
            if (!eventMatchesNum(res, group.eventNum)) continue;
            const rk = classifyRound(res.round);
            if (!roundKinds.has(rk)) continue;
            for (const p of res.placings || []) {
                if (!p.time || p.place >= 99) continue;
                const ms = parseRaceTimeMs(p.time);
                if (!Number.isFinite(ms)) continue;
                const dedupe = `${raceNum}|${normalizeClubKey(p.competitor)}|${p.time}`;
                if (seen.has(dedupe)) continue;
                seen.add(dedupe);
                entries.push({
                    crew: p.competitor,
                    time: p.time,
                    timeMs: ms,
                    raceNum,
                    round: res.round,
                    heat: res.division,
                    place: p.place,
                });
            }
        }
        return entries.sort((a, b) => a.timeMs - b.timeMs);
    }

    function buildQualifyingStandings(group) {
        const hasTt = [...state.results.values()].some(
            (r) => eventMatchesNum(r, group.eventNum) && classifyRound(r.round) === 'tt',
        );
        const roundKinds = hasTt ? new Set(['tt']) : new Set(['heat', 'e']);
        const all = collectQualifyingTimes(group, roundKinds);
        const byCrew = new Map();
        for (const row of all) {
            const key = normalizeClubKey(row.crew);
            const prev = byCrew.get(key);
            if (!prev || row.timeMs < prev.timeMs) {
                byCrew.set(key, { ...row });
            }
        }
        return [...byCrew.values()].sort((a, b) => a.timeMs - b.timeMs);
    }

    function enrichEventGroup(g) {
        const meta =
            state.eventsByNum.get(g.eventNum) ||
            state.eventsByNum.get(String(parseInt(g.eventNum, 10))) ||
            null;
        if (meta) {
            g.eventName = meta.displayName || meta.name || g.eventName;
            g.meta = meta;
        }
        if (!g.eventName && g.races.length) {
            g.eventName = g.races[0].eventName;
        }
        g.displayTitle = `Event ${g.eventNum} · ${expandEventName(g.eventName || '—')}`;
    }

    function buildEventGroups() {
        const groups = new Map();

        const ensure = (eventNum) => {
            const key = String(eventNum).trim();
            if (!key || groups.has(key)) return groups.get(key);
            const g = {
                key,
                eventNum: key,
                eventName: '',
                division: '',
                races: [],
                raceNums: new Set(),
            };
            groups.set(key, g);
            return g;
        };

        for (const race of state.races) {
            const g = ensure(race.eventNum);
            if (!g) continue;
            g.races.push(race);
            g.raceNums.add(race.raceNum);
            if (!g.eventName && race.eventName) g.eventName = race.eventName;
        }

        for (const [raceNum, res] of state.results) {
            const g = ensure(res.eventNum);
            if (!g) continue;
            g.raceNums.add(raceNum);
        }

        for (const ev of state.events) {
            const g = ensure(ev.eventNum);
            if (g && !g.eventName) g.eventName = ev.displayName || ev.name;
        }

        for (const g of groups.values()) {
            g.races.sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
            enrichEventGroup(g);
        }

        return [...groups.values()].sort((a, b) => {
            const na = parseInt(a.eventNum, 10);
            const nb = parseInt(b.eventNum, 10);
            if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
            return String(a.eventNum).localeCompare(String(b.eventNum));
        });
    }

    function getRacesForEvent(group) {
        const byNum = new Map();
        for (const r of group.races) {
            byNum.set(r.raceNum, r);
        }
        for (const raceNum of group.raceNums) {
            if (byNum.has(raceNum)) continue;
            const res = state.results.get(raceNum);
            if (!res || !eventMatchesNum(res, group.eventNum)) continue;
            const lanes = (res.placings || []).map((p, i) => ({
                lane: i + 1,
                crew: p.competitor,
            }));
            byNum.set(raceNum, {
                raceNum,
                race: String(raceNum),
                eventNum: group.eventNum,
                eventName: group.eventName,
                round: res.round,
                division: res.division,
                lanes,
                startAt: null,
                dayLabel: '',
            });
        }
        return [...byNum.values()].sort((a, b) => {
            const ta = a.startAt ? a.startAt.getTime() : a.raceNum;
            const tb = b.startAt ? b.startAt.getTime() : b.raceNum;
            return ta - tb;
        });
    }

    function getRaceMatchData(raceNum) {
        const race =
            findRace(raceNum) ||
            getRacesForEvent(getEventGroup(state.selectedEventKey) || { eventNum: '', races: [], raceNums: new Set() }).find(
                (r) => r.raceNum === raceNum,
            );
        const res = state.results.get(raceNum);
        const slots = [];

        if (race?.lanes?.length) {
            for (const lane of race.lanes) {
                const placing = matchingPlacing(lane.crew, res?.placings);
                slots.push({
                    crew: lane.crew,
                    info: clubInfo(lane.crew),
                    time: placing?.time || '',
                    place: placing?.place,
                    lane: lane.lane,
                });
            }
        } else if (res?.placings?.length) {
            for (const p of res.placings) {
                slots.push({
                    crew: p.competitor,
                    info: clubInfo(p.competitor),
                    time: p.time || '',
                    place: p.place,
                    lane: p.place,
                });
            }
        }

        slots.sort((a, b) => (a.place || 99) - (b.place || 99));
        const winner = slots.find((s) => s.place === 1) || slots[0];
        return {
            race,
            raceNum,
            res,
            slots,
            winner,
            round: res?.round || race?.round || '',
            startAt: race?.startAt,
        };
    }

    function collectKnockoutRaces(group) {
        const races = getRacesForEvent(group);
        const knockoutKinds = ['rep', 'qf', 'sf', 'final'];
        return races.filter((r) => knockoutKinds.includes(classifyRound(r.round)));
    }

    function chunkBracketPairs(items) {
        const pairs = [];
        for (let i = 0; i < items.length; i += 2) {
            pairs.push(items.slice(i, i + 2));
        }
        return pairs;
    }

    function winnerForRace(raceNum) {
        const res = state.results.get(raceNum);
        return res?.placings?.[0] || null;
    }

    function maxLaneCount() {
        let n = 2;
        for (const r of state.races) {
            for (const l of r.lanes) {
                if (l.lane > n) n = l.lane;
            }
        }
        return Math.min(6, Math.max(2, n));
    }

    function ensureDeviceAliases() {
        const max = maxLaneCount();
        const aliases = BOAT_ALIASES.slice(0, max);
        for (const a of aliases) {
            if (!(a in state.deviceAliases)) state.deviceAliases[a] = '';
        }
        for (let lane = 1; lane <= max; lane++) {
            if (!state.laneDevices[lane]) {
                state.laneDevices[lane] = BOAT_ALIASES[Math.min(lane - 1, aliases.length - 1)];
            }
        }
    }

    function setStatus(msg, isError) {
        const el = document.getElementById('bsrStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.classList.toggle('bsr-status--error', !!isError);
    }

    function loadRegattaPresets() {
        try {
            return JSON.parse(localStorage.getItem(LS_REGATTA_PRESETS) || '{}');
        } catch {
            return {};
        }
    }

    function saveRegattaPreset() {
        const presets = loadRegattaPresets();
        presets[state.regattaCode] = {
            gpsOffsetMin: state.gpsOffsetMin,
            deviceAliases: { ...state.deviceAliases },
            laneDevices: { ...state.laneDevices },
        };
        try {
            localStorage.setItem(LS_REGATTA_PRESETS, JSON.stringify(presets));
            setStatus(`Saved preset for ${state.regattaCode}`);
        } catch {
            setStatus('Could not save preset', true);
        }
    }

    function applyRegattaPreset(code) {
        const presets = loadRegattaPresets();
        const p = presets[normalizeRegattaCode(code)];
        if (!p) return false;
        state.gpsOffsetMin = p.gpsOffsetMin ?? 0;
        state.deviceAliases = { ...(p.deviceAliases || {}) };
        state.laneDevices = { ...(p.laneDevices || {}) };
        ensureDeviceAliases();
        return true;
    }

    function loadSettings() {
        try {
            state.regattaCode = normalizeRegattaCode(
                new URLSearchParams(location.search).get('regatta') ||
                    localStorage.getItem(LS_REGATTA),
            );
            state.gpsOffsetMin = parseInt(localStorage.getItem(LS_GPS_OFFSET) || '0', 10) || 0;
            state.progressionView =
                localStorage.getItem(LS_PROGRESSION_VIEW) === 'bracket' ? 'bracket' : 'linear';
            state.buoySource = localStorage.getItem(LS_BUOY_SOURCE) === 'stored' ? 'stored' : 'gps';

            const aliases = JSON.parse(localStorage.getItem(LS_DEVICE_ALIASES) || '{}');
            state.deviceAliases = typeof aliases === 'object' && aliases ? { ...aliases } : {};
            const laneMap = JSON.parse(localStorage.getItem(LS_LANE_DEVICES) || '{}');
            state.laneDevices = typeof laneMap === 'object' && laneMap ? { ...laneMap } : {};

            if (applyRegattaPreset(state.regattaCode)) {
                /* per-regatta preset overrides global lane/alias defaults */
            } else {
                if (!state.deviceAliases.boat_1) state.deviceAliases.boat_1 = '';
                if (!state.deviceAliases.boat_2) state.deviceAliases.boat_2 = '';
                state.laneDevices[1] = state.laneDevices[1] || 'boat_1';
                state.laneDevices[2] = state.laneDevices[2] || 'boat_2';
            }
            ensureDeviceAliases();
        } catch {
            ensureDeviceAliases();
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(LS_REGATTA, state.regattaCode);
            localStorage.setItem(LS_GPS_OFFSET, String(state.gpsOffsetMin));
            localStorage.setItem(LS_DEVICE_ALIASES, JSON.stringify(state.deviceAliases));
            localStorage.setItem(LS_LANE_DEVICES, JSON.stringify(state.laneDevices));
            localStorage.setItem(LS_PROGRESSION_VIEW, state.progressionView);
            localStorage.setItem(LS_BUOY_SOURCE, state.buoySource);

            const presets = loadRegattaPresets();
            presets[state.regattaCode] = {
                gpsOffsetMin: state.gpsOffsetMin,
                deviceAliases: { ...state.deviceAliases },
                laneDevices: { ...state.laneDevices },
            };
            localStorage.setItem(LS_REGATTA_PRESETS, JSON.stringify(presets));
        } catch {
            /* ignore */
        }
    }

    function filteredRaces() {
        return state.races.filter((r) => {
            if (state.filterDay && r.dayLabel !== state.filterDay) return false;
            if (state.selectedEventKey && eventKey(r) !== state.selectedEventKey) return false;
            return true;
        });
    }

    function findRace(num) {
        return state.races.find((r) => r.raceNum === num) || null;
    }

    function matchingPlacing(crew, placings) {
        if (!placings?.length) return null;
        const parsed = parseClubFromCrew(crew);
        const resolved = resolveClubFromCrew(crew);
        const crewKey = normalizeClubKey(crew);

        return (
            placings.find((p) => {
                const pr = resolveClubFromCrew(p.competitor);
                if (resolved.clubId && pr.clubId && resolved.clubId === pr.clubId) return true;
                if (normalizeClubKey(p.competitor) === crewKey) return true;
                const pc = parseClubFromCrew(p.competitor);
                if (resolved.clubId && pc.id && resolved.clubId === pc.id) return true;
                if (parsed.id && pc.id && parsed.id === pc.id) return true;
                return false;
            }) || null
        );
    }

    function buildMapDeepLink(race, options = {}) {
        const win = gpsWindowForRace(race);
        const params = new URLSearchParams();
        params.set('bsrFrom', win.from.toISOString());
        params.set('bsrTo', win.to.toISOString());

        const deviceIds = [];
        for (const lane of race.lanes) {
            const alias = state.laneDevices[lane.lane];
            const id = alias ? state.deviceAliases[alias] : '';
            if (id && !deviceIds.includes(String(id))) deviceIds.push(String(id));
        }
        if (deviceIds.length) params.set('bsrDevices', deviceIds.join(','));

        if (options.compare && deviceIds.length >= 2) {
            params.set('bsrCompare', '1');
            params.set('bsrCompareA', deviceIds[0]);
            params.set('bsrCompareB', deviceIds[1]);
        }
        return `beachsprints-map.html?${params.toString()}`;
    }

    function renderStatsOverview() {
        const root = document.getElementById('bsrStats');
        if (!root) return;
        if (!state.races.length) {
            root.hidden = true;
            return;
        }
        const meta = getRegattaMeta(state.regattaCode);
        const range = getRegattaDateRange();
        const dateLabel = range
            ? range.min.toDateString() === range.max.toDateString()
                ? range.min.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                : `${range.min.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} — ${range.max.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
            : '—';
        const eventCount = buildEventGroups().length;
        const competitorCount = countUniqueCompetitors();
        const days = [...new Set(state.races.map((r) => r.dayLabel).filter(Boolean))];
        const gpsHtml = state.gpsDayStatus.size
            ? days
                  .map((d) => {
                      const st = state.gpsDayStatus.get(d);
                      return `${escapeHtml(d.split(':').pop()?.trim() || d)}: ${st?.available ? 'GPS ✓' : '—'}`;
                  })
                  .join(' · ')
            : 'Checking Traccar…';
        root.innerHTML =
            `<article class="bsr-stat-card"><span class="bsr-stat-label">Regatta</span><div class="bsr-stat-value">${escapeHtml(meta.name)}</div><p class="bsr-stat-sub">${escapeHtml(meta.location || meta.venue)}</p></article>` +
            `<article class="bsr-stat-card"><span class="bsr-stat-label">Dates</span><div class="bsr-stat-value">${escapeHtml(dateLabel)}</div></article>` +
            `<article class="bsr-stat-card"><span class="bsr-stat-label">Competitors</span><div class="bsr-stat-value">${competitorCount}</div></article>` +
            `<article class="bsr-stat-card"><span class="bsr-stat-label">Events</span><div class="bsr-stat-value">${eventCount}</div><p class="bsr-stat-sub">${state.races.length} races</p></article>` +
            `<article class="bsr-stat-card bsr-stat-card--gps-yes"><span class="bsr-stat-label">GPS data</span><div class="bsr-stat-value">${state.devices.length ? 'Traccar' : '—'}</div><p class="bsr-stat-sub">${gpsHtml}</p></article>`;
        root.hidden = false;
    }

    async function probeGpsForDays() {
        state.gpsDayStatus = new Map();
        const days = [...new Set(state.races.map((r) => r.dayLabel).filter(Boolean))];
        if (!days.length) {
            renderStatsOverview();
            return;
        }
        await resolveDevices();
        const deviceId =
            state.deviceAliases.boat_1 ||
            state.deviceAliases.boat_2 ||
            state.devices[0]?.id;
        for (const dayLabel of days) {
            const sample = state.races.find((r) => r.dayLabel === dayLabel);
            if (!sample?.startAt || !deviceId) {
                state.gpsDayStatus.set(dayLabel, { available: false });
                continue;
            }
            const d = sample.startAt;
            const from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 6, 0, 0);
            const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 20, 0, 0);
            try {
                const pts = await fetchRoute(deviceId, from, to);
                state.gpsDayStatus.set(dayLabel, { available: pts.length > 20, pointCount: pts.length });
            } catch {
                state.gpsDayStatus.set(dayLabel, { available: false });
            }
        }
        renderStatsOverview();
    }

    function selectEvent(key) {
        state.selectedEventKey = key || '';
        state.filterEvent = key || '';
        const sel = document.getElementById('bsrFilterEvent');
        if (sel) sel.value = state.filterEvent;
        const search = document.getElementById('bsrEventSearch');
        const group = getEventGroup(key);
        if (search && group) search.value = group.displayTitle || `Event ${group.eventNum}`;
        const ws = document.getElementById('bsrEventWorkspace');
        if (ws) ws.hidden = !key;
        const url = new URL(location.href);
        if (key) url.searchParams.set('event', key);
        else url.searchParams.delete('event');
        history.replaceState(null, '', url);
        if (key) {
            renderEventHero();
            renderTimeTrialPanel();
            renderKnockoutTree();
            renderEventSchedule();
        }
    }

    function renderTimeTrialPanel() {
        const root = document.getElementById('bsrTimeTrial');
        const lead = document.getElementById('bsrTtLead');
        if (!root) return;
        const group = getEventGroup(state.selectedEventKey);
        if (!group) {
            root.innerHTML = '<p class="bsr-empty">Select an event.</p>';
            return;
        }
        const tt1All = collectQualifyingTimes(group, new Set(['heat', 'e', 'tt']));
        const tt2All = collectQualifyingTimes(group, new Set(['rep']));
        const standings = buildQualifyingStandings(group);
        const directCutoff = inferProgressionCutoff(group);
        const repCutoff = inferRepCutoff(group);
        const tt2AdvanceCutoff = inferTt2AdvanceCutoff(group);
        const tt1Ranks = tt1StandingsRankMap(group);
        const progCtx = { directCutoff, repCutoff, tt2AdvanceCutoff };

        if (lead) {
            lead.textContent =
                standings.length > 0
                    ? `${tt1All.length} heat times · top ${directCutoff} direct to knockouts · ranks ${directCutoff + 1}–${repCutoff} to repechage (TT2).`
                    : 'Qualifying times will appear when heat results are posted.';
        }
        if (!tt1All.length && !tt2All.length) {
            root.innerHTML = '<p class="bsr-note">No qualifying times in results for this event yet.</p>';
            return;
        }
        let html = '';
        if (tt1All.length) {
            html += renderQualifyingColumn('Time trial / heats (TT1)', tt1All, {
                seedPrefix: 'TT1',
                column: 'tt1',
                directCutoff,
                repCutoff,
                getStandingsRank: (row) => tt1Ranks.get(normalizeClubKey(row.crew)) || 0,
                getProgression: (row, standingsRank) =>
                    resolveProgressionLabel(normalizeClubKey(row.crew), group, {
                        ...progCtx,
                        column: 'tt1',
                        tt1Rank: standingsRank,
                    }),
            });
        }
        if (tt2All.length) {
            html += renderQualifyingColumn('Repechage (TT2)', tt2All, {
                seedPrefix: 'TT2',
                column: 'tt2',
                directCutoff: tt2AdvanceCutoff,
                repCutoff: tt2AdvanceCutoff,
                getStandingsRank: (_row, listRank) => listRank,
                getProgression: (row, listRank) =>
                    resolveProgressionLabel(normalizeClubKey(row.crew), group, {
                        ...progCtx,
                        column: 'tt2',
                        tt2Rank: listRank,
                    }),
            });
        }
        root.innerHTML = html;
    }

    function renderQualifyingColumn(title, entries, options) {
        if (!entries.length) {
            return `<div class="bsr-tt-col"><h3 class="bsr-tt-col-head">${escapeHtml(title)}</h3><p class="bsr-note">No times yet.</p></div>`;
        }
        const { seedPrefix, column, directCutoff, repCutoff, getStandingsRank, getProgression } = options;
        let rows = '';
        entries.forEach((row, i) => {
            const listRank = i + 1;
            const standingsRank = getStandingsRank ? getStandingsRank(row, listRank) : listRank;
            const info = clubInfo(row.crew);
            const seed = seedPrefix ? `${listRank}.${seedPrefix}` : String(listRank);
            const prog = getProgression ? getProgression(row, standingsRank) : { label: '—', cls: '' };
            let rowClass = '';
            if (column === 'tt1' && standingsRank) {
                if (standingsRank === directCutoff) rowClass += ' bsr-tt-cutoff';
                if (standingsRank === repCutoff) rowClass += ' bsr-tt-cutoff-rep';
                if (standingsRank <= directCutoff) rowClass += ' bsr-tt-advance';
            }
            if (column === 'tt2' && listRank === directCutoff) rowClass += ' bsr-tt-cutoff';
            rows +=
                `<tr class="${rowClass.trim()}">` +
                `<td class="bsr-tt-rank">${escapeHtml(seed)}</td>` +
                `<td>${info.logoUrl ? `<img class="bsr-tt-logo" src="${escapeHtml(info.logoUrl)}" alt="">` : '<span class="bsr-tt-logo--empty"></span>'}` +
                `<span class="bsr-tt-crew-name">${escapeHtml(info.name)}</span><span class="bsr-note"> ${escapeHtml(row.crew)}</span></td>` +
                `<td class="bsr-tt-time">${escapeHtml(row.time)}</td>` +
                `<td class="bsr-tt-race">R${row.raceNum || '—'}</td>` +
                `<td class="bsr-tt-prog"><span class="bsr-tt-prog-pill ${escapeHtml(prog.cls)}">${escapeHtml(prog.label)}</span></td></tr>`;
        });
        return (
            `<div class="bsr-tt-col"><h3 class="bsr-tt-col-head">${escapeHtml(title)}</h3>` +
            `<table class="bsr-tt-table"><thead><tr><th>Seed</th><th>Crew</th><th>Time</th><th>Race</th><th>Progression</th></tr></thead><tbody>${rows}</tbody></table></div>`
        );
    }

    function renderTreeCrewLine(slot) {
        if (!slot) {
            return '<span class="bsr-tree-crew bsr-tree-crew--empty">TBD</span>';
        }
        const win = slot.place === 1;
        return (
            `<span class="bsr-tree-crew${win ? ' bsr-tree-crew--winner' : ''}">` +
            (slot.info.logoUrl
                ? `<img class="bsr-tree-crew-logo" src="${escapeHtml(slot.info.logoUrl)}" alt="">`
                : '') +
            `<span class="bsr-tree-crew-name">${escapeHtml(slot.info.name)}</span>` +
            (slot.time ? `<span class="bsr-tree-crew-time">${escapeHtml(slot.time)}</span>` : '') +
            `</span>`
        );
    }

    function renderTreeMatch(raceNum, label) {
        const m = getRaceMatchData(raceNum);
        const current = raceNum === state.selectedRaceNum;
        const timeLabel = m.startAt ? formatRaceTime(m.startAt) : '';
        return (
            `<button type="button" class="bsr-tree-match${current ? ' bsr-tree-match--current' : ''}" data-race-num="${raceNum}" title="Race ${escapeHtml(m.race?.race || raceNum)}">` +
            `<span class="bsr-tree-match-meta">${escapeHtml(label || expandRoundLabel(m.round))}` +
            (timeLabel ? ` · ${escapeHtml(timeLabel)}` : '') +
            `</span>` +
            renderTreeCrewLine(m.slots[0]) +
            renderTreeCrewLine(m.slots[1]) +
            `</button>`
        );
    }

    function renderTreeFeeder(matches) {
        const rows = matches
            .map((m) => `<div class="bsr-tree-match-row">${renderTreeMatch(m.raceNum, m.label)}</div>`)
            .join('');
        const pairClass = matches.length > 1 ? ' bsr-tree-feeder--pair' : '';
        return `<div class="bsr-tree-feeder${pairClass}">${rows}</div>`;
    }

    function renderTreeColumn(title, feedersHtml, extraClass) {
        if (!feedersHtml) return '';
        return (
            `<div class="bsr-tree-col${extraClass ? ` ${extraClass}` : ''}">` +
            `<h3 class="bsr-tree-col-title">${escapeHtml(title)}</h3>` +
            `<div class="bsr-tree-col-body">${feedersHtml}</div>` +
            `</div>`
        );
    }

    function renderTreeChampion(finRaces) {
        const primary = finRaces[0];
        if (!primary) {
            return '<p class="bsr-note">—</p>';
        }
        const win = winnerForRace(primary.raceNum);
        if (!win) {
            return '<p class="bsr-note">Pending</p>';
        }
        const info = clubInfo(win.competitor);
        return (
            `<div class="bsr-tree-champion">` +
            (info.logoUrl
                ? `<img class="bsr-tree-champion-logo" src="${escapeHtml(info.logoUrl)}" alt="">`
                : '<span class="bsr-tree-champion-logo bsr-tree-champion-logo--empty"></span>') +
            `<span class="bsr-tree-champion-name">${escapeHtml(info.name)}</span>` +
            (win.time ? `<span class="bsr-tree-champion-time">${escapeHtml(win.time)}</span>` : '') +
            `</div>`
        );
    }

    function renderKnockoutTree() {
        const root = document.getElementById('bsrKnockoutTree');
        if (!root) return;
        const group = getEventGroup(state.selectedEventKey);
        if (!group) {
            root.innerHTML = '';
            return;
        }
        const knockout = collectKnockoutRaces(group);
        if (!knockout.length) {
            root.innerHTML =
                '<p class="bsr-note">No knockout races posted yet — repechage, quarter-finals, semi-finals and final will appear here.</p>';
            return;
        }
        const byKind = new Map();
        for (const r of knockout) {
            const k = classifyRound(r.round);
            if (!byKind.has(k)) byKind.set(k, []);
            byKind.get(k).push(r);
        }
        const rep = (byKind.get('rep') || []).sort((a, b) => a.raceNum - b.raceNum);
        const qf = (byKind.get('qf') || []).sort((a, b) => a.raceNum - b.raceNum);
        const sf = (byKind.get('sf') || []).sort((a, b) => a.raceNum - b.raceNum);
        const fin = (byKind.get('final') || []).sort((a, b) => a.raceNum - b.raceNum);

        const toMatch = (races, prefix) => races.map((r, i) => ({ raceNum: r.raceNum, label: `${prefix}${i + 1}` }));

        const repFeeders = chunkBracketPairs(toMatch(rep, 'R')).map((pair) => renderTreeFeeder(pair)).join('');
        const qfFeeders = chunkBracketPairs(toMatch(qf, 'Q')).map((pair) => renderTreeFeeder(pair)).join('');
        const sfFeeders = chunkBracketPairs(toMatch(sf, 'S')).map((pair) => renderTreeFeeder(pair)).join('');
        const finLabels = ['A Final', 'B Final', 'C Final'];
        const finFeeders = chunkBracketPairs(
            fin.map((r, i) => ({ raceNum: r.raceNum, label: finLabels[i] || `Final ${i + 1}` })),
        )
            .map((pair) => renderTreeFeeder(pair))
            .join('');

        let html = '<div class="bsr-knockout-tree">';
        if (rep.length) {
            html += renderTreeColumn('Repechage', repFeeders, 'bsr-tree-col--rep');
        }
        if (qf.length) {
            html += renderTreeColumn('Quarter-finals', qfFeeders, 'bsr-tree-col--qf');
        }
        if (sf.length) {
            html += renderTreeColumn('Semi-finals', sfFeeders, 'bsr-tree-col--sf');
        }
        if (fin.length) {
            html += renderTreeColumn('Final', finFeeders, 'bsr-tree-col--final');
        }
        html += renderTreeColumn('Winner', renderTreeChampion(fin), 'bsr-tree-col--winner');
        html += '</div>';

        root.innerHTML = html;
        root.querySelectorAll('[data-race-num]').forEach((btn) => {
            btn.addEventListener('click', () => selectRace(parseInt(btn.dataset.raceNum, 10)));
        });
    }

    function renderEventHero() {
        const root = document.getElementById('bsrEventHero');
        if (!root) return;
        const group = getEventGroup(state.selectedEventKey);
        if (!group) {
            root.innerHTML = '';
            return;
        }
        const meta = group.meta || eventMetaForRace({ eventNum: group.eventNum });
        const races = getRacesForEvent(group);
        const bits = [];
        if (meta?.classCode) bits.push(expandEventName(meta.classCode));
        if (meta?.gender) bits.push(expandEventName(meta.gender));
        if (meta?.boat) bits.push(expandEventName(meta.boat));
        if (meta?.drawSize) bits.push(`${meta.drawSize} entries`);
        if (meta?.format) bits.push(meta.format);
        root.innerHTML =
            `<h2>${escapeHtml(group.displayTitle)}</h2>` +
            (bits.length ? `<p class="bsr-card-lead">${escapeHtml(bits.join(' · '))}</p>` : '') +
            `<p class="bsr-note">${races.length} races in daysheet/results for this event.</p>`;
    }

    function renderEventSchedule() {
        const root = document.getElementById('bsrEventSchedule');
        if (!root) return;
        const group = getEventGroup(state.selectedEventKey);
        if (!group) {
            root.innerHTML = '';
            return;
        }
        const races = getRacesForEvent(group);
        if (!races.length) {
            root.innerHTML = '<p class="bsr-note">No races found for this event.</p>';
            return;
        }
        let html =
            '<table class="bsr-schedule-table"><thead><tr><th>Race</th><th>Time</th><th>Round</th><th>Crews / result</th></tr></thead><tbody>';
        for (const race of races) {
            const res = state.results.get(race.raceNum);
            const kind = classifyRound(race.round);
            let crews = race.lanes.map((l) => escapeHtml(l.crew)).join(' vs ');
            if (res?.placings?.length) {
                crews = res.placings
                    .map((p) => {
                        const ci = clubInfo(p.competitor);
                        return `${p.place}. ${escapeHtml(ci.name)} (${escapeHtml(p.time || '—')})`;
                    })
                    .join(' · ');
            }
            const current = race.raceNum === state.selectedRaceNum;
            html +=
                `<tr class="bsr-schedule-row${current ? ' bsr-schedule-row--current' : ''}" data-race-num="${race.raceNum}" tabindex="0" role="button">` +
                `<td>R${escapeHtml(race.race)}</td>` +
                `<td>${race.startAt ? escapeHtml(formatRaceTime(race.startAt)) : '—'}</td>` +
                `<td>${escapeHtml(ROUND_LABELS[kind] || expandRoundLabel(race.round))}</td>` +
                `<td>${crews || '—'}</td></tr>`;
        }
        html += '</tbody></table>';
        root.innerHTML = html;
        root.querySelectorAll('[data-race-num]').forEach((row) => {
            const go = () => selectRace(parseInt(row.dataset.raceNum, 10));
            row.addEventListener('click', go);
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    go();
                }
            });
        });
    }


    function destroyMiniMap() {
        state.miniMapLayers = [];
        if (state.miniMap) {
            state.miniMap.remove();
            state.miniMap = null;
        }
    }

    function decimateGpsPoints(points, maxPts) {
        if (!points?.length || points.length <= maxPts) return points || [];
        const step = Math.ceil(points.length / maxPts);
        const out = [];
        for (let i = 0; i < points.length; i += step) out.push(points[i]);
        const last = points[points.length - 1];
        if (out[out.length - 1] !== last) out.push(last);
        return out;
    }

    function sortGpsPoints(points) {
        return [...(points || [])]
            .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
            .sort((a, b) => gpsChartTimeMs(a) - gpsChartTimeMs(b));
    }

    const MIN_TRACE_DISPLAY_MPS = 1;

    function gpsPointSpeedMps(p) {
        const s = typeof p.speed === 'number' && !Number.isNaN(p.speed) ? p.speed : 0;
        return Math.max(0, s);
    }

    function gpsSegmentsAboveSpeed(points, minMps = MIN_TRACE_DISPLAY_MPS) {
        const sorted = sortGpsPoints(points);
        const segments = [];
        let current = [];
        for (const p of sorted) {
            if (gpsPointSpeedMps(p) > minMps) {
                current.push(p);
            } else if (current.length >= 2) {
                segments.push(current);
                current = [];
            } else {
                current = [];
            }
        }
        if (current.length >= 2) segments.push(current);
        return segments;
    }

    const BOAT_TRACE_THEME = [
        { color: '#2dd4bf', hue: 168, sat: 72 },
        { color: '#f97316', hue: 24, sat: 92 },
        { color: '#fde68a', hue: 48, sat: 88 },
        { color: '#fb7185', hue: 350, sat: 82 },
    ];

    function boatTheme(traceIdx) {
        return BOAT_TRACE_THEME[traceIdx % BOAT_TRACE_THEME.length];
    }

    function speedColorForPoint(p, traceIdx = 0) {
        const theme = boatTheme(traceIdx);
        const sc = window.AltitudeHdSpeedColor;
        let t = 0.5;
        if (sc) {
            const { minMps, maxMps } = sc.getRange();
            const span = maxMps - minMps || 1;
            const spd = sc.speedMpsForColor(typeof p.speed === 'number' ? p.speed : 0);
            t = Math.min(1, Math.max(0, (spd - minMps) / span));
        }
        const lightness = 30 + t * 32;
        return `hsl(${theme.hue}, ${theme.sat}%, ${lightness}%)`;
    }

    function bsrChartTheme() {
        return {
            grid: 'rgba(255, 255, 255, 0.06)',
            tick: '#9ec4d8',
            title: '#9ec4d8',
            legend: '#e8f4fc',
        };
    }

    function getChartCtor() {
        return typeof Chart !== 'undefined' ? Chart : null;
    }

    function destroyChartOnCanvas(canvasId, stateKey) {
        const canvas = document.getElementById(canvasId);
        const chartCtor = getChartCtor();
        if (canvas && chartCtor?.getChart) {
            const ch = chartCtor.getChart(canvas);
            if (ch) ch.destroy();
        }
        if (stateKey) state[stateKey] = null;
    }

    function destroyBsrGpsCharts() {
        destroyChartOnCanvas('bsrSpeedChart', 'speedChart');
        destroyChartOnCanvas('bsrSplitsChart', 'splitsChart');
        destroyChartOnCanvas('bsrTurnChart', 'turnChart');
        destroyChartOnCanvas('bsrCumulativeChart', 'cumulativeChart');
        const wrapIds = ['bsrSpeedChartWrap', 'bsrSplitsChartWrap', 'bsrTurnChartWrap', 'bsrCumulativeChartWrap'];
        for (const id of wrapIds) {
            const el = document.getElementById(id);
            if (el) el.hidden = true;
        }
    }

    function phaseChartData(analysis) {
        const aligned = buildAlignedPhaseChartSeries([analysis]);
        return {
            labels: aligned.labels,
            splits: aligned.series[0]?.splits || [],
            cumulative: aligned.series[0]?.cumulative || [],
        };
    }

    function buildAlignedPhaseChartSeries(analyses) {
        const phaseDefs = window.BeachSprintsCoastal?.RACE_PHASES || [];
        const valid = (analyses || []).filter((a) => a?.valid);
        const activeDefs = phaseDefs.filter((def) =>
            valid.some((a) => {
                const ph = (a.phases || []).find((p) => p.id === def.id);
                return ph && !ph.skipped && Number.isFinite(ph.durationMs);
            }),
        );
        const labels = activeDefs.map((d) => d.label);
        const series = valid.map((a) => {
            const byId = new Map((a.phases || []).map((p) => [p.id, p]));
            const splits = [];
            const cumulative = [];
            let cum = 0;
            for (const def of activeDefs) {
                const ph = byId.get(def.id);
                const sec = ph && Number.isFinite(ph.durationMs) ? ph.durationMs / 1000 : null;
                splits.push(sec);
                if (sec != null) cum += sec;
                cumulative.push(sec != null ? cum : null);
            }
            return { splits, cumulative };
        });
        return { labels, series };
    }

    function gpsChartTimeMs(p) {
        const t = p.fixTime || p.deviceTime;
        if (!t) return NaN;
        const ms = new Date(t).getTime();
        return Number.isFinite(ms) ? ms : NaN;
    }

    function gpsChartPoint(p) {
        const t = gpsChartTimeMs(p);
        const rawSpeed = gpsPointSpeedMps(p);
        if (rawSpeed <= MIN_TRACE_DISPLAY_MPS) return null;
        const y = rawSpeed * 3.6;
        if (!Number.isFinite(t) || !Number.isFinite(y)) return null;
        return { x: t, y };
    }

    function renderBsrSpeedChart(traces) {
        const wrap = document.getElementById('bsrSpeedChartWrap');
        const canvas = document.getElementById('bsrSpeedChart');
        const chartCtor = getChartCtor();
        destroyChartOnCanvas('bsrSpeedChart', 'speedChart');
        if (!wrap || !canvas || !chartCtor) return;

        const datasets = (traces || [])
            .map((t, i) => {
                const data = (t.points || [])
                    .map(gpsChartPoint)
                    .filter(Boolean)
                    .sort((a, b) => a.x - b.x);
                if (!data.length) return null;
                const color = boatTheme(i).color;
                return {
                    label: t.label || `Lane ${i + 1}`,
                    data,
                    borderColor: color,
                    backgroundColor: color,
                    fill: false,
                    tension: 0.12,
                    pointRadius: data.length <= 2 ? 4 : 0,
                    pointHitRadius: 5,
                    borderWidth: 2,
                };
            })
            .filter(Boolean);

        if (!datasets.length) return;

        wrap.hidden = false;
        state.speedChart = new chartCtor(canvas, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
                parsing: false,
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: 'Time', color: '#9ec4d8' },
                        ticks: {
                            color: '#9ec4d8',
                            maxTicksLimit: 8,
                            callback(value) {
                                const d = new Date(value);
                                return Number.isNaN(d.getTime())
                                    ? ''
                                    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                            },
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.06)' },
                    },
                    y: {
                        title: { display: true, text: 'Speed (km/h)', color: '#9ec4d8' },
                        ticks: { color: '#9ec4d8' },
                        grid: { color: 'rgba(255, 255, 255, 0.06)' },
                    },
                },
                plugins: {
                    legend: {
                        display: datasets.length > 1,
                        labels: { color: '#e8f4fc', boxWidth: 12 },
                    },
                    tooltip: {
                        callbacks: {
                            title(items) {
                                if (!items.length) return '';
                                const d = new Date(items[0].parsed.x);
                                return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
                            },
                            label(item) {
                                return `${item.dataset.label}: ${item.formattedValue} km/h`;
                            },
                        },
                    },
                },
            },
        });
        requestAnimationFrame(() => state.speedChart?.resize());
    }

    function renderBsrSplitsChart(analyses, labels) {
        const wrap = document.getElementById('bsrSplitsChartWrap');
        const canvas = document.getElementById('bsrSplitsChart');
        const chartCtor = getChartCtor();
        destroyChartOnCanvas('bsrSplitsChart', 'splitsChart');
        const valid = (analyses || []).filter((a) => a?.valid);
        if (!wrap || !canvas || !chartCtor || !valid.length) return;

        const theme = bsrChartTheme();
        const aligned = buildAlignedPhaseChartSeries(valid);
        if (!aligned.labels.length) return;

        const datasets = valid.map((a, i) => {
            const splits = aligned.series[i]?.splits || [];
            return {
                label: labels[i] || a.name || `Boat ${i + 1}`,
                data: splits,
                backgroundColor: boatTheme(i).color,
                borderColor: boatTheme(i).color,
                borderWidth: 1,
            };
        });

        wrap.hidden = false;
        state.splitsChart = new chartCtor(canvas, {
            type: 'bar',
            data: { labels: aligned.labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: datasets.length > 1, labels: { color: theme.legend } },
                    title: { display: false },
                },
                scales: {
                    x: {
                        ticks: { color: theme.tick, maxRotation: 45, minRotation: 0 },
                        grid: { color: theme.grid },
                    },
                    y: {
                        title: { display: true, text: 'Seconds', color: theme.title },
                        ticks: { color: theme.tick },
                        grid: { color: theme.grid },
                        beginAtZero: true,
                    },
                },
            },
        });
    }

    function renderBsrTurnChart(analyses, labels) {
        const wrap = document.getElementById('bsrTurnChartWrap');
        const canvas = document.getElementById('bsrTurnChart');
        const chartCtor = getChartCtor();
        destroyChartOnCanvas('bsrTurnChart', 'turnChart');
        const valid = (analyses || []).filter((a) => a?.valid && Number.isFinite(a.turnTimeMs));
        if (!wrap || !canvas || !chartCtor || !valid.length) return;

        const theme = bsrChartTheme();
        const data = valid.map((a) => a.turnTimeMs / 1000);
        const chartLabels = valid.map((a, i) => labels[i] || a.name || `Boat ${i + 1}`);

        wrap.hidden = false;
        state.turnChart = new chartCtor(canvas, {
            type: 'bar',
            data: {
                labels: chartLabels,
                datasets: [
                    {
                        label: 'Turn at top (s)',
                        data,
                        backgroundColor: valid.map((_, i) => boatTheme(i).color),
                        borderColor: valid.map((_, i) => boatTheme(i).color),
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: valid.length > 2 ? 'y' : 'x',
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        ticks: { color: theme.tick },
                        grid: { color: theme.grid },
                        beginAtZero: true,
                        title: valid.length <= 2 ? { display: true, text: 'Seconds', color: theme.title } : undefined,
                    },
                    y: {
                        ticks: { color: theme.tick },
                        grid: { color: theme.grid },
                        beginAtZero: valid.length > 2,
                        title: valid.length > 2 ? { display: true, text: 'Seconds', color: theme.title } : undefined,
                    },
                },
            },
        });
    }

    function renderBsrCumulativeChart(analyses, labels) {
        const wrap = document.getElementById('bsrCumulativeChartWrap');
        const canvas = document.getElementById('bsrCumulativeChart');
        const chartCtor = getChartCtor();
        destroyChartOnCanvas('bsrCumulativeChart', 'cumulativeChart');
        const valid = (analyses || []).filter((a) => a?.valid);
        if (!wrap || !canvas || !chartCtor || !valid.length) return;

        const theme = bsrChartTheme();
        const aligned = buildAlignedPhaseChartSeries(valid);
        if (!aligned.labels.length) return;

        const datasets = valid.map((a, i) => {
            const cumulative = aligned.series[i]?.cumulative || [];
            return {
                label: labels[i] || a.name || `Boat ${i + 1}`,
                data: cumulative,
                borderColor: boatTheme(i).color,
                backgroundColor: boatTheme(i).color,
                fill: false,
                tension: 0.15,
                pointRadius: 4,
                borderWidth: 2,
            };
        });

        wrap.hidden = false;
        state.cumulativeChart = new chartCtor(canvas, {
            type: 'line',
            data: { labels: aligned.labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: datasets.length > 1, labels: { color: theme.legend } },
                },
                scales: {
                    x: {
                        ticks: { color: theme.tick, maxRotation: 45, minRotation: 0 },
                        grid: { color: theme.grid },
                    },
                    y: {
                        title: { display: true, text: 'Cumulative time (s)', color: theme.title },
                        ticks: { color: theme.tick },
                        grid: { color: theme.grid },
                        beginAtZero: true,
                    },
                },
            },
        });
    }

    function renderBsrAnalysisCharts(analyses, labels) {
        const valid = (analyses || []).filter((a) => a?.valid);
        if (!valid.length) return;
        renderBsrSplitsChart(analyses, labels);
        renderBsrTurnChart(analyses, labels);
        renderBsrCumulativeChart(analyses, labels);
        requestAnimationFrame(() => {
            state.splitsChart?.resize();
            state.turnChart?.resize();
            state.cumulativeChart?.resize();
        });
    }

    function resolveRaceCourseBuoys(traces) {
        const coastal = window.BeachSprintsCoastal;
        if (!coastal) return { buoys: null, note: '' };
        if (state.buoySource === 'stored') {
            return {
                buoys: coastal.getCourseBuoys(),
                note: 'Using saved course buoys (Beach Sprints map / browser storage).',
            };
        }
        const traceInputs = (traces || [])
            .filter((t) => t.points?.length)
            .map((t, i) => ({
                points: t.points,
                lane: t.lane,
            }));
        const fit = coastal.inferCourseBuoysFromGps(traceInputs);
        if (fit?.ok && fit.buoys?.length) {
            return { buoys: fit.buoys, note: fit.note || 'Buoys fitted from GPS trace.' };
        }
        return {
            buoys: coastal.getCourseBuoys(),
            note: fit?.reason
                ? `${fit.reason} Using saved course buoys instead.`
                : 'Using saved course buoys.',
        };
    }

    function renderCourseBuoysLayer(map, buoys) {
        const coastal = window.BeachSprintsCoastal;
        if (!coastal?.getCourseBuoys || typeof L === 'undefined') return null;
        const buoyLayer = L.layerGroup().addTo(map);
        const buoyList = buoys?.length ? buoys : coastal.getCourseBuoys();
        const byLabel = new Map(buoyList.map((b) => [b.label, b]));

        for (const def of coastal.TIMING_LINES || []) {
            const a = byLabel.get(def.buoyA);
            const b = byLabel.get(def.buoyB);
            if (!a || !b) continue;
            L.polyline(
                [
                    [a.lat, a.lng],
                    [b.lat, b.lng],
                ],
                {
                    color: 'rgba(253, 230, 138, 0.85)',
                    weight: 2,
                    dashArray: '6 5',
                    opacity: 0.9,
                },
            ).addTo(buoyLayer);
        }

        for (const b of buoyList) {
            const icon = L.divIcon({
                className: 'bsr-buoy-icon',
                html: `<span class="bsr-buoy-icon-label">${escapeHtml(b.label)}</span>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
            });
            L.marker([b.lat, b.lng], { icon, zIndexOffset: 800 })
                .bindPopup(
                    `<strong>Buoy ${escapeHtml(b.label)}</strong><br>${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}`,
                )
                .addTo(buoyLayer);
        }
        return buoyLayer;
    }

    function renderBeachRunOverlayLayer(map, overlay, colorForIdx) {
        if (!overlay?.ok || typeof L === 'undefined') return null;
        const layer = L.layerGroup().addTo(map);
        const coastal = window.BeachSprintsCoastal;

        L.polyline(
            [
                [overlay.tideLine.a.lat, overlay.tideLine.a.lng],
                [overlay.tideLine.b.lat, overlay.tideLine.b.lng],
            ],
            {
                color: '#38bdf8',
                weight: 3,
                opacity: 0.85,
                dashArray: '10 6',
            },
        )
            .bindPopup(
                `<strong>Tide / surf line</strong><br>${coastal?.WR_COURSE_SPEC?.tideLineFromBoatM || 10} m toward beach from boat stop.`,
            )
            .addTo(layer);

        if (overlay.approxStartGate) {
            L.polyline(
                [
                    [overlay.approxStartGate.a.lat, overlay.approxStartGate.a.lng],
                    [overlay.approxStartGate.b.lat, overlay.approxStartGate.b.lng],
                ],
                { color: '#fbbf24', weight: 6, opacity: 0.95 },
            )
                .bindPopup(
                    `<strong>Approx. start gate (GPS)</strong><br>~${coastal?.WR_COURSE_SPEC?.startGateWidthM || 10} m wide, perpendicular to course · launch detected at 7→20 km/h (not daysheet time).`,
                )
                .addTo(layer);
            if (overlay.approxStartGate.center) {
                const c = overlay.approxStartGate.center;
                L.circleMarker([c.lat, c.lng], {
                    radius: 4,
                    color: '#fbbf24',
                    weight: 2,
                    fillColor: '#f59e0b',
                    fillOpacity: 1,
                })
                    .bindPopup('<strong>GPS launch</strong><br>Speed crosses from &lt;7 km/h toward ~20 km/h.')
                    .addTo(layer);
            }
        }

        if (overlay.startFinishGate) {
            L.polyline(
                [
                    [overlay.startFinishGate.a.lat, overlay.startFinishGate.a.lng],
                    [overlay.startFinishGate.b.lat, overlay.startFinishGate.b.lng],
                ],
                { color: '#f8fafc', weight: 5, opacity: 0.95 },
            )
                .bindPopup(
                    `<strong>START / FINISH</strong><br>Shared for both lanes · ~${coastal?.WR_COURSE_SPEC?.beachRunDistM || 25} m beach run (WR).`,
                )
                .addTo(layer);
            const sf = overlay.startFinishPt;
            if (sf) {
                L.circleMarker([sf.lat, sf.lng], {
                    radius: 5,
                    color: '#fff',
                    weight: 2,
                    fillColor: '#ef4444',
                    fillOpacity: 1,
                })
                    .bindPopup('<strong>START / FINISH</strong><br>Common run point for both lanes.')
                    .addTo(layer);
            }
        }

        for (const b of overlay.boatStops || []) {
            L.circleMarker([b.lat, b.lng], {
                radius: 7,
                color: '#1e293b',
                weight: 2,
                fillColor: '#0f172a',
                fillOpacity: 0.9,
            })
                .bindPopup(`<strong>${escapeHtml(b.label)}</strong><br>Boat stop / launch at surf line.`)
                .addTo(layer);
        }

        for (const f of overlay.runFlags || []) {
            const icon = L.divIcon({
                className: 'bsr-run-flag-icon',
                html: `<span class="bsr-run-flag-icon-label">${escapeHtml(f.label)}</span>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16],
            });
            L.marker([f.lat, f.lng], { icon, zIndexOffset: 750 })
                .bindPopup(
                    `<strong>${escapeHtml(f.label)}</strong><br>Lane ${f.lane} · on beach (landward of tide line).`,
                )
                .addTo(layer);
        }

        (overlay.runnerPaths || []).forEach((run, idx) => {
            const color = colorForIdx ? colorForIdx(idx) : '#e2e8f0';
            const fmt = coastal?.formatDurationMs?.bind(coastal) || ((ms) => `${(ms / 1000).toFixed(1)}s`);

            for (const leg of [
                { key: 'runOut', title: 'Run out (start → flag → boat)' },
                { key: 'runIn', title: 'Run in (boat → flag → finish)' },
            ]) {
                const seg = run[leg.key];
                if (!seg?.latlngs?.length) continue;
                L.polyline(seg.latlngs, {
                    color,
                    weight: 5,
                    opacity: 0.88,
                    dashArray: leg.key === 'runOut' ? '2 8' : '6 4',
                    lineCap: 'round',
                })
                    .bindPopup(
                        `<strong>${escapeHtml(run.name)}</strong><br>${leg.title}<br>${fmt(seg.estMs)}${escapeHtml(overlay.runLabelSuffix || '')}`,
                    )
                    .addTo(layer);
            }
        });

        return layer;
    }

    function splitWinnerClass(leader, side) {
        return leader === side ? 'bsr-split-winner' : '';
    }

    function renderGpsSplitsTable(valid, labels) {
        const coastal = window.BeachSprintsCoastal;
        if (!valid.length) return '';

        if (valid.length === 1) {
            const a = valid[0];
            let cum = 0;
            let rows = '';
            for (const ph of a.phases) {
                if (ph.skipped) continue;
                const dur = ph.durationMs;
                if (dur != null) cum += dur;
                const hint = ph.hint
                    ? `<div class="bsr-split-hint">${escapeHtml(ph.hint)}</div>`
                    : '';
                rows +=
                    `<tr><td><strong>${escapeHtml(ph.label)}</strong>${hint}</td>` +
                    `<td>${dur != null ? coastal.formatDurationMs(dur) : '—'}</td>` +
                    `<td>${dur != null ? coastal.formatDurationMs(cum) : '—'}</td></tr>`;
            }
            return (
                `<table class="bsr-phase-table bsr-phase-table--full"><thead><tr>` +
                `<th>Split (B1–B3 gates)</th><th>${escapeHtml(labels[0] || a.name)}</th><th>Cumulative</th>` +
                `</tr></thead><tbody>${rows}</tbody></table>`
            );
        }

        const cmp = coastal.compareRaceAnalyses(valid[0], valid[1]);
        if (!cmp.valid) return `<p class="bsr-note">${escapeHtml(cmp.reason || '')}</p>`;

        let cumA = 0;
        let cumB = 0;
        let rows = '';
        for (const p of cmp.phaseCompare) {
            if (p.pa?.skipped && p.pb?.skipped) continue;
            const durA = p.pa?.durationMs;
            const durB = p.pb?.durationMs;
            if (durA != null) cumA += durA;
            if (durB != null) cumB += durB;
            const splitLeader = p.leader;
            const cumLeader =
                cumA < cumB ? 'a' : cumB < cumA ? 'b' : Number.isFinite(cumA) && Number.isFinite(cumB) ? 'tie' : null;
            const hint = p.def.hint ? `<div class="bsr-split-hint">${escapeHtml(p.def.hint)}</div>` : '';
            rows +=
                `<tr>` +
                `<td><strong>${escapeHtml(p.def.label)}</strong>${hint}</td>` +
                `<td class="${splitWinnerClass(splitLeader, 'a')}">${durA != null ? coastal.formatDurationMs(durA) : '—'}</td>` +
                `<td class="${splitWinnerClass(splitLeader, 'b')}">${durB != null ? coastal.formatDurationMs(durB) : '—'}</td>` +
                `<td class="${splitWinnerClass(cumLeader, 'a')}">${Number.isFinite(cumA) ? coastal.formatDurationMs(cumA) : '—'}</td>` +
                `<td class="${splitWinnerClass(cumLeader, 'b')}">${Number.isFinite(cumB) ? coastal.formatDurationMs(cumB) : '—'}</td>` +
                `<td>${p.gap != null ? coastal.formatGapMs(p.gap) : '—'}</td></tr>`;
        }
        return (
            `<table class="bsr-phase-table bsr-phase-table--full"><thead><tr>` +
            `<th>Split</th><th>${escapeHtml(labels[0])}</th><th>${escapeHtml(labels[1])}</th>` +
            `<th>Cum. ${escapeHtml(labels[0])}</th><th>Cum. ${escapeHtml(labels[1])}</th><th>Gap</th>` +
            `</tr></thead><tbody>${rows}</tbody></table>`
        );
    }

    function renderCompareAnalysis(analyses, labels) {
        const coastal = window.BeachSprintsCoastal;
        if (!coastal || !analyses?.length) return '';
        const valid = analyses.filter((a) => a?.valid);
        if (!valid.length) return '<p class="bsr-note">No valid GPS race analysis.</p>';

        const table = renderGpsSplitsTable(valid, labels);
        let headline = '';
        if (valid.length >= 2) {
            const cmp = coastal.compareRaceAnalyses(valid[0], valid[1]);
            if (cmp.valid) {
                const winner =
                    cmp.totalLeader === 'a'
                        ? labels[0]
                        : cmp.totalLeader === 'b'
                          ? labels[1]
                          : 'Dead heat';
                const runA = valid[0].runTiming?.runTotalMs;
                const runB = valid[1].runTiming?.runTotalMs;
                const runNote =
                    runA != null && runB != null
                        ? ` · Beach run (CSV−GPS) ${coastal.formatDurationMs(runA)} vs ${coastal.formatDurationMs(runB)}`
                        : '';
                headline =
                    `<p class="bsr-card-lead"><strong>${escapeHtml(winner)}</strong> ahead on GPS boat section</p>` +
                    `<p class="bsr-gps-stat">Boat ${coastal.formatDurationMs(valid[0].totalMs)} vs ${coastal.formatDurationMs(valid[1].totalMs)} · Turn ${coastal.formatDurationMs(valid[0].turnTimeMs)} vs ${coastal.formatDurationMs(valid[1].turnTimeMs)}${runNote}</p>`;
            }
        } else {
            const runMs = valid[0].runTiming?.runTotalMs;
            const runNote =
                runMs != null ? ` · Beach run (CSV−GPS) ${coastal.formatDurationMs(runMs)}` : '';
            headline =
                `<p class="bsr-card-lead"><strong>${escapeHtml(labels[0] || valid[0].name)}</strong></p>` +
                `<p class="bsr-gps-stat">Boat ${coastal.formatDurationMs(valid[0].totalMs)} · Turn ${coastal.formatDurationMs(valid[0].turnTimeMs)}${runNote}</p>`;
        }
        return (
            `<div class="bsr-compare-block">${headline}${table}` +
            `<p class="bsr-note bsr-split-legend-note"><span class="bsr-split-winner bsr-split-winner--sample">Green</span> = faster on that split or cumulative.</p></div>`
        );
    }

    function renderMiniMap(traces, courseBuoys, traceAnalyses) {
        const el = document.getElementById('bsrRaceMap');
        if (!el || typeof L === 'undefined') return;
        destroyMiniMap();
        state.miniMap = L.map(el, { zoomControl: true, attributionControl: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(
            state.miniMap,
        );
        state.miniMapLayers = [];
        const bounds = [];

        const coastal = window.BeachSprintsCoastal;
        let beachLayer = null;
        if (coastal?.buildBeachRunOverlay && courseBuoys?.length) {
            const athletes = (traces || []).map((t, i) => ({
                lane: t.lane,
                label: t.label,
                points: t.points,
                section: t.section ?? traceAnalyses?.[i]?.section ?? null,
                officialTimeMs: t.officialTimeMs ?? traceAnalyses?.[i]?.officialTimeMs ?? null,
                analysis: traceAnalyses?.[i] ?? null,
            }));
            const overlay = coastal.buildBeachRunOverlay({ buoys: courseBuoys, athletes });
            if (overlay?.ok) {
                beachLayer = renderBeachRunOverlayLayer(state.miniMap, overlay, (i) =>
                    boatTheme(i).color,
                );
                if (beachLayer) state.miniMapLayers.push(beachLayer);
                for (const leg of [overlay.tideLine, overlay.startFinishGate, overlay.approxStartGate]) {
                    if (!leg) continue;
                    bounds.push([leg.a.lat, leg.a.lng], [leg.b.lat, leg.b.lng]);
                }
                for (const b of overlay.boatStops || []) {
                    bounds.push([b.lat, b.lng]);
                }
            }
        }

        const routeLayer = L.layerGroup().addTo(state.miniMap);
        state.miniMapLayers.push(routeLayer);
        const buoyLayer = renderCourseBuoysLayer(state.miniMap, courseBuoys);
        if (buoyLayer) state.miniMapLayers.push(buoyLayer);

        (traces || []).forEach((t, traceIdx) => {
            const segments = gpsSegmentsAboveSpeed(t.points, MIN_TRACE_DISPLAY_MPS);
            if (!segments.length) return;
            const mkColor = boatTheme(traceIdx).color;
            for (const segPts of segments) {
                const decimated = decimateGpsPoints(segPts, 250);
                for (let i = 1; i < decimated.length; i++) {
                    const prev = decimated[i - 1];
                    const p = decimated[i];
                    const line = [
                        [prev.latitude, prev.longitude],
                        [p.latitude, p.longitude],
                    ];
                    L.polyline(line, {
                        color: speedColorForPoint(p, traceIdx),
                        weight: 4,
                        opacity: 0.92,
                        lineCap: 'round',
                        lineJoin: 'round',
                    }).addTo(routeLayer);
                    bounds.push(line[0], line[1]);
                }
            }
            const firstSeg = segments[0];
            const lastSeg = segments[segments.length - 1];
            const start = firstSeg[0];
            const end = lastSeg[lastSeg.length - 1];
            L.circleMarker([start.latitude, start.longitude], {
                radius: 6,
                color: '#fff',
                weight: 2,
                fillColor: mkColor,
                fillOpacity: 1,
            })
                .bindPopup(`<strong>${escapeHtml(t.label || 'Start')}</strong><br>Start (>${MIN_TRACE_DISPLAY_MPS} m/s)`)
                .addTo(routeLayer);
            L.circleMarker([end.latitude, end.longitude], {
                radius: 5,
                color: '#1a1a1a',
                weight: 1,
                fillColor: mkColor,
                fillOpacity: 0.85,
            })
                .bindPopup(`<strong>${escapeHtml(t.label || 'Finish')}</strong><br>End (>${MIN_TRACE_DISPLAY_MPS} m/s)`)
                .addTo(routeLayer);
        });

        const buoyBounds = courseBuoys?.length
            ? courseBuoys
            : window.BeachSprintsCoastal?.getCourseBuoys?.() || [];
        for (const b of buoyBounds) {
            bounds.push([b.lat, b.lng]);
        }
        if (bounds.length) state.miniMap.fitBounds(bounds, { padding: [28, 28] });
        else state.miniMap.setView([-36.592, 174.703], 16);
        requestAnimationFrame(() => state.miniMap?.invalidateSize());
    }

    function renderRaceList() {
        const list = document.getElementById('bsrRaceList');
        if (!list) return;
        const races = filteredRaces();
        list.replaceChildren();
        if (!races.length) {
            list.innerHTML = '<li class="bsr-empty">No races match filters</li>';
            return;
        }
        for (const race of races) {
            const li = document.createElement('li');
            li.className = 'bsr-race-item';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bsr-race-btn';
            btn.setAttribute('aria-current', race.raceNum === state.selectedRaceNum ? 'true' : 'false');
            btn.innerHTML =
                `<span class="bsr-race-num">Race ${escapeHtml(race.race)}</span>` +
                `<div class="bsr-race-meta">${escapeHtml(formatRaceTime(race.startAt))} · ${escapeHtml(race.round)}${race.course ? escapeHtml(` · ${COURSE_LABELS[race.course] || race.course}`) : ''}</div>` +
                `<div class="bsr-race-meta">${escapeHtml(race.eventName)}</div>`;
            btn.addEventListener('click', () => selectRace(race.raceNum));
            li.appendChild(btn);
            list.appendChild(li);
        }
    }

    function formatRaceTime(d) {
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    function formatDateTime(d) {
        if (!d) return '—';
        return d.toLocaleString(undefined, {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }

    function renderEventsPanel(race) {
        const root = document.getElementById('bsrEventsPanel');
        if (!root) return;
        const meta = eventMetaForRace(race);
        if (!meta) {
            root.innerHTML =
                '<p class="bsr-note">No events.csv row for this event number. Load events.csv with the regatta.</p>';
            return;
        }
        const bits = [];
        if (meta.classCode) bits.push(`Class: ${expandEventName(meta.classCode)}`);
        if (meta.gender) bits.push(`Gender: ${expandEventName(meta.gender)}`);
        if (meta.boat) bits.push(`Boat: ${expandEventName(meta.boat)}`);
        if (meta.laneCount) bits.push(`Lanes: ${meta.laneCount}`);
        if (meta.drawSize) bits.push(`Draw: ${meta.drawSize}`);
        if (meta.format) bits.push(`Format: ${meta.format}`);
        if (meta.distance) bits.push(`Distance: ${meta.distance}`);

        root.innerHTML =
            `<p class="bsr-card-lead"><strong>${escapeHtml(meta.displayName || meta.name)}</strong> (Event ${escapeHtml(meta.eventNum)})</p>` +
            (bits.length
                ? `<ul class="bsr-event-meta-list">${bits.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
                : '<p class="bsr-note">Event row loaded; no extra columns parsed.</p>');
    }

    function renderRaceDetail() {
        const root = document.getElementById('bsrRaceDetail');
        if (!root) return;
        const race = findRace(state.selectedRaceNum);
        if (!race) {
            root.innerHTML =
                '<p class="bsr-empty">Select a race from the list or progression tree.</p>';
            return;
        }
        const res = state.results.get(race.raceNum);
        const winner = winnerForRace(race.raceNum);
        const names = competitorNames(race);
        const mapAllUrl = buildMapDeepLink(race, { compare: false });
        const mapCompareUrl = buildMapDeepLink(race, { compare: true });

        let lanesHtml = '';
        for (const lane of race.lanes) {
            const resolved = resolveClubFromCrew(lane.crew);
            const info = clubInfo(resolved.clubId || lane.crew);
            const placing = matchingPlacing(lane.crew, res?.placings);
            const isWinner = placing?.place === 1;
            const alias = state.laneDevices[lane.lane] || '';
            let matchHint = '';
            if (resolved.isComposite) {
                const codeHint = resolved.baseCode
                    ? `${resolved.baseCode.toUpperCase()}*`
                    : 'composite';
                matchHint =
                    ` <span class="bsr-match-tag bsr-match-tag--composite" title="Composite crew (${escapeHtml(codeHint)}) — nearest club/school in lookup">composite</span>`;
            } else if (resolved.match === 'fuzzy') {
                matchHint =
                    ' <span class="bsr-match-tag" title="Matched school name to club code">matched</span>';
            }
            lanesHtml +=
                `<div class="bsr-lane-row${isWinner ? ' bsr-lane-row--winner' : ''}">` +
                `<span class="bsr-lane-n">${lane.lane}</span>` +
                (info.logoUrl
                    ? `<img class="bsr-lane-logo" src="${escapeHtml(info.logoUrl)}" alt="">`
                    : '<span class="bsr-lane-logo--empty"></span>') +
                `<div><div class="bsr-lane-club">${escapeHtml(info.name)}${matchHint}</div>` +
                `<div class="bsr-lane-names">${escapeHtml(lane.crew || '')}${alias ? ` · GPS: ${escapeHtml(alias)}` : ''}</div></div>` +
                (placing
                    ? `<span class="bsr-lane-time">${escapeHtml(placing.time)}</span>`
                    : '<span class="bsr-lane-time">—</span>') +
                `</div>`;
        }

        let resultsHtml = '<p class="bsr-note">No results posted yet.</p>';
        if (res?.placings?.length) {
            resultsHtml =
                '<table class="bsr-results-table"><thead><tr><th>Place</th><th>Crew</th><th>Time</th></tr></thead><tbody>';
            for (const p of res.placings) {
                const ci = clubInfo(p.competitor);
                resultsHtml +=
                    `<tr><td class="bsr-place-${p.place}">${p.place}</td>` +
                    `<td>${escapeHtml(ci.name)} <span class="bsr-note">(${escapeHtml(p.competitor)})</span></td>` +
                    `<td>${escapeHtml(p.time)}</td></tr>`;
            }
            resultsHtml += '</tbody></table>';
        }

        root.innerHTML =
            `<section class="bsr-card">` +
            `<div class="bsr-race-hero">` +
            `<h2>Race ${escapeHtml(race.race)}</h2>` +
            `<span class="bsr-pill">${escapeHtml(formatRaceTime(race.startAt))}</span>` +
            `<span class="bsr-pill">${escapeHtml(expandRoundLabel(race.round))}</span>` +
            (race.course
                ? `<span class="bsr-pill bsr-pill--course">${escapeHtml(COURSE_LABELS[race.course] || race.course)}</span>`
                : '') +
            `<span class="bsr-pill">${escapeHtml(race.division || 'Open')}</span>` +
            `</div>` +
            `<p class="bsr-card-lead"><strong>${escapeHtml(expandEventName(race.eventName))}</strong> · Event ${escapeHtml(race.eventNum)}</p>` +
            (isTimeTrialRace(race) && !race.lanes.length
                ? `<p class="bsr-note bsr-note--warn">Time trial slot — draw and results are often not attached to this schedule row in RowIT, so they may not appear in results.csv or live results.</p>`
                : '') +
            (isTimeTrialRace(race) && race.lanes.length
                ? `<p class="bsr-note">Time trial — results may be in RowIT but not exported to results.csv for this race number.</p>`
                : '') +
            (race.progression
                ? `<p class="bsr-note"><strong>Progression:</strong> ${escapeHtml(race.progression)}</p>`
                : '') +
            (winner
                ? `<p class="bsr-note"><strong>Winner:</strong> ${escapeHtml(clubInfo(winner.competitor).name)} (${escapeHtml(winner.time)})</p>`
                : '') +
            `<p class="bsr-links"><a href="${escapeHtml(mapAllUrl)}">Open all lanes on GPS map</a>` +
            (race.lanes.length >= 2
                ? ` · <a href="${escapeHtml(mapCompareUrl)}">Map + head-to-head compare</a>`
                : '') +
            `</p>` +
            `</section>` +
            `<section class="bsr-card"><h3>Event metadata</h3><div id="bsrEventsPanel"></div></section>` +
            `<section class="bsr-card"><h3>Lanes</h3><div class="bsr-lane-grid">${lanesHtml || '<p class="bsr-note">No lanes drawn.</p>'}</div></section>` +
            (names ? `<section class="bsr-card"><h3>Crew names</h3><p>${escapeHtml(names)}</p></section>` : '') +
            `<section class="bsr-card"><h3>Official results</h3>${resultsHtml}</section>` +
            `<section class="bsr-card" id="bsrGpsSection"><h3>GPS analysis</h3><p class="bsr-card-lead">Splits, turn time, speed vs time, and trace map (same engine as the Beach Sprints map).</p>` +
            `<div class="bsr-buoy-toolbar" id="bsrBuoyToolbar">` +
            `<label class="bsr-toggle"><input type="radio" name="bsrBuoySource" value="gps"${state.buoySource === 'gps' ? ' checked' : ''}> Fit buoys from GPS trace</label>` +
            `<label class="bsr-toggle"><input type="radio" name="bsrBuoySource" value="stored"${state.buoySource === 'stored' ? ' checked' : ''}> Saved course buoys</label>` +
            `<p class="bsr-note" id="bsrBuoyFitNote">${escapeHtml(state.lastBuoyFitNote || 'Course fitted from trace: top turn at L3/R3, gates spaced 85 / 170 / 250 m seaward from the beach.')}</p></div>` +
            `<div id="bsrCompareAnalysis"></div>` +
            `<div class="bsr-gps-layout"><div class="bsr-analysis-grid"><div id="bsrGpsContent"><p class="bsr-note">Loading GPS…</p></div>` +
            `<div id="bsrRaceMap" class="bsr-race-map" aria-label="GPS trace map"></div>` +
            `<p class="bsr-speed-legend-note">Boat trace = lane colour, only points &gt; 1 m/s. Yellow = water gates · blue dashed = tide · white = START/FINISH · L3/R3 on GPS turn · dashed lines = run paths.</p></div>` +
            `<div class="bsr-gps-charts-grid">` +
            `<div id="bsrSpeedChartWrap" class="bsr-speed-chart-wrap bsr-speed-chart-wrap--wide" hidden>` +
            `<h4 class="bsr-speed-chart-title">Speed vs time</h4>` +
            `<div class="bsr-speed-chart-canvas-box"><canvas id="bsrSpeedChart" aria-label="Speed versus time chart"></canvas></div></div>` +
            `<div id="bsrSplitsChartWrap" class="bsr-speed-chart-wrap" hidden>` +
            `<h4 class="bsr-speed-chart-title">Leg splits</h4>` +
            `<div class="bsr-speed-chart-canvas-box"><canvas id="bsrSplitsChart" aria-label="Leg split durations"></canvas></div></div>` +
            `<div id="bsrTurnChartWrap" class="bsr-speed-chart-wrap" hidden>` +
            `<h4 class="bsr-speed-chart-title">Turn at top</h4>` +
            `<div class="bsr-speed-chart-canvas-box bsr-speed-chart-canvas-box--compact"><canvas id="bsrTurnChart" aria-label="Turn time comparison"></canvas></div></div>` +
            `<div id="bsrCumulativeChartWrap" class="bsr-speed-chart-wrap bsr-speed-chart-wrap--wide" hidden>` +
            `<h4 class="bsr-speed-chart-title">Cumulative time by leg</h4>` +
            `<div class="bsr-speed-chart-canvas-box"><canvas id="bsrCumulativeChart" aria-label="Cumulative race time"></canvas></div></div>` +
            `</div></div></section>`;

        renderEventsPanel(race);
        loadGpsForRace(race);
    }

    function renderProgressionLinear() {
        const root = document.getElementById('bsrProgression');
        if (!root) return;
        const groups = buildEventGroups();
        if (!groups.length) {
            root.innerHTML = '<p class="bsr-empty">Load regatta data to see event progression.</p>';
            return;
        }
        let html = '<div class="bsr-progression">';
        for (const g of groups) {
            if (state.filterEvent && g.key !== state.filterEvent) continue;
            const title = `${g.eventNum} · ${expandEventName(g.eventName)}${g.division ? ` · ${g.division}` : ''}`;
            html += `<div class="bsr-event-block" data-event-key="${escapeHtml(g.key)}">`;
            html += `<div class="bsr-event-head">${escapeHtml(title)} <span class="bsr-note">(${g.races.length} races)</span></div>`;
            html += '<div class="bsr-event-rounds">';
            g.races.forEach((race, i) => {
                if (i > 0) html += '<span class="bsr-arrow" aria-hidden="true">â†’</span>';
                const win = winnerForRace(race.raceNum);
                const winLabel = win ? clubInfo(win.competitor).name : '—';
                const current = race.raceNum === state.selectedRaceNum ? 'true' : 'false';
                html +=
                    `<button type="button" class="bsr-round-node" data-race-num="${race.raceNum}" aria-current="${current}">` +
                    `<span class="bsr-round-label">R${escapeHtml(race.race)} · ${escapeHtml(race.round)}</span>` +
                    `<span>${escapeHtml(formatRaceTime(race.startAt))}</span>` +
                    (win ? `<span class="bsr-round-winner">1st: ${escapeHtml(winLabel)}</span>` : '') +
                    `</button>`;
            });
            html += '</div></div>';
        }
        html += '</div>';
        root.innerHTML = html;
        root.querySelectorAll('.bsr-round-node').forEach((btn) => {
            btn.addEventListener('click', () => {
                selectRace(parseInt(btn.dataset.raceNum, 10));
            });
        });
    }

    function renderProgressionBracket() {
        const root = document.getElementById('bsrProgression');
        if (!root) return;
        const groups = buildEventGroups();
        if (!groups.length) {
            root.innerHTML = '<p class="bsr-empty">Load regatta data to see knockout brackets.</p>';
            return;
        }
        let html = '<div class="bsr-bracket-wrap">';
        for (const g of groups) {
            if (state.filterEvent && g.key !== state.filterEvent) continue;
            const title = `${g.eventNum} · ${expandEventName(g.eventName)}${g.division ? ` · ${g.division}` : ''}`;
            const byRound = new Map();
            for (const r of g.races) {
                const kind = classifyRound(r.round);
                if (!byRound.has(kind)) byRound.set(kind, []);
                byRound.get(kind).push(r);
            }
            const cols = ROUND_ORDER.filter((k) => byRound.has(k));
            html += `<div class="bsr-bracket-event">`;
            html += `<div class="bsr-bracket-title">${escapeHtml(title)}</div>`;
            html += '<div class="bsr-bracket-grid">';
            for (const kind of cols) {
                const races = byRound.get(kind) || [];
                html += `<div class="bsr-bracket-col">`;
                html += `<div class="bsr-bracket-col-head">${escapeHtml(ROUND_LABELS[kind] || kind)}</div>`;
                for (const race of races) {
                    const win = winnerForRace(race.raceNum);
                    const winLabel = win ? clubInfo(win.competitor).name : '';
                    const current = race.raceNum === state.selectedRaceNum;
                    html +=
                        `<button type="button" class="bsr-bracket-node${current ? ' bsr-bracket-node--current' : ''}" data-race-num="${race.raceNum}">` +
                        `<span class="bsr-round-label">R${escapeHtml(race.race)}</span>` +
                        `<span>${escapeHtml(race.round)}</span>` +
                        `<span>${escapeHtml(formatRaceTime(race.startAt))}</span>` +
                        (winLabel ? `<span class="bsr-round-winner">${escapeHtml(winLabel)}</span>` : '') +
                        `</button>`;
                }
                html += '</div>';
            }
            html += '</div></div>';
        }
        html += '</div>';
        root.innerHTML = html;
        root.querySelectorAll('.bsr-bracket-node').forEach((btn) => {
            btn.addEventListener('click', () => {
                selectRace(parseInt(btn.dataset.raceNum, 10));
            });
        });
    }

    function renderProgression() {
        if (state.progressionView === 'bracket') renderProgressionBracket();
        else renderProgressionLinear();
        updateProgressionViewButtons();
    }

    function updateProgressionViewButtons() {
        const linear = document.getElementById('bsrViewLinear');
        const bracket = document.getElementById('bsrViewBracket');
        if (linear) linear.setAttribute('aria-pressed', state.progressionView === 'linear' ? 'true' : 'false');
        if (bracket) bracket.setAttribute('aria-pressed', state.progressionView === 'bracket' ? 'true' : 'false');
    }

    function renderFilters() {
        const eventSel = document.getElementById('bsrFilterEvent');
        if (!eventSel) return;

        const groups = buildEventGroups();
        eventSel.innerHTML =
            '<option value="">— Select event 1–30 —</option>' +
            groups
                .map(
                    (g) =>
                        `<option value="${escapeHtml(g.key)}">${escapeHtml(g.displayTitle || `Event ${g.eventNum}`)}</option>`,
                )
                .join('');

        eventSel.value = state.filterEvent || state.selectedEventKey;
    }

    async function resolveDevices() {
        try {
            const res = await fetch('/api/traccar?action=snapshot');
            if (!res.ok) return;
            const data = await res.json();
            state.devices = Array.isArray(data.devices) ? data.devices : [];
            ensureDeviceAliases();
            for (const alias of BOAT_ALIASES.slice(0, maxLaneCount())) {
                if (state.deviceAliases[alias]) continue;
                const found = state.devices.find(
                    (d) =>
                        String(d.name || '').toLowerCase() === alias ||
                        String(d.uniqueId || '').toLowerCase() === alias,
                );
                if (found) state.deviceAliases[alias] = String(found.id);
            }
        } catch {
            /* offline */
        }
    }

    function deviceSelectOptions(selectedId) {
        let html = '<option value="">—</option>';
        for (const d of state.devices) {
            const sel = String(d.id) === String(selectedId) ? ' selected' : '';
            html += `<option value="${escapeHtml(d.id)}"${sel}>${escapeHtml(d.name || d.id)}</option>`;
        }
        return html;
    }

    function renderDeviceConfig() {
        const root = document.getElementById('bsrDeviceConfig');
        if (!root) return;
        ensureDeviceAliases();
        const max = maxLaneCount();
        const aliases = BOAT_ALIASES.slice(0, max);

        let aliasHtml = '';
        for (const a of aliases) {
            aliasHtml +=
                `<div><label>${escapeHtml(a)} device</label>` +
                `<select id="bsrAlias_${escapeHtml(a)}" data-alias="${escapeHtml(a)}">${deviceSelectOptions(state.deviceAliases[a])}</select></div>`;
        }

        let laneHtml = '';
        for (let lane = 1; lane <= max; lane++) {
            const opts = aliases
                .map(
                    (a) =>
                        `<option value="${a}"${state.laneDevices[lane] === a ? ' selected' : ''}>${a}</option>`,
                )
                .join('');
            laneHtml +=
                `<div><label>Lane ${lane} â†’</label>` +
                `<select id="bsrLane${lane}" data-lane="${lane}">${opts}</select></div>`;
        }

        root.innerHTML =
            `<div class="bsr-device-map">${aliasHtml}</div>` +
            `<div class="bsr-device-map bsr-device-map--lanes">${laneHtml}</div>` +
            `<div class="bsr-preset-actions">` +
            `<button type="button" class="bsr-btn bsr-btn--small" id="bsrSavePreset">Save preset for this regatta</button>` +
            `<span class="bsr-note">Presets stored per regatta code in this browser.</span>` +
            `</div>`;

        const saveAliases = () => {
            for (const a of aliases) {
                const el = document.getElementById(`bsrAlias_${a}`);
                if (el) state.deviceAliases[a] = el.value || '';
            }
            for (let lane = 1; lane <= max; lane++) {
                const el = document.getElementById(`bsrLane${lane}`);
                if (el) state.laneDevices[lane] = el.value || BOAT_ALIASES[lane - 1];
            }
            saveSettings();
        };

        root.querySelectorAll('select').forEach((sel) => {
            sel.addEventListener('change', saveAliases);
        });

        document.getElementById('bsrSavePreset')?.addEventListener('click', saveRegattaPreset);
    }

    function gpsWindowForRace(race) {
        const offsetMs = state.gpsOffsetMin * 60 * 1000;
        const center = new Date(race.startAt.getTime() + offsetMs);
        const from = new Date(center.getTime() - 4 * 60 * 1000);
        const to = new Date(center.getTime() + 8 * 60 * 1000);
        return { from, to, center };
    }

    async function fetchRoute(deviceId, from, to) {
        const url =
            `/api/traccar?action=route&deviceId=${encodeURIComponent(deviceId)}` +
            `&from=${encodeURIComponent(from.toISOString())}` +
            `&to=${encodeURIComponent(to.toISOString())}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Route HTTP ${res.status}`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    }

    function routeStats(points, scheduledStart) {
        if (!points.length) return null;
        const times = points
            .map((p) => {
                const t = p.fixTime || p.deviceTime;
                return t ? new Date(t).getTime() : NaN;
            })
            .filter(Number.isFinite);
        if (!times.length) return null;
        const startMs = Math.min(...times);
        const endMs = Math.max(...times);
        let maxSpeed = 0;
        for (const p of points) {
            const s = typeof p.speed === 'number' ? p.speed : 0;
            if (s > maxSpeed) maxSpeed = s;
        }
        const schedMs = scheduledStart?.getTime?.();
        return {
            startMs,
            endMs,
            durationSec: (endMs - startMs) / 1000,
            maxSpeedKmh: maxSpeed * 3.6,
            deltaFromScheduleSec: Number.isFinite(schedMs) ? (startMs - schedMs) / 1000 : null,
            pointCount: points.length,
        };
    }

    function boatSectionCardStats(analysis, officialTimeMs, scheduledStart) {
        const coastal = window.BeachSprintsCoastal;
        if (!analysis?.valid || !analysis.section) return null;
        const schedMs = scheduledStart?.getTime?.();
        const fmt = coastal?.formatDurationMs?.bind(coastal) || ((ms) => `${(ms / 1000).toFixed(2)}s`);
        const csvMs = Number.isFinite(officialTimeMs)
            ? officialTimeMs
            : analysis.officialTimeMs;
        const runMs =
            analysis.runTiming?.runTotalMs ??
            (Number.isFinite(csvMs) && csvMs > analysis.totalMs ? csvMs - analysis.totalMs : null);
        return {
            gpsLaunchMs: analysis.section.accelMs,
            gpsStopMs: analysis.section.decelMs,
            boatWaterMs: analysis.totalMs,
            deltaLaunchSec: Number.isFinite(schedMs)
                ? (analysis.section.accelMs - schedMs) / 1000
                : null,
            officialTimeMs: Number.isFinite(csvMs) ? csvMs : null,
            runMs,
            fmt,
        };
    }

    async function loadGpsForRace(race) {
        destroyBsrGpsCharts();
        const container = document.getElementById('bsrGpsContent');
        if (!container) return;
        const win = gpsWindowForRace(race);
        const match = getRaceMatchData(race.raceNum);
        const lanesToLoad = race.lanes.length ? race.lanes : [];

        if (!lanesToLoad.length) {
            container.innerHTML =
                '<p class="bsr-note">No lanes drawn. Configure boat devices in settings.</p>';
            return;
        }

        const cards = [];
        const traces = [];
        const analyses = [];
        const analysisByTrace = [];
        const labels = [];
        const coastal = window.BeachSprintsCoastal;
        let courseBuoys = null;
        for (const lane of lanesToLoad) {
            const alias = state.laneDevices[lane.lane];
            const deviceId = alias ? state.deviceAliases[alias] : '';
            if (!deviceId) {
                cards.push(
                    `<div class="bsr-gps-card"><h4>Lane ${lane.lane} (${escapeHtml(alias || '?')})</h4>` +
                        `<p class="bsr-note">No Traccar device mapped for ${escapeHtml(alias || 'alias')}.</p></div>`,
                );
                continue;
            }
            try {
                const rawPoints = await fetchRoute(deviceId, win.from, win.to);
                const slot = match.slots.find((s) => s.lane === lane.lane);
                const officialTimeMs = parseRaceTimeMs(slot?.time);
                const info = clubInfo(lane.crew);
                const label = `${info.name} (L${lane.lane})`;
                const stats = routeStats(rawPoints, win.center);
                const dev = state.devices.find((d) => String(d.id) === String(deviceId));
                const laneMapUrl = buildMapDeepLink(
                    { ...race, lanes: [lane] },
                    { compare: false },
                );
                traces.push({
                    points: rawPoints,
                    rawPoints,
                    label,
                    lane: lane.lane,
                    officialTimeMs: Number.isFinite(officialTimeMs) ? officialTimeMs : null,
                    devName: dev?.name || alias,
                    laneMapUrl,
                    fetchStats: stats,
                });
                analysisByTrace.push(null);
            } catch (err) {
                cards.push(
                    `<div class="bsr-gps-card"><h4>Lane ${lane.lane}</h4><p class="bsr-note">GPS error: ${escapeHtml(err.message)}</p></div>`,
                );
            }
        }

        const buoyResolve = resolveRaceCourseBuoys(
            traces.map((t) => ({ ...t, points: t.rawPoints || t.points })),
        );
        courseBuoys = buoyResolve.buoys;
        state.lastBuoyFitNote = buoyResolve.note || '';
        if (coastal && traces.length) {
            analyses.length = 0;
            labels.length = 0;
            for (let ti = 0; ti < traces.length; ti++) {
                const tr = traces[ti];
                if (!tr.rawPoints?.length && !tr.points?.length) continue;
                const src = tr.rawPoints || tr.points;
                const analysis = coastal.analyzeCoastalRace(src, tr.label, {
                    buoys: courseBuoys,
                    officialTimeMs: tr.officialTimeMs,
                });
                analysisByTrace[ti] = analysis.valid ? analysis : null;
                if (analysis.valid) {
                    tr.points = analysis.points;
                    tr.section = analysis.section;
                    analyses.push(analysis);
                    labels.push(tr.label);
                } else if (coastal.trimToBoatRacingSection) {
                    const trimmed = coastal.trimToBoatRacingSection(src, {
                        useTimingLines: !!courseBuoys?.length,
                    });
                    if (trimmed.section) {
                        tr.points = trimmed.points;
                        tr.section = trimmed.section;
                    }
                }
            }
        }

        for (let ti = 0; ti < traces.length; ti++) {
            const tr = traces[ti];
            const analysis = analysisByTrace[ti];
            const boat = boatSectionCardStats(analysis, tr.officialTimeMs, win.center);
            const stats = tr.fetchStats;
            const title = `Lane ${tr.lane} · ${escapeHtml(tr.devName || '')}`;
            const mapLink = tr.laneMapUrl
                ? `<a href="${escapeHtml(tr.laneMapUrl)}">Open on map →</a>`
                : '';
            if (!stats) {
                cards.push(
                    `<div class="bsr-gps-card"><h4>${title}</h4>` +
                        `<p class="bsr-note">No GPS points in window (${formatDateTime(win.from)} — ${formatDateTime(win.to)}).</p>${mapLink}</div>`,
                );
                continue;
            }
            let body =
                `<p class="bsr-gps-stat"><strong>Fetch window points:</strong> ${stats.pointCount}</p>` +
                `<p class="bsr-gps-stat"><strong>Max speed (window):</strong> ${stats.maxSpeedKmh.toFixed(1)} km/h</p>`;
            if (boat) {
                const d = boat.deltaLaunchSec;
                body +=
                    `<p class="bsr-gps-stat"><strong>GPS launch (7→20 km/h):</strong> ${formatDateTime(new Date(boat.gpsLaunchMs))}</p>` +
                    `<p class="bsr-gps-stat"><strong>vs daysheet:</strong> ${d != null ? `${d >= 0 ? '+' : ''}${d.toFixed(0)} s` : '—'}</p>` +
                    `<p class="bsr-gps-stat"><strong>Boat on water (GPS):</strong> ${boat.fmt(boat.boatWaterMs)}</p>`;
                if (boat.officialTimeMs != null) {
                    body += `<p class="bsr-gps-stat"><strong>Official total (CSV):</strong> ${boat.fmt(boat.officialTimeMs)}</p>`;
                }
                if (boat.runMs != null) {
                    body += `<p class="bsr-gps-stat"><strong>Beach run (CSV − GPS boat):</strong> ${boat.fmt(boat.runMs)}</p>`;
                }
                body += `<p class="bsr-note">Trace trimmed ±5 s around launch/stop; map shows boat racing section only.</p>`;
            } else if (analysis && !analysis.valid) {
                body += `<p class="bsr-note">${escapeHtml(analysis.reason || 'Could not detect boat racing section.')}</p>`;
            }
            cards.push(`<div class="bsr-gps-card"><h4>${title}</h4>${body}${mapLink}</div>`);
        }

        const mapAllUrl = buildMapDeepLink(race, { compare: false });
        const mapCompareUrl = buildMapDeepLink(race, { compare: true });
        container.innerHTML =
            `<div class="bsr-gps-grid">${cards.join('')}</div>` +
            `<p class="bsr-links">` +
            `<a href="${escapeHtml(mapAllUrl)}">Load all ${lanesToLoad.length} lane(s) on map</a>` +
            (lanesToLoad.length >= 2
                ? ` · <a href="${escapeHtml(mapCompareUrl)}">Map + compare first two boats</a>`
                : '') +
            `</p>` +
            `<p class="bsr-note">Fetch window: ${formatDateTime(win.from)} — ${formatDateTime(win.to)} (offset ${state.gpsOffsetMin} min). ` +
            `Splits and map use the boat racing section (7→20 km/h launch, stop near launch beach, ±5 s padding, ~1.5–5 min). Yellow line = approx. start gate on beach side of buoys.</p>`;
        const compareEl = document.getElementById('bsrCompareAnalysis');
        if (compareEl) {
            compareEl.innerHTML = analyses.length
                ? renderCompareAnalysis(analyses.slice(0, 2), labels.slice(0, 2))
                : '';
        }
        const buoyNoteEl = document.getElementById('bsrBuoyFitNote');
        if (buoyNoteEl) buoyNoteEl.textContent = state.lastBuoyFitNote;
        renderMiniMap(traces, courseBuoys, analysisByTrace);
        renderBsrSpeedChart(traces);
        renderBsrAnalysisCharts(analyses, labels);
    }

    function selectRace(raceNum) {
        state.selectedRaceNum = raceNum;
        const race = findRace(raceNum);
        if (race) {
            const key = eventKey(race);
            if (state.selectedEventKey !== key) selectEvent(key);
        }
        renderRaceList();
        renderKnockoutTree();
        renderEventSchedule();
        const analysisEl = document.getElementById('bsrRaceAnalysis');
        if (analysisEl) analysisEl.hidden = !race;
        const titleEl = document.getElementById('bsrRaceAnalysisTitle');
        if (titleEl && race) {
            titleEl.textContent = `Race ${race.race} · ${expandRoundLabel(race.round)}`;
        }
        renderRaceDetail();
        const url = new URL(location.href);
        url.searchParams.set('race', String(raceNum));
        history.replaceState(null, '', url);
    }

    async function loadRegatta() {
        state.loading = true;
        setStatus('Loading regatta data…');
        const code = state.regattaCode;
        try {
            const [daysheet, results, competitors, events, lookup] = await Promise.all([
                fetchRegattaCsv(code, 'daysheet'),
                fetchRegattaCsv(code, 'results').catch(() => ''),
                fetchRegattaCsv(code, 'competitors').catch(() => ''),
                fetchRegattaCsv(code, 'events').catch(() => ''),
                fetch('data/ahd-lookup.json').then((r) => r.json()),
            ]);
            state.races = parseDaysheet(daysheet);
            state.results = parseResults(results);
            state.competitors = parseCompetitors(competitors);
            state.events = parseEvents(events);
            state.lookup = lookup;
            buildClubIndex();
            ensureDeviceAliases();
            if (applyRegattaPreset(code)) {
                const offsetInput = document.getElementById('bsrGpsOffset');
                if (offsetInput) offsetInput.value = String(state.gpsOffsetMin);
            }
            if (!state.selectedRaceNum && state.races.length) {
                const p = new URLSearchParams(location.search).get('race');
                state.selectedRaceNum = p
                    ? parseInt(p, 10)
                    : state.races[Math.floor(state.races.length / 2)]?.raceNum;
            }
            let statusMsg = `Loaded ${state.races.length} races · ${state.results.size} results · ${state.events.length} events · ${code}`;
            if (state.races.length === 0 && state.events.length > 0) {
                statusMsg +=
                    ' — daysheet parsed empty; check daysheet.csv format (race numbers and lane columns).';
            } else if (state.results.size === 0) {
                statusMsg += ' — no results loaded (try rowit.nz or bundled data/cnzb2026-results.csv).';
            }
            setStatus(statusMsg);
            renderStatsOverview();
            renderFilters();
            renderRaceList();
            renderDeviceConfig();
            const urlEvent = new URLSearchParams(location.search).get('event');
            if (urlEvent && buildEventGroups().some((g) => g.key === urlEvent)) {
                selectEvent(urlEvent);
            }
            if (state.selectedRaceNum) {
                selectRace(state.selectedRaceNum);
            }
            probeGpsForDays();
        } catch (err) {
            setStatus(`Failed to load: ${err.message}`, true);
        } finally {
            state.loading = false;
        }
    }

    function bindUi() {
        const codeInput = document.getElementById('bsrRegattaCode');
        const loadBtn = document.getElementById('bsrLoadBtn');
        const offsetInput = document.getElementById('bsrGpsOffset');
        const eventSel = document.getElementById('bsrFilterEvent');

        if (codeInput) codeInput.value = state.regattaCode;
        if (offsetInput) offsetInput.value = String(state.gpsOffsetMin);

        loadBtn?.addEventListener('click', () => {
            state.regattaCode = normalizeRegattaCode(codeInput?.value);
            applyRegattaPreset(state.regattaCode);
            saveSettings();
            loadRegatta();
        });

        offsetInput?.addEventListener('change', () => {
            state.gpsOffsetMin = parseInt(offsetInput.value, 10) || 0;
            saveSettings();
            const race = findRace(state.selectedRaceNum);
            if (race) loadGpsForRace(race);
        });

        eventSel?.addEventListener('change', () => {
            selectEvent(eventSel.value);
        });

        const eventSearch = document.getElementById('bsrEventSearch');
        eventSearch?.addEventListener('change', () => {
            const q = eventSearch.value.trim().toLowerCase();
            if (!q) return;
            const match = buildEventGroups().find((g) => {
                const label = (g.displayTitle || `Event ${g.eventNum}`).toLowerCase();
                return label.includes(q) || String(g.eventNum) === q;
            });
            if (match) selectEvent(match.key);
        });

        const regattaParam = new URLSearchParams(location.search).get('regatta');
        if (regattaParam && codeInput) {
            codeInput.value = normalizeRegattaCode(regattaParam);
            state.regattaCode = codeInput.value;
        }

        document.getElementById('bsrViewLinear')?.addEventListener('click', () => {
            state.progressionView = 'linear';
            saveSettings();
            renderProgression();
        });

        document.getElementById('bsrViewBracket')?.addEventListener('click', () => {
            state.progressionView = 'bracket';
            saveSettings();
            renderProgression();
        });

        document.addEventListener('change', (e) => {
            const input = e.target.closest('#bsrGpsSection input[name="bsrBuoySource"]');
            if (!input) return;
            state.buoySource = input.value === 'stored' ? 'stored' : 'gps';
            saveSettings();
            const race = findRace(state.selectedRaceNum);
            if (race) loadGpsForRace(race);
        });

        document.addEventListener('keydown', (e) => {
            if (e.target.closest('input, textarea, select')) return;
            if (e.key === 'n' || e.key === 'N') {
                e.preventDefault();
                stepRace(1);
            }
            if (e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                stepRace(-1);
            }
        });
    }

    function stepRace(delta) {
        const races = filteredRaces();
        if (!races.length) return;
        let idx = races.findIndex((r) => r.raceNum === state.selectedRaceNum);
        if (idx < 0) idx = 0;
        idx = Math.max(0, Math.min(races.length - 1, idx + delta));
        selectRace(races[idx].raceNum);
    }

    async function init() {
        loadSettings();
        bindUi();
        updateProgressionViewButtons();
        await resolveDevices();
        renderDeviceConfig();
        await loadRegatta();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
