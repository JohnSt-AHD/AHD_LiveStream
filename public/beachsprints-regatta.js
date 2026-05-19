/**
 * Beach Sprints regatta dashboard — race-by-race insight from RowIT CSV + Traccar GPS.
 * Default regatta: cnzb2026 (NZ Coastal Beach Sprint Champs, Titahi Bay Apr 2026).
 */
(function () {
    const DEFAULT_REGATTA = 'cnzb2026';
    const LS_REGATTA = 'bsrRegattaCode_v1';
    const LS_GPS_OFFSET = 'bsrGpsOffsetMin_v1';
    const LS_DEVICE_ALIASES = 'bsrDeviceAliases_v1';
    const LS_LANE_DEVICES = 'bsrLaneDevices_v1';
    const LS_REGATTA_PRESETS = 'bsrRegattaPresets_v1';
    const LS_PROGRESSION_VIEW = 'bsrProgressionView_v1';

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
            races.push({
                raceNum: info.raceNum,
                race: info.label,
                startAt,
                eventNum: cols[2].trim(),
                eventName: cols[3].trim(),
                round: cols[4].trim(),
                division: cols[5] ? cols[5].trim() : '',
                lanes,
                progression: headerCols ? '' : cols[cols.length - 1] ? cols[cols.length - 1].trim() : '',
                dayLabel,
            });
        }
        races.sort((a, b) => a.startAt - b.startAt);
        return races;
    }

    function parseResults(text) {
        const map = new Map();
        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || !/^\d/.test(trimmed)) continue;
            const cols = parseCsvLine(trimmed);
            const raceNum = parseInt(cols[0], 10);
            if (!Number.isFinite(raceNum)) continue;
            const placings = [];
            for (let i = 6; i + 2 < cols.length; i += 3) {
                const place = parseInt(cols[i], 10);
                const competitor = cols[i + 1].trim();
                const time = cols[i + 2].trim();
                if (!Number.isFinite(place) || place < 1 || !competitor) continue;
                placings.push({ place, competitor, time });
            }
            placings.sort((a, b) => a.place - b.place);
            map.set(raceNum, {
                status: cols[5].trim(),
                eventNum: cols[1]?.trim(),
                round: cols[2]?.trim(),
                division: cols[3]?.trim(),
                placings,
            });
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

    function csvUrl(code, file) {
        const c = normalizeRegattaCode(code);
        if (window.AltitudeHdHub?.buildCsvUrl) {
            return window.AltitudeHdHub.buildCsvUrl(c, file);
        }
        return `https://l.rowit.nz/altitude/${c}/${file}.csv`;
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

    function parseClubFromCrew(crew) {
        const s = String(crew || '').trim();
        if (!s) return { id: '', label: '', crewNum: '' };
        const m = s.match(/^([A-Za-z]{2,5})(?:\s+(\d+))?$/);
        if (m) {
            return { id: m[1].toLowerCase(), label: s, crewNum: m[2] || '' };
        }
        return { id: '', label: s, crewNum: '' };
    }

    function resolveClubFromCrew(crew) {
        const parsed = parseClubFromCrew(crew);
        if (parsed.id && state.lookup?.clubs?.[parsed.id]) {
            return { clubId: parsed.id, label: parsed.label, match: 'code' };
        }

        const key = normalizeClubKey(crew);
        if (!key) return { clubId: '', label: parsed.label || crew, match: 'none' };

        if (state.clubIndex.has(key)) {
            return { clubId: state.clubIndex.get(key), label: parsed.label || crew, match: 'exact' };
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
            return { clubId: bestId, label: parsed.label || crew, match: 'fuzzy' };
        }
        return { clubId: parsed.id || '', label: parsed.label || crew, match: 'none' };
    }

    function clubInfo(clubIdOrCrew) {
        const resolved =
            typeof clubIdOrCrew === 'string' && clubIdOrCrew.length > 6
                ? resolveClubFromCrew(clubIdOrCrew)
                : { clubId: clubIdOrCrew };
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

    function classifyRound(round) {
        const r = String(round || '').toLowerCase();
        if (/time\s*trial|\btt\b/.test(r)) return 'tt';
        if (/rep/.test(r)) return 'rep';
        if (/quarter|\bqf\b/.test(r)) return 'qf';
        if (/semi|\bsf\b/.test(r)) return 'sf';
        if (/final|\bf\b/.test(r)) return 'final';
        if (/heat/.test(r)) return 'heat';
        return 'other';
    }

    function eventKey(race) {
        return `${race.eventNum}|${race.eventName}|${race.division}`;
    }

    function buildEventGroups() {
        const groups = new Map();
        for (const race of state.races) {
            const key = eventKey(race);
            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    eventNum: race.eventNum,
                    eventName: race.eventName,
                    division: race.division,
                    races: [],
                });
            }
            groups.get(key).races.push(race);
        }
        for (const g of groups.values()) {
            g.races.sort((a, b) => a.startAt - b.startAt);
        }
        return [...groups.values()].sort((a, b) => {
            const t = (a.races[0]?.startAt || 0) - (b.races[0]?.startAt || 0);
            if (t !== 0) return t;
            return String(a.eventName).localeCompare(String(b.eventName));
        });
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
            if (state.filterEvent && eventKey(r) !== state.filterEvent) return false;
            return true;
        });
    }

    function findRace(num) {
        return state.races.find((r) => r.raceNum === num) || null;
    }

    function matchingPlacing(crew, placings) {
        if (!placings?.length) return null;
        const resolved = resolveClubFromCrew(crew);
        const crewKey = normalizeClubKey(crew);

        return (
            placings.find((p) => {
                const pr = resolveClubFromCrew(p.competitor);
                if (resolved.clubId && pr.clubId && resolved.clubId === pr.clubId) return true;
                if (normalizeClubKey(p.competitor) === crewKey) return true;
                const pc = parseClubFromCrew(p.competitor);
                if (resolved.clubId && pc.id && resolved.clubId === pc.id) return true;
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
                `<div class="bsr-race-meta">${escapeHtml(formatRaceTime(race.startAt))} · ${escapeHtml(race.round)}</div>` +
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
            const matchHint =
                resolved.match === 'fuzzy'
                    ? ' <span class="bsr-match-tag" title="Matched school name to club code">matched</span>'
                    : '';
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
            `<span class="bsr-pill">${escapeHtml(race.round)}</span>` +
            `<span class="bsr-pill">${escapeHtml(race.division || 'Open')}</span>` +
            `</div>` +
            `<p class="bsr-card-lead"><strong>${escapeHtml(expandEventName(race.eventName))}</strong> · Event ${escapeHtml(race.eventNum)}</p>` +
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
            `<section class="bsr-card" id="bsrGpsSection"><h3>GPS analysis</h3><p class="bsr-card-lead">Traccar devices mapped per lane. Scheduled start vs GPS may differ — adjust offset if needed.</p><div id="bsrGpsContent"><p class="bsr-note">Loading GPS…</p></div></section>`;

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
                if (i > 0) html += '<span class="bsr-arrow" aria-hidden="true">→</span>';
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
        const daySel = document.getElementById('bsrFilterDay');
        const eventSel = document.getElementById('bsrFilterEvent');
        if (!daySel || !eventSel) return;

        const days = [...new Set(state.races.map((r) => r.dayLabel).filter(Boolean))];
        daySel.innerHTML =
            '<option value="">All days</option>' +
            days.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');

        const groups = buildEventGroups();
        eventSel.innerHTML =
            '<option value="">All events</option>' +
            groups
                .map(
                    (g) =>
                        `<option value="${escapeHtml(g.key)}">${escapeHtml(g.eventNum)} · ${escapeHtml(g.eventName)}</option>`,
                )
                .join('');

        daySel.value = state.filterDay;
        eventSel.value = state.filterEvent;
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
                `<div><label>Lane ${lane} →</label>` +
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
        const schedMs = scheduledStart.getTime();
        return {
            startMs,
            endMs,
            durationSec: (endMs - startMs) / 1000,
            maxSpeedKmh: maxSpeed * 3.6,
            deltaFromScheduleSec: (startMs - schedMs) / 1000,
            pointCount: points.length,
        };
    }

    async function loadGpsForRace(race) {
        const container = document.getElementById('bsrGpsContent');
        if (!container) return;
        const win = gpsWindowForRace(race);
        const lanesToLoad = race.lanes.length ? race.lanes : [];

        if (!lanesToLoad.length) {
            container.innerHTML =
                '<p class="bsr-note">No lanes drawn. Configure boat devices in settings.</p>';
            return;
        }

        const cards = [];
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
                const points = await fetchRoute(deviceId, win.from, win.to);
                const stats = routeStats(points, win.center);
                const dev = state.devices.find((d) => String(d.id) === String(deviceId));
                const laneMapUrl = buildMapDeepLink(
                    { ...race, lanes: [lane] },
                    { compare: false },
                );
                if (!stats) {
                    cards.push(
                        `<div class="bsr-gps-card"><h4>Lane ${lane.lane} · ${escapeHtml(dev?.name || alias)}</h4>` +
                            `<p class="bsr-note">No GPS points in window (${formatDateTime(win.from)} – ${formatDateTime(win.to)}).</p>` +
                            `<a href="${escapeHtml(laneMapUrl)}">Open on map →</a></div>`,
                    );
                } else {
                    cards.push(
                        `<div class="bsr-gps-card"><h4>Lane ${lane.lane} · ${escapeHtml(dev?.name || alias)}</h4>` +
                            `<p class="bsr-gps-stat"><strong>Points:</strong> ${stats.pointCount}</p>` +
                            `<p class="bsr-gps-stat"><strong>GPS start:</strong> ${formatDateTime(new Date(stats.startMs))}</p>` +
                            `<p class="bsr-gps-stat"><strong>Duration:</strong> ${stats.durationSec.toFixed(1)} s</p>` +
                            `<p class="bsr-gps-stat"><strong>Max speed:</strong> ${stats.maxSpeedKmh.toFixed(1)} km/h</p>` +
                            `<p class="bsr-gps-stat"><strong>vs schedule:</strong> ${stats.deltaFromScheduleSec >= 0 ? '+' : ''}${stats.deltaFromScheduleSec.toFixed(0)} s</p>` +
                            `<a href="${escapeHtml(laneMapUrl)}">Open on map →</a></div>`,
                    );
                }
            } catch (err) {
                cards.push(
                    `<div class="bsr-gps-card"><h4>Lane ${lane.lane}</h4><p class="bsr-note">GPS error: ${escapeHtml(err.message)}</p></div>`,
                );
            }
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
            `<p class="bsr-note">Window: ${formatDateTime(win.from)} – ${formatDateTime(win.to)} (offset ${state.gpsOffsetMin} min).</p>`;
    }

    function selectRace(raceNum) {
        state.selectedRaceNum = raceNum;
        renderRaceList();
        renderProgression();
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
                fetchCsvText(csvUrl(code, 'daysheet')),
                fetchCsvText(csvUrl(code, 'results')).catch(() => ''),
                fetchCsvText(csvUrl(code, 'competitors')).catch(() => ''),
                fetchCsvText(csvUrl(code, 'events')).catch(() => ''),
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
                statusMsg += ' — no results file yet (results.csv may not be published).';
            }
            setStatus(statusMsg);
            renderFilters();
            renderRaceList();
            renderProgression();
            renderDeviceConfig();
            renderRaceDetail();
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
        const daySel = document.getElementById('bsrFilterDay');
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

        daySel?.addEventListener('change', () => {
            state.filterDay = daySel.value;
            renderRaceList();
        });

        eventSel?.addEventListener('change', () => {
            state.filterEvent = eventSel.value;
            renderRaceList();
            renderProgression();
        });

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
