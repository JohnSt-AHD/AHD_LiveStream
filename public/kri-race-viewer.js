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
    const ZONE_START_M = 100;
    const ZONE_FINISH_M = 250;
    const BUOY_SPACING_M = 20;

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

    function xCourse(distanceM, padL, chartW) {
        return padL + (distanceM / COURSE_M) * chartW;
    }

    function svgDefs(scope = 'main') {
        const p = (name) => `${name}-${scope}`;
        return (
            '<defs>' +
            `<linearGradient id="${p('krvWaterBase')}" x1="0%" y1="0%" x2="100%" y2="100%">` +
            '<stop offset="0%" stop-color="#cffafe"/>' +
            '<stop offset="40%" stop-color="#7dd3fc"/>' +
            '<stop offset="100%" stop-color="#0284c7"/>' +
            '</linearGradient>' +
            `<pattern id="${p('krvWaterRipple')}" width="56" height="28" patternUnits="userSpaceOnUse">` +
            '<path d="M0 14 Q14 10 28 14 T56 14" fill="none" stroke="rgba(255,255,255,0.38)" stroke-width="1.1"/>' +
            '<path d="M0 21 Q14 17 28 21 T56 21" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="0.85"/>' +
            '</pattern>' +
            `<pattern id="${p('krvWaterRippleAnim')}" width="56" height="28" patternUnits="userSpaceOnUse">` +
            '<path d="M0 14 Q14 10 28 14 T56 14" fill="none" stroke="rgba(255,255,255,0.42)" stroke-width="1.2"/>' +
            '<path d="M0 21 Q14 17 28 21 T56 21" fill="none" stroke="rgba(255,255,255,0.24)" stroke-width="0.9"/>' +
            '<animateTransform attributeName="patternTransform" type="translate" from="0 0" to="56 0" dur="4.5s" repeatCount="indefinite"/>' +
            '</pattern>' +
            `<pattern id="${p('krvWaterRippleAnim2')}" width="48" height="24" patternUnits="userSpaceOnUse">` +
            '<path d="M0 12 Q12 8 24 12 T48 12" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="0.9"/>' +
            '<animateTransform attributeName="patternTransform" type="translate" from="0 0" to="-48 0" dur="6.5s" repeatCount="indefinite"/>' +
            '</pattern>' +
            `<pattern id="${p('krvWaterTexture')}" width="96" height="48" patternUnits="userSpaceOnUse">` +
            `<rect width="96" height="48" fill="url(#${p('krvWaterBase')})"/>` +
            `<rect width="96" height="48" fill="url(#${p('krvWaterRipple')})"/>` +
            '<ellipse cx="28" cy="14" rx="22" ry="5" fill="rgba(255,255,255,0.16)"/>' +
            '<ellipse cx="72" cy="34" rx="18" ry="4" fill="rgba(255,255,255,0.1)"/>' +
            '</pattern>' +
            `<linearGradient id="${p('krvWaterShine')}" x1="0%" y1="0%" x2="0%" y2="100%">` +
            '<stop offset="0%" stop-color="rgba(255,255,255,0.28)"/>' +
            '<stop offset="45%" stop-color="rgba(255,255,255,0.04)"/>' +
            '<stop offset="100%" stop-color="rgba(15,23,42,0.06)"/>' +
            '</linearGradient>' +
            `<radialGradient id="${p('krvBuoyGrad')}" cx="35%" cy="30%" r="65%">` +
            '<stop offset="0%" stop-color="#fed7aa"/>' +
            '<stop offset="100%" stop-color="#ea580c"/>' +
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

    function courseWaterHtml(padL, padT, chartW, chartH, scope, rx = 6, frameCls = '') {
        const clipId = `krvWaterClip-${scope}`;
        const tex = `krvWaterTexture-${scope}`;
        const shine = `krvWaterShine-${scope}`;
        const rippleAnim = `krvWaterRippleAnim-${scope}`;
        const rippleAnim2 = `krvWaterRippleAnim2-${scope}`;
        const shadow = `krvCourseShadow-${scope}`;
        return (
            `<clipPath id="${clipId}"><rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" rx="${rx}"/></clipPath>` +
            `<g clip-path="url(#${clipId})" class="krv-water-layer">` +
            `<rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" rx="${rx}" fill="#7dd3fc"/>` +
            `<rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" class="krv-course-water ${frameCls}" rx="${rx}" fill="url(#${tex})"/>` +
            `<rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" class="krv-course-water-shine ${frameCls}" rx="${rx}" fill="url(#${shine})"/>` +
            `<rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" class="krv-course-water-ripple ${frameCls}" rx="${rx}" fill="url(#${rippleAnim})"/>` +
            `<rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" class="krv-course-water-ripple krv-course-water-ripple--slow ${frameCls}" rx="${rx}" fill="url(#${rippleAnim2})"/>` +
            `</g>` +
            `<rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" class="krv-course-frame ${frameCls}" rx="${rx}" fill="none" filter="url(#${shadow})"/>`
        );
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
            `<g class="krv-boat-shape" transform="scale(0.55) translate(-24,-12)">` +
            cartoonBoatPaths(color) +
            `</g>`
        );
    }

    function cartoonBoatMarkup(color, logoUrl) {
        const hull = color || '#38bdf8';
        const logo = logoUrl || LOGO_PLACEHOLDER;
        return (
            `<div class="krv-zoom-boat__hull">` +
            `<svg class="krv-cartoon-boat" viewBox="0 0 48 24" width="64" height="32" aria-hidden="true">` +
            cartoonBoatPaths(hull) +
            `</svg>` +
            `<img class="krv-zoom-boat__logo-badge" src="${escapeHtml(logo)}" alt="">` +
            `</div>`
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

    function zoneRectsHtml(padL, padT, chartW, chartH, minD = 0, maxD = COURSE_M) {
        const zones = [
            { from: 0, to: ZONE_START_M, cls: 'krv-zone krv-zone--start' },
            { from: ZONE_START_M, to: COURSE_M - ZONE_FINISH_M, cls: 'krv-zone krv-zone--mid' },
            { from: COURSE_M - ZONE_FINISH_M, to: COURSE_M, cls: 'krv-zone krv-zone--finish' },
        ];
        return zones
            .map(({ from, to, cls }) => {
                const a = Math.max(from, minD);
                const b = Math.min(to, maxD);
                if (b <= a) return '';
                const x0 = padL + ((a - minD) / Math.max(1, maxD - minD)) * chartW;
                const x1 = padL + ((b - minD) / Math.max(1, maxD - minD)) * chartW;
                return `<rect x="${x0}" y="${padT}" width="${Math.max(0, x1 - x0)}" height="${chartH}" class="${cls}"/>`;
            })
            .join('');
    }

    function zoneRectsForWindow(padL, padT, chartW, chartH, padR, w, minD, maxD) {
        const zones = [
            { from: 0, to: ZONE_START_M, cls: 'krv-zone krv-zone--start' },
            { from: ZONE_START_M, to: COURSE_M - ZONE_FINISH_M, cls: 'krv-zone krv-zone--mid' },
            { from: COURSE_M - ZONE_FINISH_M, to: COURSE_M, cls: 'krv-zone krv-zone--finish' },
        ];
        return zones
            .map(({ from, to, cls }) => {
                const a = Math.max(from, minD);
                const b = Math.min(to, maxD);
                if (b <= a) return '';
                const x0 = xMap(a, minD, maxD, w, padL, padR);
                const x1 = xMap(b, minD, maxD, w, padL, padR);
                return `<rect x="${x0}" y="${padT}" width="${Math.max(0, x1 - x0)}" height="${chartH}" class="${cls}"/>`;
            })
            .join('');
    }

    function buoysHtml(h, padL, padT, padB, chartW, minD = 0, maxD = COURSE_M, padR = 0, totalW = null, scope = 'overview') {
        const buoyGrad = `krvBuoyGrad-${scope}`;
        const parts = [];
        const w = totalW ?? padL + chartW + padR;
        for (let lane = 1; lane <= LANE_COUNT; lane++) {
            const y = yMapLane(lane, h, padT, padB);
            for (let d = BUOY_SPACING_M; d < COURSE_M; d += BUOY_SPACING_M) {
                if (d < minD || d > maxD) continue;
                const x =
                    maxD > minD && maxD < COURSE_M
                        ? xMap(d, minD, maxD, w, padL, padR)
                        : xCourse(d, padL, chartW);
                parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="krv-buoy" fill="url(#${buoyGrad})"/>`);
            }
        }
        return parts.join('');
    }

    function startFinishHtml(padL, padT, chartH, chartW, padR = 0, minD = 0, maxD = COURSE_M, scope = 'overview') {
        const w = padL + chartW + padR;
        const xStart = maxD > minD && minD > 0 ? xMap(0, minD, maxD, w, padL, padR) : padL;
        const xFinish =
            maxD > minD && maxD < COURSE_M
                ? xMap(COURSE_M, minD, maxD, w, padL, padR)
                : padL + chartW;
        const showStart = minD <= 0;
        const showFinish = maxD >= COURSE_M;
        const parts = [];
        if (showStart) {
            parts.push(
                `<line x1="${xStart}" y1="${padT}" x2="${xStart}" y2="${padT + chartH}" class="krv-line-start"/>`,
                `<text x="${xStart + 6}" y="${padT + 16}" class="krv-line-label krv-line-label--start">Start</text>`,
            );
        }
        if (showFinish) {
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

    function yMapLane(lane, height, padTop, padBottom) {
        const chartH = height - padTop - padBottom;
        const laneH = chartH / LANE_COUNT;
        return padTop + (lane - 0.5) * laneH;
    }

    function crewByLane() {
        const map = new Map();
        const lanes = state.raceContext?.lanes;
        if (!lanes?.length) return map;
        for (const entry of lanes) map.set(entry.lane, entry);
        return map;
    }

    function laneLabelsSvgHtml(h, padL, padT, padB, zoom = false) {
        const crews = crewByLane();
        const parts = [];
        const headCls = zoom ? 'krv-lane-head krv-lane-head--zoom' : 'krv-lane-head';
        const laneCls = zoom ? 'krv-lane-label krv-lane-label--zoom' : 'krv-lane-label';
        const crewCls = zoom ? 'krv-lane-crew krv-lane-crew--zoom' : 'krv-lane-crew';
        const labelX = padL - 10;
        parts.push(
            `<text x="${labelX}" y="${padT - 6}" class="${headCls}" text-anchor="end">Lane</text>`,
        );
        for (let lane = 1; lane <= LANE_COUNT; lane++) {
            const y = yMapLane(lane, h, padT, padB);
            const crew = crews.get(lane);
            parts.push(
                `<text x="${labelX}" y="${y - 1}" class="${laneCls}" text-anchor="end">${lane}</text>`,
            );
            const crewLabel = crew
                ? escapeHtml(crew.shortLabel || crew.label || '')
                : '—';
            parts.push(
                `<text x="${labelX}" y="${y + 10}" class="${crewCls}" text-anchor="end">${crewLabel}</text>`,
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
        const padL = 108;
        const padR = 48;
        const padT = 28;
        const padB = 24;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        const parts = [
            svgDefs('overview'),
            courseWaterHtml(padL, padT, chartW, chartH, 'overview', 8, 'krv-course-frame--overview'),
            zoneRectsHtml(padL, padT, chartW, chartH),
            buoysHtml(h, padL, padT, padB, chartW, 0, COURSE_M, padR, null, 'overview'),
            startFinishHtml(padL, padT, chartH, chartW, padR, 0, COURSE_M, 'overview'),
        ];

        for (let lane = 1; lane <= LANE_COUNT; lane++) {
            const y = yMapLane(lane, h, padT, padB);
            parts.push(
                `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" class="krv-lane-line"/>`,
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
        svg.dataset.layout = JSON.stringify({ w, h, padL, padR, padT, padB, chartW, chartH });
    }

    function renderZoomStatic() {
        const svg = $('krvZoomSvg');
        if (!svg) return;
        const w = 1200;
        const h = 520;
        const padL = 96;
        const padR = 40;
        const padT = 36;
        const padB = 36;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        const parts = [
            svgDefs('zoom'),
            courseWaterHtml(padL, padT, chartW, chartH, 'zoom', 12, 'krv-course-frame--zoom'),
        ];

        for (let lane = 1; lane <= LANE_COUNT; lane++) {
            const y = yMapLane(lane, h, padT, padB);
            parts.push(
                `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" class="krv-lane-line krv-lane-line--zoom"/>`,
            );
        }

        parts.push('<g id="krvZoomLaneLabels"></g>');
        parts.push('<g id="krvZoomCourse"></g>');
        svg.innerHTML = parts.join('');
        svg.dataset.layout = JSON.stringify({ w, h, padL, padR, padT, padB, chartW, chartH });
    }

    function updateRaceLabel() {
        const labelEl = $('krvRaceLabel');
        if (!labelEl) return;
        if (state.raceLabel) {
            labelEl.hidden = false;
            labelEl.textContent = state.raceLabel;
        } else {
            labelEl.hidden = true;
        }
    }

    function updateOverviewBoats(standings, tSec) {
        const svg = $('krvOverviewSvg');
        const clusterG = svg?.querySelector('#krvOverviewCluster');
        const boatsG = svg?.querySelector('#krvOverviewBoats');
        if (!svg || !clusterG || !boatsG) return;

        const layout = JSON.parse(svg.dataset.layout || '{}');
        const { w, h, padL, padR, padT, padB } = layout;
        const { minD, maxD, leaderD } = clusterBounds(standings);

        const x0 = padL + (minD / COURSE_M) * (w - padL - padR);
        const x1 = padL + (maxD / COURSE_M) * (w - padL - padR);
        clusterG.innerHTML =
            `<rect x="${x0}" y="${padT}" width="${Math.max(8, x1 - x0)}" height="${h - padT - padB}" class="krv-cluster-box" rx="8"/>`;

        updateRaceLabel();

        boatsG.innerHTML = standings
            .map(({ boat, distance, idx }) => {
                const lane = boat.lane || idx + 1;
                const x = padL + (distance / COURSE_M) * (w - padL - padR);
                const y = yMapLane(lane, h, padT, padB);
                return (
                    `<g class="krv-boat krv-boat--overview" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">` +
                    boatShapeHtml(boat.color) +
                    `</g>`
                );
            })
            .join('');

        boatsG.dataset.leaderD = String(leaderD);
    }

    function updateZoomView(standings) {
        const svg = $('krvZoomSvg');
        const courseG = svg?.querySelector('#krvZoomCourse');
        const boatsEl = $('krvZoomBoats');
        if (!svg || !courseG || !boatsEl) return;

        const layout = JSON.parse(svg.dataset.layout || '{}');
        const { w, h, padL, padR, padT, padB, chartW, chartH } = layout;
        const { minD, maxD } = zoomWindow(standings);
        const leaderD = standings[0]?.distance ?? 0;
        const toGo = Math.max(0, Math.round(COURSE_M - leaderD));

        const courseParts = [
            zoneRectsForWindow(padL, padT, chartW, chartH, padR, w, minD, maxD),
            buoysHtml(h, padL, padT, padB, chartW, minD, maxD, padR, w, 'zoom'),
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
        courseG.innerHTML = courseParts.join('');

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
                const vertCls = lane <= 4 ? 'below' : 'above';
                const horizCls = lane % 2 === 1 ? 'right' : 'left';
                return (
                    `<div class="krv-zoom-boat krv-zoom-boat--info-${vertCls} krv-zoom-boat--info-${horizCls}" style="left:${xPct}%;top:${yPct}%;z-index:${20 - rank}" data-rank="${rank + 1}">` +
                    `<div class="krv-zoom-boat__anchor">` +
                    `<span class="krv-zoom-boat__rank">${rank + 1}</span>` +
                    cartoonBoatMarkup(boat.color, logo) +
                    `</div>` +
                    `<div class="krv-zoom-boat__info">` +
                    `<span class="krv-zoom-boat__label">${escapeHtml(displayName(boat))}</span>` +
                    `<span class="krv-zoom-boat__speed">${speedStr}</span>` +
                    `<span class="krv-zoom-boat__gap">${escapeHtml(toGoStr)}</span>` +
                    `</div>` +
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
        const resultsUrl = hub?.buildCsvUrl
            ? hub.buildCsvUrl(code, 'results')
            : `https://l.rowit.nz/altitude/${code}/results.csv`;

        const [lookup, daysheetText, resultsText] = await Promise.all([
            fetch('data/ahd-lookup.json').then((r) => (r.ok ? r.json() : null)),
            fetchCsv(daysheetUrl).catch(() => ''),
            fetchCsv(resultsUrl).catch(() => ''),
        ]);

        state.lookup = lookup;
        state.races = daysheetText ? parseDaysheet(daysheetText) : [];
        state.results = resultsText ? parseResultsCsv(resultsText) : new Map();
        renderUpcoming();
        renderPreviousResults();
    }

    async function loadRaceTraces() {
        const chart = global.KriVmixSpeedChart;
        if (!chart) throw new Error('Speed chart module missing');

        const data = await chart.loadData(getDataUrl());
        const raceContext = buildRaceContext();
        state.raceContext = raceContext;
        const prepared = chart.prepareChartState(data);
        state.chartState = applyRaceContextToState(prepared, raceContext);
        state.raceLabel = raceTitleLine(raceContext, data);
        updateRaceLabel();
        renderLaneLabels();
        renderPreviousResults();
    }

    async function init() {
        const status = $('krvStatus');
        try {
            renderOverviewStatic();
            renderZoomStatic();
            await loadRegattaData();
            await loadRaceTraces();
            renderUpcoming();
            renderLaneLabels();
            renderPreviousResults();
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
        loadRegattaData()
            .then(() => loadRaceTraces())
            .then(() => {
                renderUpcoming();
                renderLaneLabels();
                renderPreviousResults();
                renderFrame(playbackTimeSec(performance.now()));
            })
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

    global.KriRaceViewer = { init, reload: init };
})(typeof window !== 'undefined' ? window : globalThis);
