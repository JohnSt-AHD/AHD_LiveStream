const KV_PREFIX = 'cv:position:';
const STALE_MS = 2500;

function normalizeStreamId(raw) {
    const id = String(raw || '').trim();
    if (!id || id.length > 128) return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(id)) return null;
    return id;
}

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

const memoryStore = new Map();

function venueOffset(venue) {
    const v = String(venue || 'karapiro').toLowerCase();
    if (v === 'twizel') return { x: -140, y: -50 };
    return { x: 140, y: -50 };
}

function normalizePositionPayload(body) {
    const streamId = normalizeStreamId(body?.streamId);
    if (!streamId) {
        throw new Error('streamId is required (alphanumeric, max 128 chars).');
    }

    const x = Number(body?.x);
    const y = Number(body?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('x and y must be numbers.');
    }

    const frame = Number.isFinite(Number(body?.frame)) ? Number(body.frame) : 0;
    const auto = Number(body?.auto) ? 1 : 0;
    const venue = String(body?.venue || 'karapiro').toLowerCase();
    const refW = Number(body?.refW) > 0 ? Number(body.refW) : 1280;
    const refH = Number(body?.refH) > 0 ? Number(body.refH) : 720;

    return {
        streamId,
        x: Math.round(x),
        y: Math.round(y),
        frame: Math.round(frame),
        auto,
        venue: venue === 'twizel' ? 'twizel' : 'karapiro',
        refW,
        refH,
        updatedAt: Date.now(),
    };
}

async function saveCvPosition(payload) {
    const store = await kvStore();
    const key = `${KV_PREFIX}${payload.streamId}`;
    if (store) {
        await store.set(key, payload, { ex: 120 });
        return { storage: 'kv' };
    }
    memoryStore.set(key, payload);
    return { storage: 'memory' };
}

async function loadCvPosition(streamId) {
    const id = normalizeStreamId(streamId);
    if (!id) return null;

    const key = `${KV_PREFIX}${id}`;
    const store = await kvStore();
    let payload = null;

    if (store) {
        payload = await store.get(key);
    } else {
        payload = memoryStore.get(key) || null;
    }

    if (!payload || typeof payload !== 'object') return null;

    const ageMs = Date.now() - Number(payload.updatedAt || 0);
    const offset = venueOffset(payload.venue);
    return {
        ...payload,
        offset,
        stale: ageMs > STALE_MS,
        ageMs,
    };
}

function checkIngestAuth(req) {
    const expected = String(process.env.CV_INGEST_TOKEN || '').trim();
    if (!expected) return true;

    const header = String(req.headers.authorization || '');
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const query = String(req.query?.token || '').trim();
    return bearer === expected || query === expected;
}

function corsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With',
    );
}

export default async function handler(req, res) {
    corsHeaders(res);

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        if (req.method === 'GET') {
            const streamId = req.query?.streamId;
            const data = await loadCvPosition(streamId);
            if (!data) {
                res.status(404).json({
                    error: 'No CV position for this streamId yet.',
                    streamId: String(streamId || ''),
                });
                return;
            }
            res.status(200).json(data);
            return;
        }

        if (req.method === 'POST') {
            if (!checkIngestAuth(req)) {
                res.status(401).json({ error: 'Unauthorized CV ingest.' });
                return;
            }

            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const payload = normalizePositionPayload(body);
            const meta = await saveCvPosition(payload);
            res.status(200).json({ ok: true, ...payload, ...meta });
            return;
        }

        res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
    } catch (error) {
        console.error('cv-position API error:', error);
        res.status(400).json({
            error: error instanceof Error ? error.message : 'Bad request',
        });
    }
}
