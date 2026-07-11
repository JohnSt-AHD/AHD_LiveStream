/**
 * M1 (Spark MobiWire) field test — 25–26 Jun 2026, Spark M2M.
 * Battery: OS-reported at session start/end (not in GPS position ingest).
 * Regenerate PDF: npm run docs:m1-report
 */
export const M1_FIELD_TEST = {
  testDate: '26 Jun 2026',
  deviceId: 'M1',
  handset: 'Spark MobiWire',
  network: 'Spark M2M',
  gpsRateHz: 1,

  battery: {
    startPct: 93,
    endPct: 5,
    /** OS phone settings — not uploaded in recorder position history. */
    source: 'OS-reported at session start/end',
    profile: '1 Hz GPS + background recording',
    status: 'complete',
  },

  water: {
    windowNz: '08:00–10:00 NZST, 26 Jun 2026',
  },
};

/** Derived battery metrics from elapsed session hours. */
export function m1BatteryMetrics(elapsedH) {
  const { startPct, endPct } = M1_FIELD_TEST.battery;
  const dropPct = startPct - endPct;
  const drainPerH = elapsedH > 0 ? dropPct / elapsedH : null;
  const estFullChargeH = drainPerH != null && drainPerH > 0 ? 100 / drainPerH : null;
  const regatta8hDrainPct = drainPerH != null ? Math.round(drainPerH * 8) : null;
  return {
    startPct,
    endPct,
    dropPct,
    elapsedH,
    drainPerH: drainPerH != null ? Math.round(drainPerH * 10) / 10 : null,
    estFullChargeH: estFullChargeH != null ? Math.round(estFullChargeH) : null,
    regatta8hDrainPct,
  };
}
