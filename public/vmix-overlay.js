/**
 * vMix transparent overlay (1920×1080) — regatta graphics from RowIT CSV.
 */
const VMIX_THEMES = {
    kri: {
        title: 'KRI',
        subtitle: 'Live',
        logos: [],
    },
    'rnz-milford': {
        title: 'RNZ',
        subtitle: 'Milford',
        logos: [
            { src: 'assets/rnz/rnz-logo-white.png', alt: 'Rowing New Zealand' },
            { src: 'Milford_Tracker.png', alt: 'Milford' },
        ],
    },
    'beachsprints-milford': {
        title: 'Beach Sprints',
        subtitle: 'Milford',
        logos: [],
    },
};

const DEFAULT_CSV = {
    daysheet: 'https://l.rowit.nz/altitude/mads2026/daysheet.csv',
    results: 'https://l.rowit.nz/altitude/mads2026/results.csv',
};

const MONTHS = {
    january: 0,
    jan: 0,
    february: 1,
    feb: 1,
    march: 2,
    mar: 2,
    april: 3,
    apr: 3,
    may: 4,
    june: 5,
    jun: 5,
    july: 6,
    jul: 6,
    august: 7,
    aug: 7,
    september: 8,
    sep: 8,
    sept: 8,
    october: 9,
    oct: 9,
    november: 10,
    nov: 10,
    december: 11,
    dec: 11,
};

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
    const m = line.match(
        /DAY\s+\d+:\s+\w+\s+(\d{1,2})(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/i,
    );
    if (!m) return null;
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined) return null;
    return {
        date: new Date(parseInt(m[3], 10), month, parseInt(m[1], 10)),
        label: line.trim(),
    };
}

function parseRaceLabel(raw) {
    const m = String(raw || '').trim().match(/^(\d+)\s*\(([A-Za-z])\)\s*$/);
    if (!m) return { raceNum: null, label: String(raw || '').trim() };
    return {
        raceNum: parseInt(m[1], 10),
        label: `${m[1]} (${m[2].toUpperCase()})`,
    };
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

function parseLanes(cols) {
    const lanes = [];
    for (let lane = 1; lane <= 9; lane++) {
        const idx = 5 + lane;
        if (idx >= cols.length) break;
        lanes.push({
            lane,
            crew: (cols[idx] || '').trim() || null,
        });
    }
    let lastUsed = 0;
    for (const l of lanes) if (l.crew) lastUsed = l.lane;
    if (!lastUsed) return [];
    return lanes.filter((l) => l.lane <= lastUsed);
}

function parseDaysheetCsv(text) {
    const races = [];
    let dayDate = null;
    let dayLabel = '';

    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^DAY\s+\d+:/i.test(trimmed)) {
            const day = parseDayHeader(trimmed);
            if (day) {
                dayDate = day.date;
                dayLabel = day.label;
            }
            continue;
        }
        if (!dayDate || /^Race,/i.test(trimmed)) continue;

        const cols = parseCsvLine(trimmed);
        const raceInfo = parseRaceLabel(cols[0]);
        if (!raceInfo.raceNum) continue;
        const startAt = parseTimeOnDay(cols[1], dayDate);
        if (!startAt) continue;

        races.push({
            raceNum: raceInfo.raceNum,
            race: raceInfo.label,
            startAt,
            eventNum: cols[2].trim(),
            eventName: cols[3].trim(),
            round: cols[4].trim(),
            division: cols[5] ? cols[5].trim() : '',
            lanes: parseLanes(cols),
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
        if (!Number.isFinite(place) || place < 1 || place > 3 || !competitor) {
            continue;
        }
        placings.push({ place, competitor, time });
    }
    placings.sort((a, b) => a.place - b.place);
    return placings;
}

function parseResultsCsv(text) {
    const map = new Map();
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || !/^\d/.test(trimmed)) continue;
        const cols = parseCsvLine(trimmed);
        if (cols.length < 6) continue;
        const raceNum = parseInt(cols[0], 10);
        if (!Number.isFinite(raceNum)) continue;
        map.set(raceNum, {
            status: cols[5].trim(),
            placings: parseResultPlacings(cols),
        });
    }
    return map;
}

function formatYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatClock(d) {
    return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatRaceTime(d) {
    return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function getConfig() {
    const p = new URLSearchParams(location.search);
    let csv = { ...DEFAULT_CSV };
    try {
        const raw = localStorage.getItem('altitudeHdCsvUrls_v1');
        if (raw) csv = { ...csv, ...JSON.parse(raw) };
    } catch {
        /* ignore */
    }
    if (p.get('daysheet')) csv.daysheet = p.get('daysheet');
    if (p.get('results')) csv.results = p.get('results');

    let clock = {
        mode: 'live',
        fixedDate: '2026-03-23',
        fixedTime: '09:00',
        offsetMinutes: 0,
    };
    try {
        const raw = localStorage.getItem('altitudeHdClock_v1');
        if (raw) clock = { ...clock, ...JSON.parse(raw) };
    } catch {
        /* ignore */
    }
    if (p.get('mode') === 'fixed' || p.get('mode') === 'live') {
        clock.mode = p.get('mode');
    }
    if (p.get('fixedDate')) clock.fixedDate = p.get('fixedDate');
    if (p.get('fixedTime')) clock.fixedTime = p.get('fixedTime');
    if (p.has('offset')) {
        clock.offsetMinutes = parseInt(p.get('offset'), 10) || 0;
    }

    return {
        csv,
        clock,
        refreshMs: Math.max(5000, parseInt(p.get('refresh') || '60000', 10)),
        forceRaceNum: p.get('race') ? parseInt(p.get('race'), 10) : null,
    };
}

function getEffectiveNow(clock) {
    let base;
    if (clock.mode === 'fixed') {
        const [y, mo, d] = (clock.fixedDate || '').split('-').map(Number);
        const [h, mi] = (clock.fixedTime || '09:00').split(':').map(Number);
        base = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, 0, 0);
    } else {
        base = new Date();
    }
    const offsetMs = (Number(clock.offsetMinutes) || 0) * 60 * 1000;
    return new Date(base.getTime() + offsetMs);
}

function racesOnDate(races, date) {
    const ymd = formatYmd(date);
    return races.filter((r) => formatYmd(r.startAt) === ymd);
}

function pickCurrentRace(dayRaces, effectiveNow, forceRaceNum) {
    if (forceRaceNum) {
        const r = dayRaces.find((x) => x.raceNum === forceRaceNum);
        if (r) {
            const idx = dayRaces.indexOf(r);
            return { current: r, next: dayRaces[idx + 1] || null, dayLabel: r.dayLabel };
        }
    }
    let currentIndex = -1;
    for (let i = 0; i < dayRaces.length; i++) {
        if (dayRaces[i].startAt <= effectiveNow) currentIndex = i;
        else break;
    }
    const current =
        currentIndex >= 0
            ? dayRaces[currentIndex]
            : dayRaces[0] || null;
    const next =
        currentIndex >= 0
            ? dayRaces[currentIndex + 1] || null
            : dayRaces[1] || null;
    return {
        current,
        next,
        dayLabel: dayRaces[0]?.dayLabel || '',
    };
}

async function fetchCsvText(url) {
    try {
        const res = await fetch(
            `/api/fetch-csv?url=${encodeURIComponent(url.trim())}`,
        );
        if (res.ok) return res.text();
    } catch {
        /* direct */
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

const state = {
    config: getConfig(),
    races: [],
    results: new Map(),
    theme: null,
};

function applyTheme() {
    const id = document.body.dataset.vmixTheme || 'kri';
    state.theme = VMIX_THEMES[id] || VMIX_THEMES.kri;

    const titleEl = document.getElementById('vmixTitle');
    const subEl = document.getElementById('vmixSubtitle');
    if (titleEl) titleEl.textContent = state.theme.title;
    if (subEl) subEl.textContent = state.theme.subtitle;

    const logosEl = document.getElementById('vmixLogos');
    if (logosEl) {
        logosEl.replaceChildren();
        for (const logo of state.theme.logos || []) {
            const img = document.createElement('img');
            img.className = 'vmix-logo';
            img.src = logo.src;
            img.alt = logo.alt;
            logosEl.appendChild(img);
        }
    }
}

function renderLanes(container, lanes) {
    if (!container) return;
    if (!lanes?.length) {
        container.hidden = true;
        return;
    }
    container.hidden = false;
    const row = container.querySelector('.vmix-lane-row');
    if (!row) return;
    row.replaceChildren();
    for (const { lane, crew } of lanes) {
        const chip = document.createElement('span');
        chip.className = 'vmix-lane';
        const n = document.createElement('span');
        n.className = 'vmix-lane-n';
        n.textContent = String(lane);
        chip.appendChild(n);
        chip.appendChild(document.createTextNode(crew || '—'));
        row.appendChild(chip);
    }
}

function renderResults(panel, result) {
    if (!panel) return;
    const body = panel.querySelector('.vmix-results-body');
    if (!body) return;

    if (!result?.placings?.length) {
        panel.classList.add('vmix-results-panel--empty');
        body.textContent = 'Results pending';
        return;
    }
    panel.classList.remove('vmix-results-panel--empty');
    body.replaceChildren();
    for (const p of result.placings) {
        const line = document.createElement('div');
        line.className = 'vmix-result-line';
        const pos = document.createElement('span');
        pos.className = 'vmix-result-pos';
        pos.textContent = String(p.place);
        const crew = document.createElement('span');
        crew.textContent = p.competitor;
        const time = document.createElement('span');
        time.className = 'vmix-result-time';
        time.textContent = p.time || '—';
        line.appendChild(pos);
        line.appendChild(crew);
        line.appendChild(time);
        body.appendChild(line);
    }
}

function render() {
    const effectiveNow = getEffectiveNow(state.config.clock);
    const clockEl = document.getElementById('vmixClock');
    const dayEl = document.getElementById('vmixDayLabel');
    if (clockEl) clockEl.textContent = formatClock(effectiveNow);

    const dayRaces = racesOnDate(state.races, effectiveNow);
    const { current, next, dayLabel } = pickCurrentRace(
        dayRaces,
        effectiveNow,
        state.config.forceRaceNum,
    );

    if (dayEl) {
        dayEl.textContent = dayLabel
            ? dayLabel.replace(/^DAY\s+\d+:\s*/i, '')
            : '';
    }

    const errEl = document.getElementById('vmixError');
    if (!state.races.length) {
        if (errEl) {
            errEl.hidden = false;
            errEl.textContent = 'Loading daysheet…';
        }
        return;
    }
    if (errEl) errEl.hidden = true;

    const numEl = document.getElementById('vmixRaceNum');
    const timeEl = document.getElementById('vmixRaceTime');
    const nameEl = document.getElementById('vmixEventName');
    const metaEl = document.getElementById('vmixEventMeta');
    const statusEl = document.getElementById('vmixResultStatus');

    if (!current) {
        if (numEl) numEl.textContent = '—';
        if (nameEl) nameEl.textContent = 'No races today';
        return;
    }

    const result = state.results.get(current.raceNum);

    if (numEl) numEl.textContent = `Race ${current.race}`;
    if (timeEl) timeEl.textContent = formatRaceTime(current.startAt);
    if (nameEl) nameEl.textContent = current.eventName;
    if (metaEl) {
        metaEl.textContent = current.division
            ? `Event ${current.eventNum} · ${current.round} · Div ${current.division}`
            : `Event ${current.eventNum} · ${current.round}`;
    }
    if (statusEl) {
        if (result?.status) {
            statusEl.hidden = false;
            statusEl.textContent = result.status;
        } else {
            statusEl.hidden = true;
        }
    }

    renderLanes(document.getElementById('vmixLanes'), current.lanes);
    renderResults(document.getElementById('vmixResults'), result);

    const nextNum = document.getElementById('vmixNextRace');
    const nextEvent = document.getElementById('vmixNextEvent');
    const nextTime = document.getElementById('vmixNextTime');
    const nextBlock = document.getElementById('vmixNext');
    if (next && nextBlock) {
        nextBlock.hidden = false;
        if (nextNum) nextNum.textContent = `Race ${next.race}`;
        if (nextEvent) nextEvent.textContent = next.eventName;
        if (nextTime) nextTime.textContent = formatRaceTime(next.startAt);
    } else if (nextBlock) {
        nextBlock.hidden = true;
    }
}

async function reload() {
    try {
        const [daysheetText, resultsText] = await Promise.all([
            fetchCsvText(state.config.csv.daysheet),
            fetchCsvText(state.config.csv.results).catch(() => ''),
        ]);
        state.races = parseDaysheetCsv(daysheetText);
        state.results = resultsText
            ? parseResultsCsv(resultsText)
            : new Map();
    } catch (e) {
        const errEl = document.getElementById('vmixError');
        if (errEl) {
            errEl.hidden = false;
            errEl.textContent =
                e instanceof Error ? e.message : 'Failed to load data';
        }
    }
    render();
}

function init() {
    applyTheme();
    reload();
    setInterval(() => {
        if (state.config.clock.mode === 'live') render();
    }, 1000);
    setInterval(reload, state.config.refreshMs);
    setInterval(() => {
        state.config = getConfig();
    }, 2000);
}

document.addEventListener('DOMContentLoaded', init);
