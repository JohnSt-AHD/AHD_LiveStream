/**
 * Daysheet schedule board — parse RowIT CSV, clock modes, race window display.
 */
const LS_CLOCK = 'altitudeHdClock_v1';

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

const ROLE_LABELS = {
    prev2: '2 ago',
    prev1: 'Previous',
    current: 'Current',
    next1: 'Next',
    next2: 'Upcoming',
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
            } else if (c === '"') {
                inQ = false;
            } else {
                cur += c;
            }
        } else if (c === '"') {
            inQ = true;
        } else if (c === ',') {
            out.push(cur);
            cur = '';
        } else {
            cur += c;
        }
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
    return new Date(parseInt(m[3], 10), month, parseInt(m[1], 10));
}

function parseRaceLabel(raw) {
    const s = String(raw || '').trim();
    const withLetter = s.match(/^(\d+)\s*\(([A-Za-z])\)\s*$/);
    if (withLetter) {
        return {
            raceNum: parseInt(withLetter[1], 10),
            raceLetter: withLetter[2].toUpperCase(),
            label: `${withLetter[1]} (${withLetter[2].toUpperCase()})`,
        };
    }
    const plain = s.match(/^(\d+)$/);
    if (plain) {
        return {
            raceNum: parseInt(plain[1], 10),
            raceLetter: '',
            label: plain[1],
        };
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

function formatYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatClock(d) {
    return d.toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatRaceTime(d) {
    return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function parseDaysheetCsv(text) {
    const lines = text.split(/\r?\n/);
    const races = [];
    let dayDate = null;
    let dayLabel = '';
    let headerCols = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (/^DAY\s+\d+:/i.test(trimmed)) {
            dayLabel = trimmed;
            dayDate = parseDayHeader(trimmed);
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
            lanes: parseLanes(cols, headerCols),
            dayLabel,
        });
    }

    races.sort((a, b) => a.startAt - b.startAt);
    return races;
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
        lanes.push({ lane, crew: isCrewCell(crew) ? crew : null });
    }
    let lastUsed = 0;
    for (const l of lanes) {
        if (l.crew) lastUsed = l.lane;
    }
    if (!lastUsed) return [];
    return lanes.filter((l) => l.lane <= lastUsed);
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
            eventNum: cols[1].trim(),
            round: cols[2].trim(),
            division: cols[3].trim(),
            placings: parseResultPlacings(cols),
        });
    }
    return map;
}

function loadClockSettings() {
    const defaults = {
        mode: 'fixed',
        fixedDate: '2026-03-23',
        fixedTime: '09:00',
        offsetMinutes: 0,
        autoRefresh: false,
    };
    try {
        const raw = localStorage.getItem(LS_CLOCK);
        if (!raw) return defaults;
        return { ...defaults, ...JSON.parse(raw) };
    } catch {
        return defaults;
    }
}

function saveClockSettings(s) {
    try {
        localStorage.setItem(LS_CLOCK, JSON.stringify(s));
    } catch {
        /* ignore */
    }
}

function getEffectiveNow(settings) {
    let base;
    if (settings.mode === 'fixed') {
        const [y, mo, d] = (settings.fixedDate || '').split('-').map(Number);
        const [h, mi] = (settings.fixedTime || '09:00').split(':').map(Number);
        base = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, 0, 0);
    } else {
        base = new Date();
    }
    const offsetMs = (Number(settings.offsetMinutes) || 0) * 60 * 1000;
    return new Date(base.getTime() + offsetMs);
}

function racesOnDate(races, date) {
    const ymd = formatYmd(date);
    return races.filter((r) => formatYmd(r.startAt) === ymd);
}

function findRaceWindow(dayRaces, effectiveNow) {
    if (!dayRaces.length) {
        return { currentIndex: -1, slots: [] };
    }

    let currentIndex = -1;
    for (let i = 0; i < dayRaces.length; i++) {
        if (dayRaces[i].startAt <= effectiveNow) currentIndex = i;
        else break;
    }

    const indices =
        currentIndex < 0
            ? {
                  prev2: -1,
                  prev1: -1,
                  current: -1,
                  next1: 0,
                  next2: 1,
              }
            : {
                  prev2: currentIndex - 2,
                  prev1: currentIndex - 1,
                  current: currentIndex,
                  next1: currentIndex + 1,
                  next2: currentIndex + 2,
              };

    const slots = Object.entries(indices).map(([role, index]) => ({
        role,
        race:
            index >= 0 && index < dayRaces.length ? dayRaces[index] : null,
    }));

    return { currentIndex, slots };
}

async function fetchCsvText(url) {
    const trimmed = (url || '').trim();
    if (!trimmed) throw new Error('No URL configured');

    try {
        const res = await fetch(
            `/api/fetch-csv?url=${encodeURIComponent(trimmed)}`,
        );
        if (res.ok) return res.text();
    } catch {
        /* direct */
    }

    const res = await fetch(trimmed);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

function getCsvUrl(id) {
    if (window.AltitudeHdHub && typeof window.AltitudeHdHub.getCsvUrl === 'function') {
        return window.AltitudeHdHub.getCsvUrl(id);
    }
    const code = 'mads2026';
    const defaults = {
        daysheet: `https://l.rowit.nz/altitude/${code}/daysheet.csv`,
        results: `https://l.rowit.nz/altitude/${code}/results.csv`,
    };
    return defaults[id] || '';
}

const boardState = {
    races: [],
    results: new Map(),
    settings: loadClockSettings(),
    refreshTimer: null,
    tickTimer: null,
    loading: false,
};

function renderPlacingsList(placings) {
    const ol = document.createElement('ol');
    ol.className = 'hub-race-placings';
    ol.setAttribute('aria-label', 'Top three results');

    for (const p of placings) {
        const item = document.createElement('li');
        item.className = 'hub-race-placing';

        const place = document.createElement('span');
        place.className = 'hub-race-placing-pos';
        place.textContent = String(p.place);

        const crew = document.createElement('span');
        crew.className = 'hub-race-placing-crew';
        crew.textContent = p.competitor;

        const time = document.createElement('span');
        time.className = 'hub-race-placing-time';
        time.textContent = p.time || '—';

        item.appendChild(place);
        item.appendChild(crew);
        item.appendChild(time);
        ol.appendChild(item);
    }

    return ol;
}

function renderLaneDraw(lanes) {
    const wrap = document.createElement('div');
    wrap.className = 'hub-lane-draw';
    wrap.setAttribute('aria-label', 'Lane draw');

    const grid = document.createElement('div');
    grid.className = 'hub-lane-grid';

    for (const { lane, crew } of lanes) {
        const chip = document.createElement('span');
        chip.className = crew ? 'hub-lane' : 'hub-lane hub-lane--empty';

        const num = document.createElement('span');
        num.className = 'hub-lane-n';
        num.textContent = String(lane);
        chip.appendChild(num);

        const name = document.createElement('span');
        name.className = 'hub-lane-crew';
        name.textContent = crew || '—';
        chip.appendChild(name);

        grid.appendChild(chip);
    }

    wrap.appendChild(grid);
    return wrap;
}

function renderRaceRow(slot, resultForRace) {
    const li = document.createElement('li');
    li.className = `hub-race-row hub-race-row--${slot.role}`;
    if (slot.role === 'current' && slot.race) {
        li.classList.add('hub-race-row--highlight');
    }

    const tag = document.createElement('span');
    tag.className = 'hub-race-tag';
    tag.textContent = ROLE_LABELS[slot.role] || slot.role;

    const content = document.createElement('div');
    content.className = 'hub-race-content';

    if (!slot.race) {
        const empty = document.createElement('span');
        empty.className = 'hub-race-empty';
        empty.textContent = '—';
        content.appendChild(empty);
    } else {
        const r = slot.race;
        const body = document.createElement('div');
        body.className = 'hub-race-body';

        const time = document.createElement('span');
        time.className = 'hub-race-time';
        time.textContent = formatRaceTime(r.startAt);

        const main = document.createElement('span');
        main.className = 'hub-race-main';

        const head = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = `Race ${r.race}`;
        head.appendChild(strong);
        head.appendChild(document.createTextNode(` · Event ${r.eventNum}`));

        const eventEl = document.createElement('span');
        eventEl.className = 'hub-race-event';
        eventEl.textContent = r.eventName;

        const meta = document.createElement('span');
        meta.className = 'hub-race-meta';
        meta.textContent = r.division
            ? `${r.round} · Div ${r.division}`
            : r.round;

        main.appendChild(head);
        main.appendChild(eventEl);
        main.appendChild(meta);

        body.appendChild(time);
        body.appendChild(main);

        if (resultForRace && resultForRace.status) {
            const badge = document.createElement('span');
            badge.className = 'hub-race-result';
            badge.textContent = resultForRace.status;
            badge.title = 'Result status';
            body.appendChild(badge);
        }

        content.appendChild(body);

        const hasLanes = r.lanes && r.lanes.length > 0;
        const hasPlacings =
            resultForRace && resultForRace.placings?.length > 0;
        if (hasLanes || hasPlacings) {
            const extras = document.createElement('div');
            extras.className = 'hub-race-extras';
            if (hasLanes) extras.appendChild(renderLaneDraw(r.lanes));
            if (hasPlacings) {
                extras.appendChild(
                    renderPlacingsList(resultForRace.placings),
                );
            }
            content.appendChild(extras);
        }
    }

    li.appendChild(tag);
    li.appendChild(content);
    return li;
}

function updateClockDisplay(effectiveNow) {
    const el = document.getElementById('hubClockDisplay');
    if (!el) return;
    const s = boardState.settings;
    const mode =
        s.mode === 'fixed'
            ? 'Fixed clock'
            : 'Live clock';
    const off =
        s.offsetMinutes && Number(s.offsetMinutes) !== 0
            ? ` · offset ${s.offsetMinutes > 0 ? '+' : ''}${s.offsetMinutes} min`
            : '';
    el.textContent = `${mode}${off} — ${formatClock(effectiveNow)}`;
}

function renderBoard() {
    const list = document.getElementById('hubRaceBoard');
    const status = document.getElementById('hubScheduleStatus');
    if (!list) {
        document.dispatchEvent(
            new CustomEvent('altitudehd:schedule', {
                detail: { dayRaces: [], currentRace: null },
            }),
        );
        return;
    }

    const effectiveNow = getEffectiveNow(boardState.settings);
    updateClockDisplay(effectiveNow);

    const dayRaces = racesOnDate(boardState.races, effectiveNow);
    const { currentIndex, slots } = findRaceWindow(dayRaces, effectiveNow);

    list.replaceChildren();
    for (const slot of slots) {
        const result = slot.race
            ? boardState.results.get(slot.race.raceNum)
            : null;
        list.appendChild(renderRaceRow(slot, result));
    }

    if (status) {
        if (!boardState.races.length) {
            status.textContent = boardState.loading
                ? 'Loading daysheet…'
                : 'Load a daysheet URL above, then refresh.';
        } else if (!dayRaces.length) {
            const days = [
                ...new Set(boardState.races.map((r) => r.dayLabel)),
            ];
            status.textContent = `No races on ${formatYmd(effectiveNow)}. Regatta days: ${days.slice(0, 3).join('; ')}${days.length > 3 ? '…' : ''}`;
        } else {
            const day = dayRaces[0].dayLabel.replace(/^DAY\s+\d+:\s*/i, '');
            const cur =
                currentIndex >= 0
                    ? `Race ${dayRaces[currentIndex].race}`
                    : 'Before first race';
            status.textContent = `${day} · ${dayRaces.length} races · ${cur}`;
        }
    }

    document.dispatchEvent(
        new CustomEvent('altitudehd:schedule', {
            detail: {
                dayRaces,
                currentRace:
                    currentIndex >= 0 ? dayRaces[currentIndex] : null,
            },
        }),
    );
}

async function reloadData() {
    const daysheetUrl = getCsvUrl('daysheet');
    const resultsUrl = getCsvUrl('results');
    boardState.loading = true;
    renderBoard();

    try {
        const [daysheetText, resultsText] = await Promise.all([
            fetchCsvText(daysheetUrl),
            fetchCsvText(resultsUrl).catch(() => ''),
        ]);
        boardState.races = parseDaysheetCsv(daysheetText);
        boardState.results = resultsText
            ? parseResultsCsv(resultsText)
            : new Map();
    } catch (e) {
        const status = document.getElementById('hubScheduleStatus');
        if (status) {
            status.textContent =
                e instanceof Error ? e.message : 'Failed to load daysheet';
        }
        boardState.races = [];
        boardState.results = new Map();
    } finally {
        boardState.loading = false;
        renderBoard();
    }
}

function applySettingsFromDom() {
    const modeLive = document.getElementById('hubClockModeLive');
    const fixedDate = document.getElementById('hubClockFixedDate');
    const fixedTime = document.getElementById('hubClockFixedTime');
    const offset = document.getElementById('hubClockOffset');
    const autoRefresh = document.getElementById('hubAutoRefresh');

    boardState.settings = {
        mode: modeLive && modeLive.checked ? 'live' : 'fixed',
        fixedDate: fixedDate ? fixedDate.value : '2026-03-23',
        fixedTime: fixedTime ? fixedTime.value : '09:00',
        offsetMinutes: offset ? parseInt(offset.value, 10) || 0 : 0,
        autoRefresh: autoRefresh ? autoRefresh.checked : false,
    };
    saveClockSettings(boardState.settings);
    syncFixedInputsDisabled();
    setupRefreshTimer();
    renderBoard();
}

function syncFixedInputsDisabled() {
    const fixed = boardState.settings.mode === 'fixed';
    const fixedDate = document.getElementById('hubClockFixedDate');
    const fixedTime = document.getElementById('hubClockFixedTime');
    if (fixedDate) fixedDate.disabled = !fixed;
    if (fixedTime) fixedTime.disabled = !fixed;
}

function setupRefreshTimer() {
    if (boardState.refreshTimer) {
        clearInterval(boardState.refreshTimer);
        boardState.refreshTimer = null;
    }
    if (boardState.settings.autoRefresh) {
        boardState.refreshTimer = setInterval(() => reloadData(), 60_000);
    }
}

function setupTickTimer() {
    if (boardState.tickTimer) clearInterval(boardState.tickTimer);
    boardState.tickTimer = setInterval(() => {
        if (boardState.settings.mode === 'live') renderBoard();
    }, 30_000);
}

function bindClockControls() {
    const s = boardState.settings;
    const modeLive = document.getElementById('hubClockModeLive');
    const modeFixed = document.getElementById('hubClockModeFixed');
    const fixedDate = document.getElementById('hubClockFixedDate');
    const fixedTime = document.getElementById('hubClockFixedTime');
    const offset = document.getElementById('hubClockOffset');
    const autoRefresh = document.getElementById('hubAutoRefresh');
    const reloadBtn = document.getElementById('hubScheduleReload');

    if (modeLive) modeLive.checked = s.mode === 'live';
    if (modeFixed) modeFixed.checked = s.mode === 'fixed';
    if (fixedDate) fixedDate.value = s.fixedDate;
    if (fixedTime) fixedTime.value = s.fixedTime;
    if (offset) offset.value = String(s.offsetMinutes);
    if (autoRefresh) autoRefresh.checked = s.autoRefresh;

    syncFixedInputsDisabled();

    const onChange = () => applySettingsFromDom();
    [modeLive, modeFixed, fixedDate, fixedTime, offset, autoRefresh].forEach(
        (el) => {
            if (el) el.addEventListener('change', onChange);
        },
    );
    if (offset) offset.addEventListener('input', onChange);

    if (reloadBtn) {
        reloadBtn.addEventListener('click', () => reloadData());
    }
}

function initRegattaBoard() {
    const section = document.getElementById('hubScheduleSection');
    if (!section || section.dataset.bound === '1') return;
    section.dataset.bound = '1';

    bindClockControls();
    setupTickTimer();
    setupRefreshTimer();

    document.addEventListener('altitudehd:urls', () => reloadData());
    reloadData();
}

document.addEventListener('DOMContentLoaded', initRegattaBoard);
