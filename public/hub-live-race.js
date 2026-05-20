/**
 * Hub live race selector — drives vMix draw / lower third / results.
 * Persisted in localStorage; overlays read the same value on the same origin.
 */
const LS_LIVE_RACE = 'altitudeHdLiveRace_v1';
const DEFAULT_LIVE_RACE = '12';

const liveRaceState = {
    races: [],
    scheduleCurrent: null,
};

function loadLiveRace() {
    try {
        const v = localStorage.getItem(LS_LIVE_RACE);
        if (v != null && String(v).trim()) return String(v).trim();
    } catch {
        /* ignore */
    }
    return DEFAULT_LIVE_RACE;
}

function saveLiveRace(value) {
    const race = String(value || '').trim();
    if (!race) return;
    try {
        localStorage.setItem(LS_LIVE_RACE, race);
    } catch {
        /* ignore */
    }
    document.dispatchEvent(
        new CustomEvent('altitudehd:liverace', { detail: { race } }),
    );
    syncLiveRaceUi();
}

function findRaceIndex(races, param) {
    const p = String(param || '').trim();
    if (!p || !races.length) return -1;

    let idx = races.findIndex((r) => r.race === p);
    if (idx >= 0) return idx;

    const num = parseInt(p, 10);
    if (!Number.isFinite(num)) return -1;
    const letter = p.match(/\(([A-Za-z])\)/i)?.[1]?.toUpperCase();
    idx = races.findIndex((r) => {
        if (r.raceNum !== num) return false;
        if (letter) return r.race.includes(`(${letter})`);
        return true;
    });
    if (idx >= 0) return idx;
    return races.findIndex((r) => r.raceNum === num);
}

function findRaceByNumberStep(races, param, delta) {
    if (!races.length) return null;
    const idx = findRaceIndex(races, param);
    const current = idx >= 0 ? races[idx] : null;
    let num = current?.raceNum;
    if (!Number.isFinite(num)) {
        num = parseInt(String(param || ''), 10);
    }
    if (!Number.isFinite(num)) return races[0];

    const targetNum = num + delta;
    const exact = races.find((r) => r.raceNum === targetNum);
    if (exact) return exact;

    if (delta > 0) {
        return races.find((r) => r.raceNum > num) || races[races.length - 1];
    }
    for (let i = races.length - 1; i >= 0; i--) {
        if (races[i].raceNum < num) return races[i];
    }
    return races[0];
}

function findRaceMeta(param) {
    const idx = findRaceIndex(liveRaceState.races, param);
    if (idx < 0) return null;
    return liveRaceState.races[idx];
}

function stepLiveRace(delta) {
    const races = liveRaceState.races;
    const param = loadLiveRace();
    if (!races.length) {
        const cur = parseInt(param, 10);
        const base = Number.isFinite(cur) ? cur : 1;
        saveLiveRace(String(Math.max(1, base + delta)));
        return;
    }
    const next = findRaceByNumberStep(races, param, delta);
    if (next) saveLiveRace(next.race);
}

function syncLiveRaceUi() {
    const input = document.getElementById('hubLiveRaceInput');
    const meta = document.getElementById('hubLiveRaceMeta');
    const race = loadLiveRace();
    if (input && document.activeElement !== input) {
        input.value = race;
    }
    if (meta) {
        const row = findRaceMeta(race);
        if (row) {
            meta.textContent = `${row.eventType} · ${row.round} · ${formatRaceTime(row.startAt)}`;
        } else if (liveRaceState.races.length) {
            meta.textContent = 'Race not found on daysheet — check number or reload schedule.';
        } else {
            meta.textContent =
                'Load daysheet above to step through races with + / −.';
        }
    }
}

function formatRaceTime(d) {
    return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    });
}

async function reloadLiveRaceDaysheet() {
    const url = window.AltitudeHdHub?.getCsvUrl?.('daysheet');
    if (!url) return;
    try {
        let text;
        const res = await fetch(
            `/api/fetch-csv?url=${encodeURIComponent(url)}`,
        );
        if (res.ok) text = await res.text();
        else {
            const direct = await fetch(url);
            if (!direct.ok) throw new Error('Daysheet unavailable');
            text = await direct.text();
        }
        liveRaceState.races = parseDaysheetForLiveRace(text);
    } catch {
        liveRaceState.races = [];
    }
    syncLiveRaceUi();
}

function parseDaysheetForLiveRace(text) {
    const MONTHS = {
        january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
        april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
        august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9,
        november: 10, nov: 10, december: 11, dec: 11,
    };
    const races = [];
    let dayDate = null;

    function parseLine(line) {
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

    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^DAY\s+\d+:/i.test(trimmed)) {
            const m = trimmed.match(
                /DAY\s+\d+:\s+\w+\s+(\d{1,2})(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/i,
            );
            if (m) {
                const month = MONTHS[m[2].toLowerCase()];
                if (month !== undefined) {
                    dayDate = new Date(
                        parseInt(m[3], 10),
                        month,
                        parseInt(m[1], 10),
                    );
                }
            }
            continue;
        }
        if (!dayDate || /^Race,/i.test(trimmed)) continue;
        const cols = parseLine(trimmed);
        const raw = cols[0].trim();
        const withLetter = raw.match(/^(\d+)\s*\(([A-Za-z])\)\s*$/);
        const plain = raw.match(/^(\d+)$/);
        if (!withLetter && !plain) continue;
        const tm = (cols[1] || '').trim().match(/^(\d{1,2}):(\d{2})$/);
        if (!tm) continue;
        const startAt = new Date(
            dayDate.getFullYear(),
            dayDate.getMonth(),
            dayDate.getDate(),
            parseInt(tm[1], 10),
            parseInt(tm[2], 10),
            0,
            0,
        );
        const raceNum = parseInt(withLetter ? withLetter[1] : plain[1], 10);
        const race = withLetter
            ? `${withLetter[1]} (${withLetter[2].toUpperCase()})`
            : plain[1];
        races.push({
            raceNum,
            race,
            eventType: cols[3] ? cols[3].trim() : '',
            round: cols[4] ? cols[4].trim() : '',
            startAt,
        });
    }
    races.sort((a, b) => a.startAt - b.startAt);
    return races;
}

function useScheduleCurrentRace() {
    const cur = liveRaceState.scheduleCurrent;
    if (cur?.race) saveLiveRace(cur.race);
}

function bindLiveRaceControls() {
    const panel = document.getElementById('hubLiveRacePanel');
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';

    const input = document.getElementById('hubLiveRaceInput');
    const minus = document.getElementById('hubLiveRaceMinus');
    const plus = document.getElementById('hubLiveRacePlus');
    const syncBtn = document.getElementById('hubLiveRaceSync');

    if (input) {
        input.value = loadLiveRace();
        input.addEventListener('change', () => saveLiveRace(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
                saveLiveRace(input.value);
            }
        });
    }
    if (minus) minus.addEventListener('click', () => stepLiveRace(-1));
    if (plus) plus.addEventListener('click', () => stepLiveRace(1));
    if (syncBtn) syncBtn.addEventListener('click', useScheduleCurrentRace);

    document.addEventListener('altitudehd:urls', () => reloadLiveRaceDaysheet());
    document.addEventListener('altitudehd:schedule', (e) => {
        liveRaceState.scheduleCurrent = e.detail?.currentRace || null;
        const syncBtnEl = document.getElementById('hubLiveRaceSync');
        if (syncBtnEl) {
            syncBtnEl.disabled = !liveRaceState.scheduleCurrent;
        }
    });

    reloadLiveRaceDaysheet();
    syncLiveRaceUi();
}

window.AltitudeHdLiveRace = {
    getLiveRace: loadLiveRace,
    setLiveRace: saveLiveRace,
    stepLiveRace,
    getRaces: () => liveRaceState.races.slice(),
};

document.addEventListener('DOMContentLoaded', bindLiveRaceControls);
