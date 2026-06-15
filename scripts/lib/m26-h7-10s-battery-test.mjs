/**
 * H7 (One NZ Smart M26) battery + data test @ 10 s reporting — 15 Jun 2026.
 * Regenerate PDF: npm run docs:m26-10s-report
 */
export const M26_H7_10S_BATTERY_TEST = {
  id: 'battery-h7-m26-10s-2026-06-15',
  deviceId: 'H7',
  handset: 'One NZ Smart M26',
  reportingIntervalSec: 10,
  reportingLabel: '10 s',
  status: 'complete',
  testDate: '15 Jun 2026',

  start: {
    timeNz: '06:17',
    startNz: '15 Jun 2026, 06:17',
    startIso: '2026-06-14T18:17:40.189Z',
    batteryPct: 69,
    /** OS-reported cumulative app cellular data at session start. */
    dataUsageMb: 42.97,
  },

  end: {
    timeNz: '16:35',
    endNz: '15 Jun 2026, 16:35',
    endIso: '2026-06-15T04:35:16.052Z',
    batteryPct: 28,
    dataUsageMb: 54.38,
    elapsedH: 10.3,
    dropPct: 41,
    drainPerH: 4.0,
    estFullChargeH: 25,
    sessionDataMb: 11.41,
  },

  ingest: {
    totalSamples: 3706,
    sessionAvgHz: 0.1,
    activeMedianGapSec: 10.0,
    activeRateHz: 0.1,
    gapsOver60s: 0,
  },

  /** Prior completed tests on same handset — for comparison. */
  compareRef: {
    oneHz: { profile: '1 Hz', elapsedH: 10.3, drainPerH: 3.1, sessionDataMb: 36, estFullChargeH: 32 },
    thirtySec: { profile: '30 s', elapsedH: 11.0, drainPerH: 2.5, sessionDataMb: 6.16, estFullChargeH: 39 },
  },
};

export function m26H710sSessionDataMb(test = M26_H7_10S_BATTERY_TEST) {
  const { start, end } = test;
  if (start.dataUsageMb == null || end.dataUsageMb == null) return null;
  return Math.round((end.dataUsageMb - start.dataUsageMb) * 100) / 100;
}
