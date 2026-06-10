import {
    checkIngestAuth,
    corsHeaders,
    loadCvPosition,
    normalizePositionPayload,
    saveCvPosition,
} from './lib/cv-position.mjs';

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
