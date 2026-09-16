import {
    cacheStatus,
    normalizeRegattaCode,
    refreshCode,
    ROWIT_FILES,
    watchCode,
} from './lib/rowit-cache.mjs';

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseFiles(raw) {
    if (Array.isArray(raw)) {
        return raw.map((f) => String(f).toLowerCase()).filter((f) => ROWIT_FILES.includes(f));
    }
    const text = String(raw || '').trim();
    if (!text) return ['results'];
    return text
        .split(',')
        .map((f) => f.trim().toLowerCase())
        .filter((f) => ROWIT_FILES.includes(f));
}

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        if (req.method === 'GET') {
            const code = normalizeRegattaCode(req.query?.code);
            if (code) watchCode(code);
            res.status(200).json(cacheStatus(code));
            return;
        }

        if (req.method === 'POST') {
            const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
            const action = String(body.action || req.query?.action || 'refresh').toLowerCase();
            const code = normalizeRegattaCode(body.code || req.query?.code);
            if (!code) {
                res.status(400).json({ error: 'code is required' });
                return;
            }
            watchCode(code);

            if (action === 'watch') {
                res.status(200).json({ ok: true, code, ...cacheStatus(code) });
                return;
            }

            const files = parseFiles(body.files || body.file || req.query?.files || req.query?.file);
            const force = body.force !== false;
            const result = await refreshCode(code, files.length ? files : ['results'], { force });
            res.status(200).json({ ok: true, action: 'refresh', ...result });
            return;
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        res.status(502).json({
            error: err instanceof Error ? err.message : 'RowIT cache error',
        });
    }
}
