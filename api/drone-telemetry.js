import { droneTelemetry } from './lib/ged-cv-sim.mjs';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'GET only' });
        return;
    }
    const row = droneTelemetry();
    const wantAll = /\/all\/?$/.test(String(req.url || '')) || req.query?.all === '1';
    res.status(200).json(wantAll ? [row] : row);
}
