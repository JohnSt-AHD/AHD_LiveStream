const API_BASE = '/api/traccar';

function parseNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

const params = new URLSearchParams(window.location.search);
const deviceId = parseInt(params.get('deviceId'), 10);
const posLeftPct = parseNum(params.get('x'), 0, 100, 72);
const posTopPct = parseNum(params.get('y'), 0, 100, 10);
const widthPct = parseNum(params.get('w'), 12, 96, 28);
const pollMs = parseNum(params.get('interval'), 1000, 60000, 2500);
const transparent = params.get('transparent') === '1';

const card = document.getElementById('speedCard');
const errEl = document.getElementById('speedError');
const elSplit = document.getElementById('scSplit');

/** Time for 500 m at constant speed (m/s), as M:SS.d — no unit suffix. */
function formatSplit500FromMps(speedMps) {
    if (!Number.isFinite(speedMps) || speedMps < 0.01) return '—';
    let sec = 500 / speedMps;
    if (sec > 7200) return '—';
    sec = Math.round(sec * 10) / 10;

    let minutes = Math.floor(sec / 60);
    let sRem = Math.round((sec - minutes * 60) * 10) / 10;
    if (sRem >= 59.95) {
        minutes += 1;
        sRem = 0;
    }
    const intS = Math.floor(sRem + 1e-9);
    let tenth = Math.round((sRem - intS) * 10);
    if (tenth === 10) {
        const ns = intS + 1;
        if (ns >= 60) {
            minutes += 1;
            return `${minutes}:00.0`;
        }
        return `${minutes}:${String(ns).padStart(2, '0')}.0`;
    }
    return `${minutes}:${String(intS).padStart(2, '0')}.${tenth}`;
}

function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    card.hidden = true;
}

if (!Number.isFinite(deviceId) || deviceId < 1) {
    showError('Missing or invalid deviceId. Open this page from the main map (Speed screen) or add ?deviceId=123 to the URL.');
} else {
    if (transparent) {
        document.body.classList.add('speed-transparent');
    }
    card.style.left = `${posLeftPct}%`;
    card.style.top = `${posTopPct}%`;
    card.style.width = `${widthPct}%`;
    card.style.maxWidth = '520px';
    card.hidden = false;
    errEl.hidden = true;
}

function mergeDevicesFromPositions(deviceList, positionsMap) {
    const list = Array.isArray(deviceList) ? deviceList.slice() : [];
    const seen = new Set(list.map((d) => d && d.id).filter((id) => id != null));
    for (const key of Object.keys(positionsMap)) {
        const id = Number(key);
        if (!Number.isFinite(id) || seen.has(id)) continue;
        const pos = positionsMap[id];
        let name = `Device ${id}`;
        if (pos && typeof pos.deviceName === 'string' && pos.deviceName.trim()) {
            name = pos.deviceName.trim();
        }
        list.push({ id, name });
        seen.add(id);
    }
    return list;
}

async function tick() {
    if (!Number.isFinite(deviceId) || deviceId < 1) return;
    try {
        const res = await fetch(`${API_BASE}?action=snapshot`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            elSplit.textContent = '—';
            elSplit.classList.remove('speed-warn');
            errEl.textContent = data.error || `Error ${res.status}`;
            errEl.hidden = false;
            card.hidden = true;
            return;
        }
        errEl.hidden = true;
        card.hidden = false;

        const positionsMap = {};
        (Array.isArray(data.positions) ? data.positions : []).forEach((pos) => {
            if (pos && pos.deviceId != null) positionsMap[pos.deviceId] = pos;
        });
        const pos = positionsMap[deviceId];

        if (!pos || typeof pos.speed !== 'number') {
            elSplit.textContent = '—';
            elSplit.classList.remove('speed-warn');
            return;
        }

        elSplit.textContent = formatSplit500FromMps(pos.speed);
        elSplit.classList.toggle('speed-warn', pos.speed > 5);
    } catch (e) {
        elSplit.textContent = '—';
        errEl.textContent = e.message || 'Network error';
        errEl.hidden = false;
        card.hidden = true;
    }
}

if (Number.isFinite(deviceId) && deviceId >= 1) {
    tick();
    setInterval(tick, pollMs);
}
