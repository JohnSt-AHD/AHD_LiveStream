export function extractCookieHeader(response) {
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

export async function traccarLogin() {
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
        if (!base) missing.push('TRACCAR_URL');
        if (!email) missing.push('TRACCAR_EMAIL');
        if (!password) missing.push('TRACCAR_PASSWORD');
        const err = new Error(`Missing Traccar config: ${missing.join(', ')}`);
        err.statusCode = 503;
        throw err;
    }

    const traccarUrl = base.replace(/\/$/, '');
    const authResponse = await fetch(`${traccarUrl}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    });

    const cookie = extractCookieHeader(authResponse);
    await authResponse.json().catch(() => ({}));

    if (!authResponse.ok) {
        throw new Error(`Traccar authentication failed: ${authResponse.status}`);
    }
    if (!cookie) {
        throw new Error('Traccar login succeeded but no session cookie was returned');
    }

    return { traccarUrl, cookie };
}

export async function traccarGetJson(traccarUrl, cookie, path) {
    const upstream = await fetch(`${traccarUrl}${path}`, {
        headers: { Cookie: cookie, Accept: 'application/json' },
    });
    if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        throw new Error(`Traccar request failed (${path}): ${upstream.status} ${text.slice(0, 200)}`);
    }
    return upstream.json();
}

export async function fetchTraccarSnapshot() {
    const { traccarUrl, cookie } = await traccarLogin();
    const [devicesRaw, positionsRaw] = await Promise.all([
        traccarGetJson(traccarUrl, cookie, '/api/devices'),
        traccarGetJson(traccarUrl, cookie, '/api/positions'),
    ]);
    let geofencesRaw = [];
    try {
        geofencesRaw = await traccarGetJson(traccarUrl, cookie, '/api/geofences');
    } catch {
        geofencesRaw = [];
    }
    return {
        devices: Array.isArray(devicesRaw) ? devicesRaw : [],
        positions: Array.isArray(positionsRaw) ? positionsRaw : [],
        geofences: Array.isArray(geofencesRaw) ? geofencesRaw : [],
    };
}
