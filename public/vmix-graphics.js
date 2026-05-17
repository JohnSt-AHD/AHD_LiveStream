/**
 * vMix broadcast graphics — title, lower third, draw, results.
 * URL: ?g=d|l|r|t  &race=12  &regatta=mads2026
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

function vgResolveGraphic() {
    const p = new URLSearchParams(location.search);
    const g = (p.get('g') || p.get('graphic') || 'lower').toLowerCase();
    return VG_GRAPHIC_ALIASES[g] || 'lower';
}

function vgResolveTheme() {
    return document.body.dataset.vmixTheme || 'kri';
}

function vgIsVideoAsset(src) {
    return /\.(mp4|webm|mov)(\?|$)/i.test(src || '');
}

function vgSetBackground(graphic) {
    const bg = document.getElementById('vgBg');
    if (!bg) return;
    const theme = VG_THEMES[vgResolveTheme()] || VG_THEMES.kri;
    const src = theme.backgrounds[graphic];
    let video = bg.querySelector('video.vg-bg-video');

    if (src && vgIsVideoAsset(src)) {
        if (!video) {
            video = document.createElement('video');
            video.className = 'vg-bg-video';
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.autoplay = true;
            video.setAttribute('aria-hidden', 'true');
            bg.appendChild(video);
        }
        bg.style.backgroundImage = '';
        if (video.dataset.src !== src) {
            video.dataset.src = src;
            video.src = src;
            video.load();
        }
        video.play().catch(() => {});
        bg.classList.remove('vg-bg--plain');
        return;
    }

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
}

function vgEl(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
}

function vgRenderTitle(layer, race) {
    layer.className = 'vg-layer vg-layer--title';
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
    layer.className = 'vg-layer vg-layer--lower';
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    layer.appendChild(
        vgEl('p', 'vg-lower-race', `Race ${race.race} · ${vgFormatTime(race.startAt)}`),
    );
    layer.appendChild(vgEl('h2', 'vg-lower-event', fullName));
    const meta = [race.round, race.progression].filter(Boolean).join(' · ');
    if (meta) layer.appendChild(vgEl('p', 'vg-lower-meta', meta));
}

function vgBuildLaneRow(entry, lookup) {
    const li = vgEl('li', 'vg-lane');
    const club = vgParseClubCode(entry.code);
    const info = vgClubInfo(club.id, lookup);
    if (info.logoUrl) {
        const img = document.createElement('img');
        img.className = 'vg-lane-logo';
        img.src = info.logoUrl;
        img.alt = '';
        li.appendChild(img);
    } else {
        li.appendChild(vgEl('span', 'vg-lane-logo vg-lane-logo--empty', '—'));
    }
    li.appendChild(vgEl('span', 'vg-lane-n', String(entry.lane)));
    const crew = vgEl('div', 'vg-lane-crew');
    crew.appendChild(vgEl('span', 'vg-lane-club', info.name));
    if (entry.names) {
        crew.appendChild(vgEl('span', 'vg-lane-names', entry.names));
    }
    li.appendChild(crew);
    if (entry.time) {
        li.appendChild(vgEl('span', 'vg-lane-time', entry.time));
    }
    return li;
}

function vgRenderDraw(layer, race) {
    layer.className = 'vg-layer vg-layer--draw';
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    const head = vgEl('div', 'vg-draw-head');
    head.appendChild(vgEl('h2', 'vg-draw-event', fullName));
    head.appendChild(
        vgEl(
            'p',
            'vg-draw-meta',
            `Race ${race.race} · ${race.round}${race.division ? ` · Div ${race.division}` : ''}`,
        ),
    );
    layer.appendChild(head);

    const list = vgEl('ul', 'vg-draw-lanes');
    for (const lane of race.lanes) {
        if (!lane.code) continue;
        list.appendChild(
            vgBuildLaneRow(
                {
                    lane: lane.lane,
                    code: lane.code,
                    names: vgCompetitorNames(race, lane),
                },
                vgState.lookup,
            ),
        );
    }
    layer.appendChild(list);
}

function vgRenderResults(layer, race) {
    layer.className = 'vg-layer vg-layer--results';
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    const head = vgEl('div', 'vg-draw-head');
    head.appendChild(vgEl('h2', 'vg-draw-event', fullName));
    head.appendChild(
        vgEl('p', 'vg-draw-meta', `Race ${race.race} · ${race.round} · Results`),
    );
    layer.appendChild(head);

    const result = vgState.results.get(race.raceNum);
    const list = vgEl('ul', 'vg-draw-lanes vg-draw-lanes--results');
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
                ),
            );
        }
    } else {
        list.appendChild(vgEl('li', 'vg-lane vg-lane--empty', 'Results not available'));
    }
    layer.appendChild(list);
}

function vgRender(graphic, raceParam) {
    const layer = document.getElementById('vgLayer');
    const err = document.getElementById('vgError');
    if (!layer) return;

    vgSetBackground(graphic);
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

function vgRefreshGraphic() {
    vgRender(vgResolveGraphic(), vgGetRaceParam());
}

async function vgInit() {
    const graphic = vgResolveGraphic();

    try {
        await vgReload();
        vgRender(graphic, vgGetRaceParam());
    } catch (e) {
        const err = document.getElementById('vgError');
        if (err) {
            err.hidden = false;
            err.textContent =
                e instanceof Error ? e.message : 'Failed to load graphics data';
        }
    }

    window.addEventListener('storage', (e) => {
        if (e.key === VG_LS_LIVE_RACE) vgRefreshGraphic();
    });
    document.addEventListener('altitudehd:liverace', () => vgRefreshGraphic());

    setInterval(async () => {
        try {
            await vgReload();
            vgRefreshGraphic();
        } catch {
            /* ignore refresh errors */
        }
    }, 60000);
}

document.addEventListener('DOMContentLoaded', vgInit);
