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
            await traccarLogin();
            res.status(200).json({ token: 'session', ok: true });
            return;
        }

        if (action === 'snapshot') {
            const { traccarUrl, cookie } = await traccarLogin();
            const [devicesRaw, positionsRaw] = await Promise.all([
                traccarGetJson(traccarUrl, cookie, '/api/devices'),
                traccarGetJson(traccarUrl, cookie, '/api/positions'),
            ]);
            let geofencesRaw = [];
            let groupsRaw = [];
            try {
                geofencesRaw = await traccarGetJson(traccarUrl, cookie, '/api/geofences');
            } catch (e) {
                console.error('Geofences optional fetch failed:', e);
            }
            try {
                groupsRaw = await traccarGetJson(traccarUrl, cookie, '/api/groups');
            } catch (e) {
                console.error('Groups optional fetch failed:', e);
            }
            const devices = normalizeDevicesPayload(devicesRaw);
            const positions = normalizePositionsPayload(positionsRaw);
            const geofences = Array.isArray(geofencesRaw) ? geofencesRaw : [];
            const groups = Array.isArray(groupsRaw) ? groupsRaw : [];
            res.status(200).json({ devices, positions, geofences, groups });
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
            const { traccarUrl, cookie } = await traccarLogin();
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

        if (action === 'devices' || action === 'positions') {
            const { traccarUrl, cookie } = await traccarLogin();
            const path = action === 'devices' ? '/api/devices' : '/api/positions';
            const data = await traccarGetJson(traccarUrl, cookie, path);
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
