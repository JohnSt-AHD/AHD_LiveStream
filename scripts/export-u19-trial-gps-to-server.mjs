#!/usr/bin/env node
/**
 * Upload downsampled GPS traces from a scorer export into trial-results API.
 *
 * Export on the scorer device (browser console on beachsprints-regatta.html):
 *   copy(JSON.stringify(
 *     Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('bsrTrialLive_v3')).races || {})
 *       .filter(([, s]) => s?.gpsPoints?.length)
 *       .map(([k, s]) => [k, { gps: s.gps, startAt: s.startAt, gpsMs: s.gpsMs, points: s.gpsPoints }])
 *   ))
 * Save to: public/data/archives/u19_ct_26/latest/trial-gps-store.json
 *
 * Usage: node scripts/export-u19-trial-gps-to-server.mjs [path-to-json]
 */
const DEFAULT_GPS_PATH =
  'public/data/archives/u19_ct_26/latest/trial-gps-store.json';
const API = 'https://ahd-livestream.vercel.app/api/trial-results?regatta=u19_ct_26';
const TOKEN = 'r3A2xEjWMDoqeT910VtDsg';
const MAX_UPLOAD_BYTES = 480 * 1024;

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeFetchedGpsTraces } from './lib/u19-trial-gps-fetch.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function slotKey(raceNum, lane) {
  return `${raceNum}:${lane}`;
}

async function main() {
  const rel = process.argv[2] || DEFAULT_GPS_PATH;
  const path = join(ROOT, rel);
  let localGps = {};
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    localGps = raw.gpsTraces || raw;
  } catch {
    console.log('No local GPS export — uploading split-derived traces only.');
  }

  const getRes = await fetch(API);
  if (!getRes.ok) throw new Error(`GET failed: ${getRes.status}`);
  const payload = await getRes.json();
  let maxPoints = 180;
  payload.gpsTraces = await mergeFetchedGpsTraces(payload, {
    apiBase: new URL(API).origin,
    localGps,
    verbose: true,
    maxPoints,
  });
  payload.updatedAt = Date.now();

  let bodyText = JSON.stringify(payload);
  while (bodyText.length > MAX_UPLOAD_BYTES && maxPoints > 24) {
    maxPoints = Math.max(24, Math.floor(maxPoints * 0.75));
    payload.gpsTraces = await mergeFetchedGpsTraces(payload, {
      apiBase: new URL(API).origin,
      localGps,
      verbose: false,
      maxPoints,
    });
    bodyText = JSON.stringify(payload);
    console.log(`Payload ${bodyText.length} bytes — retrying with maxPoints=${maxPoints}`);
  }
  if (bodyText.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Payload still too large (${bodyText.length} bytes) after downsampling.`);
  }
  console.log(
    `Uploading ${Object.keys(payload.gpsTraces || {}).length} trace(s), ${bodyText.length} bytes, maxPoints=${maxPoints}`,
  );

  const put = await fetch(`${API}&token=${TOKEN}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: bodyText,
  });
  const body = await put.json();
  if (!put.ok) throw new Error(`PUT failed: ${put.status} ${JSON.stringify(body)}`);

  const count = Object.keys(payload.gpsTraces || {}).length;
  console.log(`Uploaded ${count} GPS trace(s) to trial-results API.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
