/**
 * U19 trial GPS device assignments — TT from actual start order + swap;
 * knockout / mix / doubles inferred from CrewSight traces at race time.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREWSIGHT_DEVICES, slotKey } from './u19-trial-gps-fetch.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ASSIGNMENTS_PATH = join(
  __dirname,
  '..',
  '..',
  'public/data/archives/u19_ct_26/latest/trial-gps-assignments.json',
);

/** Solo TT: actual beach start order, devices swapped each run (women start C1X_B). */
export const WOMEN_TT_GPS = [
  { crew: 'HARR', raceNum: 5, gps: 'C1X_B' },
  { crew: 'KEDD', raceNum: 1, gps: 'C1X_A' },
  { crew: 'CHUR', raceNum: 6, gps: 'C1X_B' },
  { crew: 'BROO', raceNum: 4, gps: 'C1X_A' },
  { crew: 'PENG', raceNum: 2, gps: 'C1X_B' },
  { crew: 'KUBA', raceNum: 3, gps: 'C1X_A' },
];

/** Solo TT: actual beach start order (men start C1X_A; CRIM/SMIT/BACC from trace analysis). */
export const MEN_TT_GPS = [
  { crew: 'JOHN', raceNum: 9, gps: 'C1X_A' },
  { crew: 'HALE', raceNum: 11, gps: 'C1X_B' },
  { crew: 'CRIM', raceNum: 7, gps: 'C1X_B' },
  { crew: 'SMIT', raceNum: 8, gps: 'C1X_A' },
  { crew: 'BACC', raceNum: 10, gps: 'C1X_B' },
];

export function buildStaticTtAssignmentMap() {
  const map = {};
  for (const row of [...WOMEN_TT_GPS, ...MEN_TT_GPS]) {
    map[`${row.raceNum}:1`] = row.gps;
  }
  return map;
}

export async function loadAssignmentFile(path = DEFAULT_ASSIGNMENTS_PATH) {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    return raw.bySlot && typeof raw.bySlot === 'object' ? raw.bySlot : {};
  } catch {
    return buildStaticTtAssignmentMap();
  }
}

function clipPoints(points, startMs, endMs) {
  if (!points?.length) return [];
  return points.filter((p) => {
    const t = new Date(p.fixTime || p.deviceTime).getTime();
    return Number.isFinite(t) && t >= startMs && t <= endMs;
  });
}

function rowingScore(points) {
  if (!points.length) return 0;
  const speeds = points.map((p) => Number(p.speed) || 0);
  const moving = speeds.filter((s) => s > 1.5);
  if (!moving.length) return Math.max(...speeds, 0);
  return (moving.reduce((a, b) => a + b, 0) / moving.length) * moving.length;
}

async function fetchRoute(apiBase, deviceId, fromIso, toIso) {
  const url =
    `${apiBase}/api/traccar?action=route&source=rowing` +
    `&deviceId=${encodeURIComponent(deviceId)}` +
    `&from=${encodeURIComponent(fromIso)}` +
    `&to=${encodeURIComponent(toIso)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function scoreDevicesForSlot(row, apiBase) {
  if (!Number.isFinite(row.ms) || !Number.isFinite(row.savedAt)) {
    return { C1X_A: 0, C1X_B: 0 };
  }
  const startAt = row.savedAt - row.ms;
  const endMs = row.savedAt;
  const from = new Date(startAt - 45000).toISOString();
  const to = new Date(endMs + 45000).toISOString();
  const scores = { C1X_A: 0, C1X_B: 0 };
  for (const [label, dev] of Object.entries(CREWSIGHT_DEVICES)) {
    const raw = await fetchRoute(apiBase, dev.id, from, to);
    const clipped = clipPoints(raw, startAt - 5000, endMs + 5000);
    scores[label] = rowingScore(clipped);
  }
  return scores;
}

function pickLabelFromScores(scores) {
  return scores.C1X_A >= scores.C1X_B ? 'C1X_A' : 'C1X_B';
}

/** Resolve simultaneous H2H so the two lanes get different devices when both score strongly. */
function reconcileHeadToHead(slotsWithScores) {
  if (slotsWithScores.length !== 2) {
    return slotsWithScores.map(({ key, scores }) => ({
      key,
      gps: pickLabelFromScores(scores),
    }));
  }
  const [a, b] = slotsWithScores;
  let gpsA = pickLabelFromScores(a.scores);
  let gpsB = pickLabelFromScores(b.scores);
  if (gpsA === gpsB) {
    const marginA = Math.abs(a.scores.C1X_A - a.scores.C1X_B);
    const marginB = Math.abs(b.scores.C1X_A - b.scores.C1X_B);
    if (marginA <= marginB) {
      gpsA = gpsA === 'C1X_A' ? 'C1X_B' : 'C1X_A';
    } else {
      gpsB = gpsB === 'C1X_A' ? 'C1X_B' : 'C1X_A';
    }
  }
  return [
    { key: a.key, gps: gpsA },
    { key: b.key, gps: gpsB },
  ];
}

/**
 * Build slotKey → C1X_A|C1X_B for all saved slots.
 * @param {object} bundle trial-results payload
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.staticMap] explicit assignments (TT)
 * @param {string} [opts.apiBase]
 */
export async function buildAssignmentMap(bundle, opts = {}) {
  const staticMap = { ...buildStaticTtAssignmentMap(), ...(opts.staticMap || {}) };
  const map = { ...staticMap };
  const apiBase = opts.apiBase || 'https://ahd-livestream.vercel.app';
  const slots = (bundle.savedSlots || []).filter(
    (s) => !String(s.lane).startsWith('ref-') && s.rowKind !== 'prog-ref',
  );

  const needsInfer = slots.filter((s) => !map[slotKey(s)]);
  const byRace = new Map();
  for (const row of needsInfer) {
    const k = slotKey(row);
    if (!byRace.has(row.raceNum)) byRace.set(row.raceNum, []);
    byRace.get(row.raceNum).push(row);
  }

  for (const [, raceSlots] of byRace) {
    const scored = [];
    for (const row of raceSlots) {
      const scores = await scoreDevicesForSlot(row, apiBase);
      scored.push({ key: slotKey(row), scores, row });
    }
    for (const { key, gps } of reconcileHeadToHead(scored)) {
      map[key] = gps;
    }
  }

  return map;
}

export function gpsLabelForSlot(row, assignmentMap) {
  const key = slotKey(row);
  if (assignmentMap?.[key]) return assignmentMap[key];
  if (String(row.lane).startsWith('ref-') || row.rowKind === 'prog-ref') return 'C1X_A';
  return null;
}

export function deviceIdForAssignment(label) {
  return CREWSIGHT_DEVICES[label]?.id ?? null;
}
