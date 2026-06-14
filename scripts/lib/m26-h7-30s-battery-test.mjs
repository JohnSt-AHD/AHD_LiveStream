/**
 * H7 (One NZ Smart M26) battery + data test @ 30 s reporting — started 14 Jun 2026.
 * Update end values when the session finishes; regenerate hub entry via npm run docs:m26-30s-report (when added).
 */
export const M26_H7_30S_BATTERY_TEST = {
  id: 'battery-h7-m26-30s-2026-06-14',
  deviceId: 'H7',
  handset: 'One NZ Smart M26',
  reportingIntervalSec: 30,
  reportingLabel: '30 s',
  status: 'in_progress',
  testDate: '14 Jun 2026',

  start: {
    timeNz: '19:09',
    startNz: '14 Jun 2026, 19:09',
    startIso: '2026-06-14T07:09:00.000Z',
    batteryPct: 98,
    /** OS-reported cumulative app cellular data at session start (includes prior 1 Hz test). */
    dataUsageMb: 36.77,
  },

  end: {
    timeNz: null,
    endNz: null,
    endIso: null,
    batteryPct: null,
    dataUsageMb: null,
    elapsedH: null,
    dropPct: null,
    drainPerH: null,
    sessionDataMb: null,
  },

  /** Latest interim reading (test still in progress). */
  snapshot: {
    timeNz: '21:33',
    snapshotNz: '14 Jun 2026, 21:33',
    snapshotIso: '2026-06-14T09:33:10.869Z',
    batteryPct: 92,
    dataUsageMb: 38.14,
    elapsedH: 2.4,
    dropPct: 6,
    drainPerH: 2.5,
    sessionDataMb: 1.37,
  },

  /** Completed 1 Hz test on same handset — for comparison when this session ends. */
  compareRef: {
    reportId: 'gps-h7-m26-2026-06-14',
    profile: '1 Hz',
    elapsedH: 10.3,
    drainPerH: 3.1,
    sessionDataMb: 36,
  },
};

/** Session cellular data delta (end cumulative minus start baseline). */
export function m26H730sSessionDataMb(test = M26_H7_30S_BATTERY_TEST) {
  const { start, end } = test;
  if (start.dataUsageMb == null || end.dataUsageMb == null) return null;
  return Math.round((end.dataUsageMb - start.dataUsageMb) * 100) / 100;
}
