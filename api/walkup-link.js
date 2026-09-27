/**
 * Public walk-up check-in link for RowSafe QR (CrewSight /walkup).
 * Uses the same ROWING_TRACKER_URL + token as the live fleet proxy.
 */
function trackerBase() {
  return String(process.env.ROWING_TRACKER_URL || process.env.ROWING_API_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function walkupToken() {
  return String(
    process.env.WALKUP_TOKEN ||
      process.env.ROWING_INGEST_TOKEN ||
      process.env.INGEST_TOKEN ||
      'rnz',
  ).trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const explicit = String(process.env.WALKUP_URL || '').trim();
  if (explicit) {
    res.status(200).json({ ok: true, walkupUrl: explicit, source: 'WALKUP_URL' });
    return;
  }

  const base = trackerBase();
  if (!base) {
    res.status(503).json({
      ok: false,
      error: 'ROWING_TRACKER_URL is not configured on the server.',
    });
    return;
  }

  const token = walkupToken();
  const walkupUrl =
    `${base}/walkup` + (token ? `?token=${encodeURIComponent(token)}` : '');

  res.status(200).json({
    ok: true,
    walkupUrl,
    source: 'ROWING_TRACKER_URL',
    hasToken: Boolean(token),
  });
}
