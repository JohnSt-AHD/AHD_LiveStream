/**
 * H7 (One NZ Smart M26) battery + data test @ 30 s reporting — 14–15 Jun 2026.
 * Regenerate PDF: npm run docs:m26-30s-report
 */
export const M26_H7_30S_BATTERY_TEST = {
  id: 'battery-h7-m26-30s-2026-06-14',
  deviceId: 'H7',
  handset: 'One NZ Smart M26',
  reportingIntervalSec: 30,
  reportingLabel: '30 s',
  status: 'complete',
  testDate: '14–15 Jun 2026',

  start: {
    timeNz: '19:09',
    startNz: '14 Jun 2026, 19:09',
    startIso: '2026-06-14T07:09:00.000Z',
    batteryPct: 98,
    /** OS-reported cumulative app cellular data at session start (includes prior 1 Hz test). */
    dataUsageMb: 36.77,
  },

  end: {
    timeNz: '06:11',
    endNz: '15 Jun 2026, 06:11',
    endIso: '2026-06-14T18:11:38.918Z',
    batteryPct: 70,
    dataUsageMb: 42.93,
    elapsedH: 11.0,
    dropPct: 28,
    drainPerH: 2.5,
    estFullChargeH: 39,
    sessionDataMb: 6.16,
  },

  ingest: {
    totalSamples: 1023,
    sessionAvgHz: 0.03,
    activeMedianGapSec: 30.0,
    activeRateHz: 0.033,
    gapsOver60s: 193,
  },

  /** Completed 1 Hz test on same handset — comparison. */
  compareRef: {
    reportId: 'gps-h7-m26-2026-06-14',
    profile: '1 Hz',
    elapsedH: 10.3,
    drainPerH: 3.1,
    sessionDataMb: 36,
    estFullChargeH: 32,
  },
};

/** Session cellular data delta (end cumulative minus start baseline). */
export function m26H730sSessionDataMb(test = M26_H7_30S_BATTERY_TEST) {
  const { start, end } = test;
  if (start.dataUsageMb == null || end.dataUsageMb == null) return null;
  return Math.round((end.dataUsageMb - start.dataUsageMb) * 100) / 100;
}
