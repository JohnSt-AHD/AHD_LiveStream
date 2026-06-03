/**
 * Rowing Regatta Dashboard — RowIT CSV results + World Rowing progression (2025+).
 * Default regatta: mads2026 (Maadi 2026 — RowIT daysheet + bundled results fallback).
 */
(function () {
    const DEFAULT_REGATTA = 'mads2026';
    const ROWIT_CSV_BASES = ['https://l.rowit.nz/altitude', 'https://rowit.nz/altitude'];
    const LOCAL_REGATTA_CSV = {
        mads2026: {
            daysheet: 'data/mads2026-daysheet.csv',
            results: 'data/mads2026-results.csv',
        },
        nicc2026: { results: 'data/nicc-results.csv' },
        nicc: { results: 'data/nicc-results.csv' },
    };
    const REGATTA_META = {
        mads2026: {
            name: 'Maadi Regatta 2026',
            location: 'Lake Ruataniwha, Twizel',
            venue: 'Maadi Cup',
        },
        nicc2026: {
            name: 'NICC 2026',
            location: 'New Zealand',
            venue: '',
        },
        nicc: {
            name: 'NICC Regatta',
            location: 'New Zealand',
            venue: '',
        },
    };
    const MEDAL_ICONS = {
        gold: 'https://s.rowit.nz/i/m/medal_nz-g.png',
        silver: 'https://s.rowit.nz/i/m/medal_nz-s.png',
        bronze: 'https://s.rowit.nz/i/m/medal_nz-b.png',
    };
    const LS_REGATTA = 'rrdRegattaCode_v1';
    const LS_LIVE_REFRESH = 'rrdLiveRefresh_v1';
    const LOGO_PLACEHOLDER = 'assets/school-logos/placeholder-white.svg';
    const LIVE_REFRESH_MS = 60000;

    const ROUND_ORDER = ['heat', 'qf', 'sf', 'final', 'other'];
    const ROUND_LABELS = {
        heat: 'Heats',
        qf: 'Quarter-finals',
        sf: 'Semi-finals',
        final: 'Finals',
        other: 'Other',
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
        selectedRaceNum: null,
        filterEvent: '',
        selectedEventKey: '',
        loading: false,
        liveRefresh: false,
        missingLogos: null,
        drawRows: [],
        progressionByEvent: new Map(),
    };

    let liveRefreshTimer = null;

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function clubLogoSrc(logoFilename) {
        const name = String(logoFilename || '').trim();
        return name ? `assets/school-logos/${encodeURIComponent(name)}` : LOGO_PLACEHOLDER;
    }

    function logoImgHtml(className, logoUrl, alt = '') {
        const src = logoUrl || LOGO_PLACEHOLDER;
        return (
            `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" ` +
            `onerror="this.onerror=null;this.src='${LOGO_PLACEHOLDER}'">`
        );
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
            return { raceNum: parseInt(withLetter[1], 10), label: `${withLetter[1]} (${withLetter[2].toUpperCase()})` };
        }
        const plain = s.match(/^(\d+)$/);
        if (plain) return { raceNum: parseInt(plain[1], 10), label: plain[1] };
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
            let progression = '';
            if (headerCols?.length) {
                const pi = headerCols.findIndex((h) => String(h || '').toLowerCase().includes('progression'));
                if (pi >= 0) progression = (cols[pi] || '').trim();
            } else if (cols.length > 6) {
                progression = cols[cols.length - 1] ? cols[cols.length - 1].trim() : '';
            }
            races.push({
                raceNum: info.raceNum,
                race: info.label,
                startAt,
                eventNum: cols[2].trim(),
                eventName: cols[3].trim(),
                round: cols[4].trim(),
                division: cols[5] ? cols[5].trim() : '',
                lanes,
                progression,
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
            } else if (cur && rank(p.place) === rank(cur.place) && p.time && (!cur.time || cur.time.length < p.time.length)) {
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
                format: cols[4]?.trim() || '',
                placings,
            };
            if (map.has(raceNum)) {
                const prev = map.get(raceNum);
                const sameMeta =
                    prev.eventNum === row.eventNum &&
                    prev.round === row.round &&
                    prev.division === row.division;
                if (sameMeta && placings.length <= prev.placings.length) continue;
                if (sameMeta) {
                    prev.placings = mergeResultPlacings(prev.placings, placings);
                    if (!prev.status && row.status) prev.status = row.status;
                    if (!prev.format && row.format) prev.format = row.format;
                } else if (placings.length >= prev.placings.length) {
                    map.set(raceNum, row);
                }
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
            if (!eventNum || (!/^\d/.test(eventNum) && !/^e?\d/i.test(eventNum))) continue;
            const row = { eventNum, name: (cols[1] || '').trim(), raw: cols };
            if (header) {
                header.forEach((h, i) => {
                    const v = cols[i]?.trim();
                    if (!v) return;
                    if (h === 'name' || h.includes('description') || h.includes('title')) row.name = v;
                    else if (h.includes('class')) row.classCode = v;
                    else if (h.includes('gender') || h === 'sex') row.gender = v;
                    else if (h.includes('boat') || h.includes('discipline')) row.boat = v;
                    else if (h.includes('draw') || h.includes('entries')) row.drawSize = v;
                    else if (h.includes('format')) row.format = v;
                    else if (h.includes('distance')) row.distance = v;
                });
            } else {
                if (cols[2]) row.classCode = cols[2].trim();
                if (cols[3]) row.gender = cols[3].trim();
                if (cols[4]) row.boat = cols[4].trim();
                if (cols[6]) row.drawSize = cols[6].trim();
            }
            row.displayName = eventTitleFromMeta(row);
            events.push(row);
            byNum.set(eventNum, row);
            byNum.set(String(parseInt(eventNum, 10)), row);
        }
        state.eventsByNum = byNum;
        return events;
    }

    function normalizeRegattaCode(raw) {
        return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || DEFAULT_REGATTA;
    }

    function csvUrlCandidates(code, file) {
        const c = normalizeRegattaCode(code);
        if (window.AltitudeHdHub?.buildCsvUrlCandidates) {
            return window.AltitudeHdHub.buildCsvUrlCandidates(c, file);
        }
        return ROWIT_CSV_BASES.map((base) => `${base}/${c}/${file}.csv`);
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

    async function fetchDrawCsv(code) {
        const c = normalizeRegattaCode(code);
        const urls = [`https://l.rowit.nz/${c}/draw.csv`, `https://rowit.nz/${c}/draw.csv`];
        for (const url of urls) {
            try {
                const text = await fetchCsvText(url);
                if (text && !/Nothing published/i.test(text)) return text;
            } catch {
                /* try next */
            }
        }
        return '';
    }

    function parseDrawCsv(text) {
        const rows = [];
        if (!text || /Nothing published/i.test(text)) return rows;
        let header = null;
        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || /^"DRAW/i.test(trimmed) || /^"DRAFT DRAW/i.test(trimmed)) continue;
            const cols = parseCsvLine(trimmed);
            if (/^Event/i.test(cols[0] || '')) {
                header = cols.map((c) => String(c || '').toLowerCase().trim());
                continue;
            }
            const eventNum = (cols[0] || '').trim();
            if (!eventNum) continue;
            const row = {
                eventNum,
                eventType: (cols[1] || '').trim(),
                round: (cols[2] || '').trim(),
                division: (cols[3] || '').trim(),
                lanes: [],
            };
            const laneStart = 4;
            for (let i = laneStart; i < cols.length; i++) {
                const crew = (cols[i] || '').trim();
                if (crew) row.lanes.push({ lane: i - laneStart + 1, crew });
            }
            rows.push(row);
        }
        return rows;
    }

    function buildProgressionIndex() {
        const byEvent = new Map();
        const add = (eventNum, format) => {
            const key = String(eventNum || '').trim();
            const f = String(format || '').trim();
            if (!key || !f) return;
            if (!byEvent.has(key)) byEvent.set(key, new Set());
            byEvent.get(key).add(f);
        };

        for (const race of state.races) {
            if (race.progression) add(race.eventNum, race.progression);
        }
        for (const res of state.results.values()) {
            if (res.format) add(res.eventNum, res.format);
        }
        state.progressionByEvent = byEvent;
    }

    function primaryProgressionFormat(group) {
        const fromMeta = group?.meta?.format;
        if (fromMeta) return fromMeta;
        const set = state.progressionByEvent.get(String(group?.eventNum || ''));
        if (set?.size) return [...set][0];
        return '';
    }

    function formatForHeatRace(group, heatResult) {
        if (heatResult.format) return heatResult.format;
        const ds = state.races.find(
            (r) =>
                eventMatchesNum(r, group.eventNum) &&
                classifyRound(r.round) === 'heat' &&
                String(r.division) === String(heatResult.division),
        );
        if (ds?.progression) return ds.progression;
        return primaryProgressionFormat(group);
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
        return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function buildClubIndex() {
        const index = new Map();
        if (!state.lookup?.clubs) {
            state.clubIndex = index;
            return index;
        }
        for (const [id, c] of Object.entries(state.lookup.clubs)) {
            const keys = new Set([id, c.id, c.name, c.name?.replace(/\s+Rowing Club$/i, ''), c.name?.replace(/\s+College$/i, '')]);
            for (const k of keys) {
                const nk = normalizeClubKey(k);
                if (nk && !index.has(nk)) index.set(nk, id);
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

    function findClosestClubByCode(code) {
        const clubs = state.lookup?.clubs || {};
        const c = String(code || '').toLowerCase();
        if (!c) return { clubId: '', match: 'none' };
        if (clubs[`${c}*`]) return { clubId: `${c}*`, match: 'composite-star' };
        if (clubs[c]) return { clubId: c, match: 'code' };
        const prefixHits = Object.keys(clubs).filter((id) => id !== 'comp' && id.startsWith(c));
        if (prefixHits.length) return { clubId: prefixHits[0], match: 'composite-prefix' };
        const head = c.slice(0, 2);
        const fuzzyHits = Object.keys(clubs)
            .filter((id) => id !== 'comp' && id.length >= c.length && id.startsWith(head))
            .map((id) => ({ id, dist: levenshtein(c, id.slice(0, c.length)) }))
            .filter((x) => x.dist <= 1)
            .sort((a, b) => a.dist - b.dist);
        if (fuzzyHits.length) return { clubId: fuzzyHits[0].id, match: 'composite-fuzzy' };
        if (clubs.comp) return { clubId: 'comp', match: 'composite-generic' };
        return { clubId: '', match: 'none' };
    }

    function parseClubFromCrew(crew) {
        const s = String(crew || '').trim();
        if (!s) return { id: '', label: '', isComposite: false };
        const m = s.match(/^([A-Za-z]{2,5})(\*?)(?:\s+(\d+))?$/);
        if (m) return { id: m[1].toLowerCase(), label: s, crewNum: m[3] || '', isComposite: m[2] === '*' };
        return { id: '', label: s, isComposite: s.includes('*') };
    }

    function resolveClubFromCrew(crew) {
        const parsed = parseClubFromCrew(crew);
        if (parsed.isComposite && parsed.id) {
            const nearest = findClosestClubByCode(parsed.id);
            if (nearest.clubId) {
                return { clubId: nearest.clubId, label: parsed.label, match: nearest.match, isComposite: true, baseCode: parsed.id };
            }
        }
        if (parsed.id && state.lookup?.clubs?.[parsed.id]) {
            return { clubId: parsed.id, label: parsed.label, match: 'code', isComposite: false };
        }
        const key = normalizeClubKey(crew);
        if (state.clubIndex.has(key)) {
            return { clubId: state.clubIndex.get(key), label: parsed.label || crew, match: 'exact', isComposite: parsed.isComposite };
        }
        return { clubId: parsed.id || '', label: parsed.label || crew, match: 'none', isComposite: parsed.isComposite };
    }

    function clubInfo(clubIdOrCrew) {
        const resolved = resolveClubFromCrew(clubIdOrCrew);
        const clubId = resolved.clubId || clubIdOrCrew;
        const c = state.lookup?.clubs?.[clubId];
        if (!c) {
            return {
                name: String(clubId || clubIdOrCrew || '—').toUpperCase(),
                logoUrl: LOGO_PLACEHOLDER,
                clubId: clubId || '',
            };
        }
        return {
            name: c.name || String(clubId).toUpperCase(),
            logoUrl: clubLogoSrc(c.logo),
            clubId,
            isComposite: resolved.isComposite,
        };
    }

    function expandEventName(code) {
        if (!code || !state.lookup) return code;
        const parts = String(code).trim().split(/\s+/);
        const out = [];
        for (const p of parts) {
            const low = p.toLowerCase();
            if (state.lookup.gender?.[low]) out.push(state.lookup.gender[low]);
            else if (state.lookup.boat?.[low]) out.push(state.lookup.boat[low]);
            else if (state.lookup.class?.[low.replace(/\s/g, '')]) out.push(state.lookup.class[low.replace(/\s/g, '')]);
            else if (state.lookup.class?.[low]) out.push(state.lookup.class[low]);
            else out.push(p);
        }
        return out.join(' ');
    }

    function eventTitleFromMeta(row) {
        if (!row) return '';
        const bits = [];
        const genderCode = String(row.gender || '').trim();
        const classCode = String(row.classCode || '').trim().replace(/\s/g, '');
        const boatCode = String(row.boat || '').trim();
        if (genderCode && state.lookup?.gender?.[genderCode.toLowerCase()]) {
            bits.push(state.lookup.gender[genderCode.toLowerCase()]);
        }
        if (classCode && state.lookup?.class?.[classCode.toLowerCase()]) {
            bits.push(state.lookup.class[classCode.toLowerCase()]);
        }
        if (boatCode && state.lookup?.boat?.[boatCode.toLowerCase()]) {
            bits.push(state.lookup.boat[boatCode.toLowerCase()]);
        }
        if (bits.length) return bits.join(' ');
        return expandEventName(row.name || row.classCode || row.eventNum);
    }

    function eventMetaForRace(race) {
        return state.eventsByNum.get(race.eventNum) || state.eventsByNum.get(String(parseInt(race.eventNum, 10))) || null;
    }

    function competitorNames(race) {
        const key = `${race.race}|${race.division}`;
        const row = state.competitors.get(key);
        if (row?.names) return row.names;
        for (const [, v] of state.competitors) {
            if (v.raceNum === race.raceNum && v.division === race.division) return v.names;
        }
        return '';
    }

    function classifyRound(round) {
        const r = String(round || '').toLowerCase();
        if (r === 'r' || /rep|repechage/.test(r)) return 'rep';
        if (r === 'q' || /quarter|\bqf\b/.test(r)) return 'qf';
        if (r === 's' || /semi|\bsf\b/.test(r)) return 'sf';
        if (r === 'f' || /final|\bf\b/.test(r)) return 'final';
        if (r === 'h' || /heat/.test(r)) return 'heat';
        if (r === 'e' || /exhibition/.test(r)) return 'final';
        return 'other';
    }

    function expandRoundLabel(round) {
        const map = { h: 'Heat', q: 'Quarter-final', s: 'Semi-final', f: 'Final', e: 'Exhibition', r: 'Repechage' };
        const r = String(round || '').trim().toLowerCase();
        if (map[r]) return map[r];
        if (/quarter/i.test(r)) return 'Quarter-final';
        if (/semi/i.test(r)) return 'Semi-final';
        if (/rep/i.test(r)) return 'Repechage';
        if (/heat/i.test(r)) return 'Heat';
        if (/final/i.test(r)) return 'Final';
        return String(round || '');
    }

    function finalDivisionRank(race) {
        const div = String(race?.division ?? state.results.get(race?.raceNum)?.division ?? '').trim();
        const num = parseInt(div, 10);
        if (Number.isFinite(num) && num >= 1 && num <= 9) return num;
        const lower = div.toLowerCase();
        if (lower === 'a' || /^a\s*final/.test(lower)) return 1;
        if (lower === 'b' || /^b\s*final/.test(lower)) return 2;
        if (lower === 'c' || /^c\s*final/.test(lower)) return 3;
        return 99;
    }

    function finalLabelForRace(race) {
        const rank = finalDivisionRank(race);
        if (rank === 1) return 'A Final';
        if (rank === 2) return 'B Final';
        if (rank === 3) return 'C Final';
        return 'Final';
    }

    function sortFinalRaces(races) {
        return [...(races || [])].sort((a, b) => {
            const da = finalDivisionRank(a);
            const db = finalDivisionRank(b);
            if (da !== db) return da - db;
            return (a.startAt ? a.startAt.getTime() : a.raceNum) - (b.startAt ? b.startAt.getTime() : b.raceNum);
        });
    }

    function formatRoundLabel(race) {
        if (race && classifyRound(race.round) === 'final') {
            const lbl = finalLabelForRace(race);
            if (lbl !== 'Final') return lbl;
        }
        return expandRoundLabel(race?.round);
    }

    function eventKey(race) {
        return String(race?.eventNum ?? '').trim();
    }

    function eventMatchesNum(raceOrRes, eventNum) {
        return String(raceOrRes?.eventNum ?? raceOrRes) === String(eventNum);
    }

    function getRegattaMeta(code) {
        const c = normalizeRegattaCode(code);
        return REGATTA_META[c] || { name: c.toUpperCase(), location: '', venue: '' };
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

    function enrichEventGroup(g) {
        const meta = state.eventsByNum.get(g.eventNum) || state.eventsByNum.get(String(parseInt(g.eventNum, 10))) || null;
        if (meta) {
            g.eventName = meta.displayName || meta.name || g.eventName;
            g.meta = meta;
        }
        if (!g.eventName && g.races.length) g.eventName = g.races[0].eventName;
        g.displayTitle = `Event ${g.eventNum} · ${expandEventName(g.eventName || '—')}`;
    }

    function buildEventGroups() {
        const groups = new Map();
        const ensure = (eventNum) => {
            const key = String(eventNum).trim();
            if (!key || groups.has(key)) return groups.get(key);
            const g = { key, eventNum: key, eventName: '', races: [], raceNums: new Set() };
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
        for (const r of group.races) byNum.set(r.raceNum, r);
        for (const raceNum of group.raceNums) {
            if (byNum.has(raceNum)) continue;
            const res = state.results.get(raceNum);
            if (!res || !eventMatchesNum(res, group.eventNum)) continue;
            const lanes = (res.placings || []).map((p, i) => ({ lane: i + 1, crew: p.competitor }));
            byNum.set(raceNum, {
                raceNum,
                race: String(raceNum),
                eventNum: group.eventNum,
                eventName: group.eventName,
                round: res.round,
                division: res.division,
                format: res.format,
                lanes,
                startAt: null,
                dayLabel: '',
            });
        }

        let synthId = 900000;
        for (const dr of state.drawRows) {
            if (String(dr.eventNum) !== String(group.eventNum)) continue;
            const kind = classifyRound(dr.round);
            if (kind !== 'qf' && kind !== 'sf' && kind !== 'final') continue;
            const exists = [...byNum.values()].some(
                (r) => classifyRound(r.round) === kind && String(r.division) === String(dr.division),
            );
            if (exists) continue;
            byNum.set(synthId, {
                raceNum: synthId,
                race: `D${synthId - 900000}`,
                eventNum: group.eventNum,
                eventName: group.eventName,
                round: dr.round,
                division: dr.division,
                lanes: dr.lanes,
                startAt: null,
                dayLabel: '',
                fromDraw: true,
            });
            synthId += 1;
        }

        return [...byNum.values()].sort((a, b) => {
            const ta = a.startAt ? a.startAt.getTime() : a.raceNum;
            const tb = b.startAt ? b.startAt.getTime() : b.raceNum;
            return ta - tb;
        });
    }

    function rebuildRaceIndex() {
        const merged = new Map();
        for (const r of state.races) merged.set(r.raceNum, r);
        for (const g of buildEventGroups()) {
            for (const r of getRacesForEvent(g)) {
                if (!merged.has(r.raceNum)) merged.set(r.raceNum, r);
            }
        }
        state.races = [...merged.values()].sort((a, b) => {
            const ta = a.startAt ? a.startAt.getTime() : a.raceNum;
            const tb = b.startAt ? b.startAt.getTime() : b.raceNum;
            return ta - tb;
        });
    }

    function getEventGroup(key) {
        return buildEventGroups().find((g) => g.key === key) || null;
    }

    function getRaceMatchData(raceNum) {
        const race = findRace(raceNum);
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
        return { race, raceNum, res, slots, winner: slots.find((s) => s.place === 1) || slots[0], round: res?.round || race?.round || '' };
    }

    function winnerForRace(raceNum) {
        const res = state.results.get(raceNum);
        return res?.placings?.find((p) => p.place === 1) || res?.placings?.[0] || null;
    }

    function findRace(num) {
        const direct = state.races.find((r) => r.raceNum === num);
        if (direct) return direct;
        for (const g of buildEventGroups()) {
            const r = getRacesForEvent(g).find((x) => x.raceNum === num);
            if (r) return r;
        }
        return null;
    }

    function matchingPlacing(crew, placings) {
        if (!placings?.length) return null;
        const crewKey = normalizeClubKey(crew);
        const resolved = resolveClubFromCrew(crew);
        return (
            placings.find((p) => {
                const pr = resolveClubFromCrew(p.competitor);
                if (resolved.clubId && pr.clubId && resolved.clubId === pr.clubId) return true;
                return normalizeClubKey(p.competitor) === crewKey;
            }) || null
        );
    }

    function collectHeatResultsForEvent(group) {
        const heats = [];
        for (const [raceNum, res] of state.results) {
            if (!eventMatchesNum(res, group.eventNum)) continue;
            if (classifyRound(res.round) !== 'heat') continue;
            heats.push({
                raceNum,
                division: res.division,
                format: formatForHeatRace(group, { division: res.division, format: res.format }),
                placings: res.placings || [],
            });
        }
        heats.sort((a, b) => {
            const da = parseInt(a.division, 10);
            const db = parseInt(b.division, 10);
            if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
            return a.raceNum - b.raceNum;
        });
        return heats;
    }

    function collectRepResultsForEvent(group) {
        const reps = [];
        const seen = new Set();
        for (const [raceNum, res] of state.results) {
            if (!eventMatchesNum(res, group.eventNum)) continue;
            if (classifyRound(res.round) !== 'rep') continue;
            seen.add(raceNum);
            reps.push({
                raceNum,
                division: res.division,
                format: res.format || primaryProgressionFormat(group),
                placings: res.placings || [],
            });
        }
        for (const race of getRacesForEvent(group)) {
            if (classifyRound(race.round) !== 'rep') continue;
            if (seen.has(race.raceNum)) continue;
            seen.add(race.raceNum);
            const res = state.results.get(race.raceNum);
            reps.push({
                raceNum: race.raceNum,
                division: race.division,
                format: res?.format || race.progression || primaryProgressionFormat(group),
                placings: res?.placings || [],
            });
        }
        reps.sort((a, b) => {
            const da = parseInt(a.division, 10);
            const db = parseInt(b.division, 10);
            if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
            return a.raceNum - b.raceNum;
        });
        return reps;
    }

    function renderHeatTableRows(rows, renderCrew) {
        return rows
            .map((row) => {
                const info = renderCrew(row.crew);
                return (
                    `<tr>` +
                    `<td class="bsr-tt-rank">${row.place}</td>` +
                    `<td>${logoImgHtml('bsr-tt-logo', info.logoUrl, info.name)}` +
                    `<span class="bsr-tt-crew-name">${escapeHtml(info.name)}</span>` +
                    `<span class="bsr-note"> ${escapeHtml(row.crew)}</span></td>` +
                    `<td class="bsr-tt-time">${escapeHtml(row.time || '—')}</td>` +
                    `<td class="bsr-tt-prog"><span class="bsr-tt-prog-pill ${escapeHtml(row.progression.cls)}">${escapeHtml(row.progression.label)}</span></td>` +
                    `</tr>`
                );
            })
            .join('');
    }

    function setStatus(msg, isError) {
        const el = document.getElementById('rrdStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.classList.toggle('bsr-status--error', !!isError);
    }

    function loadSettings() {
        try {
            state.regattaCode = normalizeRegattaCode(
                new URLSearchParams(location.search).get('regatta') || localStorage.getItem(LS_REGATTA),
            );
            state.liveRefresh = localStorage.getItem(LS_LIVE_REFRESH) === '1';
        } catch {
            state.regattaCode = DEFAULT_REGATTA;
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(LS_REGATTA, state.regattaCode);
            localStorage.setItem(LS_LIVE_REFRESH, state.liveRefresh ? '1' : '0');
        } catch {
            /* ignore */
        }
    }

    function formatRaceTime(d) {
        if (!d) return '—';
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    function renderStatsOverview() {
        const root = document.getElementById('rrdStats');
        if (!root) return;
        if (!state.races.length && !state.results.size) {
            root.hidden = true;
            return;
        }
        const meta = getRegattaMeta(state.regattaCode);
        const range = getRegattaDateRange();
        const dateLabel = range
            ? range.min.toDateString() === range.max.toDateString()
                ? range.min.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                : `${range.min.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} — ${range.max.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
            : 'From results CSV';
        const eventCount = buildEventGroups().length;
        root.innerHTML =
            `<article class="bsr-stat-card"><span class="bsr-stat-label">Regatta</span><div class="bsr-stat-value">${escapeHtml(meta.name)}</div><p class="bsr-stat-sub">${escapeHtml(meta.location || meta.venue)}</p></article>` +
            `<article class="bsr-stat-card"><span class="bsr-stat-label">Dates</span><div class="bsr-stat-value">${escapeHtml(dateLabel)}</div></article>` +
            `<article class="bsr-stat-card"><span class="bsr-stat-label">Competitors</span><div class="bsr-stat-value">${countUniqueCompetitors()}</div></article>` +
            `<article class="bsr-stat-card"><span class="bsr-stat-label">Events</span><div class="bsr-stat-value">${eventCount}</div><p class="bsr-stat-sub">${state.results.size} results</p></article>` +
            `<article class="bsr-stat-card"><span class="bsr-stat-label">GPS</span><div class="bsr-stat-value">—</div><p class="bsr-stat-sub">Coming later</p></article>`;
        root.hidden = false;
    }

    function renderFilters() {
        const eventSel = document.getElementById('rrdFilterEvent');
        if (!eventSel) return;
        const groups = buildEventGroups();
        eventSel.innerHTML =
            '<option value="">— Select event —</option>' +
            groups.map((g) => `<option value="${escapeHtml(g.key)}">${escapeHtml(g.displayTitle || `Event ${g.eventNum}`)}</option>`).join('');
        eventSel.value = state.filterEvent || state.selectedEventKey;
    }

    function renderSchemeReference(activeEntryCount) {
        const root = document.getElementById('rrdSchemeReference');
        const WR = window.WorldRowingProgression;
        if (!root || !WR) return;
        const rows = WR.ENTRY_SCHEMES.map((s) => {
            const active = activeEntryCount >= s.min && activeEntryCount <= s.max;
            return (
                `<tr class="${active ? 'rrd-scheme-table--active' : ''}">` +
                `<td>${s.min}–${s.max}</td><td>${s.heats}</td>` +
                `<td>${s.directPerHeat} per heat${s.fastTimes ? ` + ${s.fastTimes} FT` : ''}</td>` +
                `<td>${s.qf || '—'}</td><td>${s.sf || '—'}</td>` +
                `<td>${s.finals.join(', ')}</td></tr>`
            );
        }).join('');
        root.innerHTML =
            `<p class="bsr-note">${escapeHtml(WR.RULES_SUMMARY)}</p>` +
            `<div class="rrd-scheme-table-wrap"><table class="rrd-scheme-table">` +
            `<thead><tr><th>Entries</th><th>Heats</th><th>Progression</th><th>QF</th><th>SF</th><th>Finals</th></tr></thead>` +
            `<tbody>${rows}</tbody></table></div>`;
    }

    function selectEvent(key) {
        state.selectedEventKey = key || '';
        state.filterEvent = key || '';
        const sel = document.getElementById('rrdFilterEvent');
        if (sel) sel.value = state.filterEvent;
        const search = document.getElementById('rrdEventSearch');
        const group = getEventGroup(key);
        if (search && group) search.value = group.displayTitle || `Event ${group.eventNum}`;
        const ws = document.getElementById('rrdEventWorkspace');
        if (ws) ws.hidden = !key;
        const url = new URL(location.href);
        if (key) url.searchParams.set('event', key);
        else url.searchParams.delete('event');
        history.replaceState(null, '', url);
        if (key) {
            renderEventHero();
            renderHeatsProgression();
            renderRepechagePanel();
            renderBracketTree();
            renderEventSchedule();
            const group = getEventGroup(key);
            const heatResults = collectHeatResultsForEvent(group);
            const WR = window.WorldRowingProgression;
            const entryCount = group?.meta?.drawSize ? parseInt(group.meta.drawSize, 10) : undefined;
            const prog = WR?.computeEventHeatProgression({ heatResults, entryCount });
            renderSchemeReference(prog?.scheme?.entryCount || heatResults.length * 6);
        }
    }

    function renderEventHero() {
        const root = document.getElementById('rrdEventHero');
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

    function renderHeatsProgression() {
        const root = document.getElementById('rrdHeatsProgression');
        const lead = document.getElementById('rrdHeatsLead');
        if (!root) return;
        const group = getEventGroup(state.selectedEventKey);
        if (!group) {
            root.innerHTML = '<p class="bsr-empty">Select an event.</p>';
            return;
        }
        const WR = window.WorldRowingProgression;
        const heatResults = collectHeatResultsForEvent(group);
        const entryCount = group.meta?.drawSize ? parseInt(group.meta.drawSize, 10) : undefined;
        const prog = WR?.computeEventHeatProgression({ heatResults, entryCount });

        if (lead && prog) {
            const src =
                prog.source === 'rowit'
                    ? 'RowIT progression (results / daysheet / draw)'
                    : 'World Rowing progression (fallback — no RowIT format found)';
            lead.textContent = `${src}. ${prog.summary || ''}`.trim();
        }

        if (!prog?.heats?.length) {
            root.innerHTML = '<p class="bsr-note">No heat results for this event yet.</p>';
            return;
        }

        root.innerHTML = prog.heats
            .map((heat) => {
                const note = heat.format
                    ? `<p class="bsr-note rrd-format-notes">${escapeHtml(heat.format)}</p>`
                    : '';
                return (
                    `<div class="bsr-tt-col">` +
                    `<h3 class="bsr-tt-col-head">Heat ${escapeHtml(heat.heatNum)}` +
                    (heat.raceNum ? `<span class="bsr-note"> · R${heat.raceNum}</span>` : '') +
                    `</h3>` +
                    note +
                    `<table class="bsr-tt-table"><thead><tr><th>Pl</th><th>Crew</th><th>Time</th><th>Progression</th></tr></thead>` +
                    `<tbody>${renderHeatTableRows(heat.rows, clubInfo)}</tbody></table></div>`
                );
            })
            .join('');
    }

    function renderRepechagePanel() {
        const root = document.getElementById('rrdRepechagePanel');
        if (!root) return;
        const group = getEventGroup(state.selectedEventKey);
        if (!group) {
            root.innerHTML = '';
            return;
        }
        const WR = window.WorldRowingProgression;
        const repResults = collectRepResultsForEvent(group);
        const repProg = WR?.computeRepProgression(repResults);

        if (!repProg?.reps?.length) {
            const scheduled = collectRepResultsForEvent(group);
            if (!scheduled.length) {
                root.innerHTML = '';
                return;
            }
            root.innerHTML =
                `<h3 class="bsr-tt-col-head">Repechages</h3>` +
                scheduled
                    .map((rep) => {
                        const race = findRace(rep.raceNum);
                        const crews = (rep.placings?.length ? rep.placings : race?.lanes || [])
                            .map((p, i) => {
                                const crew = p.competitor || p.crew;
                                const info = clubInfo(crew);
                                return (
                                    `<tr><td class="bsr-tt-rank">${p.place || i + 1}</td>` +
                                    `<td>${logoImgHtml('bsr-tt-logo', info.logoUrl, info.name)}` +
                                    `<span class="bsr-tt-crew-name">${escapeHtml(info.name)}</span></td>` +
                                    `<td class="bsr-tt-time">${escapeHtml(p.time || '—')}</td>` +
                                    `<td class="bsr-tt-prog">—</td></tr>`
                                );
                            })
                            .join('');
                        return (
                            `<div class="bsr-tt-col">` +
                            `<h4 class="bsr-tt-col-head">Repechage ${escapeHtml(rep.division || rep.raceNum)}` +
                            `<span class="bsr-note"> · R${rep.raceNum}</span></h4>` +
                            (rep.placings?.length ? '' : `<p class="bsr-note">Draw only — results pending</p>`) +
                            `<table class="bsr-tt-table"><thead><tr><th>Pl</th><th>Crew</th><th>Time</th><th>Progression</th></tr></thead>` +
                            `<tbody>${crews}</tbody></table></div>`
                        );
                    })
                    .join('');
            return;
        }

        root.innerHTML =
            `<h3 class="bsr-tt-col-head">Repechages</h3>` +
            repProg.reps
                .map((rep) => {
                    const note = rep.format ? `<p class="bsr-note">${escapeHtml(rep.format)}</p>` : '';
                    return (
                        `<div class="bsr-tt-col">` +
                        `<h4 class="bsr-tt-col-head">Repechage ${escapeHtml(rep.repNum)}` +
                        (rep.raceNum ? `<span class="bsr-note"> · R${rep.raceNum}</span>` : '') +
                        `</h4>` +
                        note +
                        `<table class="bsr-tt-table"><thead><tr><th>Pl</th><th>Crew</th><th>Time</th><th>Progression</th></tr></thead>` +
                        `<tbody>${renderHeatTableRows(rep.rows, clubInfo)}</tbody></table></div>`
                    );
                })
                .join('');
    }

    function getRaceProgressionFormat(raceNum) {
        const race = findRace(raceNum);
        if (race?.progression) return race.progression;
        const res = state.results.get(raceNum);
        return res?.format || '';
    }

    function advancingPlacesForRace(raceNum, roundKind) {
        const WR = window.WorldRowingProgression;
        return WR?.advancingPlacesForRound?.(roundKind, getRaceProgressionFormat(raceNum)) || new Set([1, 2, 3, 4]);
    }

    function medalIconHtml(medalKey, alt) {
        const src = MEDAL_ICONS[medalKey];
        if (!src) return '';
        return (
            `<img class="rrd-medal-icon" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="28" height="28" ` +
            `onerror="this.style.display='none'">`
        );
    }

    function renderTreeCrewLine(slot, opts = {}) {
        if (!slot) return '<span class="bsr-tree-crew bsr-tree-crew--empty">TBD</span>';
        const { advances, medalClass } = opts;
        const win = slot.place === 1;
        let cls = 'bsr-tree-crew';
        if (win && !medalClass) cls += ' bsr-tree-crew--winner';
        if (advances) cls += ' bsr-tree-crew--advances';
        if (medalClass) cls += ` rrd-tree-crew--medal-${medalClass}`;
        const progMark = advances ? '<span class="rrd-tree-advance-mark" aria-hidden="true"></span>' : '';
        return (
            `<span class="${cls}">` +
            progMark +
            logoImgHtml('bsr-tree-crew-logo', slot.info.logoUrl, slot.info.name) +
            `<span class="bsr-tree-crew-name">${escapeHtml(slot.info.name)}</span>` +
            (slot.time ? `<span class="bsr-tree-crew-time">${escapeHtml(slot.time)}</span>` : '') +
            `</span>`
        );
    }

    function renderTreeMatch(raceNum, label, roundKind) {
        const m = getRaceMatchData(raceNum);
        const current = raceNum === state.selectedRaceNum;
        const timeLabel = m.race?.startAt ? formatRaceTime(m.race.startAt) : '';
        const advancePlaces = advancingPlacesForRace(raceNum, roundKind);
        const isAFinal = roundKind === 'final' && finalDivisionRank(m.race || { division: m.res?.division }) === 1;
        const medalKeys = ['gold', 'silver', 'bronze'];
        const crewsHtml = m.slots
            .map((slot) => {
                const advances = slot.place && advancePlaces.has(slot.place);
                let medalClass = '';
                if (isAFinal && slot.place >= 1 && slot.place <= 3) {
                    medalClass = medalKeys[slot.place - 1];
                }
                return renderTreeCrewLine(slot, { advances, medalClass });
            })
            .join('');
        const format = getRaceProgressionFormat(raceNum);
        const progHint =
            format && (roundKind === 'qf' || roundKind === 'sf')
                ? `<span class="rrd-tree-prog-hint">${escapeHtml(format)}</span>`
                : '';
        return (
            `<button type="button" class="bsr-tree-match${current ? ' bsr-tree-match--current' : ''}" data-race-num="${raceNum}">` +
            `<span class="bsr-tree-match-meta">${escapeHtml(label || formatRoundLabel(m.race || { round: m.round }))}` +
            (timeLabel ? ` · ${escapeHtml(timeLabel)}` : '') +
            `</span>` +
            progHint +
            `<div class="rrd-tree-match-crews">${crewsHtml || renderTreeCrewLine(null)}</div>` +
            `</button>`
        );
    }

    function renderTreeFeeder(matches, roundKind) {
        return `<div class="bsr-tree-feeder">${matches.map((m) => `<div class="bsr-tree-match-row">${renderTreeMatch(m.raceNum, m.label, roundKind)}</div>`).join('')}</div>`;
    }

    function renderTreeColumn(title, feedersHtml, extraClass) {
        if (!feedersHtml) return '';
        return (
            `<div class="bsr-tree-col${extraClass ? ` ${extraClass}` : ''}">` +
            `<h3 class="bsr-tree-col-title">${escapeHtml(title)}</h3>` +
            `<div class="bsr-tree-col-body">${feedersHtml}</div></div>`
        );
    }

    function renderMedalists(finRaces) {
        const sorted = sortFinalRaces(finRaces);
        const aFinal = sorted.find((r) => finalDivisionRank(r) === 1) || sorted[0];
        if (!aFinal) return '<p class="bsr-note">—</p>';

        const res = state.results.get(aFinal.raceNum);
        let top3 = (res?.placings || []).filter((p) => p.place >= 1 && p.place <= 3 && p.place < 90).sort((a, b) => a.place - b.place);

        if (!top3.length) {
            const m = getRaceMatchData(aFinal.raceNum);
            top3 = m.slots.slice(0, 3).map((s, i) => ({
                place: s.place || i + 1,
                competitor: s.crew,
                time: s.time,
            }));
        }

        if (!top3.length) return '<p class="bsr-note">Pending</p>';

        const medalClass = ['gold', 'silver', 'bronze'];
        const medalLabel = ['Gold', 'Silver', 'Bronze'];

        return top3
            .map((p) => {
                const idx = Math.min(p.place - 1, 2);
                const info = clubInfo(p.competitor);
                return (
                    `<div class="rrd-medalist rrd-medalist--${medalClass[idx]}">` +
                    medalIconHtml(medalClass[idx], `${medalLabel[idx]} medal`) +
                    `<span class="rrd-medalist-rank">${p.place}</span>` +
                    logoImgHtml('rrd-medalist-logo', info.logoUrl, info.name) +
                    `<span class="rrd-medalist-name">${escapeHtml(info.name)}</span>` +
                    (p.time ? `<span class="rrd-medalist-time">${escapeHtml(p.time)}</span>` : '') +
                    `</div>`
                );
            })
            .join('');
    }

    function renderBracketTree() {
        const root = document.getElementById('rrdBracketTree');
        if (!root) return;
        const group = getEventGroup(state.selectedEventKey);
        if (!group) {
            root.innerHTML = '';
            return;
        }
        const races = getRacesForEvent(group);
        const byKind = new Map();
        for (const r of races) {
            const k = classifyRound(r.round);
            if (!byKind.has(k)) byKind.set(k, []);
            byKind.get(k).push(r);
        }
        const qf = (byKind.get('qf') || []).sort((a, b) => {
            const da = parseInt(a.division, 10);
            const db = parseInt(b.division, 10);
            if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
            return a.raceNum - b.raceNum;
        });
        const sf = (byKind.get('sf') || []).sort((a, b) => {
            const da = parseInt(a.division, 10);
            const db = parseInt(b.division, 10);
            if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
            return a.raceNum - b.raceNum;
        });
        const fin = sortFinalRaces(byKind.get('final') || []);

        if (!qf.length && !sf.length && !fin.length) {
            root.innerHTML = '<p class="bsr-note">No quarter-finals, semi-finals or finals posted for this event yet.</p>';
            return;
        }

        let html = '<div class="bsr-knockout-tree">';
        if (qf.length) {
            html += renderTreeColumn(
                'Quarter-finals',
                qf.map((r) => renderTreeFeeder([{ raceNum: r.raceNum, label: `QF ${r.division || ''}` }], 'qf')).join(''),
                'bsr-tree-col--qf',
            );
        }
        if (sf.length) {
            html += renderTreeColumn(
                'Semi-finals',
                sf.map((r) => renderTreeFeeder([{ raceNum: r.raceNum, label: `SF ${r.division || ''}` }], 'sf')).join(''),
                'bsr-tree-col--sf',
            );
        }
        if (fin.length) {
            html += renderTreeColumn(
                'Finals',
                fin.map((r) => renderTreeFeeder([{ raceNum: r.raceNum, label: finalLabelForRace(r) }], 'final')).join(''),
                'bsr-tree-col--final',
            );
        }
        html += renderTreeColumn('Medalists', renderMedalists(fin), 'bsr-tree-col--medalists');
        html += '</div>';

        root.innerHTML = html;
        root.querySelectorAll('[data-race-num]').forEach((btn) => {
            btn.addEventListener('click', () => selectRace(parseInt(btn.dataset.raceNum, 10)));
        });
    }

    function renderEventSchedule() {
        const root = document.getElementById('rrdEventSchedule');
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
            let crews = race.lanes.map((l) => escapeHtml(l.crew)).join(' · ');
            if (res?.placings?.length) {
                crews = res.placings
                    .filter((p) => p.place < 90)
                    .map((p) => `${p.place}. ${escapeHtml(clubInfo(p.competitor).name)} (${escapeHtml(p.time || '—')})`)
                    .join(' · ');
            }
            const current = race.raceNum === state.selectedRaceNum;
            html +=
                `<tr class="bsr-schedule-row${current ? ' bsr-schedule-row--current' : ''}" data-race-num="${race.raceNum}" tabindex="0" role="button">` +
                `<td>R${escapeHtml(race.race)}</td>` +
                `<td>${race.startAt ? escapeHtml(formatRaceTime(race.startAt)) : '—'}</td>` +
                `<td>${escapeHtml(ROUND_LABELS[kind] || formatRoundLabel(race))}</td>` +
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

    function renderEventsPanel(race) {
        const root = document.getElementById('rrdEventsPanel');
        if (!root) return;
        const meta = eventMetaForRace(race);
        if (!meta) {
            root.innerHTML = '<p class="bsr-note">No events.csv row for this event number.</p>';
            return;
        }
        const bits = [];
        if (meta.classCode) bits.push(`Class: ${expandEventName(meta.classCode)}`);
        if (meta.gender) bits.push(`Gender: ${expandEventName(meta.gender)}`);
        if (meta.boat) bits.push(`Boat: ${expandEventName(meta.boat)}`);
        if (meta.drawSize) bits.push(`Draw: ${meta.drawSize}`);
        if (meta.format) bits.push(`Format: ${meta.format}`);
        root.innerHTML =
            `<p class="bsr-card-lead"><strong>${escapeHtml(meta.displayName || meta.name)}</strong> (Event ${escapeHtml(meta.eventNum)})</p>` +
            (bits.length ? `<ul class="bsr-event-meta-list">${bits.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : '');
    }

    function renderRaceDetail() {
        const root = document.getElementById('rrdRaceDetail');
        if (!root) return;
        const race = findRace(state.selectedRaceNum);
        if (!race) {
            root.innerHTML = '<p class="bsr-empty">Select a race from the schedule or bracket.</p>';
            return;
        }
        const res = state.results.get(race.raceNum);
        const winner = winnerForRace(race.raceNum);
        const names = competitorNames(race);

        let lanesHtml = '';
        const laneSource = race.lanes.length ? race.lanes : (res?.placings || []).map((p, i) => ({ lane: i + 1, crew: p.competitor }));
        for (const lane of laneSource) {
            const info = clubInfo(lane.crew);
            const placing = matchingPlacing(lane.crew, res?.placings);
            const isWinner = placing?.place === 1;
            lanesHtml +=
                `<div class="bsr-lane-row${isWinner ? ' bsr-lane-row--winner' : ''}">` +
                `<span class="bsr-lane-n">${lane.lane}</span>` +
                logoImgHtml('bsr-lane-logo', info.logoUrl, info.name) +
                `<div><div class="bsr-lane-club">${escapeHtml(info.name)}</div>` +
                `<div class="bsr-lane-names">${escapeHtml(lane.crew || '')}</div></div>` +
                `<span class="bsr-lane-time">${escapeHtml(placing?.time || '—')}</span></div>`;
        }

        let resultsHtml = '<p class="bsr-note">No results posted yet.</p>';
        if (res?.placings?.length) {
            resultsHtml =
                '<table class="bsr-results-table"><thead><tr><th>Place</th><th>Crew</th><th>Time</th></tr></thead><tbody>';
            for (const p of res.placings) {
                if (p.place >= 90) continue;
                const ci = clubInfo(p.competitor);
                resultsHtml +=
                    `<tr><td class="bsr-place-${p.place}">${p.place}</td>` +
                    `<td>${escapeHtml(ci.name)} <span class="bsr-note">(${escapeHtml(p.competitor)})</span></td>` +
                    `<td>${escapeHtml(p.time)}</td></tr>`;
            }
            resultsHtml += '</tbody></table>';
        }

        const formatNote = res?.format || race.format || '';

        root.innerHTML =
            `<section class="bsr-card">` +
            `<div class="bsr-race-hero">` +
            `<h2>Race ${escapeHtml(race.race)}</h2>` +
            `<span class="bsr-pill">${escapeHtml(formatRaceTime(race.startAt))}</span>` +
            `<span class="bsr-pill">${escapeHtml(formatRoundLabel(race))}</span>` +
            `<span class="bsr-pill">${escapeHtml(race.division ? `Heat ${race.division}` : '—')}</span>` +
            `</div>` +
            `<p class="bsr-card-lead"><strong>${escapeHtml(expandEventName(race.eventName))}</strong> · Event ${escapeHtml(race.eventNum)}</p>` +
            (formatNote ? `<p class="bsr-note"><strong>RowIT format:</strong> ${escapeHtml(formatNote)}</p>` : '') +
            (race.progression ? `<p class="bsr-note"><strong>Progression:</strong> ${escapeHtml(race.progression)}</p>` : '') +
            (winner ? `<p class="bsr-note"><strong>Winner:</strong> ${escapeHtml(clubInfo(winner.competitor).name)} (${escapeHtml(winner.time)})</p>` : '') +
            `<p class="rrd-gps-soon">GPS trace analysis will be added in a future update.</p>` +
            `</section>` +
            `<section class="bsr-card"><h3>Event metadata</h3><div id="rrdEventsPanel"></div></section>` +
            `<section class="bsr-card"><h3>Lane / crew list</h3><div class="bsr-lane-grid">${lanesHtml || '<p class="bsr-note">No crews listed.</p>'}</div></section>` +
            (names ? `<section class="bsr-card"><h3>Crew names</h3><p>${escapeHtml(names)}</p></section>` : '') +
            `<section class="bsr-card"><h3>Official results</h3>${resultsHtml}</section>`;

        renderEventsPanel(race);
    }

    function selectRace(raceNum) {
        state.selectedRaceNum = raceNum;
        const race = findRace(raceNum);
        if (race) {
            const key = eventKey(race);
            if (state.selectedEventKey !== key) selectEvent(key);
        }
        renderBracketTree();
        renderEventSchedule();
        renderHeatsProgression();
        renderRepechagePanel();
        const analysisEl = document.getElementById('rrdRaceAnalysis');
        if (analysisEl) analysisEl.hidden = !race;
        const titleEl = document.getElementById('rrdRaceAnalysisTitle');
        if (titleEl && race) titleEl.textContent = `Race ${race.race} · ${formatRoundLabel(race)}`;
        renderRaceDetail();
        const url = new URL(location.href);
        url.searchParams.set('race', String(raceNum));
        history.replaceState(null, '', url);
    }

    function stepRace(delta) {
        const group = getEventGroup(state.selectedEventKey);
        if (!group) return;
        const races = getRacesForEvent(group);
        if (!races.length) return;
        let idx = races.findIndex((r) => r.raceNum === state.selectedRaceNum);
        if (idx < 0) idx = 0;
        idx = Math.max(0, Math.min(races.length - 1, idx + delta));
        selectRace(races[idx].raceNum);
    }

    async function loadMissingLogosReport() {
        try {
            const res = await fetch('data/missing-school-logos.json');
            if (res.ok) state.missingLogos = await res.json();
        } catch {
            state.missingLogos = null;
        }
    }

    function renderMissingLogosPanel() {
        const el = document.getElementById('rrdMissingLogos');
        if (!el) return;
        const rep = state.missingLogos;
        if (!rep) {
            el.innerHTML = '<p class="bsr-note">Missing-logo report not loaded.</p>';
            return;
        }
        const items = [
            ...(rep.missingFile || []).map((r) => ({ id: r.id, name: r.name, detail: r.logo })),
            ...(rep.noLogo || []).map((r) => ({ id: r.id, name: r.name, detail: '(no logo in lookup)' })),
        ].sort((a, b) => a.name.localeCompare(b.name));
        const rows = items
            .map(
                (r) =>
                    `<tr><td><code>${escapeHtml(r.id)}</code></td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.detail)}</td></tr>`,
            )
            .join('');
        el.innerHTML =
            `<p class="bsr-note">${items.length} club(s) without a logo image.</p>` +
            `<div class="bsr-missing-logos-scroll"><table class="bsr-missing-logos-table">` +
            `<thead><tr><th>Code</th><th>Club</th><th>Expected file</th></tr></thead>` +
            `<tbody>${rows || '<tr><td colspan="3">All lookup logos present.</td></tr>'}</tbody></table></div>`;
    }

    async function applyRegattaPayload(code, options = {}) {
        const preserveSelection = options.preserveSelection !== false;
        const selRace = preserveSelection ? state.selectedRaceNum : null;
        const selEvent = preserveSelection ? state.selectedEventKey : null;

        const [daysheet, results, competitors, events, drawText, lookup] = await Promise.all([
            fetchRegattaCsv(code, 'daysheet').catch(() => ''),
            fetchRegattaCsv(code, 'results').catch(() => ''),
            fetchRegattaCsv(code, 'competitors').catch(() => ''),
            fetchRegattaCsv(code, 'events').catch(() => ''),
            fetchDrawCsv(code).catch(() => ''),
            state.lookup ? Promise.resolve(state.lookup) : fetch('data/ahd-lookup.json').then((r) => r.json()),
        ]);

        if (!state.lookup) {
            state.lookup = lookup;
            buildClubIndex();
        }

        state.races = daysheet ? parseDaysheet(daysheet) : [];
        state.results = results ? parseResults(results) : new Map();
        state.competitors = competitors ? parseCompetitors(competitors) : new Map();
        state.events = events ? parseEvents(events) : [];
        state.drawRows = drawText ? parseDrawCsv(drawText) : [];
        buildProgressionIndex();
        rebuildRaceIndex();

        if (!preserveSelection && !state.selectedRaceNum && state.races.length) {
            const p = new URLSearchParams(location.search).get('race');
            state.selectedRaceNum = p ? parseInt(p, 10) : state.races[Math.floor(state.races.length / 2)]?.raceNum;
        }

        let statusMsg = `Loaded ${state.races.length} races · ${state.results.size} results · ${state.events.length} events · ${code}`;
        if (options.refreshedAt) statusMsg = `Updated ${options.refreshedAt} · ${statusMsg}`;
        if (state.liveRefresh) statusMsg += ' · live refresh 1 min';
        if (state.results.size === 0) statusMsg += ' — no results loaded.';
        else if (!daysheet) statusMsg += ' — results only (daysheet not on RowIT yet).';
        if (state.drawRows.length) statusMsg += ` · draw ${state.drawRows.length} rows`;

        setStatus(statusMsg);
        renderStatsOverview();
        renderFilters();
        renderSchemeReference(0);

        const urlEvent = new URLSearchParams(location.search).get('event');
        if (!selEvent && urlEvent && buildEventGroups().some((g) => g.key === urlEvent)) {
            selectEvent(urlEvent);
        } else if (selEvent && buildEventGroups().some((g) => g.key === selEvent)) {
            selectEvent(selEvent);
        }
        if (selRace && findRace(selRace)) selectRace(selRace);
        else if (state.selectedRaceNum && findRace(state.selectedRaceNum)) selectRace(state.selectedRaceNum);
    }

    function stopLiveRefresh() {
        if (liveRefreshTimer) {
            clearInterval(liveRefreshTimer);
            liveRefreshTimer = null;
        }
    }

    function startLiveRefresh() {
        stopLiveRefresh();
        if (!state.liveRefresh) return;
        liveRefreshTimer = setInterval(async () => {
            if (state.loading) return;
            state.loading = true;
            try {
                await applyRegattaPayload(state.regattaCode, {
                    preserveSelection: true,
                    refreshedAt: new Date().toLocaleTimeString(),
                });
            } catch (err) {
                setStatus(`Live refresh failed: ${err.message}`, true);
            } finally {
                state.loading = false;
            }
        }, LIVE_REFRESH_MS);
    }

    async function loadRegatta() {
        state.loading = true;
        setStatus('Loading regatta data…');
        const code = state.regattaCode;
        try {
            if (!state.lookup) {
                state.lookup = await fetch('data/ahd-lookup.json').then((r) => r.json());
                buildClubIndex();
            }
            await loadMissingLogosReport();
            await applyRegattaPayload(code, { preserveSelection: false });
            renderMissingLogosPanel();
            startLiveRefresh();
        } catch (err) {
            setStatus(`Failed to load: ${err.message}`, true);
        } finally {
            state.loading = false;
        }
    }

    function bindUi() {
        const codeInput = document.getElementById('rrdRegattaCode');
        const loadBtn = document.getElementById('rrdLoadBtn');
        const eventSel = document.getElementById('rrdFilterEvent');

        if (codeInput) codeInput.value = state.regattaCode;

        loadBtn?.addEventListener('click', () => {
            state.regattaCode = normalizeRegattaCode(codeInput?.value);
            saveSettings();
            loadRegatta();
        });

        const liveRefreshEl = document.getElementById('rrdLiveRefresh');
        if (liveRefreshEl) {
            liveRefreshEl.checked = state.liveRefresh;
            liveRefreshEl.addEventListener('change', () => {
                state.liveRefresh = liveRefreshEl.checked;
                saveSettings();
                startLiveRefresh();
            });
        }

        eventSel?.addEventListener('change', () => selectEvent(eventSel.value));

        const eventSearch = document.getElementById('rrdEventSearch');
        eventSearch?.addEventListener('change', () => {
            const q = eventSearch.value.trim().toLowerCase();
            if (!q) return;
            const match = buildEventGroups().find((g) => {
                const label = (g.displayTitle || `Event ${g.eventNum}`).toLowerCase();
                return label.includes(q) || String(g.eventNum).toLowerCase() === q;
            });
            if (match) selectEvent(match.key);
        });

        const regattaParam = new URLSearchParams(location.search).get('regatta');
        if (regattaParam && codeInput) {
            codeInput.value = normalizeRegattaCode(regattaParam);
            state.regattaCode = codeInput.value;
        }

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

    async function init() {
        loadSettings();
        bindUi();
        renderSchemeReference(0);
        await loadRegatta();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
