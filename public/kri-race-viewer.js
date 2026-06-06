/**
 * KRI live stream — race viewer (birds-eye course + zoom + upcoming races).
 * Replays saved split-speed data (same source as speed vs distance chart).
 */
(function (global) {
    const DATA_URL = 'data/kri-sample-wrcp1-m1x-h1.json';
    const COURSE_M = 2000;
    const LANE_COUNT = 8;
    const MARKERS_M = [0, 500, 1000, 1500, 2000];
    const LOGO_PLACEHOLDER = 'assets/school-logos/placeholder-white.svg';
    const LS_LIVE_RACE = 'altitudeHdLiveRace_v1';
    const CLUSTER_PAD_M = 100;
    const ZOOM_TRAIL_M = 90;
    const ZOOM_LEAD_M = 35;
    const LOOP_PAUSE_SEC = 2.5;

    const MONTHS = {
        january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
        april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
        august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9,
        november: 10, nov: 10, december: 11, dec: 11,
    };

    const state = {
        lookup: null,
        races: [],
        chartState: null,
        raceLabel: '',
        rafId: null,
        playbackStart: null,
    };

    function $(id) {
        return document.getElementById(id);
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

    function buildRaceContext() {
        const race = findRace(getRaceParam());
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

    function zoomWindow(standings) {
        const leaderD = standings[0]?.distance ?? 0;
        const lastD = standings[standings.length - 1]?.distance ?? 0;
        const minD = Math.max(0, lastD - ZOOM_TRAIL_M);
        const maxD = Math.min(COURSE_M, leaderD + ZOOM_LEAD_M);
        if (maxD - minD < 120) {
            return { minD: Math.max(0, leaderD - 80), maxD: Math.min(COURSE_M, leaderD + 40) };
        }
        return { minD, maxD };
    }

    function xMap(distanceM, minD, maxD, width, padLeft, padRight) {
        const chartW = width - padLeft - padRight;
        const t = (distanceM - minD) / Math.max(1, maxD - minD);
        return padLeft + Math.max(0, Math.min(1, t)) * chartW;
    }

    function yMapLane(lane, height, padTop, padBottom) {
        const chartH = height - padTop - padBottom;
        const laneH = chartH / LANE_COUNT;
        return padTop + (lane - 0.5) * laneH;
    }

    function renderOverviewStatic() {
        const svg = $('krvOverviewSvg');
        if (!svg) return;
        const w = 1800;
        const h = 220;
        const padL = 72;
        const padR = 48;
        const padT = 28;
        const padB = 24;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        const parts = [
            `<rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" class="krv-course-bg" rx="6"/>`,
        ];

        for (let lane = 1; lane <= LANE_COUNT; lane++) {
            const y = yMapLane(lane, h, padT, padB);
            parts.push(
                `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" class="krv-lane-line"/>`,
            );
            parts.push(
                `<text x="${padL - 10}" y="${y + 5}" class="krv-lane-label" text-anchor="end">${lane}</text>`,
            );
        }

        for (const dist of MARKERS_M) {
            const x = padL + (dist / COURSE_M) * chartW;
            parts.push(`<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + chartH}" class="krv-marker-line"/>`);
            if (dist > 0 && dist < COURSE_M) {
                parts.push(
                    `<text x="${x}" y="${padT - 8}" class="krv-marker-label" text-anchor="middle">${dist}m</text>`,
                );
            }
        }

        parts.push(
            `<text x="${padL}" y="${h - 4}" class="krv-end-label" text-anchor="start">Start</text>`,
            `<text x="${padL + chartW}" y="${h - 4}" class="krv-end-label" text-anchor="end">Finish</text>`,
        );

        parts.push('<g id="krvOverviewCluster"></g>');
        parts.push('<g id="krvOverviewBoats"></g>');

        svg.innerHTML = parts.join('');
        svg.dataset.layout = JSON.stringify({ w, h, padL, padR, padT, padB, chartW, chartH });
    }

    function renderZoomStatic() {
        const svg = $('krvZoomSvg');
        if (!svg) return;
        const w = 1200;
        const h = 520;
        const padL = 56;
        const padR = 40;
        const padT = 36;
        const padB = 36;

        const parts = [
            `<rect x="${padL}" y="${padT}" width="${w - padL - padR}" height="${h - padT - padB}" class="krv-course-bg krv-course-bg--zoom" rx="10"/>`,
        ];

        for (let lane = 1; lane <= LANE_COUNT; lane++) {
            const y = yMapLane(lane, h, padT, padB);
            parts.push(
                `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" class="krv-lane-line krv-lane-line--zoom"/>`,
            );
            parts.push(
                `<text x="${padL - 12}" y="${y + 6}" class="krv-lane-label krv-lane-label--zoom" text-anchor="end">${lane}</text>`,
            );
        }

        parts.push('<g id="krvZoomMarkers"></g>');
        svg.innerHTML = parts.join('');
        svg.dataset.layout = JSON.stringify({ w, h, padL, padR, padT, padB });
    }

    function updateOverviewBoats(standings, tSec) {
        const svg = $('krvOverviewSvg');
        const clusterG = svg?.querySelector('#krvOverviewCluster');
        const boatsG = svg?.querySelector('#krvOverviewBoats');
        const labelEl = $('krvRaceLabel');
        if (!svg || !clusterG || !boatsG) return;

        const layout = JSON.parse(svg.dataset.layout || '{}');
        const { w, h, padL, padR, padT, padB } = layout;
        const { minD, maxD, leaderD } = clusterBounds(standings);

        const x0 = padL + (minD / COURSE_M) * (w - padL - padR);
        const x1 = padL + (maxD / COURSE_M) * (w - padL - padR);
        clusterG.innerHTML =
            `<rect x="${x0}" y="${padT}" width="${Math.max(8, x1 - x0)}" height="${h - padT - padB}" class="krv-cluster-box" rx="8"/>`;

        if (labelEl) {
            labelEl.hidden = false;
            labelEl.textContent = state.raceLabel;
            labelEl.style.left = `${((x0 + x1) / 2 / w) * 100}%`;
            labelEl.style.top = `${((padT - 6) / h) * 100}%`;
        }

        boatsG.innerHTML = standings
            .map(({ boat, distance, idx }) => {
                const lane = boat.lane || idx + 1;
                const x = padL + (distance / COURSE_M) * (w - padL - padR);
                const y = yMapLane(lane, h, padT, padB);
                return (
                    `<g class="krv-boat krv-boat--overview" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">` +
                    `<polygon points="0,-7 12,0 0,7 -4,0" fill="${boat.color || '#38bdf8'}" class="krv-boat-shape"/>` +
                    `</g>`
                );
            })
            .join('');

        boatsG.dataset.leaderD = String(leaderD);
    }

    function updateZoomView(standings) {
        const svg = $('krvZoomSvg');
        const markersG = svg?.querySelector('#krvZoomMarkers');
        const boatsEl = $('krvZoomBoats');
        if (!svg || !markersG || !boatsEl) return;

        const layout = JSON.parse(svg.dataset.layout || '{}');
        const { w, h, padL, padR, padT, padB } = layout;
        const { minD, maxD } = zoomWindow(standings);
        const leaderD = standings[0]?.distance ?? 0;
        const toGo = Math.max(0, Math.round(COURSE_M - leaderD));

        const markerParts = [];
        for (const dist of MARKERS_M) {
            if (dist < minD || dist > maxD) continue;
            const x = xMap(dist, minD, maxD, w, padL, padR);
            markerParts.push(`<line x1="${x}" y1="${padT}" x2="${x}" y2="${h - padB}" class="krv-marker-line krv-marker-line--zoom"/>`);
            if (dist > 0 && dist < COURSE_M) {
                markerParts.push(
                    `<text x="${x}" y="${padT - 10}" class="krv-marker-label krv-marker-label--zoom" text-anchor="middle">${dist}m</text>`,
                );
            }
        }
        markersG.innerHTML = markerParts.join('');

        boatsEl.innerHTML = standings
            .map((entry, rank) => {
                const { boat, distance, speed, idx } = entry;
                const lane = boat.lane || idx + 1;
                const xPct = ((xMap(distance, minD, maxD, w, padL, padR) / w) * 100).toFixed(3);
                const yPct = ((yMapLane(lane, h, padT, padB) / h) * 100).toFixed(3);
                const gap = rank === 0 ? '' : `+${Math.max(0, Math.round(leaderD - distance))} m`;
                const logo = boat.logoUrl || LOGO_PLACEHOLDER;
                const speedStr = `${speed.toFixed(1)} m/s`;
                const toGoStr = rank === 0 ? `${toGo} m to go` : gap;
                return (
                    `<div class="krv-zoom-boat" style="left:${xPct}%;top:${yPct}%" data-rank="${rank + 1}">` +
                    `<span class="krv-zoom-boat__rank">${rank + 1}</span>` +
                    `<img class="krv-zoom-boat__logo" src="${escapeHtml(logo)}" alt="">` +
                    `<span class="krv-zoom-boat__label">${escapeHtml(boat.label || boat.id)}</span>` +
                    `<span class="krv-zoom-boat__speed">${speedStr}</span>` +
                    `<span class="krv-zoom-boat__gap">${escapeHtml(toGoStr)}</span>` +
                    `</div>`
                );
            })
            .join('');
    }

    function renderUpcoming() {
        const list = $('krvUpcomingList');
        if (!list) return;
        const upcoming = getUpcoming(5);
        if (!upcoming.length) {
            list.innerHTML = '<li class="krv-upcoming__empty">No schedule loaded</li>';
            return;
        }
        list.innerHTML = upcoming
            .map((race) => {
                const name = expandEventName(race.eventType, state.lookup);
                const round = [race.round, race.division ? `Div ${race.division}` : '']
                    .filter(Boolean)
                    .join(' · ');
                return (
                    `<li class="krv-upcoming__row">` +
                    `<span class="krv-upcoming__time">${formatScheduleTime(race.startAt)}</span>` +
                    `<span class="krv-upcoming__race">Race ${escapeHtml(race.race)}</span>` +
                    `<span class="krv-upcoming__event">${escapeHtml(name)}</span>` +
                    `<span class="krv-upcoming__round">${escapeHtml(round || '—')}</span>` +
                    `</li>`
                );
            })
            .join('');
    }

    function renderFrame(tSec) {
        if (!state.chartState) return;
        const standings = global.KriVmixSpeedChart.liveStandings(state.chartState.boats, tSec);
        updateOverviewBoats(standings, tSec);
        updateZoomView(standings);
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
        const tSec = playbackTimeSec(ts);
        renderFrame(tSec);
        state.rafId = global.requestAnimationFrame(tick);
    }

    function startPlayback() {
        if (state.rafId) global.cancelAnimationFrame(state.rafId);
        state.playbackStart = null;
        state.rafId = global.requestAnimationFrame(tick);
    }

    async function loadRegattaData() {
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

    async function loadRaceTraces() {
        const chart = global.KriVmixSpeedChart;
        if (!chart) throw new Error('Speed chart module missing');

        const data = await chart.loadData(getDataUrl());
        const raceContext = buildRaceContext();
        state.chartState = chart.applyRaceContext(chart.prepareChartState(data), raceContext);
        state.raceLabel = raceTitleLine(raceContext, data);
    }

    async function init() {
        const status = $('krvStatus');
        try {
            renderOverviewStatic();
            renderZoomStatic();
            await Promise.all([loadRegattaData(), loadRaceTraces()]);
            renderUpcoming();
            renderFrame(0);
            startPlayback();
            if (status) status.hidden = true;
        } catch (err) {
            if (status) {
                status.hidden = false;
                status.textContent =
                    err instanceof Error ? err.message : 'Failed to load race viewer';
            }
        }
    }

    function onLiveRaceChange() {
        loadRaceTraces()
            .then(() => {
                renderUpcoming();
                renderFrame(playbackTimeSec(performance.now()));
            })
            .catch(() => {});
    }

    global.document.addEventListener('DOMContentLoaded', () => {
        init();
        global.document.addEventListener('altitudehd:liverace', onLiveRaceChange);
        global.document.addEventListener('altitudehd:schedule', () => renderUpcoming());
    });

    global.KriRaceViewer = { init, reload: init };
})(typeof window !== 'undefined' ? window : globalThis);
