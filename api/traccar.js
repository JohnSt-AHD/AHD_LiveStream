/**
 * Build Cookie header from Traccar POST /api/session response.
 * Node fetch does not persist Set-Cookie across requests.
 */
function extractCookieHeader(response) {
    const parts = [];
    if (typeof response.headers.getSetCookie === 'function') {
        for (const c of response.headers.getSetCookie()) {
            const nv = c.split(';')[0].trim();
            if (nv && !parts.includes(nv)) {
                parts.push(nv);
            }
        }
    }
    if (parts.length > 0) {
        return parts.join('; ');
    }
    const raw = response.headers.get('set-cookie');
    if (raw) {
        const m = raw.match(/JSESSIONID=([^;,\s]+)/);
        if (m) {
            return `JSESSIONID=${m[1]}`;
        }
    }
    return '';
}

async function traccarLogin() {
    let base =
        process.env.TRACCAR_URL ||
        process.env.TRACCAR_BASE_URL ||
        process.env.TRACCAR_HOST ||
        '';
    base = String(base).trim();
    if (base && !/^https?:\/\//i.test(base)) {
        base = `https://${base.replace(/^\/+/, '')}`;
    }

    const email = (
        process.env.TRACCAR_EMAIL ||
        process.env.TRACCAR_USERNAME ||
        process.env.TRACCAR_USER ||
        process.env.TRACCAR_LOGIN ||
        ''
    ).trim();

    const password = (
        process.env.TRACCAR_PASSWORD ||
        process.env.TRACCAR_PASS ||
        process.env.TRACCAR_PWD ||
        ''
    ).trim();

    if (!base || !email || !password) {
        const missing = [];
        if (!base) missing.push('TRACCAR_URL (or TRACCAR_BASE_URL / TRACCAR_HOST)');
        if (!email) missing.push('TRACCAR_EMAIL (or TRACCAR_USERNAME / TRACCAR_USER / TRACCAR_LOGIN)');
        if (!password) missing.push('TRACCAR_PASSWORD (or TRACCAR_PASS / TRACCAR_PWD)');
        const err = new Error(
            `Missing: ${missing.join(
                '; '
            )}. In Vercel open this project → Settings → Environment Variables, add those keys, check both Production and Preview, save, then Redeploy.`
        );
        err.statusCode = 503;
        throw err;
    }

    const traccarUrl = base.replace(/\/$/, '');
    const authResponse = await fetch(`${traccarUrl}/api/session`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    });

    const cookie = extractCookieHeader(authResponse);
    await authResponse.json().catch(() => ({}));

    if (!authResponse.ok) {
        throw new Error(`Traccar authentication failed: ${authResponse.status}`);
    }
    if (!cookie) {
        throw new Error(
            'Traccar login succeeded but no session cookie was returned; check TRACCAR_URL and server version'
        );
    }

    return { traccarUrl, cookie };
}

function normalizeDevicesPayload(data) {
    return Array.isArray(data) ? data : [];
}

function normalizePositionsPayload(data) {
    return Array.isArray(data) ? data : [];
}

function rowingTrackerBase() {
    return String(process.env.ROWING_TRACKER_URL || process.env.ROWING_API_URL || '').trim().replace(/\/$/, '');
}

/** Client toggle: ?source=rowing | ?source=traccar (default traccar). */
function useRowingSource(req) {
    const explicit = String(req.query?.source || '').toLowerCase();
    if (explicit === 'rowing' || explicit === 'rnz') return true;
    if (explicit === 'traccar') return false;
    return false;
}

function canUseRowing() {
    return Boolean(rowingTrackerBase());
}

function rowingAuthHeaders() {
    const token = String(
        process.env.ROWING_INGEST_TOKEN || process.env.INGEST_TOKEN || 'rnz',
    ).trim();
    const headers = { Accept: 'application/json' };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

async function rowingProxy(req, res, path) {
    if (!canUseRowing()) {
        res.status(503).json({
            ok: false,
            error: 'ROWING_TRACKER_URL is not configured on the server.',
        });
        return;
    }
    const base = rowingTrackerBase();
    const url = new URL(path.startsWith('/') ? path : `/${path}`, `${base}/`);
    const skipQuery = new Set(['action', 'source']);
    for (const [key, value] of Object.entries(req.query)) {
        if (skipQuery.has(key)) continue;
        if (value != null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    }
    const headers = { ...rowingAuthHeaders(), Accept: 'application/json' };
    const init = { method: req.method, headers };
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
        headers['Content-Type'] = 'application/json';
        init.body =
            typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    }
    const upstream = await fetch(url.toString(), init);
    const text = await upstream.text().catch(() => '');
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { ok: false, error: text.slice(0, 400) };
    }
    res.status(upstream.status).json(data);
}

async function rowingGetJson(path, query = {}) {
    const base = rowingTrackerBase();
    if (!base) {
        return null;
    }
    const url = new URL(path.startsWith('/') ? path : `/${path}`, `${base}/`);
    for (const [key, value] of Object.entries(query)) {
        if (value != null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    }
    const upstream = await fetch(url.toString(), { headers: rowingAuthHeaders() });
    if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        throw new Error(`Rowing tracker failed (${path}): ${upstream.status} ${text.slice(0, 200)}`);
    }
    return upstream.json();
}

async function traccarGetJson(traccarUrl, cookie, path) {
    const upstream = await fetch(`${traccarUrl}${path}`, {
        headers: {
            Cookie: cookie,
            Accept: 'application/json',
        },
    });

    if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        throw new Error(`Traccar request failed (${path}): ${upstream.status} ${text.slice(0, 200)}`);
    }

    return upstream.json();
}

const GEOFENCE_CACHE_TTL_MS = Number(process.env.TRACCAR_GEOFENCE_CACHE_MS) || 15 * 60 * 1000;
const TRACCAR_SESSION_CACHE_TTL_MS = Number(process.env.TRACCAR_SESSION_CACHE_MS) || 30 * 60 * 1000;

/** @type {{ traccarUrl: string, cookie: string, fetchedAt: number }} */
let traccarSessionCache = { traccarUrl: '', cookie: '', fetchedAt: 0 };
/** @type {{ geofences: object[], groups: object[], fetchedAt: number }} */
let geofenceMetaCache = { geofences: [], groups: [], fetchedAt: 0 };

async function getTraccarSession(force = false) {
    const now = Date.now();
    if (
        !force &&
        traccarSessionCache.cookie &&
        now - traccarSessionCache.fetchedAt < TRACCAR_SESSION_CACHE_TTL_MS
    ) {
        return {
            traccarUrl: traccarSessionCache.traccarUrl,
            cookie: traccarSessionCache.cookie,
        };
    }
    const session = await traccarLogin();
    traccarSessionCache = { ...session, fetchedAt: now };
    return session;
}

async function getTraccarGeofenceMeta(force = false) {
    const now = Date.now();
    if (
        !force &&
        geofenceMetaCache.fetchedAt &&
        now - geofenceMetaCache.fetchedAt < GEOFENCE_CACHE_TTL_MS
    ) {
        return { geofences: geofenceMetaCache.geofences, groups: geofenceMetaCache.groups };
    }
    try {
        const { traccarUrl, cookie } = await getTraccarSession();
        const [geofencesRaw, groupsRaw] = await Promise.all([
            traccarGetJson(traccarUrl, cookie, '/api/geofences').catch(() => []),
            traccarGetJson(traccarUrl, cookie, '/api/groups').catch(() => []),
        ]);
        const geofences = Array.isArray(geofencesRaw) ? geofencesRaw : [];
        const groups = Array.isArray(groupsRaw) ? groupsRaw : [];
        geofenceMetaCache = { geofences, groups, fetchedAt: now };
        return { geofences, groups };
    } catch (e) {
        console.error('Traccar geofence metadata fetch failed:', e);
        if (geofenceMetaCache.fetchedAt) {
            return { geofences: geofenceMetaCache.geofences, groups: geofenceMetaCache.groups };
        }
        return { geofences: [], groups: [] };
    }
}

async function rowingLiveSnapshot(onlineSec) {
    return rowingGetJson('/api/snapshot', {
        onlineSec: onlineSec || '120',
    });
}

export default async function handler(req, res) {
    const { action } = req.query;

    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        if (action === 'auth') {
            if (useRowingSource(req) && canUseRowing()) {
                res.status(200).json({ token: 'session', ok: true, source: 'rowing' });
                return;
            }
            await traccarLogin();
            res.status(200).json({ token: 'session', ok: true, source: 'traccar' });
            return;
        }

        if (action === 'positions' && useRowingSource(req)) {
            if (!canUseRowing()) {
                res.status(503).json({
                    error: 'ROWING_TRACKER_URL is not configured on the server.',
                });
                return;
            }
            const data = await rowingLiveSnapshot(req.query.onlineSec);
            res.status(200).json({
                devices: Array.isArray(data.devices) ? data.devices : [],
                positions: Array.isArray(data.positions) ? data.positions : [],
                source: 'rowing',
                lite: true,
            });
            return;
        }

        if (action === 'positions') {
            const { traccarUrl, cookie } = await getTraccarSession();
            const [devicesRaw, positionsRaw] = await Promise.all([
                traccarGetJson(traccarUrl, cookie, '/api/devices'),
                traccarGetJson(traccarUrl, cookie, '/api/positions'),
            ]);
            res.status(200).json({
                devices: normalizeDevicesPayload(devicesRaw),
                positions: normalizePositionsPayload(positionsRaw),
                source: 'traccar',
                lite: true,
            });
            return;
        }

        if (action === 'snapshot' && useRowingSource(req)) {
            if (!canUseRowing()) {
                res.status(503).json({
                    error: 'ROWING_TRACKER_URL is not configured on the server.',
                });
                return;
            }
            const data = await rowingLiveSnapshot(req.query.onlineSec);
            const refreshMeta = String(req.query.refreshGeofences || '') === '1';
            const { geofences, groups } = await getTraccarGeofenceMeta(refreshMeta);
            res.status(200).json({
                devices: Array.isArray(data.devices) ? data.devices : [],
                positions: Array.isArray(data.positions) ? data.positions : [],
                geofences,
                groups,
                source: 'rowing',
            });
            return;
        }

        if (action === 'snapshot') {
            const { traccarUrl, cookie } = await getTraccarSession();
            const [devicesRaw, positionsRaw] = await Promise.all([
                traccarGetJson(traccarUrl, cookie, '/api/devices'),
                traccarGetJson(traccarUrl, cookie, '/api/positions'),
            ]);
            const refreshMeta = String(req.query.refreshGeofences || '') === '1';
            const { geofences, groups } = await getTraccarGeofenceMeta(refreshMeta);
            const devices = normalizeDevicesPayload(devicesRaw);
            const positions = normalizePositionsPayload(positionsRaw);
            res.status(200).json({ devices, positions, geofences, groups, source: 'traccar' });
            return;
        }

        if (action === 'route') {
            const deviceId = req.query.deviceId;
            const from = req.query.from;
            const to = req.query.to;
            if (deviceId == null || deviceId === '' || !from || !to) {
                res.status(400).json({ error: 'Missing deviceId, from, or to (use ISO 8601 datetimes)' });
                return;
            }
            if (useRowingSource(req)) {
                if (!canUseRowing()) {
                    res.status(503).json({
                        error: 'ROWING_TRACKER_URL is not configured on the server.',
                    });
                    return;
                }
                const data = await rowingGetJson('/api/history', {
                    deviceId: String(deviceId),
                    from: String(from),
                    to: String(to),
                });
                res.status(200).json(Array.isArray(data) ? data : []);
                return;
            }
            const { traccarUrl, cookie } = await getTraccarSession();
            const q = new URLSearchParams({
                deviceId: String(deviceId),
                from: String(from),
                to: String(to),
            });
            const path = `/api/reports/route?${q.toString()}`;
            const data = await traccarGetJson(traccarUrl, cookie, path);
            res.status(200).json(Array.isArray(data) ? data : []);
            return;
        }

        if (action === 'timing-lines' && useRowingSource(req)) {
            if (!['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) {
                res.status(405).json({ ok: false, error: 'Method not allowed' });
                return;
            }
            if (req.method === 'OPTIONS') {
                res.status(204).end();
                return;
            }
            await rowingProxy(req, res, '/api/timing-lines');
            return;
        }

        if (action === 'capsize-clear' && useRowingSource(req)) {
            if (!['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) {
                res.status(405).json({ ok: false, error: 'Method not allowed' });
                return;
            }
            if (req.method === 'OPTIONS') {
                res.status(204).end();
                return;
            }
            await rowingProxy(req, res, '/api/capsize-clear');
            return;
        }

        if (action === 'logbook' && useRowingSource(req)) {
            if (!canUseRowing()) {
                res.status(503).json({
                    ok: false,
                    error: 'ROWING_TRACKER_URL is not configured on the server.',
                });
                return;
            }
            const data = await rowingGetJson('/api/history', {
                list: 'logbook',
                days: req.query.days || '45',
                tz: req.query.tz || req.query.timeZone || 'Pacific/Auckland',
            });
            res.status(200).json(data);
            return;
        }

        if (action === 'devices') {
            const { traccarUrl, cookie } = await getTraccarSession();
            const data = await traccarGetJson(traccarUrl, cookie, '/api/devices');
            res.status(200).json(data);
            return;
        }

        res.status(400).json({ error: 'Invalid action' });
    } catch (error) {
        console.error('API Error:', error);
        const status = error.statusCode || 500;
        res.status(status).json({ error: error.message });
    }
}
