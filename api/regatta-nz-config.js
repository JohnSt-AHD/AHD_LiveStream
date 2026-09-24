/**
 * Shared Regatta NZ spectator config (hub Setup → phone / web app).
 * GET returns the latest saved config; POST/PUT saves it.
 * Uses Vercel KV when configured; otherwise in-memory (best-effort).
 */

const KV_KEY = 'regatta-nz:spectator-config';
const DEFAULT = {
  code: 'nzmm2026',
  livestreamUrl: '',
  livestreamActive: false,
  livestreamLabel: 'Watch the livestream',
  mode: 'sim',
  streamId: 'ged-sim',
  updatedAt: null,
};

/** @type {typeof DEFAULT | null} */
let memory = null;

function normalizeCode(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
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

function sanitize(body) {
  const next = { ...DEFAULT };
  if (body && typeof body === 'object') {
    const c = normalizeCode(body.code);
    if (c) next.code = c;
    if (body.livestreamUrl != null) next.livestreamUrl = String(body.livestreamUrl).trim();
    if (body.livestreamActive != null) next.livestreamActive = Boolean(body.livestreamActive);
    if (body.livestreamLabel) {
      next.livestreamLabel = String(body.livestreamLabel).trim() || DEFAULT.livestreamLabel;
    }
    if (body.mode === 'live' || body.mode === 'sim') next.mode = body.mode;
    const id = String(body.streamId || '').trim();
    if (/^[a-zA-Z0-9._-]{1,128}$/.test(id)) next.streamId = id;
  }
  if (next.livestreamActive && !next.livestreamUrl) next.livestreamActive = false;
  next.updatedAt = new Date().toISOString();
  return next;
}

async function loadConfig() {
  const store = await kvStore();
  if (store) {
    try {
      const data = await store.get(KV_KEY);
      if (data && typeof data === 'object') return sanitize(data);
    } catch {
      /* fall through */
    }
  }
  return memory ? { ...memory } : { ...DEFAULT, updatedAt: null };
}

async function saveConfig(body) {
  const next = sanitize(body);
  memory = next;
  const store = await kvStore();
  if (store) {
    await store.set(KV_KEY, next);
  }
  return { ...next, persisted: Boolean(store) };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const cfg = await loadConfig();
      res.status(200).json(cfg);
      return;
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const saved = await saveConfig(body);
      res.status(200).json(saved);
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Config error' });
  }
}
