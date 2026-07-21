#!/usr/bin/env node
/**
 * Build full GPS assignment map (TT from start order + infer knockout/mix/doubles),
 * write trial-gps-assignments.json, and upload traces to trial-results API.
 *
 * Usage: node scripts/apply-u19-trial-gps-assignments.mjs [--dry-run]
 */
const API = 'https://ahd-livestream.vercel.app/api/trial-results?regatta=u19_ct_26';
const TOKEN = 'r3A2xEjWMDoqeT910VtDsg';
const MAX_UPLOAD_BYTES = 480 * 1024;
const ASSIGNMENTS_PATH =
  'public/data/archives/u19_ct_26/latest/trial-gps-assignments.json';

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAssignmentMap, loadAssignmentFile } from './lib/u19-trial-gps-assignments.mjs';
import { mergeFetchedGpsTraces, slotKey } from './lib/u19-trial-gps-fetch.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const getRes = await fetch(API);
  if (!getRes.ok) throw new Error(`GET failed: ${getRes.status}`);
  const payload = await getRes.json();

  const staticMap = await loadAssignmentFile(join(ROOT, ASSIGNMENTS_PATH));
  const assignmentMap = await buildAssignmentMap(payload, {
    apiBase: new URL(API).origin,
    staticMap,
    verbose: true,
  });

  const outPath = join(ROOT, ASSIGNMENTS_PATH);
  const fileBody = {
    version: 1,
    regatta: 'u19_ct_26',
    note:
      'Solo TT from actual beach start order with device swap. Knockout/mix/doubles from CrewSight trace at race time.',
    womenTtStartOrder: ['HARR', 'KEDD', 'CHUR', 'BROO', 'PENG', 'KUBA'],
    menTtStartOrder: ['JOHN', 'HALE', 'CRIM', 'SMIT', 'BACC'],
    bySlot: assignmentMap,
  };
  await writeFile(outPath, `${JSON.stringify(fileBody, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${Object.keys(assignmentMap).length} assignment(s) → ${ASSIGNMENTS_PATH}`);

  for (const row of (payload.savedSlots || []).sort((a, b) => a.raceNum - b.raceNum || Number(a.lane) - Number(b.lane))) {
    const k = slotKey(row);
    console.log(`  ${k.padEnd(8)} ${String(row.crew).padEnd(12)} → ${assignmentMap[k] || '?'}`);
  }

  if (dryRun) {
    console.log('Dry run — skipping API upload.');
    return;
  }

  let maxPoints = 180;
  payload.gpsTraces = await mergeFetchedGpsTraces(payload, {
    apiBase: new URL(API).origin,
    assignmentMap,
    verbose: false,
    maxPoints,
  });
  payload.updatedAt = Date.now();

  let bodyText = JSON.stringify(payload);
  while (bodyText.length > MAX_UPLOAD_BYTES && maxPoints > 24) {
    maxPoints = Math.max(24, Math.floor(maxPoints * 0.75));
    payload.gpsTraces = await mergeFetchedGpsTraces(payload, {
      apiBase: new URL(API).origin,
      assignmentMap,
      verbose: false,
      maxPoints,
    });
    bodyText = JSON.stringify(payload);
    console.log(`Payload ${bodyText.length} bytes — retrying maxPoints=${maxPoints}`);
  }

  const put = await fetch(`${API}&token=${TOKEN}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: bodyText,
  });
  const body = await put.json();
  if (!put.ok) throw new Error(`PUT failed: ${put.status} ${JSON.stringify(body)}`);

  console.log(
    `Uploaded ${Object.keys(payload.gpsTraces || {}).length} GPS trace(s), ${bodyText.length} bytes.`,
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
