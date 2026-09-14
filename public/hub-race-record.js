/**
 * Graphics-PC race-day recorder — Draw starts a race window, Results ends it,
 * and the next Draw closes the previous race if Results never went up.
 */
const RACE_CUES_API = '/api/race-cues';
const LS_REGATTA = 'altitudeHdRegattaCode_v1';

const raceRecordState = {
    day: null,
};

function raceRecordRegatta() {
    return (
        window.AltitudeHdHub?.getRegattaCode?.() ||
        document.getElementById('hubRegattaCode')?.value ||
        (() => {
            try {
                return localStorage.getItem(LS_REGATTA) || '';
            } catch {
                return '';
            }
        })() ||
        'mads2026'
    );
}

function raceRecordRace() {
    return (
        window.AltitudeHdLiveRace?.getLiveRace?.() ||
        document.getElementById('hubLiveRaceInput')?.value ||
        '12'
    );
}

function formatCueClock(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('en-NZ', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Pacific/Auckland',
    });
}

function raceCueKind(graphic) {
    const g = String(graphic || '').toLowerCase();
    if (g === 'd' || g === 'draw') return 'draw';
    if (g === 'r' || g === 'results') return 'results';
    return '';
}

async function raceCuesRequest(method, body) {
    const url = new URL(RACE_CUES_API, location.origin);
    url.searchParams.set('regatta', raceRecordRegatta());
    const opts = { method, headers: { Accept: 'application/json' } };
    if (method === 'POST') {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify({
            regatta: raceRecordRegatta(),
            race: raceRecordRace(),
            ...body,
        });
    }
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Recorder ${res.status}`);
    }
    return json;
}

function openRaceFromDay(day) {
    if (!day?.openId) return null;
    return (day.races || []).find((r) => r.id === day.openId && !r.endAt) || null;
}

function renderRaceRecord(day) {
    raceRecordState.day = day;
    const recording = Boolean(day?.recording);
    const open = openRaceFromDay(day);
    const toggle = document.getElementById('hubRaceRecordToggle');
    const status = document.getElementById('hubRaceRecordStatus');
    const openEl = document.getElementById('hubRaceRecordOpen');
    const list = document.getElementById('hubRaceRecordList');
    const persist = document.getElementById('hubRaceRecordPersist');
    const fileHint = document.getElementById('hubRaceRecordFile');

    if (toggle) {
        toggle.textContent = recording ? 'Stop' : 'Record';
        toggle.setAttribute('aria-pressed', recording ? 'true' : 'false');
        toggle.classList.toggle('is-recording', recording);
    }
    if (status) {
        if (!day) {
            status.textContent = 'Recorder API not reachable. Use the local hub on the graphics PC.';
        } else if (!recording) {
            status.textContent = 'Not recording — Draw and Results will not be logged.';
        } else if (open) {
            status.textContent = `Recording · waiting for Results or the next Draw`;
        } else {
            status.textContent = 'Recording · next Draw starts a race window';
        }
    }
    if (openEl) {
        if (open) {
            const lanes = (open.lanes || [])
                .map((l) => `L${l.lane} ${l.crew}`)
                .join(' · ');
            openEl.hidden = false;
            openEl.innerHTML = `<strong>Open:</strong> Race ${open.race || open.raceNum}
                ${open.eventType ? `· ${open.eventType}` : ''}
                ${open.round ? open.round : ''}
                · draw ${formatCueClock(open.drawAt)}
                ${lanes ? `<span class="hub-race-record-lanes">${lanes}</span>` : ''}`;
        } else {
            openEl.hidden = true;
            openEl.textContent = '';
        }
    }
    if (persist) {
        persist.hidden = !day || day.persisted !== false;
    }
    if (fileHint && day?.regatta && day?.date) {
        fileHint.textContent = `/data/race-cues/${day.regatta}/${day.date}.json`;
        fileHint.href = `data/race-cues/${day.regatta}/${day.date}.json`;
    }
    if (list) {
        const races = [...(day?.races || [])].reverse();
        if (!races.length) {
            list.innerHTML = '<p class="hub-race-record-empty">No races logged yet today.</p>';
        } else {
            list.innerHTML = races
                .map((r) => {
                    const end = r.endAt
                        ? `${formatCueClock(r.endAt)} (${r.endedBy || 'closed'})`
                        : 'open';
                    const resultBits = (r.results?.placings || [])
                        .slice(0, 3)
                        .map((p) => `${p.place}. ${p.competitor}`)
                        .join(' · ');
                    const pending = r.endAt && !r.results?.placings?.length
                        ? '<span class="hub-race-record-pending">no results sheet</span>'
                        : '';
                    return `<article class="hub-race-record-card${r.endAt ? '' : ' is-open'}">
                        <header>
                            <strong>Race ${r.race || r.raceNum}</strong>
                            <span>${r.eventType || ''} ${r.round || ''}</span>
                        </header>
                        <p>Draw ${formatCueClock(r.drawAt)} → ${end}</p>
                        <p>${(r.lanes || []).map((l) => `${l.lane}:${l.crew}`).join(' · ') || 'No lane draw'}</p>
                        <p>${(r.competitors || []).slice(0, 8).join(', ')}${(r.competitors || []).length > 8 ? '…' : ''}</p>
                        <p>${resultBits || pending || ''}</p>
                    </article>`;
                })
                .join('');
        }
    }
}

async function refreshRaceRecord() {
    try {
        const day = await raceCuesRequest('GET');
        renderRaceRecord(day);
        return day;
    } catch {
        renderRaceRecord(null);
        return null;
    }
}

async function postRaceCue(action, extra) {
    try {
        const day = await raceCuesRequest('POST', { action, ...extra });
        renderRaceRecord(day);
        return day;
    } catch (err) {
        const status = document.getElementById('hubRaceRecordStatus');
        if (status) status.textContent = err instanceof Error ? err.message : 'Cue failed';
        return null;
    }
}

function bindRaceRecord() {
    const root = document.getElementById('hubRaceRecord');
    if (!root) return;

    document.getElementById('hubRaceRecordToggle')?.addEventListener('click', async () => {
        const next = !raceRecordState.day?.recording;
        await postRaceCue('recording', { recording: next });
    });

    document.addEventListener('altitudehd:vmixtrigger', (e) => {
        const kind = e.detail?.action === 'in' ? raceCueKind(e.detail.graphic) : '';
        if (!kind) return;
        postRaceCue(kind);
    });

    refreshRaceRecord();
    setInterval(refreshRaceRecord, 4000);
}

window.AltitudeHdRaceRecord = {
    refresh: refreshRaceRecord,
    post: postRaceCue,
};

document.addEventListener('DOMContentLoaded', bindRaceRecord);
