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
        waterRafId: null,
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

    function drawLakeWater(ctx, pw, ph, layout, timeSec) {
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

        const sunGlare = ctx.createLinearGradient(x, y, x + w * 0.35, y + h * 0.25);
        sunGlare.addColorStop(0, 'rgba(255,255,255,0.22)');
        sunGlare.addColorStop(0.45, 'rgba(200,235,255,0.08)');
        sunGlare.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sunGlare;
        ctx.fillRect(x, y, w, h);

        const bandCount = Math.max(10, Math.floor(h / 16));
        for (let i = 0; i < bandCount; i++) {
            const row = (i + 0.5) / bandCount;
            const yMid = y + h * row;
            ctx.beginPath();
            for (let px = 0; px <= w; px += 3) {
                const wx = x + px;
                const wave =
                    Math.sin(px * 0.022 + timeSec * 1.15 + i * 0.62) * 2.4 +
                    Math.sin(px * 0.009 - timeSec * 0.72 + i * 1.05) * 3.8 +
                    Math.cos(px * 0.005 + timeSec * 0.38) * 1.6;
                const wy = yMid + wave;
                if (px === 0) ctx.moveTo(wx, wy);
                else ctx.lineTo(wx, wy);
            }
            ctx.strokeStyle = `rgba(255,255,255,${0.035 + (i % 3) * 0.012})`;
            ctx.lineWidth = 1.1;
            ctx.stroke();
        }

        for (let i = 0; i < bandCount; i++) {
            const row = (i + 0.35) / bandCount;
            const yMid = y + h * row + 4;
            ctx.beginPath();
            for (let px = 0; px <= w; px += 4) {
                const wx = x + px;
                const wave =
                    Math.sin(px * 0.016 - timeSec * 0.95 + i * 0.8) * 2.8 +
                    Math.sin(px * 0.007 + timeSec * 0.55 + i * 0.4) * 2.2;
                const wy = yMid + wave;
                if (px === 0) ctx.moveTo(wx, wy);
                else ctx.lineTo(wx, wy);
            }
            ctx.strokeStyle = 'rgba(8, 47, 73, 0.04)';
            ctx.lineWidth = 1.4;
            ctx.stroke();
        }

        for (let b = 0; b < 6; b++) {
            const bandY = y + ((timeSec * 14 + b * (h / 6)) % h);
            const spec = ctx.createLinearGradient(x, bandY - 28, x, bandY + 28);
            spec.addColorStop(0, 'rgba(255,255,255,0)');
            spec.addColorStop(0.42, 'rgba(186,230,253,0.1)');
            spec.addColorStop(0.5, 'rgba(255,255,255,0.16)');
            spec.addColorStop(0.58, 'rgba(186,230,253,0.08)');
            spec.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = spec;
            ctx.fillRect(x, bandY - 28, w, 56);
        }

        const sparkleCount = Math.floor((w * h) / 9000);
        for (let s = 0; s < sparkleCount; s++) {
            const seed = s * 17.17 + Math.floor(timeSec * 3);
            const sx = x + ((seed * 73) % 1000) / 1000 * w;
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
        const dpr = Math.min(global.devicePixelRatio || 1, 2);
        const pw = Math.max(1, Math.floor(rect.width * dpr));
        const ph = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== pw || canvas.height !== ph) {
            canvas.width = pw;
            canvas.height = ph;
        }
        canvas.dataset.waterLayout = JSON.stringify(layout);
    }

    function paintWaterCanvas(canvas, timeSec) {
        if (!canvas) return;
        const layout = JSON.parse(canvas.dataset.waterLayout || 'null');
        if (!layout) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawLakeWater(ctx, canvas.width, canvas.height, layout, timeSec);
    }

    function waterAnimationTick(ts) {
        const timeSec = ts / 1000;
        const overviewLayout = JSON.parse($('krvOverviewSvg')?.dataset.layout || 'null');
        const zoomLayout = JSON.parse($('krvZoomSvg')?.dataset.layout || 'null');
        syncWaterCanvas($('krvOverviewWater'), overviewLayout);
        syncWaterCanvas($('krvZoomWater'), zoomLayout);
        paintWaterCanvas($('krvOverviewWater'), timeSec);
        paintWaterCanvas($('krvZoomWater'), timeSec);
        state.waterRafId = global.requestAnimationFrame(waterAnimationTick);
    }

    function startWaterAnimation() {
        if (state.waterRafId) global.cancelAnimationFrame(state.waterRafId);
        state.waterRafId = global.requestAnimationFrame(waterAnimationTick);
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
            courseFrameHtml(padL, padT, chartW, chartH, 'overview', 8, 'krv-course-frame--overview'),
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
        const overviewLayout = { w, h, padL, padR, padT, padB, chartW, chartH, rx: 8 };
        svg.dataset.layout = JSON.stringify(overviewLayout);
        syncWaterCanvas($('krvOverviewWater'), overviewLayout);
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
            courseFrameHtml(padL, padT, chartW, chartH, 'zoom', 12, 'krv-course-frame--zoom'),
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
        const zoomLayout = { w, h, padL, padR, padT, padB, chartW, chartH, rx: 12 };
        svg.dataset.layout = JSON.stringify(zoomLayout);
        syncWaterCanvas($('krvZoomWater'), zoomLayout);
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
            startWaterAnimation();
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
