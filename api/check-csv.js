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
        res.status(400).json({ ok: false, error: 'Invalid or disallowed URL' });
        return;
    }

    try {
        const upstream = await fetch(target, {
            method: 'GET',
            headers: { Accept: 'text/csv,text/plain,*/*' },
            signal: AbortSignal.timeout(15000),
        });
        const text = await upstream.text();
        const looksCsv =
            upstream.ok &&
            text.length > 0 &&
            (text.includes(',') || text.toLowerCase().includes('event'));

        res.status(200).json({
            ok: looksCsv,
            status: upstream.status,
            bytes: text.length,
        });
    } catch (e) {
        res.status(200).json({
            ok: false,
            error: e instanceof Error ? e.message : 'Fetch failed',
        });
    }
}
