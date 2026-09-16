import { isCsvLike, serveCachedCsv } from './lib/rowit-cache.mjs';

const ALLOWED_HOSTS = new Set([
    'l.rowit.nz',
    'www.l.rowit.nz',
    'rowit.nz',
    'www.rowit.nz',
]);

function isAllowedUrl(raw) {
    try {
        const u = new URL(String(raw).trim());
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
        return ALLOWED_HOSTS.has(u.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function applyCacheHeaders(res, meta) {
    if (!meta) return;
    res.setHeader('X-Rowit-Cache', String(meta.status || 'unknown'));
    if (meta.storage) res.setHeader('X-Rowit-Storage', String(meta.storage));
    if (Number.isFinite(meta.ageMs)) res.setHeader('X-Rowit-Age-Ms', String(meta.ageMs));
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

    const force =
        req.query.fresh === '1' ||
        req.query.refresh === '1' ||
        req.query.force === '1';

    try {
        const cached = await serveCachedCsv(target, { force });
        if (cached?.text && isCsvLike(cached.text)) {
            applyCacheHeaders(res, cached.meta);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.status(200).send(cached.text);
            return;
        }

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
        if (!isCsvLike(text)) {
            res.status(404).send('CSV not published');
            return;
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(text);
    } catch (e) {
        res.status(502).send(e instanceof Error ? e.message : 'Fetch failed');
    }
}
