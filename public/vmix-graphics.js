/**
 * vMix broadcast graphics — title, lower third, draw, results.
 * Keys: d/l/r/t = play in · g = fleet map (Milford) · o = out · c = clear all.
 * URL: ?g=d  &race=12  &regatta=mads2026  (&autoplay=1 to run in on load)
 */
const VG_GRAPHIC_ALIASES = {
    t: 'title',
    title: 'title',
    d: 'draw',
    draw: 'draw',
    l: 'lower',
    lower: 'lower',
    r: 'results',
    results: 'results',
    g: 'speed',
    map: 'speed',
    gps: 'speed',
};

const VG_HOLD_MS = 3000;
const VG_MILFORD_DRAW_RESULTS_HOLD_MS = 6000;
const VG_OUTRO_MS = 3000;

const vgPlayback = {
    state: 'idle',
    graphic: null,
    introTimer: null,
    outroTimer: null,
    rewindRaf: null,
    onVideoTime: null,
};

const VG_THEMES = {
    kri: {
        label: 'KRI',
        backgrounds: {
            title: 'assets/vmix/kri/title.png',
            lower: 'assets/vmix/kri/lower.png',
            draw: 'assets/vmix/kri/draw.png',
            results: 'assets/vmix/kri/results.png',
        },
    },
    'rnz-milford': {
        label: 'RNZ Milford',
        speedEmbed: true,
        backgrounds: {
            title: 'assets/vmix/milford/title.webm',
            lower: 'assets/vmix/milford/lower.webm',
            draw: 'assets/vmix/milford/draw.webm',
            results: 'assets/vmix/milford/results.webm',
        },
    },
    'beachsprints-milford': {
        label: 'Beach Sprints Milford',
        backgrounds: {},
    },
};

const VG_MONTHS = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
    april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
    august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9,
    november: 10, nov: 10, december: 11, dec: 11,
};

const vgState = {
    lookup: null,
    races: [],
    competitors: new Map(),
    results: new Map(),
    regattaCode: 'mads2026',
};

function vgParseCsvLine(line) {
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

function vgParseDayHeader(line) {
    const m = line.match(
        /DAY\s+\d+:\s+\w+\s+(\d{1,2})(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/i,
    );
    if (!m) return { date: null, label: line.trim() };
    const month = VG_MONTHS[m[2].toLowerCase()];
    if (month === undefined) return { date: null, label: line.trim() };
    return {
        date: new Date(parseInt(m[3], 10), month, parseInt(m[1], 10)),
        label: line.trim(),
    };
}

function vgParseRaceLabel(raw) {
    const m = String(raw || '').trim().match(/^(\d+)\s*\(([A-Za-z])\)\s*$/);
    if (!m) return { raceNum: null, label: String(raw || '').trim() };
    return {
        raceNum: parseInt(m[1], 10),
        label: `${m[1]} (${m[2].toUpperCase()})`,
    };
}

function vgParseTimeOnDay(timeStr, dayDate) {
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

function vgParseLanes(cols) {
    const lanes = [];
    for (let lane = 1; lane <= 9; lane++) {
        const idx = 5 + lane;
        if (idx >= cols.length - 1) break;
        lanes.push({
            lane,
            code: (cols[idx] || '').trim() || null,
        });
    }
    let lastUsed = 0;
    for (const l of lanes) if (l.code) lastUsed = l.lane;
    return lastUsed ? lanes.filter((l) => l.lane <= lastUsed) : lanes;
}

function vgParseDaysheet(text) {
    const races = [];
    let dayDate = null;
    let dayLabel = '';
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^DAY\s+\d+:/i.test(trimmed)) {
            const day = vgParseDayHeader(trimmed);
            dayDate = day.date;
            dayLabel = day.label;
            continue;
        }
        if (!dayDate || /^Race,/i.test(trimmed)) continue;
        const cols = vgParseCsvLine(trimmed);
        const info = vgParseRaceLabel(cols[0]);
        if (!info.raceNum) continue;
        const startAt = vgParseTimeOnDay(cols[1], dayDate);
        if (!startAt) continue;
        races.push({
            raceNum: info.raceNum,
            race: info.label,
            startAt,
            eventNum: cols[2].trim(),
            eventType: cols[3].trim(),
            round: cols[4].trim(),
            division: cols[5] ? cols[5].trim() : '',
            lanes: vgParseLanes(cols),
            progression: cols[cols.length - 1] ? cols[cols.length - 1].trim() : '',
            dayLabel,
        });
    }
    return races;
}

function vgParseCompetitors(text) {
    const map = new Map();
    let dayDate = null;
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^DAY\s+\d+:/i.test(trimmed)) {
            dayDate = vgParseDayHeader(trimmed).date;
            continue;
        }
        if (!dayDate || /^Race,/i.test(trimmed)) continue;
        const cols = vgParseCsvLine(trimmed);
        const info = vgParseRaceLabel(cols[0]);
        if (!info.raceNum) continue;
        const division = cols[5] ? cols[5].trim() : '';
        const key = `${info.label}|${division}`;
        map.set(key, {
            race: info.label,
            raceNum: info.raceNum,
            division,
            names: cols[6] ? cols[6].trim() : '',
        });
    }
    return map;
}

function vgParseResults(text) {
    const map = new Map();
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || !/^\d/.test(trimmed)) continue;
        const cols = vgParseCsvLine(trimmed);
        const raceNum = parseInt(cols[0], 10);
        if (!Number.isFinite(raceNum)) continue;
        const placings = [];
        for (let i = 6; i + 2 < cols.length; i += 3) {
            const place = parseInt(cols[i], 10);
            if (!Number.isFinite(place)) continue;
            placings.push({
                place,
                competitor: cols[i + 1].trim(),
                time: cols[i + 2].trim(),
            });
        }
        placings.sort((a, b) => a.place - b.place);
        map.set(raceNum, { status: cols[5].trim(), placings });
    }
    return map;
}

function vgGetRegattaCode() {
    const p = new URLSearchParams(location.search);
    if (p.get('regatta')) return p.get('regatta').trim().toLowerCase();
    if (window.AltitudeHdHub?.getRegattaCode) {
        return window.AltitudeHdHub.getRegattaCode();
    }
    try {
        return localStorage.getItem('altitudeHdRegattaCode_v1') || 'mads2026';
    } catch {
        return 'mads2026';
    }
}

function vgGetCsvUrl(fileId) {
    if (window.AltitudeHdHub?.buildCsvUrl) {
        return window.AltitudeHdHub.buildCsvUrl(vgGetRegattaCode(), fileId);
    }
    const code = vgGetRegattaCode();
    return `https://l.rowit.nz/altitude/${code}/${fileId}.csv`;
}

async function vgFetchCsv(url) {
    try {
        const res = await fetch(
            `/api/fetch-csv?url=${encodeURIComponent(url)}`,
        );
        if (res.ok) return res.text();
    } catch {
        /* direct */
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

async function vgLoadLookup() {
    const res = await fetch('data/ahd-lookup.json');
    if (!res.ok) throw new Error('Lookup file missing');
    return res.json();
}

function vgLookupToken(map, token) {
    if (!map || !token) return token;
    if (map[token]) return map[token];
    const lower = token.toLowerCase();
    for (const [k, v] of Object.entries(map)) {
        if (k.toLowerCase() === lower) return v;
    }
    return token;
}

function vgExpandEventName(eventType, lookup) {
    if (!lookup || !eventType) return eventType;
    const parts = eventType.trim().split(/\s+/);
    if (parts.length < 3) return eventType;
    const g = vgLookupToken(lookup.gender, parts[0]);
    const c = vgLookupToken(lookup.class, parts[1]);
    const b = vgLookupToken(lookup.boat, parts[2]);
    return `${g} ${c} ${b}`;
}

function vgParseClubCode(raw) {
    const m = String(raw || '').trim().match(/^([A-Za-z]+)(?:\s+(\d+))?$/);
    if (!m) return { id: '', crewNum: '' };
    return { id: m[1].toLowerCase(), crewNum: m[2] || '' };
}

function vgClubInfo(clubId, lookup) {
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

const VG_LS_LIVE_RACE = 'altitudeHdLiveRace_v1';
const VG_LS_TRIGGER = 'altitudeHdVmixTrigger_v1';
const VG_LS_SPEED = 'altitudeHdSpeedVmix_v1';

function vgGetRaceParam() {
    const urlRace = new URLSearchParams(location.search).get('race');
    if (urlRace != null && String(urlRace).trim() !== '') {
        return String(urlRace).trim();
    }
    if (window.AltitudeHdLiveRace?.getLiveRace) {
        return window.AltitudeHdLiveRace.getLiveRace();
    }
    try {
        const stored = localStorage.getItem(VG_LS_LIVE_RACE);
        if (stored != null && String(stored).trim()) return String(stored).trim();
    } catch {
        /* ignore */
    }
    return null;
}

function vgFindRace(raceParam) {
    if (!vgState.races.length) return null;
    const p = String(raceParam || '').trim();
    if (!p) return vgState.races[0];
    const num = parseInt(p, 10);
    const letter = p.match(/\(([A-Za-z])\)/i)?.[1]?.toUpperCase();
    const found = vgState.races.find((r) => {
        if (r.raceNum !== num) return false;
        if (letter && !r.race.includes(`(${letter})`)) return false;
        return true;
    });
    return found || vgState.races.find((r) => r.raceNum === num) || vgState.races[0];
}

function vgCompetitorNames(race, lane) {
    const divisions = [];
    if (lane?.code) {
        const club = vgParseClubCode(lane.code);
        if (club.crewNum) divisions.push(club.crewNum);
        if (lane.lane) divisions.push(String(lane.lane));
    }
    if (race.division) divisions.push(race.division);
    divisions.push('');

    for (const div of divisions) {
        const row = vgState.competitors.get(`${race.race}|${div}`);
        if (row?.names) return row.names;
    }
    for (const [, v] of vgState.competitors) {
        if (v.raceNum === race.raceNum && (!lane || v.division === String(lane.lane))) {
            return v.names;
        }
    }
    return '';
}

function vgFormatTime(d) {
    return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function vgFormatDayLabel(dayLabel) {
    return dayLabel.replace(/^DAY\s+\d+:\s*/i, '').trim();
}

function vgResolveTheme() {
    return document.body.dataset.vmixTheme || 'kri';
}

function vgThemeConfig() {
    return VG_THEMES[vgResolveTheme()] || VG_THEMES.kri;
}

function vgIsSpeedGraphic(graphic) {
    return graphic === 'speed';
}

function vgSpeedEnabled() {
    return !!vgThemeConfig().speedEmbed;
}

function vgBuildSpeedEmbedUrl() {
    const u = new URL('speed.html', location.href);
    u.searchParams.set('vmix', '1');
    u.searchParams.set('transparent', '1');
    try {
        const s = JSON.parse(localStorage.getItem(VG_LS_SPEED) || '{}');
        if (s.deviceId) u.searchParams.set('deviceId', String(s.deviceId));
        if (s.rsLat != null) u.searchParams.set('rsLat', String(s.rsLat));
        if (s.rsLng != null) u.searchParams.set('rsLng', String(s.rsLng));
        if (s.reLat != null) u.searchParams.set('reLat', String(s.reLat));
        if (s.reLng != null) u.searchParams.set('reLng', String(s.reLng));
    } catch {
        /* ignore */
    }
    return `speed.html?${u.searchParams.toString()}`;
}

function vgGetSpeedFrame() {
    return document.getElementById('vgMapFrame');
}

function vgPostToSpeedFrame(phase) {
    const frame = vgGetSpeedFrame();
    frame?.contentWindow?.postMessage({ type: 'altitudehd:vg', phase }, '*');
}

function vgIsVideoAsset(src) {
    return /\.(mp4|webm|mov)(\?|$)/i.test(src || '');
}

function vgGetBackgroundSrc(graphic) {
    const theme = VG_THEMES[vgResolveTheme()] || VG_THEMES.kri;
    return theme.backgrounds[graphic] || null;
}

function vgGetBgEl() {
    return document.getElementById('vgBg');
}

function vgGetLayerEl() {
    return document.getElementById('vgLayer');
}

function vgGetBgVideo() {
    const bg = vgGetBgEl();
    if (!bg) return null;
    return bg.querySelector('video.vg-bg-video');
}

function vgEnsureBgVideo() {
    const bg = vgGetBgEl();
    if (!bg) return null;
    let video = bg.querySelector('video.vg-bg-video');
    if (!video) {
        video = document.createElement('video');
        video.className = 'vg-bg-video';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.setAttribute('aria-hidden', 'true');
        bg.appendChild(video);
    }
    video.loop = false;
    return video;
}

function vgClearPlaybackTimers() {
    if (vgPlayback.introTimer) {
        clearTimeout(vgPlayback.introTimer);
        vgPlayback.introTimer = null;
    }
    if (vgPlayback.outroTimer) {
        clearTimeout(vgPlayback.outroTimer);
        vgPlayback.outroTimer = null;
    }
    if (vgPlayback.rewindRaf) {
        cancelAnimationFrame(vgPlayback.rewindRaf);
        vgPlayback.rewindRaf = null;
    }
    const video = vgGetBgVideo();
    if (video && vgPlayback.onVideoTime) {
        video.removeEventListener('timeupdate', vgPlayback.onVideoTime);
        vgPlayback.onVideoTime = null;
    }
}

function vgSetStageState(state) {
    vgPlayback.state = state;
    const stage = document.querySelector('.vg-stage');
    if (stage) {
        stage.dataset.vgState = state;
    }
}

function vgShowBackground(visible) {
    const bg = vgGetBgEl();
    if (!bg) return;
    bg.classList.toggle('vg-bg--visible', visible);
    bg.classList.toggle('vg-bg--outro', vgPlayback.state === 'outro');
}

function vgShowTextLayer(visible, opts = {}) {
    const layer = vgGetLayerEl();
    if (!layer) return;
    layer.classList.toggle('vg-layer--visible', visible);
    if (visible && opts.fadeIn) {
        layer.classList.add('vg-layer--fade-in');
    }
    if (!visible) {
        layer.classList.remove('vg-layer--fade-in');
    }
}

function vgSyncLayerVisibility(layer) {
    if (!layer) return;
    if (vgPlayback.state === 'hold' || vgPlayback.state === 'outro') {
        layer.classList.add('vg-layer--visible');
    } else {
        layer.classList.remove('vg-layer--visible', 'vg-layer--fade-in');
    }
}

function vgSetLayerGraphicClass(layer, modifier) {
    layer.className = `vg-layer ${modifier}`;
    vgSyncLayerVisibility(layer);
}

function vgLoadBackgroundAsset(graphic) {
    const bg = vgGetBgEl();
    if (!bg) return { isVideo: false };
    const src = vgGetBackgroundSrc(graphic);

    if (src && vgIsVideoAsset(src)) {
        const video = vgEnsureBgVideo();
        bg.style.backgroundImage = '';
        bg.classList.remove('vg-bg--plain');
        if (video.dataset.src !== src) {
            video.dataset.src = src;
            video.src = src;
            video.load();
        }
        return { isVideo: true, video };
    }

    const video = vgGetBgVideo();
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.remove();
    }

    if (src) {
        bg.style.backgroundImage = `url('${src}')`;
        bg.classList.remove('vg-bg--plain');
    } else {
        bg.style.backgroundImage = '';
        bg.classList.add('vg-bg--plain');
    }
    return { isVideo: false };
}

function vgResetBackground() {
    const bg = vgGetBgEl();
    const video = vgGetBgVideo();
    if (video) {
        video.pause();
        video.playbackRate = 1;
        video.currentTime = 0;
    }
    if (bg) {
        bg.style.backgroundImage = '';
        bg.classList.remove(
            'vg-bg--visible',
            'vg-bg--outro',
            'vg-bg--plain',
            'vg-bg--fade-in',
        );
    }
    vgHideMap();
}

function vgGetMapWrap() {
    return document.getElementById('vgMapWrap');
}

function vgEnsureMapFrame() {
    let wrap = vgGetMapWrap();
    if (!wrap) {
        const stage = document.querySelector('.vg-stage');
        if (!stage) return null;
        wrap = document.createElement('div');
        wrap.id = 'vgMapWrap';
        wrap.className = 'vg-map-wrap';
        wrap.innerHTML =
            '<iframe class="vg-map-frame" id="vgMapFrame" title="Altitude HD speed overlay"></iframe>';
        stage.insertBefore(wrap, vgGetBgEl()?.nextSibling || null);
    }
    return wrap;
}

function vgLoadSpeedFrame() {
    const wrap = vgEnsureMapFrame();
    const frame = vgGetSpeedFrame();
    const embedUrl = vgBuildSpeedEmbedUrl();
    if (!wrap || !frame) return;
    if (frame.dataset.srcUrl !== embedUrl) {
        frame.dataset.srcUrl = embedUrl;
        frame.dataset.loaded = '0';
        frame.src = embedUrl;
    }
}

function vgStartSpeedIntro() {
    vgShowTextLayer(false);
    vgShowBackground(false);
    vgLoadSpeedFrame();
    vgShowMap(true, false);

    const frame = vgGetSpeedFrame();
    const sendIntro = () => vgPostToSpeedFrame('intro');
    if (frame) {
        if (frame.dataset.loaded === '1') {
            sendIntro();
        } else {
            frame.addEventListener('load', () => {
                frame.dataset.loaded = '1';
                sendIntro();
            }, { once: true });
        }
    }
    vgPlayback.introTimer = setTimeout(() => vgEnterHold(), 4500);
}

function vgShowMap(visible, outro) {
    const wrap = vgEnsureMapFrame();
    if (!wrap) return;
    wrap.classList.toggle('vg-map-wrap--visible', visible);
    wrap.classList.toggle('vg-map-wrap--outro', !!outro && visible);
}

function vgHideMap() {
    const wrap = vgGetMapWrap();
    if (wrap) {
        wrap.classList.remove('vg-map-wrap--visible', 'vg-map-wrap--outro');
    }
}

function vgMilfordDrawResultsHoldMs() {
    const theme = document.body?.dataset?.vmixTheme;
    const graphic = vgPlayback.graphic;
    if (theme === 'rnz-milford' && (graphic === 'draw' || graphic === 'results')) {
        return VG_MILFORD_DRAW_RESULTS_HOLD_MS;
    }
    return VG_HOLD_MS;
}

function vgHoldDelayMs(video) {
    const holdMs = vgMilfordDrawResultsHoldMs();
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
        return Math.min(holdMs, Math.max(0, video.duration * 1000 - 80));
    }
    return holdMs;
}

function vgPauseVideoAtHoldPoint(video) {
    if (!video) return;
    const theme = document.body?.dataset?.vmixTheme;
    const graphic = vgPlayback.graphic;
    if (theme === 'rnz-milford' && (graphic === 'draw' || graphic === 'results')) {
        const target = 6;
        const t = Number.isFinite(video.duration)
            ? Math.min(target, Math.max(0, video.duration - 0.05))
            : target;
        video.currentTime = t;
    }
    video.pause();
    video.playbackRate = 1;
}

function vgIsKriTheme() {
    return document.body?.dataset?.vmixTheme === 'kri';
}

/** KRI PNG graphics: background and text fade in together on hold. */
function vgKriDefersBackgroundFade() {
    return vgIsKriTheme();
}

function vgStartIntroPlayback(isVideo, video) {
    vgShowBackground(!vgKriDefersBackgroundFade());
    vgShowTextLayer(false);

    if (isVideo && video) {
        video.loop = false;
        video.playbackRate = 1;
        video.currentTime = 0;
        const onPlay = () => {
            vgPlayback.introTimer = setTimeout(
                () => vgEnterHold(),
                vgHoldDelayMs(video),
            );
        };
        if (video.readyState >= 2) {
            video.play().then(onPlay).catch(onPlay);
        } else {
            video.addEventListener(
                'loadeddata',
                () => video.play().then(onPlay).catch(onPlay),
                { once: true },
            );
        }
        return;
    }

    vgPlayback.introTimer = setTimeout(() => vgEnterHold(), VG_HOLD_MS);
}

function vgEnterHold() {
    if (vgPlayback.state !== 'intro') return;
    vgClearPlaybackTimers();
    vgPauseVideoAtHoldPoint(vgGetBgVideo());
    vgSetStageState('hold');
    if (vgIsSpeedGraphic(vgPlayback.graphic)) {
        vgShowTextLayer(false);
        vgShowMap(true, false);
    } else {
        if (vgKriDefersBackgroundFade()) {
            vgShowBackground(true);
            const bg = vgGetBgEl();
            if (bg) bg.classList.add('vg-bg--fade-in');
        }
        vgShowTextLayer(true, { fadeIn: true });
        vgApplySavedLayout(vgPlayback.graphic);
    }
}

function vgPlayVideoReverseRaf(video, startTime, onDone) {
    let finished = false;
    const done = () => {
        if (finished) return;
        finished = true;
        if (vgPlayback.outroTimer) {
            clearTimeout(vgPlayback.outroTimer);
            vgPlayback.outroTimer = null;
        }
        if (vgPlayback.rewindRaf) {
            cancelAnimationFrame(vgPlayback.rewindRaf);
            vgPlayback.rewindRaf = null;
        }
        video.pause();
        video.playbackRate = 1;
        video.currentTime = 0;
        onDone();
    };

    video.pause();
    video.playbackRate = 1;
    video.currentTime = startTime;

    const rewindMs = Math.max(VG_OUTRO_MS, startTime * 1000);
    const t0 = performance.now();

    const tick = (now) => {
        const progress = Math.min(1, (now - t0) / rewindMs);
        video.currentTime = Math.max(0, startTime * (1 - progress));
        if (progress < 1) {
            vgPlayback.rewindRaf = requestAnimationFrame(tick);
        } else {
            video.currentTime = 0;
            done();
        }
    };

    vgPlayback.rewindRaf = requestAnimationFrame(tick);
    vgPlayback.outroTimer = setTimeout(done, rewindMs + 400);
}

function vgPlayVideoReverse(video, onDone) {
    let finished = false;
    const done = () => {
        if (finished) return;
        finished = true;
        vgClearPlaybackTimers();
        video.pause();
        video.playbackRate = 1;
        video.currentTime = 0;
        onDone();
    };

    video.loop = false;
    video.pause();
    video.playbackRate = 1;

    const startTime = Math.max(
        0,
        Math.min(
            video.currentTime || 0,
            Number.isFinite(video.duration) ? video.duration : VG_HOLD_MS / 1000,
        ),
    );

    if (startTime <= 0.02) {
        done();
        return;
    }

    const rewindMs = Math.max(VG_OUTRO_MS, startTime * 1000);

    const startRafFallback = () => {
        vgPlayVideoReverseRaf(video, startTime, onDone);
    };

    const startNative = () => {
        video.currentTime = startTime;
        video.playbackRate = -1;
        const onTime = () => {
            if (video.currentTime <= 0.05) {
                done();
            }
        };
        vgPlayback.onVideoTime = onTime;
        video.addEventListener('timeupdate', onTime);

        let lastT = startTime;
        let stallTicks = 0;
        const stallId = setInterval(() => {
            if (finished) {
                clearInterval(stallId);
                return;
            }
            if (video.playbackRate < 0 && video.currentTime >= lastT - 0.001) {
                stallTicks += 1;
                if (stallTicks >= 10) {
                    clearInterval(stallId);
                    video.removeEventListener('timeupdate', onTime);
                    vgPlayback.onVideoTime = null;
                    video.pause();
                    video.playbackRate = 1;
                    startRafFallback();
                }
            } else {
                stallTicks = 0;
            }
            lastT = video.currentTime;
        }, 100);

        const playPromise = video.play();
        const armTimeout = () => {
            vgPlayback.outroTimer = setTimeout(() => {
                clearInterval(stallId);
                done();
            }, rewindMs + 800);
        };
        if (playPromise && typeof playPromise.then === 'function') {
            playPromise.then(armTimeout).catch(() => {
                clearInterval(stallId);
                video.removeEventListener('timeupdate', onTime);
                vgPlayback.onVideoTime = null;
                startRafFallback();
            });
        } else {
            armTimeout();
        }
    };

    if (video.readyState >= 1) {
        startNative();
    } else {
        video.addEventListener('loadeddata', startNative, { once: true });
    }
}

function vgStartOutroPlayback(isVideo, video) {
    const graphic = vgPlayback.graphic;
    const done = () => {
        vgClearPlaybackTimers();
        vgShowTextLayer(false);
        vgResetToIdle();
    };

    if (vgIsSpeedGraphic(graphic)) {
        vgShowBackground(false);
        vgShowMap(true, false);
        vgPostToSpeedFrame('outro');
        vgPlayback.outroTimer = setTimeout(done, 6000);
        return;
    }

    vgShowBackground(true);
    const bg = vgGetBgEl();
    if (bg) bg.classList.add('vg-bg--outro');

    if (isVideo && video) {
        vgPlayVideoReverse(video, done);
        return;
    }

    vgPlayback.outroTimer = setTimeout(done, VG_OUTRO_MS);
}

function vgResetToIdle() {
    vgPostToSpeedFrame('clear');
    vgClearPlaybackTimers();
    vgPlayback.graphic = null;
    vgSetStageState('idle');
    vgShowTextLayer(false);
    vgShowBackground(false);
    vgResetBackground();
    const layer = vgGetLayerEl();
    if (layer) layer.replaceChildren();
}

function vgTriggerIn(graphic) {
    if (vgPlayback.state !== 'idle') return;
    if (vgIsSpeedGraphic(graphic) && !vgSpeedEnabled()) return;

    vgPlayback.graphic = graphic;
    vgSetStageState('intro');
    vgHideMap();

    if (vgIsSpeedGraphic(graphic)) {
        vgStartSpeedIntro();
        return;
    }

    vgPrepareContent(graphic, vgGetRaceParam());
    const { isVideo, video } = vgLoadBackgroundAsset(graphic);
    vgStartIntroPlayback(isVideo, video);
}

function vgTriggerOut() {
    if (vgPlayback.state !== 'hold') return;
    vgSetStageState('outro');
    const graphic = vgPlayback.graphic;
    if (vgIsSpeedGraphic(graphic)) {
        vgStartOutroPlayback(false, null);
        return;
    }
    const video = vgGetBgVideo();
    vgStartOutroPlayback(
        !!video && vgIsVideoAsset(vgGetBackgroundSrc(graphic)),
        video,
    );
}

function vgTriggerClear() {
    vgClearPlaybackTimers();
    vgResetToIdle();
}

function vgPrepareContent(graphic, raceParam) {
    const layer = vgGetLayerEl();
    const err = document.getElementById('vgError');
    if (!layer) return;
    if (vgIsSpeedGraphic(graphic)) return;

    const race = vgFindRace(raceParam);

    if (!race && graphic !== 'title') {
        if (err) {
            err.hidden = false;
            err.textContent = 'No race data — check regatta code and daysheet.';
        }
        layer.replaceChildren();
        return;
    }
    if (err) err.hidden = true;

    layer.replaceChildren();
    if (graphic === 'title') vgRenderTitle(layer, race);
    else if (graphic === 'lower') vgRenderLower(layer, race);
    else if (graphic === 'draw') vgRenderDraw(layer, race);
    else if (graphic === 'results') vgRenderResults(layer, race);

    vgSyncLayerVisibility(layer);
    vgApplySavedLayout(graphic);
}

function vgApplySavedLayout(graphic) {
    const theme = document.body?.dataset?.vmixTheme;
    if (!theme || !graphic || !window.VmixLayout) return;
    window.VmixLayout.apply(theme, graphic);
}

function vgEl(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
}

function vgRenderTitle(layer, race) {
    vgSetLayerGraphicClass(layer, 'vg-layer--title');
    layer.dataset.vgLayout = 'title';
    const code = vgState.regattaCode.toUpperCase();
    const day = race
        ? vgFormatDayLabel(race.dayLabel)
        : vgState.races[0]
          ? vgFormatDayLabel(vgState.races[0].dayLabel)
          : '';
    layer.appendChild(vgEl('h1', 'vg-title-code', code));
    if (day) layer.appendChild(vgEl('p', 'vg-title-date', day));
}

function vgRenderLower(layer, race) {
    vgSetLayerGraphicClass(layer, 'vg-layer--lower');
    layer.dataset.vgLayout = 'lower';
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    const meta = [race.round, race.progression].filter(Boolean).join(' · ');
    if (meta) {
        const metaEl = vgEl('p', 'vg-lower-meta', meta);
        metaEl.dataset.vgLayout = 'lower-meta';
        layer.appendChild(metaEl);
    }
    const raceEl = vgEl(
        'p',
        'vg-lower-race',
        `Race ${race.race} · ${vgFormatTime(race.startAt)}`,
    );
    raceEl.dataset.vgLayout = 'lower-race';
    layer.appendChild(raceEl);
    const eventEl = vgEl('h2', 'vg-lower-event', fullName);
    eventEl.dataset.vgLayout = 'lower-event';
    layer.appendChild(eventEl);
}

function vgThemeId() {
    return document.body?.dataset?.vmixTheme || '';
}

/** Lane/placing numbers are baked into KRI & Milford PNG/WebM backgrounds. */
function vgShowLaneNumber() {
    const theme = vgThemeId();
    return theme !== 'kri' && theme !== 'rnz-milford';
}

function vgShowAthleteNames(mode) {
    if (mode === 'draw') return false;
    const theme = vgThemeId();
    return theme !== 'kri' && theme !== 'rnz-milford';
}

function vgBuildLaneRow(entry, lookup, mode) {
    const li = vgEl('li', `vg-lane${mode === 'draw' ? ' vg-lane--draw' : ''}`);
    const club = vgParseClubCode(entry.code);
    const info = vgClubInfo(club.id, lookup);
    if (vgShowLaneNumber()) {
        li.appendChild(vgEl('span', 'vg-lane-n', String(entry.lane)));
    }
    if (info.logoUrl) {
        const img = document.createElement('img');
        img.className = 'vg-lane-logo';
        img.src = info.logoUrl;
        img.alt = '';
        if (mode === 'draw') {
            img.dataset.vgLayoutTarget = 'draw-logo';
        } else {
            img.dataset.vgLayoutTarget = 'results-logo';
        }
        li.appendChild(img);
    } else {
        li.appendChild(vgEl('span', 'vg-lane-logo vg-lane-logo--empty', '—'));
    }
    const crew = vgEl('div', 'vg-lane-crew');
    crew.dataset.vgLayoutTarget = mode === 'draw' ? 'draw-crew' : 'results-crew';
    crew.appendChild(vgEl('span', 'vg-lane-club', info.name));
    if (entry.names && vgShowAthleteNames(mode)) {
        crew.appendChild(vgEl('span', 'vg-lane-names', entry.names));
    }
    li.appendChild(crew);
    if (entry.time) {
        li.appendChild(vgEl('span', 'vg-lane-time', entry.time));
    }
    return li;
}

function vgRenderDraw(layer, race) {
    vgSetLayerGraphicClass(layer, 'vg-layer--draw');
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    const head = vgEl('div', 'vg-draw-head');
    head.appendChild(
        vgEl(
            'p',
            'vg-draw-meta',
            `Race ${race.race} · ${race.round}${race.division ? ` · Div ${race.division}` : ''}`,
        ),
    );
    head.appendChild(vgEl('h2', 'vg-draw-event', fullName));
    head.dataset.vgLayout = 'draw-head';
    layer.appendChild(head);

    const list = vgEl('ul', 'vg-draw-lanes');
    list.dataset.vgLayout = 'draw-lanes';
    for (const lane of race.lanes) {
        if (!lane.code) continue;
        list.appendChild(
            vgBuildLaneRow(
                {
                    lane: lane.lane,
                    code: lane.code,
                },
                vgState.lookup,
                'draw',
            ),
        );
    }
    layer.appendChild(list);
}

function vgRenderResults(layer, race) {
    vgSetLayerGraphicClass(layer, 'vg-layer--results');
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    const head = vgEl('div', 'vg-draw-head');
    head.appendChild(
        vgEl('p', 'vg-draw-meta', `Race ${race.race} · ${race.round} · Results`),
    );
    head.appendChild(vgEl('h2', 'vg-draw-event', fullName));
    head.dataset.vgLayout = 'results-head';
    layer.appendChild(head);

    const result = vgState.results.get(race.raceNum);
    const list = vgEl('ul', 'vg-draw-lanes vg-draw-lanes--results');
    list.dataset.vgLayout = 'results-lanes';
    if (result?.placings?.length) {
        for (const p of result.placings) {
            const laneRef = { lane: p.place, code: p.competitor };
            list.appendChild(
                vgBuildLaneRow(
                    {
                        lane: p.place,
                        code: p.competitor,
                        names: vgCompetitorNames(race, laneRef),
                        time: p.time,
                    },
                    vgState.lookup,
                    'results',
                ),
            );
        }
    } else {
        list.appendChild(vgEl('li', 'vg-lane vg-lane--empty', 'Results not available'));
    }
    layer.appendChild(list);
}

function vgRefreshHoldContent() {
    if (vgPlayback.state === 'hold' && vgPlayback.graphic) {
        vgPrepareContent(vgPlayback.graphic, vgGetRaceParam());
    }
}

function vgHandleRemoteTrigger(raw) {
    if (!raw) return;
    try {
        const msg = JSON.parse(raw);
        if (msg.action === 'out') {
            vgTriggerOut();
            return;
        }
        if (msg.action === 'clear' || msg.action === 'c') {
            vgTriggerClear();
            return;
        }
        if (msg.action === 'in' && msg.graphic) {
            const g = VG_GRAPHIC_ALIASES[msg.graphic] || msg.graphic;
            vgTriggerIn(g);
        }
    } catch {
        /* ignore */
    }
}

function vgBindKeyboard() {
    document.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.target.closest('input, textarea, select')) return;
        const key = e.key.toLowerCase();
        if (key === 'o') {
            e.preventDefault();
            vgTriggerOut();
            return;
        }
        if (key === 'c') {
            e.preventDefault();
            vgTriggerClear();
            return;
        }
        const graphic = VG_GRAPHIC_ALIASES[key];
        if (graphic) {
            e.preventDefault();
            vgTriggerIn(graphic);
        }
    });

    window.addEventListener('storage', (e) => {
        if (e.key === VG_LS_LIVE_RACE) vgRefreshHoldContent();
        if (e.key === VG_LS_TRIGGER) vgHandleRemoteTrigger(e.newValue);
    });
}

function vgBindRemoteTriggers() {
    const params = new URLSearchParams(location.search);
    const action = (params.get('action') || params.get('a') || '').toLowerCase();
    if (action === 'out' || action === 'o') {
        vgTriggerOut();
        return;
    }
    if (action === 'clear' || action === 'c') {
        vgTriggerClear();
        return;
    }
    const g = params.get('g') || params.get('graphic');
    if (!g) return;
    const graphic = VG_GRAPHIC_ALIASES[g.toLowerCase()];
    if (!graphic) return;
    if (params.get('autoplay') === '1' || params.get('play') === '1') {
        vgTriggerIn(graphic);
    }
}

async function vgReload() {
    vgState.regattaCode = vgGetRegattaCode();
    const [lookup, daysheetText, competitorsText, resultsText] =
        await Promise.all([
            vgLoadLookup(),
            vgFetchCsv(vgGetCsvUrl('daysheet')),
            vgFetchCsv(vgGetCsvUrl('competitors')).catch(() => ''),
            vgFetchCsv(vgGetCsvUrl('results')).catch(() => ''),
        ]);
    vgState.lookup = lookup;
    vgState.races = vgParseDaysheet(daysheetText);
    vgState.competitors = vgParseCompetitors(competitorsText);
    vgState.results = vgParseResults(resultsText);
}

async function vgInit() {
    vgResetToIdle();
    vgBindKeyboard();

    try {
        await vgReload();
    } catch (e) {
        const err = document.getElementById('vgError');
        if (err) {
            err.hidden = false;
            err.textContent =
                e instanceof Error ? e.message : 'Failed to load graphics data';
        }
    }

    vgBindRemoteTriggers();

    document.addEventListener('altitudehd:liverace', () => vgRefreshHoldContent());
    document.addEventListener('altitudehd:vmixtrigger', (e) => {
        vgHandleRemoteTrigger(JSON.stringify(e.detail || {}));
    });

    window.addEventListener('message', (e) => {
        if (e.data?.type !== 'altitudehd:vg') return;
        if (!vgIsSpeedGraphic(vgPlayback.graphic)) return;
        if (e.data.phase === 'hold' && vgPlayback.state === 'intro') {
            vgClearPlaybackTimers();
            vgEnterHold();
        }
        if (e.data.phase === 'idle' && vgPlayback.state === 'outro') {
            vgClearPlaybackTimers();
            vgResetToIdle();
        }
    });

    setInterval(async () => {
        try {
            await vgReload();
            vgRefreshHoldContent();
        } catch {
            /* ignore refresh errors */
        }
    }, 60000);
}

/** Dev layout editor (?dev=1) — show graphic on hold with background + text visible. */
function vgDevPreviewHold(graphic) {
    vgClearPlaybackTimers();
    vgPlayback.graphic = graphic;
    vgPrepareContent(graphic, vgGetRaceParam());
    const { isVideo, video } = vgLoadBackgroundAsset(graphic);
    vgSetStageState('hold');
    vgShowBackground(true);
    vgShowTextLayer(true);
    if (isVideo && video) {
        vgPauseVideoAtHoldPoint(video);
    }
    vgApplySavedLayout(graphic);
}

window.VmixGraphics = {
    triggerIn: vgTriggerIn,
    triggerOut: vgTriggerOut,
    triggerClear: vgTriggerClear,
    getState: () => vgPlayback.state,
    devPreviewHold: vgDevPreviewHold,
};
window.AltitudeHdVmix = window.VmixGraphics;

document.addEventListener('DOMContentLoaded', vgInit);
