export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }
    res.status(200).json({
        sim: true,
        cloud: {
            live_race: '1',
            regatta: 'nzmm2026',
        },
        drone: {
            hfov_deg: 73,
            pitch_offset_deg: 0,
            prefer_sn_prefix: '1581',
            takeoff_above_water_m: 0,
        },
    });
}
