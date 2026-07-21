/**
 * Fetch real CrewSight GPS traces for U19 trial saved slots (C1X_A / C1X_B).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LAYOUT_PATH = join(
  __dirname,
  '..',
  '..',
  'public/data/archives/u19_ct_26/latest/course-layout.json',
);

export const CREWSIGHT_DEVICES = {
  C1X_A: { id: 343069, label: 'C1x_A' },
  C1X_B: { id: 343070, label: 'C1X_B' },
};

export const BIG_MANLY_COURSE_LAYOUT = {
  originLat: -36.628375,
  originLng: 174.758363,
  headingDeg: 45,
  laneSpacingA: 25,
  buoySpacingB: 85,
  tideLineC: 50,
};

const DEFAULT_API_BASE = 'https://ahd-livestream.vercel.app';

/** @deprecated Use gpsLabelForSlot with assignment map — lane is not device on this trial. */
export function gpsLabelForLane(lane) {
  const n = Number(lane);
  if (n === 2) return 'C1X_B';
  if (String(lane).startsWith('ref-')) return 'C1X_A';
  return 'C1X_A';
}

export function deviceIdForLabel(label) {
  return CREWSIGHT_DEVICES[label]?.id ?? null;
}

export function deviceIdForLane(lane) {
  return deviceIdForLabel(gpsLabelForLane(lane));
}

export function slotKey(row) {
  return `${row.raceNum}:${row.lane}`;
}

function clipPoints(points, startMs, endMs) {
  if (!points?.length) return [];
  return points.filter((p) => {
    const t = new Date(p.fixTime || p.deviceTime).getTime();
    return Number.isFinite(t) && t >= startMs && t <= endMs;
  });
}

export function downsampleGpsPoints(points, max = 180) {
  if (!Array.isArray(points) || points.length <= max) return points || [];
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.min(points.length - 1, Math.floor(i * step))]);
  }
  return out;
}

export async function loadCourseArchive(layoutPath = DEFAULT_LAYOUT_PATH) {
  try {
    const raw = JSON.parse(await readFile(layoutPath, 'utf8'));
    return {
      layout: raw.layout || BIG_MANLY_COURSE_LAYOUT,
      venueId: raw.venueId || 'big-manly',
      gpsDevices: raw.gpsDevices || CREWSIGHT_DEVICES,
    };
  } catch {
    return {
      layout: BIG_MANLY_COURSE_LAYOUT,
      venueId: 'big-manly',
      gpsDevices: CREWSIGHT_DEVICES,
    };
  }
}

async function fetchRoute(apiBase, deviceId, fromIso, toIso) {
  const url =
    `${apiBase}/api/traccar?action=route&source=rowing` +
    `&deviceId=${encodeURIComponent(deviceId)}` +
    `&from=${encodeURIComponent(fromIso)}` +
    `&to=${encodeURIComponent(toIso)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Route HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchGpsTraceForSlot(row, opts = {}) {
  if (String(row.lane).startsWith('ref-') || row.rowKind === 'prog-ref') return null;
  if (!Number.isFinite(row.ms) || row.ms <= 0 || !Number.isFinite(row.savedAt)) return null;

  const gpsLabel =
    opts.gpsLabel ||
    opts.assignmentMap?.[slotKey(row)] ||
    null;
  if (!gpsLabel) return null;

  const deviceId = deviceIdForLabel(gpsLabel);
  if (!deviceId) return null;

  const apiBase = opts.apiBase || DEFAULT_API_BASE;
  const padBeforeMs = opts.padBeforeMs ?? 45000;
  const padAfterMs = opts.padAfterMs ?? 45000;
  const clipPadMs = opts.clipPadMs ?? 5000;

  const startAt = row.savedAt - row.ms;
  const endMs = row.savedAt;
  const from = new Date(startAt - padBeforeMs).toISOString();
  const to = new Date(endMs + padAfterMs).toISOString();

  const raw = await fetchRoute(apiBase, deviceId, from, to);
  const clipped = clipPoints(raw, startAt - clipPadMs, endMs + clipPadMs);
  if (clipped.length < 8) return null;

  return {
    gps: gpsLabel,
    startAt,
    gpsMs: row.ms,
    points: downsampleGpsPoints(clipped, opts.maxPoints ?? 180),
  };
}

export async function fetchGpsTracesFromBundle(bundle, opts = {}) {
  const traces = {};
  const slots = bundle.savedSlots || [];
  if (!opts.assignmentMap) {
    const { buildAssignmentMap } = await import('./u19-trial-gps-assignments.mjs');
    opts = { ...opts, assignmentMap: await buildAssignmentMap(bundle, opts) };
  }
  const concurrency = opts.concurrency ?? 4;
  let idx = 0;

  async function worker() {
    while (idx < slots.length) {
      const i = idx++;
      const row = slots[i];
      try {
        const hit = await fetchGpsTraceForSlot(row, opts);
        if (hit) traces[slotKey(row)] = hit;
      } catch (err) {
        if (opts.verbose) {
          console.warn(`GPS fetch failed ${slotKey(row)}:`, err.message || err);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, slots.length || 1) }, () => worker()));
  return traces;
}

export async function mergeFetchedGpsTraces(bundle, opts = {}) {
  if (!opts.assignmentMap) {
    const { buildAssignmentMap } = await import('./u19-trial-gps-assignments.mjs');
    opts = { ...opts, assignmentMap: await buildAssignmentMap(bundle, opts) };
  }
  const fetched = await fetchGpsTracesFromBundle(bundle, opts);
  const merged = { ...(bundle.gpsTraces || {}), ...fetched };
  if (Object.keys(merged).length) return merged;

  if (opts.fallbackSynthesize) {
    const { mergeGpsTraces } = await import('./u19-trial-gps-synthesize.mjs');
    return mergeGpsTraces(bundle, opts.localGps || {});
  }
  return merged;
}
