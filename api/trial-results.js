/**
 * Shared trial results for U19 coastal selection (u19_ct_26 only).
 * GET — any viewer; PUT — optional TRIAL_RESULTS_TOKEN auth.
 * Storage: Vercel KV/Redis when configured, else in-memory (single instance).
 */
const TRIAL_REGATTA = 'u19_ct_26';
/** Default write token for u19_ct_26 — override with TRIAL_RESULTS_TOKEN on Vercel if preferred. */
const DEFAULT_WRITE_TOKEN = 'r3A2xEjWMDoqeT910VtDsg';
const KV_KEY = `trial:results:${TRIAL_REGATTA}`;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_GPS_TRACES = 120;
const MAX_GPS_POINTS = 180;

function downsamplePoints(points, max) {
    if (!Array.isArray(points) || points.length <= max) return points || [];
    const step = points.length / max;
    const out = [];
    for (let i = 0; i < max; i++) {
        out.push(points[Math.min(points.length - 1, Math.floor(i * step))]);
    }
    return out;
}

function sanitizeGpsTraces(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [key, trace] of Object.entries(raw).slice(0, MAX_GPS_TRACES)) {
        if (!trace || typeof trace !== 'object' || !Array.isArray(trace.points) || !trace.points.length) {
            continue;
        }
        out[String(key).slice(0, 24)] = {
            gps: String(trace.gps || '').slice(0, 16),
            startAt: Number.isFinite(Number(trace.startAt)) ? Number(trace.startAt) : null,
            gpsMs: Number.isFinite(Number(trace.gpsMs)) ? Number(trace.gpsMs) : null,
            points: downsamplePoints(trace.points, MAX_GPS_POINTS).map((p) => ({
                latitude: Number(p.latitude),
                longitude: Number(p.longitude),
                speed: Number(p.speed),
                fixTime: String(p.fixTime || p.deviceTime || '').slice(0, 32),
                deviceTime: String(p.deviceTime || p.fixTime || '').slice(0, 32),
                accuracy: Number.isFinite(Number(p.accuracy)) ? Number(p.accuracy) : undefined,
            })),
        };
    }
    return out;
}

const memoryStore = new Map();

async function kvStore() {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
        return null;
    }
    try {
        const { kv } = await import('@vercel/kv');
        return kv;
    } catch {
        return null;
    }
}

function normalizeRegatta(raw) {
    return String(raw || '')
        .trim()
        .toLowerCase();
}

function corsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With',
    );
}

function expectedWriteToken() {
    return String(process.env.TRIAL_RESULTS_TOKEN || DEFAULT_WRITE_TOKEN).trim();
}

function checkWriteAuth(req) {
    const expected = expectedWriteToken();
    const header = String(req.headers.authorization || '');
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const query = String(req.query?.token || '').trim();
    if (bearer === expected || query === expected) {
        return { ok: true, mode: process.env.TRIAL_RESULTS_TOKEN ? 'env' : 'default' };
    }
    return { ok: false, mode: process.env.TRIAL_RESULTS_TOKEN ? 'env' : 'default' };
}

function sanitizePayload(body) {
    if (!body || typeof body !== 'object') {
        throw new Error('JSON body required.');
    }
    const regatta = normalizeRegatta(body.regatta);
    if (regatta !== TRIAL_REGATTA) {
        throw new Error(`Only regatta ${TRIAL_REGATTA} is supported.`);
    }

    const updatedAt = Number(body.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
        throw new Error('updatedAt must be a positive number.');
    }

    const savedSlots = Array.isArray(body.savedSlots) ? body.savedSlots.slice(0, 500) : [];
    const raceResults =
        body.raceResults && typeof body.raceResults === 'object' ? body.raceResults : {};

    return {
        version: 1,
        regatta: TRIAL_REGATTA,
        updatedAt,
        rankings:
            body.rankings && typeof body.rankings === 'object' ?
                {
                    women: Array.isArray(body.rankings.women) ? body.rankings.women.slice(0, 32) : [],
                    men: Array.isArray(body.rankings.men) ? body.rankings.men.slice(0, 32) : [],
                }
            :   { women: [], men: [] },
        mixRecommendation:
            body.mixRecommendation && typeof body.mixRecommendation === 'object' ?
                body.mixRecommendation
            :   null,
        publishedEvents:
            body.publishedEvents && typeof body.publishedEvents === 'object' ?
                body.publishedEvents
            :   {},
        savedSlots: savedSlots.map((row) => ({
            raceNum: Number(row.raceNum),
            lane: row.lane,
            crew: String(row.crew || '').slice(0, 64),
            ms: Number(row.ms),
            time: String(row.time || '').slice(0, 16),
            splits: row.splits && typeof row.splits === 'object' ? row.splits : {},
            savedAt: Number(row.savedAt) || updatedAt,
            rowKind: String(row.rowKind || '').slice(0, 24),
        })),
        raceResults,
        prognostic:
            body.prognostic && typeof body.prognostic === 'object' ?
                {
                    custom:
                        body.prognostic.custom && typeof body.prognostic.custom === 'object' ?
                            body.prognostic.custom
                        :   {},
                    derived:
                        body.prognostic.derived && typeof body.prognostic.derived === 'object' ?
                            body.prognostic.derived
                        :   {},
                }
            :   { custom: {}, derived: {} },
        gpsTraces: sanitizeGpsTraces(body.gpsTraces),
    };
}

async function loadPayload(regatta) {
    if (normalizeRegatta(regatta) !== TRIAL_REGATTA) return null;
    const store = await kvStore();
    if (store) {
        return (await store.get(KV_KEY)) || null;
    }
    return memoryStore.get(KV_KEY) || null;
}

async function savePayload(payload) {
    const store = await kvStore();
    if (store) {
        await store.set(KV_KEY, payload);
        return { storage: 'kv' };
    }
    memoryStore.set(KV_KEY, payload);
    return { storage: 'memory' };
}

export default async function handler(req, res) {
    corsHeaders(res);

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const regatta = normalizeRegatta(req.query?.regatta || TRIAL_REGATTA);
    if (regatta !== TRIAL_REGATTA) {
        res.status(400).json({ error: `Only regatta ${TRIAL_REGATTA} is supported.` });
        return;
    }

    try {
        if (req.method === 'GET') {
            const payload = await loadPayload(regatta);
            if (!payload) {
                res.status(404).json({
                    error: 'No trial results published yet.',
                    regatta: TRIAL_REGATTA,
                });
                return;
            }
            const store = await kvStore();
            res.status(200).json({
                ...payload,
                storage: store ? 'kv' : 'memory',
            });
            return;
        }

        if (req.method === 'PUT') {
            const auth = checkWriteAuth(req);
            if (!auth.ok) {
                res.status(401).json({ error: 'Unauthorized — trial write token required.' });
                return;
            }

            const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
            if (rawBody.length > MAX_BODY_BYTES) {
                res.status(413).json({ error: 'Payload too large.' });
                return;
            }

            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const existing = await loadPayload(regatta);
            const next = sanitizePayload(body);
            const incomingGpsCount = Object.keys(next.gpsTraces || {}).length;
            if (
                !incomingGpsCount &&
                existing?.gpsTraces &&
                Object.keys(existing.gpsTraces).length
            ) {
                next.gpsTraces = existing.gpsTraces;
            }
            if (existing?.updatedAt && next.updatedAt < existing.updatedAt) {
                res.status(409).json({
                    error: 'Stale write — refresh and retry.',
                    updatedAt: existing.updatedAt,
                });
                return;
            }

            const meta = await savePayload(next);
            res.status(200).json({
                ok: true,
                regatta: TRIAL_REGATTA,
                updatedAt: next.updatedAt,
                savedCount: next.savedSlots.length,
                raceCount: Object.keys(next.raceResults || {}).length,
                auth: auth.mode,
                ...meta,
            });
            return;
        }

        res.status(405).json({ error: 'Method not allowed. Use GET or PUT.' });
    } catch (error) {
        console.error('trial-results API error:', error);
        res.status(400).json({
            error: error instanceof Error ? error.message : 'Bad request',
        });
    }
}
