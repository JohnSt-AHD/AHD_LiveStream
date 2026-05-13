/**
 * Extract JSESSIONID from Traccar POST /api/session response.
 * Node fetch does not forward Set-Cookie across requests; callers must pass Cookie manually.
 */
function extractJsessionCookie(response) {
    if (typeof response.headers.getSetCookie === 'function') {
        const list = response.headers.getSetCookie();
        for (const c of list) {
            if (c.startsWith('JSESSIONID=')) {
                return c.split(';')[0];
            }
        }
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
    const base = process.env.TRACCAR_URL;
    const email = process.env.TRACCAR_EMAIL || process.env.TRACCAR_USERNAME;
    const password = process.env.TRACCAR_PASSWORD;

    if (!base || !email || !password) {
        const err = new Error(
            'Missing TRACCAR_URL, TRACCAR_EMAIL (or TRACCAR_USERNAME), or TRACCAR_PASSWORD on the server'
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

    const cookie = extractJsessionCookie(authResponse);
    await authResponse.json().catch(() => ({}));

    if (!authResponse.ok) {
        throw new Error(`Traccar authentication failed: ${authResponse.status}`);
    }
    if (!cookie) {
        throw new Error(
            'Traccar login succeeded but no JSESSIONID cookie was returned; check TRACCAR_URL and server version'
        );
    }

    return { traccarUrl, cookie };
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

        if (action === 'devices' || action === 'positions') {
            const { traccarUrl, cookie } = await traccarLogin();
            const path = action === 'devices' ? '/api/devices' : '/api/positions';
            const upstream = await fetch(`${traccarUrl}${path}`, {
                headers: { Cookie: cookie },
            });

            if (!upstream.ok) {
                throw new Error(`Traccar ${action} failed: ${upstream.status}`);
            }

            const data = await upstream.json();
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
