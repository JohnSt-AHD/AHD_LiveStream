/**
 * KRI live stream — race viewer (birds-eye course + zoom + upcoming races).
 * Replays saved split-speed data (same source as speed vs distance chart).
 */
(function (global) {
    const DATA_URL = 'data/kri-sample-wrcp1-m1x-h1.json';
    const COURSE_M = 2000;
    const COURSE_PAD_M = 100;
    const COURSE_VIEW_MIN_M = -COURSE_PAD_M;
    const COURSE_VIEW_MAX_M = COURSE_M + COURSE_PAD_M;
    const LANE_COUNT = 8;
    const MARKERS_M = [0, 500, 1000, 1500, 2000];
    const LOGO_PLACEHOLDER = 'assets/school-logos/placeholder-white.svg';
    const LS_LIVE_RACE = 'altitudeHdLiveRace_v1';
    const CLUSTER_PAD_M = 100;
    const ZOOM_TRAIL_M = 90;
    const ZOOM_LEAD_M = 35;
    const ZOOM_SPAN_M = 130;
    const ZOOM_CENTER_SMOOTH = 0.1;
    const ZOOM_BOAT_Y_SMOOTH = 0.16;
    const ZOOM_COURSE_REGEN_M = 40;
    const LOOP_PAUSE_SEC = 2.5;
    const ZONE_START_M = 100;
    const ZONE_FINISH_M = 250;
    const BUOY_SPACING_M = 20;
    const BUOY_R_OVERVIEW = 3;
    const BUOY_R_ZOOM = 4;
    const RACE_STAGGER_M = 1000;
    const SPLIT_MARKERS_M = [500, 1000, 1500];
    const SPLIT_HOLD_SEC = 20;
    const FINISH_HIDE_SEC = 30;
    const TITLE_FOLLOW_SNAP_M = 14;
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const MONTHS = {
        january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
        april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
        august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9,
        november: 10, nov: 10, december: 11, dec: 11,
    };

    const state = {
        lookup: null,
        races: [],
        results: new Map(),
        raceContext: null,
        chartState: null,
        raceLabel: '',
        raceSlots: [],
        selectedRaceSlot: 'current',
        onCourseRaceNums: new Set(),
        lastPlaybackSec: 0,
        rafId: null,
        playbackStart: null,
        waterRafId: null,
        zoomCenter: null,
        zoomCourseAnchor: null,
        zoomBoatYOffset: new Map(),
        lastFrameTs: null,
        prevBoatDistance: new Map(),
        finishedBoats: new Map(),
        laneSplitCallouts: new Map(),
        waterLiteFrame: 0,
        waterDeferTimer: null,
        overviewLayout: null,
        zoomLayout: null,
        zoomBoatPool: [],
        overviewBoatNodes: new Map(),
        titleFollowKey: '',
        splitCalloutsKey: '',
        clusterKeys: '',
        waterDeferUntil: 0,
    };

    function $(id) {
        return document.getElementById(id);
    }

    function useLiteGraphics() {
        if (global.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
        return global.matchMedia('(max-width: 900px)').matches;
    }

    function effectiveBuoySpacing() {
        return useLiteGraphics() ? BUOY_SPACING_M * 2 : BUOY_SPACING_M;
    }

    function canvasDpr() {
        return useLiteGraphics() ? 1 : Math.min(global.devicePixelRatio || 1, 2);
    }

    function enrichLayout(layout) {
        const { h, padT, padB } = layout;
        const bands = computeLaneBands(h, padT, padB);
        return { ...layout, laneCenters: bands.centers, laneHeights: bands.heights };
    }

    function getOverviewLayout() {
        if (state.overviewLayout) return state.overviewLayout;
        const svg = $('krvOverviewSvg');
        if (!svg?.dataset.layout) return null;
        state.overviewLayout = enrichLayout(JSON.parse(svg.dataset.layout));
        return state.overviewLayout;
    }

    function getZoomLayout() {
        if (state.zoomLayout) return state.zoomLayout;
        const svg = $('krvZoomSvg');
        if (!svg?.dataset.layout) return null;
        state.zoomLayout = enrichLayout(JSON.parse(svg.dataset.layout));
        return state.zoomLayout;
    }

    function clearBoatPools() {
        state.zoomBoatPool = [];
        $('krvZoomBoats')?.replaceChildren();
        state.overviewBoatNodes = new Map();
        $('krvOverviewBoats')?.replaceChildren();
        state.titleFollowKey = '';
        state.splitCalloutsKey = '';
        state.clusterKeys = '';
    }

    function yMapLaneCached(lane, layout) {
        return layout?.laneCenters?.[lane - 1] ?? 0;
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function params() {
        return new URLSearchParams(global.location.search);
    }

    function getRegattaCode() {
        const p = params().get('regatta');
        if (p) return global.AltitudeHdHub?.normalizeRegattaCode?.(p) || p;
        if (global.AltitudeHdHub?.loadRegattaCode) return global.AltitudeHdHub.loadRegattaCode();
        return 'mads2026';
    }

    function getRaceParam() {
        const urlRace = params().get('race');
        if (urlRace != null && String(urlRace).trim() !== '') return String(urlRace).trim();
        if (global.AltitudeHdLiveRace?.getLiveRace) {
            const hub = global.AltitudeHdLiveRace.getLiveRace();
            if (hub) return hub;
        }
        try {
            const stored = global.localStorage.getItem(LS_LIVE_RACE);
            if (stored) return stored;
        } catch {
            /* ignore */
        }
        return null;
    }

    function getDataUrl() {
        return params().get('data') || DATA_URL;
    }

    async function fetchCsv(url) {
        try {
            const res = await fetch(`/api/fetch-csv?url=${encodeURIComponent(url)}`);
            if (res.ok) return res.text();
        } catch {
            /* direct */
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
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
        if (!m) return { date: null, label: line.trim() };
        const month = MONTHS[m[2].toLowerCase()];
        if (month === undefined) return { date: null, label: line.trim() };
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
        const t = String(raw || '').trim();
        return t && t !== '-' && !/^-+\s*$/.test(t) && !/cancelled/i.test(t);
    }

    function parseLanes(cols, headerCols) {
        if (headerCols?.length) {
            const lanes = [];
            for (let i = 0; i < headerCols.length; i++) {
                const h = (headerCols[i] || '').trim().toLowerCase();
                const m = h.match(/^lane[_\s-]?(\d+)$/);
                if (!m) continue;
                const code = (cols[i] || '').trim();
                if (!isCrewCell(code)) continue;
                lanes.push({ lane: parseInt(m[1], 10), code });
            }
            lanes.sort((a, b) => a.lane - b.lane);
            if (lanes.length) return lanes;
        }
        const lanes = [];
        for (let lane = 1; lane <= 9; lane++) {
            const idx = 5 + lane;
            if (idx >= cols.length - 1) break;
            const code = (cols[idx] || '').trim();
            lanes.push({ lane, code: isCrewCell(code) ? code : null });
        }
        let lastUsed = 0;
        for (const l of lanes) if (l.code) lastUsed = l.lane;
        return lastUsed ? lanes.filter((l) => l.lane <= lastUsed) : lanes;
    }

    function parseDaysheet(text) {
        const races = [];
        let dayDate = null;
        let headerCols = null;
        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (/^DAY\s+\d+:/i.test(trimmed)) {
                dayDate = parseDayHeader(trimmed).date;
                headerCols = null;
                continue;
            }
            if (!dayDate) continue;
            if (/^Race,/i.test(trimmed)) {
                headerCols = parseCsvLine(trimmed);
                continue;
            }
            const cols = parseCsvLine(trimmed);
            const info = parseRaceLabel(cols[0]);
            if (!info.raceNum) continue;
            const startAt = parseTimeOnDay(cols[1], dayDate);
            if (!startAt) continue;
            races.push({
                raceNum: info.raceNum,
                race: info.label,
                startAt,
                eventType: cols[3]?.trim() || '',
                round: cols[4]?.trim() || '',
                division: cols[5] ? cols[5].trim() : '',
                lanes: parseLanes(cols, headerCols),
            });
        }
        races.sort((a, b) => a.startAt - b.startAt);
        return races;
    }

    function parseResultsCsv(text) {
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
                if (!Number.isFinite(place) || !competitor) continue;
                placings.push({ place, competitor, time });
            }
            placings.sort((a, b) => a.place - b.place);
            map.set(raceNum, { status: cols[5]?.trim() || '', placings });
        }
        return map;
    }

    function lookupToken(map, key) {
        if (!map || !key) return key;
        const hit = map[String(key).toLowerCase()];
        return hit || key;
    }

    function expandEventName(eventType, lookup) {
        if (!lookup || !eventType) return eventType;
        const parts = eventType.trim().split(/\s+/);
        if (parts.length < 3) return eventType;
        const g = lookupToken(lookup.gender, parts[0]);
        const c = lookupToken(lookup.class, parts[1]);
        const b = lookupToken(lookup.boat, parts[2]);
        return `${g} ${c} ${b}`;
    }

    function parseClubCode(raw) {
        const m = String(raw || '').trim().match(/^([A-Za-z]+)(?:\s+(\d+))?$/);
        if (!m) return { id: '', crewNum: '' };
        return { id: m[1].toLowerCase(), crewNum: m[2] || '' };
    }

    function clubInfo(clubId, lookup) {
        if (!clubId || !lookup?.clubs) {
            return { name: clubId.toUpperCase(), logoUrl: null };
        }
        const c = lookup.clubs[clubId];
        if (!c) return { name: clubId.toUpperCase(), logoUrl: null };
        const logoUrl = c.logo
            ? `assets/school-logos/${encodeURIComponent(c.logo)}`
            : null;
        return { name: c.name, logoUrl };
    }

    function findRace(raceParam) {
        if (!state.races.length) return null;
        const p = String(raceParam || '').trim();
        if (!p) return state.races[0];
        const exact = state.races.find((r) => r.race === p);
        if (exact) return exact;
        const num = parseInt(p, 10);
        if (Number.isFinite(num)) {
            return state.races.find((r) => r.raceNum === num) || state.races[0];
        }
        return state.races[0];
    }

    function findPreviousRace() {
        const current = findRace(getRaceParam());
        if (!current || !state.races.length) return null;
        let idx = state.races.findIndex((r) => r.race === current.race);
        if (idx < 0) idx = state.races.findIndex((r) => r.raceNum === current.raceNum);
        if (idx > 0) return state.races[idx - 1];
        if (Number.isFinite(current.raceNum)) {
            let prev = null;
            for (const r of state.races) {
                if (r.raceNum < current.raceNum) prev = r;
                else break;
            }
            return prev;
        }
        return null;
    }

    function buildRaceContextFromRace(race) {
        if (!race) return null;
        const lanes = (race.lanes || [])
            .filter((entry) => entry.code)
            .sort((a, b) => a.lane - b.lane)
            .map((entry) => {
                const club = parseClubCode(entry.code);
                const info = clubInfo(club.id, state.lookup);
                return {
                    lane: entry.lane,
                    label: info.name,
                    shortLabel: club.id ? club.id.toUpperCase() : String(entry.code || '').trim(),
                    logoUrl: info.logoUrl,
                };
            });
        return {
            event: expandEventName(race.eventType, state.lookup),
            round: race.round || '',
            race: race.race,
            lanes,
        };
    }

    function buildRaceContext() {
        return buildRaceContextFromRace(findRace(getRaceParam()));
    }

    function getSelectedRaceSlot() {
        return state.raceSlots.find((s) => s.slot === state.selectedRaceSlot) || state.raceSlots[1] || state.raceSlots[0];
    }

    function resetRaceTracking(clearFinished = true) {
        state.prevBoatDistance = new Map();
        state.laneSplitCallouts = new Map();
        state.splitCalloutsKey = '';
        state.zoomCourseAnchor = null;
        state.zoomBoatYOffset = new Map();
        if (clearFinished) state.finishedBoats = new Map();
    }

    function trackingKey(slotId, idx) {
        return `${slotId}-${idx}`;
    }

    function timeAtDistance(timeline, dist) {
        if (!timeline?.length) return null;
        if (dist <= 0) return 0;
        if (timeline[0].distance >= dist) {
            const a = timeline[0];
            if (a.distance <= 0) return a.t;
            return a.t + (dist / a.distance) * (timeline[1]?.t ?? a.t);
        }
        for (let i = 1; i < timeline.length; i++) {
            const b = timeline[i];
            if (b.distance >= dist) {
                const a = timeline[i - 1];
                if (b.distance <= a.distance) return b.t;
                const f = (dist - a.distance) / (b.distance - a.distance);
                return a.t + f * (b.t - a.t);
            }
        }
        return timeline[timeline.length - 1].t;
    }

    function formatSplitTime(sec) {
        const s = Math.max(0, sec);
        const m = Math.floor(s / 60);
        const secs = s % 60;
        const tenths = Math.floor((secs % 1) * 10);
        const whole = Math.floor(secs);
        return `${m}:${String(whole).padStart(2, '0')}.${tenths}`;
    }

    function updateRaceTracking(slotId, rawStandings, tSec) {
        const isSelected = slotId === state.selectedRaceSlot;
        for (const entry of rawStandings) {
            const { boat, rawDistance, idx } = entry;
            const key = trackingKey(slotId, idx);
            const prevDist = state.prevBoatDistance.get(key);
            if (prevDist != null) {
                if (rawDistance >= COURSE_M && prevDist < COURSE_M) {
                    const finishTime = timeAtDistance(boat.timeline, COURSE_M);
                    if (finishTime != null) {
                        state.finishedBoats.set(key, { hideAfter: tSec + FINISH_HIDE_SEC });
                        if (isSelected) {
                            state.laneSplitCallouts.set(`${key}-finish`, {
                                lane: boat.lane || idx + 1,
                                text: formatSplitTime(finishTime),
                                until: tSec + SPLIT_HOLD_SEC,
                                kind: 'finish',
                                marker: COURSE_M,
                            });
                        }
                    }
                }
                if (isSelected) {
                    for (const m of SPLIT_MARKERS_M) {
                        if (prevDist < m && rawDistance >= m) {
                            const t0 = timeAtDistance(boat.timeline, m - 500);
                            const t1 = timeAtDistance(boat.timeline, m);
                            if (t0 != null && t1 != null) {
                                state.laneSplitCallouts.set(`${key}-${m}`, {
                                    lane: boat.lane || idx + 1,
                                    text: formatSplitTime(t1 - t0),
                                    until: tSec + SPLIT_HOLD_SEC,
                                    kind: 'split',
                                    marker: m,
                                });
                            }
                        }
                    }
                }
            }
            state.prevBoatDistance.set(key, rawDistance);
        }
    }

    function pruneLaneSplitCallouts(tSec) {
        for (const [k, v] of state.laneSplitCallouts) {
            if (tSec > v.until) state.laneSplitCallouts.delete(k);
        }
        if (state.laneSplitCallouts.size === 0 && state.splitCalloutsKey) {
            state.splitCalloutsKey = '';
            const el = $('krvZoomSplits');
            if (el) el.innerHTML = '';
        }
    }

    function applyFinishHold(slotId, entry, tSec, offsetM) {
        const { idx } = entry;
        const key = trackingKey(slotId, idx);
        const fin = state.finishedBoats.get(key);
        if (!fin) return entry;
        if (tSec <= fin.hideAfter) {
            return { ...entry, distance: COURSE_M + offsetM };
        }
        return { ...entry, hide: true };
    }

    function selectRaceSlot(slotId) {
        if (!state.raceSlots.some((s) => s.slot === slotId)) return;
        state.selectedRaceSlot = slotId;
        state.zoomCenter = null;
        state.zoomCourseAnchor = null;
        state.zoomBoatYOffset = new Map();
        state.laneSplitCallouts = new Map();
        state.splitCalloutsKey = '';
        const sel = getSelectedRaceSlot();
        state.raceContext = sel?.context ?? null;
        state.raceLabel = sel?.label ?? '';
        renderZoomRacePicker();
        renderLaneLabels();
        renderUpcoming();
        renderFrame(state.lastPlaybackSec);
    }

    function standingsForSlot(boats, tSec, offsetM) {
        const chart = global.KriVmixSpeedChart;
        if (!chart || !boats?.length) return [];
        return chart
            .liveStandings(boats, tSec)
            .map((entry) => ({
                ...entry,
                rawDistance: entry.distance,
                distance: entry.distance + offsetM,
            }));
    }

    function processSlotStandings(slotId, rawStandings, tSec, offsetM) {
        return rawStandings
            .map((entry) => applyFinishHold(slotId, entry, tSec, offsetM))
            .filter((entry) => !entry.hide);
    }

    function isRaceOnCourse(standings) {
        return standings.some((s) => s.distance >= 0 && s.distance <= COURSE_M);
    }

    function updateOnCourseRaceNums(tSec) {
        const nums = new Set();
        for (const slot of state.raceSlots) {
            const standings = standingsForSlot(slot.boats, tSec, slot.offsetM);
            if (isRaceOnCourse(standings)) nums.add(slot.raceNum);
        }
        state.onCourseRaceNums = nums;
    }

    function prepareRaceSlots(prepared, baseData) {
        const current = findRace(getRaceParam());
        let idx = current ? state.races.findIndex((r) => r.race === current.race) : 0;
        if (idx < 0 && current) {
            idx = state.races.findIndex((r) => r.raceNum === current.raceNum);
        }
        if (idx < 0) idx = 0;

        const fallback = current || state.races[idx] || null;
        const behindRace = state.races[idx > 0 ? idx - 1 : idx] || fallback;
        const aheadRace = state.races[idx + 1 < state.races.length ? idx + 1 : idx] || fallback;
        const raceBySlot = { behind: behindRace, current: fallback, ahead: aheadRace };

        state.raceSlots = [
            { slot: 'behind', offsetM: -RACE_STAGGER_M },
            { slot: 'current', offsetM: 0 },
            { slot: 'ahead', offsetM: RACE_STAGGER_M },
        ].map(({ slot, offsetM }) => {
            const daysheetRace = raceBySlot[slot];
            const ctx = buildRaceContextFromRace(daysheetRace);
            const applied = applyRaceContextToState(prepared, ctx);
            return {
                slot,
                offsetM,
                raceNum: daysheetRace?.raceNum ?? null,
                raceId: daysheetRace?.race ?? null,
                label: raceTitleLine(ctx, baseData),
                context: ctx,
                boats: applied.boats,
            };
        });

        if (!state.raceSlots.some((s) => s.slot === state.selectedRaceSlot)) {
            state.selectedRaceSlot = 'current';
        }
        const sel = getSelectedRaceSlot();
        state.raceContext = sel?.context ?? null;
        state.raceLabel = sel?.label ?? '';
    }

    function getUpcoming(count = 5) {
        const races = state.races;
        if (!races.length) return [];
        const current = findRace(getRaceParam());
        let startIdx = 0;
        if (current) {
            startIdx = races.findIndex((r) => r.race === current.race);
            if (startIdx < 0) startIdx = races.findIndex((r) => r.raceNum === current.raceNum);
            if (startIdx < 0) startIdx = 0;
        }
        return races.slice(startIdx, startIdx + count);
    }

    function formatScheduleTime(d) {
        return d
            .toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            })
            .toLowerCase();
    }

    function raceTitleLine(ctx, data) {
        const event = ctx?.event || data?.event || 'Race';
        const race = ctx?.race || data?.race;
        const round = ctx?.round || data?.round;
        const bits = [event, race ? `Race ${race}` : '', round].filter(Boolean);
        return bits.join(' · ');
    }

    function clusterBounds(standings) {
        if (!standings.length) {
            return { minD: 0, maxD: 400, leaderD: 0 };
        }
        const dists = standings.map((s) => s.distance);
        const minD = Math.max(0, Math.min(...dists) - CLUSTER_PAD_M);
        const maxD = Math.min(COURSE_M, Math.max(...dists) + CLUSTER_PAD_M);
        return { minD, maxD, leaderD: dists[0] };
    }

    function zoomWindowTarget(standings) {
        const span = ZOOM_SPAN_M;

        if (!standings.length) {
            return { center: 0 };
        }

        const dists = standings.map((s) => s.distance);
        const packMin = Math.min(...dists);
        const packMax = Math.max(...dists);
        return { center: (packMin + packMax) / 2 };
    }

    function clampZoomWindow(center) {
        const span = ZOOM_SPAN_M;
        let minD = center - span / 2;
        let maxD = center + span / 2;

        if (minD < COURSE_VIEW_MIN_M) {
            const shift = COURSE_VIEW_MIN_M - minD;
            minD += shift;
            maxD += shift;
            center = (minD + maxD) / 2;
        }
        if (maxD > COURSE_VIEW_MAX_M) {
            const shift = maxD - COURSE_VIEW_MAX_M;
            minD -= shift;
            maxD -= shift;
            center = (minD + maxD) / 2;
        }

        return { minD, maxD, center };
    }

    function frameAlpha(rate, dtSec) {
        return 1 - Math.pow(1 - rate, Math.max(1, dtSec * 60));
    }

    function smoothZoomWindow(target, dtSec) {
        const snap = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (state.zoomCenter == null || snap) {
            state.zoomCenter = target.center;
        } else {
            state.zoomCenter += (target.center - state.zoomCenter) * frameAlpha(ZOOM_CENTER_SMOOTH, dtSec);
        }
        return clampZoomWindow(state.zoomCenter);
    }

    function smoothBoatYOffset(idx, targetPx, dtSec) {
        const prev = state.zoomBoatYOffset.get(idx);
        if (prev == null || global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            state.zoomBoatYOffset.set(idx, targetPx);
            return targetPx;
        }
        const next = prev + (targetPx - prev) * frameAlpha(ZOOM_BOAT_Y_SMOOTH, dtSec);
        state.zoomBoatYOffset.set(idx, next);
        return next;
    }

    function zoomWindow(standings, dtSec = 1 / 60) {
        return smoothZoomWindow(zoomWindowTarget(standings), dtSec);
    }

    function xCourse(distanceM, padL, chartW) {
        return padL + (distanceM / COURSE_M) * chartW;
    }

    function svgDefs(scope = 'main') {
        const p = (name) => `${name}-${scope}`;
        return (
            '<defs>' +
            `<radialGradient id="${p('krvBuoyGrad')}" cx="35%" cy="30%" r="65%">` +
            '<stop offset="0%" stop-color="#fed7aa"/>' +
            '<stop offset="100%" stop-color="#ea580c"/>' +
            '</radialGradient>' +
            `<radialGradient id="${p('krvBuoyGradYellow')}" cx="35%" cy="30%" r="65%">` +
            '<stop offset="0%" stop-color="#fef08a"/>' +
            '<stop offset="100%" stop-color="#eab308"/>' +
            '</radialGradient>' +
            `<filter id="${p('krvCourseShadow')}" x="-4%" y="-8%" width="108%" height="120%">` +
            '<feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0c4a6e" flood-opacity="0.28"/>' +
            '</filter>' +
            `<pattern id="${p('krvChecker')}" width="10" height="10" patternUnits="userSpaceOnUse">` +
            '<rect width="5" height="5" fill="#1e40af"/>' +
            '<rect x="5" y="0" width="5" height="5" fill="#ffffff"/>' +
            '<rect x="0" y="5" width="5" height="5" fill="#ffffff"/>' +
            '<rect x="5" y="5" width="5" height="5" fill="#1e40af"/>' +
            '</pattern>' +
            '</defs>'
        );
    }

    function courseFrameHtml(padL, padT, chartW, chartH, scope, rx = 6, frameCls = '') {
        const shadow = `krvCourseShadow-${scope}`;
        return (
            `<rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" class="krv-course-frame ${frameCls}" rx="${rx}" fill="none" filter="url(#${shadow})"/>`
        );
    }

    function roundRectPath(ctx, x, y, w, h, r) {
        const rad = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.lineTo(x + w - rad, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
        ctx.lineTo(x + w, y + h - rad);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
        ctx.lineTo(x + rad, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
        ctx.lineTo(x, y + rad);
        ctx.quadraticCurveTo(x, y, x + rad, y);
        ctx.closePath();
    }

    function coursePixelRect(layout, pw, ph) {
        const { padL, padT, chartW, chartH, w, h, rx = 6 } = layout;
        const sx = pw / w;
        const sy = ph / h;
        return {
            x: padL * sx,
            y: padT * sy,
            w: chartW * sx,
            h: chartH * sy,
            r: rx * Math.min(sx, sy),
        };
    }

    function drawLakeWater(ctx, pw, ph, layout, timeSec, lite = false) {
        const { x, y, w, h, r } = coursePixelRect(layout, pw, ph);
        if (w < 2 || h < 2) return;

        ctx.save();
        roundRectPath(ctx, x, y, w, h, r);
        ctx.clip();

        const depth = ctx.createLinearGradient(0, y, 0, y + h);
        depth.addColorStop(0, '#7ec8ea');
        depth.addColorStop(0.18, '#55aed8');
        depth.addColorStop(0.45, '#3d94c4');
        depth.addColorStop(0.72, '#2a7aab');
        depth.addColorStop(1, '#1a5580');
        ctx.fillStyle = depth;
        ctx.fillRect(x, y, w, h);

        if (lite) {
            ctx.restore();
            return;
        }

        const sunGlare = ctx.createLinearGradient(x, y, x + w * 0.35, y + h * 0.25);
        sunGlare.addColorStop(0, 'rgba(255,255,255,0.22)');
        sunGlare.addColorStop(0.45, 'rgba(200,235,255,0.08)');
        sunGlare.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sunGlare;
        ctx.fillRect(x, y, w, h);

        // Vertical ripples travelling right → left (across the course)
        const colCount = Math.max(8, Math.floor(w / 14));
        for (let i = 0; i < colCount; i++) {
            const col = (i + 0.5) / colCount;
            const xMid = x + w * col;
            ctx.beginPath();
            for (let py = 0; py <= h; py += 3) {
                const wy = y + py;
                const wave =
                    Math.sin(py * 0.024 - timeSec * 1.2 + i * 0.58) * 2.6 +
                    Math.sin(py * 0.01 + timeSec * 0.68 + i * 1.02) * 3.6 +
                    Math.cos(py * 0.006 - timeSec * 0.42) * 1.5;
                const wx = xMid + wave;
                if (py === 0) ctx.moveTo(wx, wy);
                else ctx.lineTo(wx, wy);
            }
            ctx.strokeStyle = `rgba(255,255,255,${0.035 + (i % 3) * 0.012})`;
            ctx.lineWidth = 1.1;
            ctx.stroke();
        }

        for (let i = 0; i < colCount; i++) {
            const col = (i + 0.35) / colCount;
            const xMid = x + w * col;
            ctx.beginPath();
            for (let py = 0; py <= h; py += 4) {
                const wy = y + py;
                const wave =
                    Math.sin(py * 0.017 + timeSec * 0.88 + i * 0.75) * 2.6 +
                    Math.sin(py * 0.008 - timeSec * 0.5 + i * 0.38) * 2.0;
                const wx = xMid + wave;
                if (py === 0) ctx.moveTo(wx, wy);
                else ctx.lineTo(wx, wy);
            }
            ctx.strokeStyle = 'rgba(8, 47, 73, 0.04)';
            ctx.lineWidth = 1.3;
            ctx.stroke();
        }

        for (let b = 0; b < 5; b++) {
            const drift = (timeSec * 22 + b * (w / 5)) % (w + 80);
            const bandX = x + w - drift;
            const spec = ctx.createLinearGradient(bandX - 24, y, bandX + 24, y);
            spec.addColorStop(0, 'rgba(255,255,255,0)');
            spec.addColorStop(0.45, 'rgba(186,230,253,0.1)');
            spec.addColorStop(0.5, 'rgba(255,255,255,0.14)');
            spec.addColorStop(0.55, 'rgba(186,230,253,0.08)');
            spec.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = spec;
            ctx.fillRect(bandX - 24, y, 48, h);
        }

        const sparkleCount = Math.floor((w * h) / 9000);
        for (let s = 0; s < sparkleCount; s++) {
            const seed = s * 17.17 + Math.floor(timeSec * 3);
            const drift = (timeSec * 18 + seed * 0.7) % w;
            const sx = x + w - drift;
            const sy = y + (((seed + 41) * 59) % 1000) / 1000 * h;
            const pulse = 0.35 + 0.65 * Math.sin(timeSec * 2.4 + seed);
            if (pulse < 0.55) continue;
            ctx.fillStyle = `rgba(255,255,255,${0.08 * pulse})`;
            ctx.beginPath();
            ctx.ellipse(sx, sy, 2.2 * pulse, 0.9 * pulse, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    function syncWaterCanvas(canvas, layout) {
        if (!canvas || !layout) return;
        const stack = canvas.parentElement;
        if (!stack) return;
        const rect = stack.getBoundingClientRect();
        const dpr = canvasDpr();
        const pw = Math.max(1, Math.floor(rect.width * dpr));
        const ph = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== pw || canvas.height !== ph) {
            canvas.width = pw;
            canvas.height = ph;
        }
        canvas.dataset.waterLayout = JSON.stringify(layout);
    }

    function paintWaterCanvas(canvas, timeSec, lite = false) {
        if (!canvas) return;
        const layout = JSON.parse(canvas.dataset.waterLayout || 'null');
        if (!layout) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawLakeWater(ctx, canvas.width, canvas.height, layout, timeSec, lite);
    }

    function paintWaterFrame(ts) {
        const lite = useLiteGraphics();
        if (lite) {
            state.waterLiteFrame += 1;
            if (state.waterLiteFrame % 2 !== 0) return;
        }
        const timeSec = ts / 1000;
        const zoomLayout = getZoomLayout();
        syncWaterCanvas($('krvZoomWater'), zoomLayout);
        paintWaterCanvas($('krvZoomWater'), timeSec, lite);
    }

    function scheduleWaterAnimation() {
        /* Water is painted from the main playback loop. */
    }

    function startWaterAnimation() {
        /* No-op: single RAF drives playback + water. */
    }

    function checkerFill(scope) {
        return `url(#krvChecker-${scope})`;
    }

    function cartoonBoatPaths(fill) {
        const hull = fill || '#38bdf8';
        return (
            `<ellipse cx="7" cy="12" rx="5.5" ry="2.4" fill="rgba(255,255,255,0.42)"/>` +
            `<path d="M11 12c0-5.5 15-6.5 29 0-14 6.5-29 5.5-29 0z" fill="${hull}" stroke="#0c4a6e" stroke-width="1.1"/>` +
            `<path d="M15 12c0-3.2 10.5-3.8 23 0-11 3.8-23 3.2-23 0z" fill="rgba(255,255,255,0.32)"/>` +
            `<line x1="23" y1="5.2" x2="35" y2="3.4" stroke="#334155" stroke-width="1.35" stroke-linecap="round"/>` +
            `<line x1="23" y1="18.8" x2="35" y2="20.6" stroke="#334155" stroke-width="1.35" stroke-linecap="round"/>` +
            `<circle cx="23" cy="12" r="2.1" fill="#1e293b"/>`
        );
    }

    function boatShapeHtml(color) {
        return (
            `<g class="krv-boat-shape" transform="scale(0.72) translate(-24,-12)">` +
            cartoonBoatPaths(color) +
            `</g>`
        );
    }

    function displayName(boat) {
        return boat.label || boat.shortLabel || 'Crew';
    }

    function xMap(distanceM, minD, maxD, width, padLeft, padRight) {
        const chartW = width - padLeft - padRight;
        const t = (distanceM - minD) / Math.max(1, maxD - minD);
        return padLeft + Math.max(0, Math.min(1, t)) * chartW;
    }

    function zoneRectsHtml() {
        return '';
    }

    function zoneRectsForWindow() {
        return '';
    }

    function buoyFill(d, scope) {
        if (d <= ZONE_START_M || d >= COURSE_M - ZONE_FINISH_M) {
            return `url(#krvBuoyGradYellow-${scope})`;
        }
        return `url(#krvBuoyGrad-${scope})`;
    }

    function buoysHtml(h, padL, padT, padB, chartW, minD = 0, maxD = COURSE_M, padR = 0, totalW = null, scope = 'overview', buoySpacing = BUOY_SPACING_M) {
        const parts = [];
        const w = totalW ?? padL + chartW + padR;
        for (let lane = 1; lane <= LANE_COUNT; lane++) {
            const y = yMapBuoyLine(lane, h, padT, padB);
            for (let d = buoySpacing; d < COURSE_M; d += buoySpacing) {
                if (d < minD || d > maxD) continue;
                const x =
                    maxD > minD && maxD < COURSE_M
                        ? xMap(d, minD, maxD, w, padL, padR)
                        : xCourse(d, padL, chartW);
                parts.push(
                    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${scope === 'overview' ? BUOY_R_OVERVIEW : BUOY_R_ZOOM}" class="krv-buoy" fill="${buoyFill(d, scope)}"/>`,
                );
            }
        }
        return parts.join('');
    }

    function startFinishHtml(padL, padT, chartH, chartW, padR = 0, minD = 0, maxD = COURSE_M, scope = 'overview') {
        const w = padL + chartW + padR;
        const showStart = minD <= 0 && maxD >= 0;
        const showFinish = minD <= COURSE_M && maxD >= COURSE_M;
        const parts = [];
        if (showStart) {
            const xStart = xMap(0, minD, maxD, w, padL, padR);
            parts.push(
                `<line x1="${xStart}" y1="${padT}" x2="${xStart}" y2="${padT + chartH}" class="krv-line-start"/>`,
                `<text x="${xStart + 6}" y="${padT + 16}" class="krv-line-label krv-line-label--start">Start</text>`,
            );
        }
        if (showFinish) {
            const xFinish = xMap(COURSE_M, minD, maxD, w, padL, padR);
            parts.push(
                `<rect x="${xFinish - 6}" y="${padT}" width="12" height="${chartH}" fill="${checkerFill(scope)}" class="krv-finish-banner"/>`,
                `<line x1="${xFinish}" y1="${padT}" x2="${xFinish}" y2="${padT + chartH}" class="krv-line-finish"/>`,
                `<text x="${xFinish - 8}" y="${padT + 16}" class="krv-line-label krv-line-label--finish" text-anchor="end">Finish</text>`,
            );
        }
        return parts.join('');
    }

    function applyRaceContextToState(prepared, raceContext) {
        if (!raceContext?.lanes?.length) return prepared;
        const sortedLanes = [...raceContext.lanes].sort((a, b) => a.lane - b.lane);
        const boats = prepared.boats.map((boat, idx) => {
            const laneCtx = sortedLanes[idx];
            if (!laneCtx) return { ...boat, lane: boat.lane ?? idx + 1 };
            return {
                ...boat,
                lane: laneCtx.lane,
                label: laneCtx.label,
                logoUrl: laneCtx.logoUrl,
                shortLabel: laneCtx.shortLabel,
            };
        });
        const data = {
            ...prepared.data,
            event: raceContext.event || prepared.data.event,
            round: raceContext.round ?? prepared.data.round,
            race: raceContext.race ?? prepared.data.race,
        };
        return { ...prepared, data, boats };
    }

    function computeLaneBands(height, padTop, padBottom) {
        const chartH = height - padTop - padBottom;
        const laneH = chartH / LANE_COUNT;
        const tops = [padTop];
        for (let i = 0; i < LANE_COUNT; i++) {
            tops.push(padTop + (i + 1) * laneH);
        }
        const centers = tops.slice(0, -1).map((top) => top + laneH / 2);
        return { tops, centers, heights: Array(LANE_COUNT).fill(laneH) };
    }

    function yMapLane(lane, height, padTop, padBottom) {
        const { centers } = computeLaneBands(height, padTop, padBottom);
        return centers[lane - 1];
    }

    function yMapBuoyLine(lane, height, padTop, padBottom) {
        const { tops } = computeLaneBands(height, padTop, padBottom);
        return tops[lane - 1];
    }

    function laneDividerYs(height, padTop, padBottom) {
        const { tops } = computeLaneBands(height, padTop, padBottom);
        return tops.slice(1, LANE_COUNT);
    }

    function crewByLane() {
        const map = new Map();
        const lanes = state.raceContext?.lanes;
        if (!lanes?.length) return map;
        for (const entry of lanes) map.set(entry.lane, entry);
        return map;
    }

    function laneLabelsSvgHtml(h, padL, padT, padB, zoom = false) {
        const parts = [];
        const headCls = zoom ? 'krv-lane-head krv-lane-head--zoom' : 'krv-lane-head';
        const laneCls = zoom ? 'krv-lane-label krv-lane-label--zoom' : 'krv-lane-label';
        const { heights } = computeLaneBands(h, padT, padB);
        const laneH = heights[0];
        const r = Math.min(laneH * 0.38, zoom ? 16 : 13);
        const boxCx = padL - r - 16;
        parts.push(
            `<text x="${boxCx.toFixed(1)}" y="${padT - 6}" class="${headCls}" text-anchor="middle">Lane</text>`,
        );
        for (let lane = 1; lane <= LANE_COUNT; lane++) {
            const y = yMapLane(lane, h, padT, padB);
            parts.push(
                `<circle cx="${boxCx.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" class="krv-lane-info-box"/>`,
            );
            parts.push(
                `<text x="${boxCx.toFixed(1)}" y="${(y + 4).toFixed(1)}" class="${laneCls}" text-anchor="middle">${lane}</text>`,
            );
        }
        return parts.join('');
    }

    function renderLaneLabels() {
        const overviewG = $('krvOverviewSvg')?.querySelector('#krvOverviewLaneLabels');
        const zoomG = $('krvZoomSvg')?.querySelector('#krvZoomLaneLabels');
        if (overviewG) {
            const layout = JSON.parse($('krvOverviewSvg').dataset.layout || '{}');
            overviewG.innerHTML = laneLabelsSvgHtml(
                layout.h,
                layout.padL,
                layout.padT,
                layout.padB,
                false,
            );
        }
        if (zoomG) {
            const layout = JSON.parse($('krvZoomSvg').dataset.layout || '{}');
            zoomG.innerHTML = laneLabelsSvgHtml(
                layout.h,
                layout.padL,
                layout.padT,
                layout.padB,
                true,
            );
        }
    }

    function renderOverviewStatic() {
        const svg = $('krvOverviewSvg');
        if (!svg) return;
        const w = 1800;
        const h = 220;
        const padL = 120;
        const padR = 48;
        const padT = 28;
        const padB = 24;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        const buoySpacing = effectiveBuoySpacing();
        const parts = [
            svgDefs('overview'),
            courseFrameHtml(padL, padT, chartW, chartH, 'overview', 8, 'krv-course-frame--overview'),
            zoneRectsHtml(padL, padT, chartW, chartH),
            buoysHtml(h, padL, padT, padB, chartW, 0, COURSE_M, padR, null, 'overview', buoySpacing),
            startFinishHtml(padL, padT, chartH, chartW, padR, 0, COURSE_M, 'overview'),
        ];

        for (const y of laneDividerYs(h, padT, padB)) {
            parts.push(
                `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + chartW}" y2="${y.toFixed(1)}" class="krv-lane-line"/>`,
            );
        }

        parts.push('<g id="krvOverviewLaneLabels"></g>');

        for (const dist of MARKERS_M) {
            const x = padL + (dist / COURSE_M) * chartW;
            parts.push(`<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + chartH}" class="krv-marker-line"/>`);
            if (dist > 0 && dist < COURSE_M) {
                parts.push(
                    `<text x="${x}" y="${padT - 8}" class="krv-marker-label" text-anchor="middle">${dist}m</text>`,
                );
            }
        }

        parts.push('<g id="krvOverviewCluster"></g>');
        parts.push('<g id="krvOverviewBoats"></g>');

        svg.innerHTML = parts.join('');
        state.overviewLayout = enrichLayout({
            w, h, padL, padR, padT, padB, chartW, chartH, rx: 8,
        });
        svg.dataset.layout = JSON.stringify(state.overviewLayout);
    }

    function renderZoomStatic() {
        const svg = $('krvZoomSvg');
        if (!svg) return;
        const w = 1200;
        const h = 520;
        const padL = 132;
        const padR = 40;
        const padT = 36;
        const padB = 36;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        const parts = [
            svgDefs('zoom'),
            courseFrameHtml(padL, padT, chartW, chartH, 'zoom', 12, 'krv-course-frame--zoom'),
        ];

        for (const y of laneDividerYs(h, padT, padB)) {
            parts.push(
                `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" class="krv-lane-line krv-lane-line--zoom"/>`,
            );
        }

        parts.push('<g id="krvZoomLaneLabels"></g>');
        parts.push('<g id="krvZoomCourse"></g>');
        svg.innerHTML = parts.join('');
        state.zoomLayout = enrichLayout({
            w, h, padL, padR, padT, padB, chartW, chartH, rx: 12,
        });
        svg.dataset.layout = JSON.stringify(state.zoomLayout);
        syncWaterCanvas($('krvZoomWater'), state.zoomLayout);
    }

    function updateRaceTitles(slotStandings) {
        const zoomEl = $('krvZoomRaceTitle');
        const labelsEl = $('krvOverviewRaceLabels');
        const sel = getSelectedRaceSlot();

        if (zoomEl) {
            if (sel?.label) {
                zoomEl.hidden = false;
                zoomEl.textContent = sel.label;
            } else {
                zoomEl.hidden = true;
            }
        }

        if (!labelsEl || !state.raceSlots.length) return;

        const layout = getOverviewLayout();
        if (!layout) {
            labelsEl.innerHTML = '';
            return;
        }
        const { w, h, padL, padR, padT } = layout;

        const titleBits = state.raceSlots
            .map((slot) => {
                const standings = slotStandings?.find((s) => s.slot === slot.slot)?.standings ?? [];
                if (!standings.length) return '';
                const dists = standings.map((s) => s.distance);
                const followD = (Math.min(...dists) + Math.max(...dists)) / 2;
                return `${slot.slot}:${Math.round(followD / TITLE_FOLLOW_SNAP_M)}`;
            })
            .join('|');
        const titleKey = `${titleBits}|${state.selectedRaceSlot}`;
        if (titleKey === state.titleFollowKey && labelsEl.childElementCount > 0) return;
        state.titleFollowKey = titleKey;

        const chartW = w - padL - padR;
        const dockTop = useLiteGraphics();
        labelsEl.innerHTML = state.raceSlots
            .map((slot) => {
                const standings = slotStandings?.find((s) => s.slot === slot.slot)?.standings ?? [];
                if (!slot.label || !standings.length) return '';
                const dists = standings.map((s) => s.distance);
                const followD = (Math.min(...dists) + Math.max(...dists)) / 2;
                const x = padL + (followD / COURSE_M) * chartW;
                const xPct = (x / w) * 100;
                const active = slot.slot === state.selectedRaceSlot;
                const onCourse = state.onCourseRaceNums.has(slot.raceNum);
                const topPct = dockTop ? null : (((padT - 6) / h) * 100).toFixed(3);
                const style = dockTop
                    ? `left:${xPct.toFixed(3)}%`
                    : `left:${xPct.toFixed(3)}%;top:${topPct}%`;
                return (
                    `<button type="button" class="krv-overview__race-label${dockTop ? ' krv-overview__race-label--dock-top' : ''}${active ? ' krv-overview__race-label--active' : ''}${onCourse ? ' krv-overview__race-label--on-course' : ''}" data-slot="${slot.slot}" style="${style}">` +
                    `${escapeHtml(slot.label)}` +
                    `</button>`
                );
            })
            .join('');
    }

    function layoutZoomBoats(standings, layout, minD, maxD) {
        const { w, h, padL, padR, padT, padB } = layout;
        const mobile = useLiteGraphics();
        const laneH = layout.laneHeights?.[0] ?? (h - padT - padB) / LANE_COUNT;
        const minSep = mobile ? Math.max(58, laneH * 0.98) : Math.max(44, laneH * 0.82);

        const items = standings.map((entry, rank) => {
            const lane = entry.boat.lane || entry.idx + 1;
            const xPx = xMap(entry.distance, minD, maxD, w, padL, padR);
            const yPx = yMapLaneCached(lane, layout);
            return { entry, rank, lane, xPx, yPx, yOffset: 0 };
        });

        const xSpread =
            items.length > 1
                ? Math.max(...items.map((i) => i.xPx)) - Math.min(...items.map((i) => i.xPx))
                : 999;
        const xThreshold = mobile ? 90 : 130;
        if (!mobile && xSpread <= xThreshold) {
            for (let i = 0; i < items.length; i++) {
                for (let j = i + 1; j < items.length; j++) {
                    const a = items[i];
                    const b = items[j];
                    if (Math.abs(a.xPx - b.xPx) > xThreshold) continue;
                    const yA = a.yPx + a.yOffset;
                    const yB = b.yPx + b.yOffset;
                    const gap = Math.abs(yA - yB);
                    if (gap >= minSep) continue;
                    const push = (minSep - gap) / 2 + 1;
                    if (yA <= yB) {
                        a.yOffset -= push;
                        b.yOffset += push;
                    } else {
                        a.yOffset += push;
                        b.yOffset -= push;
                    }
                }
            }
        }

        const maxOffset = laneH * 0.42;
        for (const item of items) {
            item.yOffset = Math.max(-maxOffset, Math.min(maxOffset, item.yOffset));
        }

        return items.map((item) => ({
            ...item,
            xPct: ((item.xPx / w) * 100).toFixed(2),
            yOffsetPx: item.yOffset,
        }));
    }

    function createZoomBoatNode() {
        const el = document.createElement('div');
        el.className = 'krv-zoom-boat';
        el.innerHTML =
            `<div class="krv-zoom-boat__info">` +
            `<div class="krv-zoom-boat__info-head">` +
            `<span class="krv-zoom-boat__rank"></span>` +
            `<span class="krv-zoom-boat__label"></span>` +
            `</div>` +
            `<div class="krv-zoom-boat__stats">` +
            `<span class="krv-zoom-boat__speed"></span>` +
            `<span class="krv-zoom-boat__gap"></span>` +
            `</div>` +
            `</div>` +
            `<div class="krv-zoom-boat__hull">` +
            `<svg class="krv-cartoon-boat" viewBox="0 0 48 24" width="92" height="46" aria-hidden="true"></svg>` +
            `<img class="krv-zoom-boat__logo-badge" alt="" loading="lazy" decoding="async">` +
            `</div>`;
        return {
            el,
            svg: el.querySelector('.krv-cartoon-boat'),
            img: el.querySelector('.krv-zoom-boat__logo-badge'),
            rank: el.querySelector('.krv-zoom-boat__rank'),
            label: el.querySelector('.krv-zoom-boat__label'),
            speed: el.querySelector('.krv-zoom-boat__speed'),
            gap: el.querySelector('.krv-zoom-boat__gap'),
            logoUrl: null,
            hullColor: null,
        };
    }

    function buildZoomCourseHtml(layout, minD, maxD) {
        const { w, h, padL, padR, padT, padB, chartW, chartH } = layout;
        const buoySpacing = effectiveBuoySpacing();
        const courseParts = [
            zoneRectsForWindow(padL, padT, chartW, chartH, padR, w, minD, maxD),
            buoysHtml(h, padL, padT, padB, chartW, minD, maxD, padR, w, 'zoom', buoySpacing),
            startFinishHtml(padL, padT, chartH, chartW, padR, minD, maxD, 'zoom'),
        ];
        for (const dist of MARKERS_M) {
            if (dist < minD || dist > maxD) continue;
            const x = xMap(dist, minD, maxD, w, padL, padR);
            courseParts.push(
                `<line x1="${x}" y1="${padT}" x2="${x}" y2="${h - padB}" class="krv-marker-line krv-marker-line--zoom"/>`,
            );
            if (dist > 0 && dist < COURSE_M) {
                courseParts.push(
                    `<text x="${x}" y="${padT - 10}" class="krv-marker-label krv-marker-label--zoom" text-anchor="middle">${dist}m</text>`,
                );
            }
        }
        return courseParts.join('');
    }

    function updateZoomBoatsPooled(standings, layout, minD, maxD, toGo, dtSec) {
        const boatsEl = $('krvZoomBoats');
        if (!boatsEl) return;
        const items = layoutZoomBoats(standings, layout, minD, maxD);
        const { h } = layout;
        const leaderD = standings[0]?.distance ?? 0;
        const mobile = useLiteGraphics();
        const hullHalf = mobile ? 36 : 46;

        while (state.zoomBoatPool.length < items.length) {
            const node = createZoomBoatNode();
            boatsEl.appendChild(node.el);
            state.zoomBoatPool.push(node);
        }

        const activeIdx = new Set();
        for (let i = 0; i < items.length; i++) {
            const node = state.zoomBoatPool[i];
            const { entry, rank, xPct, yPx, yOffsetPx } = items[i];
            activeIdx.add(entry.idx);
            const smoothY = smoothBoatYOffset(entry.idx, yOffsetPx, dtSec);
            const yPct = (((yPx + smoothY) / h) * 100).toFixed(2);
            const { boat, distance, speed } = entry;
            node.el.hidden = false;
            node.el.dataset.rank = String(rank + 1);
            node.el.style.setProperty('--hull-half', `${hullHalf}px`);
            node.el.style.left = `${xPct}%`;
            node.el.style.top = `${yPct}%`;
            node.el.style.transform = `translate(calc(-1 * var(--hull-half)), -50%)`;
            node.el.style.zIndex = String(20 - rank);

            const logo = boat.logoUrl || LOGO_PLACEHOLDER;
            if (node.logoUrl !== logo) {
                node.img.src = logo;
                node.logoUrl = logo;
            }
            const hullColor = boat.color || '#38bdf8';
            if (node.hullColor !== hullColor) {
                node.svg.innerHTML = cartoonBoatPaths(hullColor);
                node.hullColor = hullColor;
            }
            node.rank.textContent = String(rank + 1);
            node.label.textContent = mobile
                ? (boat.shortLabel || displayName(boat))
                : displayName(boat);
            node.speed.textContent = mobile
                ? `${speed.toFixed(1)}`
                : `${speed.toFixed(1)} m/s`;
            node.gap.textContent =
                rank === 0
                    ? mobile
                        ? `${toGo}m`
                        : `${toGo} m to go`
                    : `+${Math.max(0, Math.round(leaderD - distance))}m`;
        }

        for (let i = items.length; i < state.zoomBoatPool.length; i++) {
            state.zoomBoatPool[i].el.hidden = true;
        }
        for (const idx of state.zoomBoatYOffset.keys()) {
            if (!activeIdx.has(idx)) state.zoomBoatYOffset.delete(idx);
        }
    }

    function renderZoomRacePicker() {
        const el = $('krvZoomRacePicker');
        if (!el) return;
        if (!state.raceSlots.length) {
            el.innerHTML = '';
            el.hidden = true;
            return;
        }
        el.hidden = false;
        el.innerHTML = state.raceSlots
            .map((slot) => {
                const active = slot.slot === state.selectedRaceSlot;
                const onCourse = state.onCourseRaceNums.has(slot.raceNum);
                const short = slot.label.split(' · ').slice(-2).join(' · ') || slot.label;
                return (
                    `<button type="button" role="tab" aria-selected="${active}" class="krv-zoom__race-tab${active ? ' krv-zoom__race-tab--active' : ''}${onCourse ? ' krv-zoom__race-tab--on-course' : ''}" data-slot="${slot.slot}">` +
                    `${escapeHtml(short)}` +
                    `</button>`
                );
            })
            .join('');
    }

    function updateOverviewBoats(slotStandings) {
        const svg = $('krvOverviewSvg');
        const clusterG = svg?.querySelector('#krvOverviewCluster');
        const boatsG = svg?.querySelector('#krvOverviewBoats');
        if (!svg || !clusterG || !boatsG) return;

        const layout = getOverviewLayout();
        if (!layout) return;
        const { w, h, padL, padR, padT, padB } = layout;
        const chartW = w - padL - padR;
        const selected = state.selectedRaceSlot;

        const clusterKey = slotStandings
            .map(({ slot, standings }) => {
                if (!standings.length) return `${slot}:none`;
                const dists = standings.map((s) => s.distance);
                const minD = Math.min(...dists);
                const maxD = Math.max(...dists);
                return `${slot}:${Math.round(minD / 8)}-${Math.round(maxD / 8)}:${slot === selected ? 1 : 0}`;
            })
            .join('|');
        if (clusterKey !== state.clusterKeys) {
            state.clusterKeys = clusterKey;
            clusterG.innerHTML = slotStandings
                .map(({ slot, standings }) => {
                    if (!standings.length) return '';
                    const dists = standings.map((s) => s.distance);
                    const minD = Math.min(...dists);
                    const maxD = Math.max(...dists);
                    const a = Math.max(0, minD);
                    const b = Math.min(COURSE_M, maxD);
                    if (b <= a) return '';
                    const x0 = padL + (a / COURSE_M) * chartW;
                    const x1 = padL + (b / COURSE_M) * chartW;
                    const active = slot === selected;
                    return (
                        `<rect x="${x0.toFixed(1)}" y="${padT}" width="${Math.max(8, x1 - x0).toFixed(1)}" height="${h - padT - padB}" class="krv-cluster-box krv-cluster-box--${slot}${active ? ' krv-cluster-box--active' : ''}" rx="8"/>`
                    );
                })
                .join('');
        }

        updateRaceTitles(slotStandings);

        const activeKeys = new Set();
        for (const { slot, standings } of slotStandings) {
            for (const { boat, distance, idx } of standings) {
                if (distance < -80 || distance > COURSE_M + 80) continue;
                const key = `${slot}-${idx}`;
                activeKeys.add(key);
                const lane = boat.lane || idx + 1;
                const x = padL + (distance / COURSE_M) * chartW;
                const y = yMapLaneCached(lane, layout);
                const dim = slot !== selected ? ' krv-boat--overview-dim' : '';
                const cls = `krv-boat krv-boat--overview krv-boat--${slot}${dim}`;
                let node = state.overviewBoatNodes.get(key);
                if (!node) {
                    const g = document.createElementNS(SVG_NS, 'g');
                    const shape = document.createElementNS(SVG_NS, 'g');
                    shape.setAttribute('class', 'krv-boat-shape');
                    shape.setAttribute('transform', 'scale(0.72) translate(-24,-12)');
                    shape.innerHTML = cartoonBoatPaths(boat.color);
                    g.appendChild(shape);
                    boatsG.appendChild(g);
                    node = { g, shape, color: boat.color };
                    state.overviewBoatNodes.set(key, node);
                } else if (node.color !== boat.color) {
                    node.shape.innerHTML = cartoonBoatPaths(boat.color);
                    node.color = boat.color;
                }
                node.g.setAttribute('class', cls);
                node.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
            }
        }
        for (const [key, node] of state.overviewBoatNodes) {
            if (!activeKeys.has(key)) {
                node.g.remove();
                state.overviewBoatNodes.delete(key);
            }
        }
    }

    function updateZoomView(standings, dtSec = 1 / 60) {
        const svg = $('krvZoomSvg');
        const courseG = svg?.querySelector('#krvZoomCourse');
        if (!svg || !courseG) return;

        const layout = getZoomLayout();
        if (!layout) return;
        const { w, padL, padR, padT, padB } = layout;
        const { minD, maxD } = zoomWindow(standings, dtSec);
        const leaderD = standings[0]?.distance ?? 0;
        const toGo = Math.max(0, Math.round(COURSE_M - leaderD));

        const anchor = state.zoomCourseAnchor;
        const needsRebuild =
            !anchor ||
            minD < anchor.minD - ZOOM_COURSE_REGEN_M ||
            maxD > anchor.maxD + ZOOM_COURSE_REGEN_M;

        if (needsRebuild) {
            courseG.innerHTML = buildZoomCourseHtml(layout, minD, maxD);
            state.zoomCourseAnchor = { minD, maxD };
            courseG.setAttribute('transform', '');
        } else {
            const offset = xMap(anchor.minD, minD, maxD, w, padL, padR) - padL;
            courseG.setAttribute('transform', `translate(${offset.toFixed(2)}, 0)`);
        }

        updateZoomBoatsPooled(standings, layout, minD, maxD, toGo, dtSec);
    }

    function splitMarkerLabel(marker) {
        if (marker >= COURSE_M) return 'Finish';
        return `${marker}m`;
    }

    function renderZoomSplitCallouts(tSec) {
        const el = $('krvZoomSplits');
        const layout = getZoomLayout();
        if (!el || !layout) return;
        const { h, padT, padB } = layout;
        const byLane = new Map();
        for (const callout of state.laneSplitCallouts.values()) {
            if (tSec > callout.until) continue;
            const existing = byLane.get(callout.lane);
            if (!existing || callout.marker > existing.marker) {
                byLane.set(callout.lane, callout);
            }
        }
        const calloutKey = [...byLane.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([lane, c]) => `${lane}:${c.marker}:${c.text}:${c.kind}`)
            .join('|');
        if (calloutKey === state.splitCalloutsKey) return;
        state.splitCalloutsKey = calloutKey;

        el.innerHTML = [...byLane.entries()]
            .map(([lane, callout]) => {
                const yPct = ((yMapLaneCached(lane, layout) / h) * 100).toFixed(2);
                const kindCls = callout.kind === 'finish' ? ' krv-lane-split--finish' : '';
                return (
                    `<div class="krv-lane-split${kindCls}" style="top:${yPct}%">` +
                    `<span class="krv-lane-split__marker">${escapeHtml(splitMarkerLabel(callout.marker))}</span>` +
                    `<span class="krv-lane-split__time">${escapeHtml(callout.text)}</span>` +
                    `</div>`
                );
            })
            .join('');
    }

    function renderUpcoming() {
        const list = $('krvUpcomingList');
        if (!list) return;
        const upcoming = getUpcoming(8);
        if (!upcoming.length) {
            list.innerHTML = '<li class="krv-upcoming__empty">No schedule loaded</li>';
            return;
        }
        const selectedNum = getSelectedRaceSlot()?.raceNum;
        list.innerHTML = upcoming
            .map((race) => {
                const name = expandEventName(race.eventType, state.lookup);
                const round = [race.round, race.division ? `Div ${race.division}` : '']
                    .filter(Boolean)
                    .join(' · ');
                const onCourse = state.onCourseRaceNums.has(race.raceNum);
                const active = race.raceNum === selectedNum;
                const cls = [
                    'krv-upcoming__row',
                    onCourse ? 'krv-upcoming__row--on-course' : '',
                    active ? 'krv-upcoming__row--active' : '',
                ]
                    .filter(Boolean)
                    .join(' ');
                return (
                    `<li class="${cls}" data-race-num="${race.raceNum}" role="button" tabindex="0">` +
                    `<span class="krv-upcoming__time">${formatScheduleTime(race.startAt)}</span>` +
                    `<span class="krv-upcoming__race">Race ${escapeHtml(race.race)}</span>` +
                    `<span class="krv-upcoming__event">${escapeHtml(name)}</span>` +
                    `<span class="krv-upcoming__round">${escapeHtml(round || '—')}</span>` +
                    (onCourse ? `<span class="krv-upcoming__badge">On course</span>` : '') +
                    `</li>`
                );
            })
            .join('');
    }

    function renderPreviousResults() {
        const metaEl = $('krvPreviousMeta');
        const list = $('krvPreviousList');
        if (!metaEl || !list) return;

        const prevRace = findPreviousRace();
        if (!prevRace) {
            metaEl.textContent = 'No previous race';
            list.innerHTML = '<li class="krv-previous__empty">—</li>';
            return;
        }

        const event = expandEventName(prevRace.eventType, state.lookup);
        const round = [prevRace.round, prevRace.division ? `Div ${prevRace.division}` : '']
            .filter(Boolean)
            .join(' · ');
        metaEl.textContent = [`Race ${prevRace.race}`, event, round].filter(Boolean).join(' · ');

        const result = state.results.get(prevRace.raceNum);
        if (!result?.placings?.length) {
            list.innerHTML = '<li class="krv-previous__empty">Results not available</li>';
            return;
        }

        list.innerHTML = result.placings
            .map((p) => {
                const club = parseClubCode(p.competitor);
                const info = clubInfo(club.id, state.lookup);
                const logo = info.logoUrl || LOGO_PLACEHOLDER;
                return (
                    `<li class="krv-previous__row">` +
                    `<span class="krv-previous__place">${p.place}</span>` +
                    `<img class="krv-previous__logo" src="${escapeHtml(logo)}" alt="">` +
                    `<span class="krv-previous__name">${escapeHtml(info.name)}</span>` +
                    `<span class="krv-previous__time">${escapeHtml(p.time || '—')}</span>` +
                    `</li>`
                );
            })
            .join('');
    }

    function renderFrame(tSec, dtSec = 1 / 60) {
        if (!state.chartState) return;
        if (state.lastPlaybackSec - tSec > 1) resetRaceTracking();
        state.lastPlaybackSec = tSec;
        const prevOnCourseKey = [...state.onCourseRaceNums].sort().join(',');
        updateOnCourseRaceNums(tSec);
        const onCourseKey = [...state.onCourseRaceNums].sort().join(',');
        if (onCourseKey !== prevOnCourseKey) {
            renderUpcoming();
            renderZoomRacePicker();
        }

        const slotStandings = state.raceSlots.map((slot) => {
            const raw = standingsForSlot(slot.boats, tSec, slot.offsetM);
            updateRaceTracking(slot.slot, raw, tSec);
            return {
                slot: slot.slot,
                raceNum: slot.raceNum,
                standings: processSlotStandings(slot.slot, raw, tSec, slot.offsetM),
            };
        });
        pruneLaneSplitCallouts(tSec);

        updateOverviewBoats(slotStandings);

        const selected = getSelectedRaceSlot();
        const zoomStandings = selected
            ? slotStandings.find((s) => s.slot === selected.slot)?.standings ?? []
            : [];
        updateZoomView(zoomStandings, dtSec);
        renderZoomSplitCallouts(tSec);
    }

    function playbackTimeSec(ts) {
        if (state.playbackStart == null) state.playbackStart = ts;
        const elapsed = (ts - state.playbackStart) / 1000;
        const raceDur = state.chartState?.raceDurationSec ?? 420;
        const cycle = raceDur + LOOP_PAUSE_SEC;
        const mod = elapsed % cycle;
        return mod <= raceDur ? mod : raceDur;
    }

    function tick(ts) {
        const dtSec = state.lastFrameTs ? Math.min(0.05, (ts - state.lastFrameTs) / 1000) : 1 / 60;
        state.lastFrameTs = ts;
        const tSec = playbackTimeSec(ts);
        renderFrame(tSec, dtSec);
        if (!state.waterDeferUntil || ts >= state.waterDeferUntil) {
            paintWaterFrame(ts);
        }
        state.rafId = global.requestAnimationFrame(tick);
    }

    function startPlayback() {
        if (state.rafId) global.cancelAnimationFrame(state.rafId);
        state.playbackStart = null;
        state.zoomCenter = null;
        state.lastFrameTs = null;
        state.waterDeferUntil = useLiteGraphics() ? performance.now() + 500 : 0;
        resetRaceTracking();
        state.rafId = global.requestAnimationFrame(tick);
    }

    async function loadRegattaSchedule() {
        const code = getRegattaCode();
        const hub = global.AltitudeHdHub;
        const daysheetUrl = hub?.buildCsvUrl
            ? hub.buildCsvUrl(code, 'daysheet')
            : `https://l.rowit.nz/altitude/${code}/daysheet.csv`;

        const [lookup, daysheetText] = await Promise.all([
            fetch('data/ahd-lookup.json').then((r) => (r.ok ? r.json() : null)),
            fetchCsv(daysheetUrl).catch(() => ''),
        ]);

        state.lookup = lookup;
        state.races = daysheetText ? parseDaysheet(daysheetText) : [];
        renderUpcoming();
    }

    async function loadRegattaResults() {
        const code = getRegattaCode();
        const hub = global.AltitudeHdHub;
        const resultsUrl = hub?.buildCsvUrl
            ? hub.buildCsvUrl(code, 'results')
            : `https://l.rowit.nz/altitude/${code}/results.csv`;
        const resultsText = await fetchCsv(resultsUrl).catch(() => '');
        state.results = resultsText ? parseResultsCsv(resultsText) : new Map();
    }

    async function loadRegattaData() {
        await loadRegattaSchedule();
        await loadRegattaResults();
        renderPreviousResults();
    }

    function applyRaceTraces(data) {
        const chart = global.KriVmixSpeedChart;
        if (!chart) throw new Error('Speed chart module missing');
        clearBoatPools();
        state.overviewLayout = null;
        state.zoomLayout = null;
        const prepared = chart.prepareChartState(data);
        state.chartState = prepared;
        prepareRaceSlots(prepared, data);
        state.zoomCenter = null;
        state.zoomCourseAnchor = null;
        state.zoomBoatYOffset = new Map();
        resetRaceTracking();
        renderZoomRacePicker();
        updateRaceTitles([]);
        renderLaneLabels();
    }

    async function loadRaceTraces() {
        const chart = global.KriVmixSpeedChart;
        if (!chart) throw new Error('Speed chart module missing');
        const data = await chart.loadData(getDataUrl());
        applyRaceTraces(data);
        renderPreviousResults();
    }

    function bindRaceSelection() {
        $('krvZoomRacePicker')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-slot]');
            if (btn) selectRaceSlot(btn.dataset.slot);
        });
        $('krvOverviewRaceLabels')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-slot]');
            if (btn) selectRaceSlot(btn.dataset.slot);
        });
        $('krvUpcomingList')?.addEventListener('click', (e) => {
            const row = e.target.closest('[data-race-num]');
            if (!row) return;
            const num = parseInt(row.dataset.raceNum, 10);
            const slot = state.raceSlots.find((s) => s.raceNum === num);
            if (slot) selectRaceSlot(slot.slot);
        });
        $('krvUpcomingList')?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target.closest('[data-race-num]');
            if (!row) return;
            e.preventDefault();
            const num = parseInt(row.dataset.raceNum, 10);
            const slot = state.raceSlots.find((s) => s.raceNum === num);
            if (slot) selectRaceSlot(slot.slot);
        });
    }

    async function init() {
        const status = $('krvStatus');
        try {
            renderOverviewStatic();
            renderZoomStatic();
            bindRaceSelection();

            const chart = global.KriVmixSpeedChart;
            if (!chart) throw new Error('Speed chart module missing');

            const [data] = await Promise.all([
                chart.loadData(getDataUrl()),
                loadRegattaSchedule(),
            ]);
            applyRaceTraces(data);
            renderUpcoming();
            renderLaneLabels();
            renderPreviousResults();
            renderFrame(0);
            startPlayback();
            scheduleWaterAnimation();
            if (status) status.hidden = true;

            loadRegattaResults()
                .then(() => renderPreviousResults())
                .catch(() => {});
        } catch (err) {
            if (status) {
                status.hidden = false;
                status.textContent =
                    err instanceof Error ? err.message : 'Failed to load race viewer';
            }
        }
    }

    function onLiveRaceChange() {
        const chart = global.KriVmixSpeedChart;
        if (!chart) return;
        Promise.all([loadRegattaSchedule(), chart.loadData(getDataUrl())])
            .then(([, data]) => {
                applyRaceTraces(data);
                renderUpcoming();
                renderLaneLabels();
                renderPreviousResults();
                renderFrame(playbackTimeSec(performance.now()));
            })
            .catch(() => {});
        loadRegattaResults()
            .then(() => renderPreviousResults())
            .catch(() => {});
    }

    global.document.addEventListener('DOMContentLoaded', () => {
        init();
        global.document.addEventListener('altitudehd:liverace', onLiveRaceChange);
        global.document.addEventListener('altitudehd:schedule', () => {
            renderUpcoming();
            renderPreviousResults();
        });
    });

    global.KriRaceViewer = { init, reload: init, selectRaceSlot };
})(typeof window !== 'undefined' ? window : globalThis);
