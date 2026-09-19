/**
 * Hub live race selector — drives vMix draw / lower third / results, and
 * pushes the same race to the CV laptop Setup API.
 *
 * Auto mode: follow schedule time + published RowIT results (from hub-regatta).
 * Manual: ± / type-in / "Use current" — stays until "Resume auto".
 */
const LS_LIVE_RACE = 'altitudeHdLiveRace_v1';
const LS_LEADER_LANE = 'altitudeHdLeaderLane_v1';
const LS_LIVE_RACE_AUTO = 'altitudeHdLiveRaceAuto_v1';
const LS_CV_URL = 'altitudeHdCvServerUrl_v1';
const DEFAULT_LIVE_RACE = '1';
const DEFAULT_LEADER_LANE = 4;

const liveRaceState = {
    races: [],
    scheduleCurrent: null,
    suggested: null,
    dayRaces: [],
    pushing: false,
    lastPush: null,
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

function isAutoLiveRace() {
    try {
        const v = localStorage.getItem(LS_LIVE_RACE_AUTO);
        if (v == null) return true; // default ON
        return v === '1' || v === 'true';
    } catch {
        return true;
    }
}

function setAutoLiveRace(on) {
    try {
        localStorage.setItem(LS_LIVE_RACE_AUTO, on ? '1' : '0');
    } catch {
        /* ignore */
    }
    syncAutoUi();
}

function getCvServerUrl() {
    try {
        const fromApi = window.AltitudeHdCvStatus?.getCvServerUrl?.();
        if (fromApi) return String(fromApi).replace(/\/+$/, '');
    } catch {
        /* ignore */
    }
    try {
        const v = localStorage.getItem(LS_CV_URL);
        if (v && String(v).trim()) return String(v).trim().replace(/\/+$/, '');
    } catch {
        /* ignore */
    }
    const input = document.getElementById('hubCvServerUrl');
    if (input?.value?.trim()) return input.value.trim().replace(/\/+$/, '');
    return 'http://127.0.0.1:8790';
}

function boatCountForRace(raceParam) {
    const suggested = liveRaceState.suggested;
    if (suggested?.race?.race === raceParam && suggested.boatCount > 0) {
        return suggested.boatCount;
    }
    const fromDay = (liveRaceState.dayRaces || []).find(
        (r) => r.race === raceParam,
    );
    if (fromDay?.lanes) {
        const n = fromDay.lanes.filter((l) => l && l.crew).length;
        if (n > 0) return n;
    }
    const meta = findRaceMeta(raceParam);
    if (meta?.lanes) {
        const n = meta.lanes.filter((l) => l && l.crew).length;
        if (n > 0) return n;
    }
    return 0;
}

async function pushLiveRaceToCv(race, { source = 'hub' } = {}) {
    const cv = getCvServerUrl();
    const regatta =
        window.AltitudeHdHub?.getRegattaCode?.() ||
        localStorage.getItem('altitudeHdRegattaCode_v1') ||
        'nzmm2026';
    const boatCount = boatCountForRace(race);
    const body = {
        cloud: {
            live_race: String(race),
            regatta: String(regatta).trim().toLowerCase() || 'nzmm2026',
            race_source: source,
            lane_map: [],
        },
    };
    if (boatCount > 0) {
        body.race_boat_count = boatCount;
    }

    const statusEl = document.getElementById('hubLiveRaceCvStatus');
    liveRaceState.pushing = true;
    if (statusEl) statusEl.textContent = `Pushing race ${race} to CV…`;

    try {
        const res = await fetch(`${cv}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(5000),
            mode: 'cors',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        liveRaceState.lastPush = {
            ok: true,
            race: String(race),
            at: Date.now(),
            boatCount,
            cv,
        };
        if (statusEl) {
            const boats = boatCount > 0 ? ` · ${boatCount} boats` : '';
            statusEl.textContent = `CV updated · race ${race}${boats}`;
        }
        return true;
    } catch (e) {
        liveRaceState.lastPush = {
            ok: false,
            race: String(race),
            at: Date.now(),
            error: e instanceof Error ? e.message : 'push failed',
            cv,
        };
        if (statusEl) {
            statusEl.textContent = `CV offline (${cv}) — race saved on hub only`;
        }
        return false;
    } finally {
        liveRaceState.pushing = false;
    }
}

function saveLiveRace(value, { manual = false, source = 'hub' } = {}) {
    const race = String(value || '').trim();
    if (!race) return;
    if (manual) setAutoLiveRace(false);
    try {
        localStorage.setItem(LS_LIVE_RACE, race);
    } catch {
        /* ignore */
    }
    document.dispatchEvent(
        new CustomEvent('altitudehd:liverace', {
            detail: { race, source, manual: Boolean(manual) },
        }),
    );
    syncLiveRaceUi();
    pushLiveRaceToCv(race, { source: manual ? 'hub-manual' : source });
}

function clampLeaderLane(value) {
    const n = parseInt(String(value), 10);
    if (!Number.isFinite(n)) return DEFAULT_LEADER_LANE;
    return Math.min(8, Math.max(1, n));
}

function loadLeaderLane() {
    try {
        const v = localStorage.getItem(LS_LEADER_LANE);
        if (v != null && String(v).trim() !== '') {
            return clampLeaderLane(v);
        }
    } catch {
        /* ignore */
    }
    return DEFAULT_LEADER_LANE;
}

function saveLeaderLane(value) {
    const lane = clampLeaderLane(value);
    try {
        localStorage.setItem(LS_LEADER_LANE, String(lane));
    } catch {
        /* ignore */
    }
    document.dispatchEvent(
        new CustomEvent('altitudehd:leaderlane', { detail: { lane } }),
    );
    syncLeaderLaneUi();
}

function syncLeaderLaneUi() {
    const input = document.getElementById('hubLeaderLaneInput');
    if (input) input.value = String(loadLeaderLane());
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
    const pool = liveRaceState.dayRaces.length
        ? liveRaceState.dayRaces
        : liveRaceState.races;
    const idx = findRaceIndex(pool, param);
    if (idx < 0) return null;
    return pool[idx];
}

function stepLiveRace(delta) {
    const races = liveRaceState.dayRaces.length
        ? liveRaceState.dayRaces
        : liveRaceState.races;
    const param = loadLiveRace();
    if (!races.length) {
        const cur = parseInt(param, 10);
        const base = Number.isFinite(cur) ? cur : 1;
        saveLiveRace(String(Math.max(1, base + delta)), { manual: true });
        return;
    }
    const next = findRaceByNumberStep(races, param, delta);
    if (next) saveLiveRace(next.race, { manual: true });
}

function reasonLabel(reason) {
    switch (reason) {
        case 'by_schedule':
            return 'by schedule time';
        case 'after_results':
            return 'advanced past published results';
        case 'before_first':
            return 'before first race';
        case 'last_with_results':
            return 'last race (results in)';
        default:
            return reason || '';
    }
}

function syncAutoUi() {
    const auto = isAutoLiveRace();
    const chk = document.getElementById('hubLiveRaceAuto');
    if (chk && chk.checked !== auto) chk.checked = auto;
    const resume = document.getElementById('hubLiveRaceResumeAuto');
    if (resume) resume.hidden = auto;
    const modeEl = document.getElementById('hubLiveRaceMode');
    if (modeEl) {
        if (auto) {
            const sug = liveRaceState.suggested?.race?.race;
            const why = reasonLabel(liveRaceState.suggested?.reason);
            modeEl.textContent = sug
                ? `Auto · suggesting ${sug}${why ? ` (${why})` : ''}`
                : 'Auto · waiting for schedule';
        } else {
            modeEl.textContent = 'Manual override — graphics & CV stay on this race';
        }
    }
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
            const boats = boatCountForRace(race);
            const boatBit = boats > 0 ? ` · ${boats} boats` : '';
            meta.textContent = `${row.eventType || row.eventName || ''} · ${row.round || ''} · ${formatRaceTime(row.startAt)}${boatBit}`
                .replace(/^\s·\s/, '')
                .replace(/\s·\s·\s/g, ' · ');
        } else if (liveRaceState.races.length || liveRaceState.dayRaces.length) {
            meta.textContent = 'Race not found on daysheet — check number or reload schedule.';
        } else {
            meta.textContent =
                'Load daysheet in Setup to step through races with + / −.';
        }
    }
    syncAutoUi();
}

function formatRaceTime(d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
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
    const sug = liveRaceState.suggested?.race;
    const cur = sug || liveRaceState.scheduleCurrent;
    if (cur?.race) saveLiveRace(cur.race, { manual: true, source: 'hub-manual' });
}

function applySuggestedIfAuto() {
    if (!isAutoLiveRace()) return;
    const sug = liveRaceState.suggested?.race;
    if (!sug?.race) return;
    const current = loadLiveRace();
    if (current === sug.race) {
        const boatCount = boatCountForRace(sug.race);
        const last = liveRaceState.lastPush;
        if (
            !last?.ok ||
            last.race !== sug.race ||
            (boatCount > 0 && last.boatCount !== boatCount)
        ) {
            pushLiveRaceToCv(sug.race, { source: 'hub-auto' });
        }
        return;
    }
    saveLiveRace(sug.race, { manual: false, source: 'hub-auto' });
}

function resumeAutoLiveRace() {
    setAutoLiveRace(true);
    applySuggestedIfAuto();
    syncLiveRaceUi();
}

function bindLiveRaceControls() {
    const panel = document.getElementById('hubLiveRacePanel');
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';

    const input = document.getElementById('hubLiveRaceInput');
    const minus = document.getElementById('hubLiveRaceMinus');
    const plus = document.getElementById('hubLiveRacePlus');
    const syncBtn = document.getElementById('hubLiveRaceSync');
    const autoChk = document.getElementById('hubLiveRaceAuto');
    const resumeBtn = document.getElementById('hubLiveRaceResumeAuto');
    const pushBtn = document.getElementById('hubLiveRacePushCv');

    if (input) {
        input.value = loadLiveRace();
        input.addEventListener('change', () =>
            saveLiveRace(input.value, { manual: true }),
        );
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
                saveLiveRace(input.value, { manual: true });
            }
        });
    }
    if (minus) minus.addEventListener('click', () => stepLiveRace(-1));
    if (plus) plus.addEventListener('click', () => stepLiveRace(1));
    if (syncBtn) syncBtn.addEventListener('click', useScheduleCurrentRace);
    if (autoChk) {
        autoChk.checked = isAutoLiveRace();
        autoChk.addEventListener('change', () => {
            if (autoChk.checked) resumeAutoLiveRace();
            else setAutoLiveRace(false);
        });
    }
    if (resumeBtn) resumeBtn.addEventListener('click', resumeAutoLiveRace);
    if (pushBtn) {
        pushBtn.addEventListener('click', () =>
            pushLiveRaceToCv(loadLiveRace(), {
                source: isAutoLiveRace() ? 'hub-auto' : 'hub-manual',
            }),
        );
    }

    const leaderLaneInput = document.getElementById('hubLeaderLaneInput');
    if (leaderLaneInput) {
        leaderLaneInput.value = String(loadLeaderLane());
        const applyLeaderLane = () => saveLeaderLane(leaderLaneInput.value);
        leaderLaneInput.addEventListener('change', applyLeaderLane);
        leaderLaneInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                leaderLaneInput.blur();
                applyLeaderLane();
            }
        });
    }

    document.addEventListener('altitudehd:urls', () => {
        reloadLiveRaceDaysheet();
        // Regatta code change — re-push current race with new code
        pushLiveRaceToCv(loadLiveRace(), {
            source: isAutoLiveRace() ? 'hub-auto' : 'hub-manual',
        });
    });
    document.addEventListener('altitudehd:schedule', (e) => {
        liveRaceState.scheduleCurrent = e.detail?.currentRace || null;
        liveRaceState.suggested = e.detail?.suggested || null;
        liveRaceState.dayRaces = Array.isArray(e.detail?.dayRaces)
            ? e.detail.dayRaces
            : [];
        const syncBtnEl = document.getElementById('hubLiveRaceSync');
        if (syncBtnEl) {
            syncBtnEl.disabled = !(
                liveRaceState.suggested?.race || liveRaceState.scheduleCurrent
            );
        }
        applySuggestedIfAuto();
        syncLiveRaceUi();
    });

    reloadLiveRaceDaysheet();
    syncLiveRaceUi();
    syncLeaderLaneUi();
    // Initial push so CV matches hub on page load
    pushLiveRaceToCv(loadLiveRace(), {
        source: isAutoLiveRace() ? 'hub-auto' : 'hub-manual',
    });
}

window.AltitudeHdLiveRace = {
    getLiveRace: loadLiveRace,
    setLiveRace: (race) => saveLiveRace(race, { manual: true }),
    stepLiveRace,
    getRaces: () => liveRaceState.races.slice(),
    isAuto: isAutoLiveRace,
    setAuto: setAutoLiveRace,
    resumeAuto: resumeAutoLiveRace,
    pushToCv: () => pushLiveRaceToCv(loadLiveRace()),
};

window.AltitudeHdLeaderLane = {
    getLeaderLane: loadLeaderLane,
    setLeaderLane: saveLeaderLane,
    clampLeaderLane,
    syncLeaderLaneUi,
};

document.addEventListener('DOMContentLoaded', bindLiveRaceControls);
