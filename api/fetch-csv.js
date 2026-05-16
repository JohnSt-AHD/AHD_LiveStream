const ALLOWED_HOSTS = new Set(['l.rowit.nz', 'www.l.rowit.nz']);

function isAllowedUrl(raw) {
    try {
        const u = new URL(String(raw).trim());
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
        return ALLOWED_HOSTS.has(u.hostname.toLowerCase());
    } catch {
        return false;
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const target = req.query.url;
    if (!target || !isAllowedUrl(target)) {
        res.status(400).send('Invalid or disallowed URL');
        return;
    }

    try {
        const upstream = await fetch(target, {
            method: 'GET',
            headers: { Accept: 'text/csv,text/plain,*/*' },
            signal: AbortSignal.timeout(20000),
        });
        const text = await upstream.text();
        if (!upstream.ok) {
            res.status(upstream.status).send(text || 'Upstream error');
            return;
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(text);
    } catch (e) {
        res.status(502).send(e instanceof Error ? e.message : 'Fetch failed');
    }
}
