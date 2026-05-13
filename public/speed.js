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
const elDevice = document.getElementById('scDevice');
const elKmh = document.getElementById('scKmh');
const elMs = document.getElementById('scMs');
const elMeta = document.getElementById('scMeta');

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

function formatTime(dateString) {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function isRecent(fixTime) {
    const t = new Date(fixTime);
    if (Number.isNaN(t.getTime())) return false;
    return Date.now() - t.getTime() < 5 * 60 * 1000;
}

async function tick() {
    if (!Number.isFinite(deviceId) || deviceId < 1) return;
    try {
        const res = await fetch(`${API_BASE}?action=snapshot`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            elMeta.textContent = data.error || `Error ${res.status}`;
            return;
        }
        const rawDevices = Array.isArray(data.devices) ? data.devices : [];
        const positionsMap = {};
        (Array.isArray(data.positions) ? data.positions : []).forEach((pos) => {
            if (pos && pos.deviceId != null) positionsMap[pos.deviceId] = pos;
        });
        const list = mergeDevicesFromPositions(rawDevices, positionsMap);
        const dev = list.find((d) => Number(d.id) === deviceId);
        const pos = positionsMap[deviceId];

        const name = dev ? dev.name || `Device ${deviceId}` : `Device ${deviceId}`;
        elDevice.textContent = name;

        if (!pos || typeof pos.speed !== 'number') {
            elKmh.textContent = '—';
            elKmh.classList.remove('speed-warn');
            elMs.textContent = 'No live position for this device yet.';
            elMeta.textContent = '';
            return;
        }

        const kmh = pos.speed * 3.6;
        const mps = pos.speed;
        elKmh.textContent = `${kmh.toFixed(1)}`;
        elKmh.classList.toggle('speed-warn', pos.speed > 5);
        elMs.textContent = `${mps.toFixed(2)} m/s`;
        const online = isRecent(pos.fixTime || pos.deviceTime);
        elMeta.textContent = `${online ? 'Live' : 'Stale'} · Last fix ${formatTime(pos.fixTime || pos.deviceTime)}`;
    } catch (e) {
        elMeta.textContent = e.message || 'Network error';
    }
}

if (Number.isFinite(deviceId) && deviceId >= 1) {
    tick();
    setInterval(tick, pollMs);
}
