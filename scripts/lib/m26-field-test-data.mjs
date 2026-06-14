/**
 * M26 (One NZ Smart M26) field test results — 14 Jun 2026, Karāpiro area.
 * Reference handset: Samsung Galaxy S21 (H6). Test device: M26 quote unit (H7).
 * Update after longer battery sessions; regenerate PDFs via npm run proposals:all && npm run docs:m26-report
 */
export const M26_FIELD_TEST = {
  testDate: '14 Jun 2026',
  handset: 'One NZ Smart M26',
  referenceHandset: 'Samsung Galaxy S21',
  batteryMah: 5000,

  gps: {
    windowNz: '11:30–11:45 NZST',
    durationMin: 16,
    distanceKm: 10,
    fixRateHz: 1.0,
    h6: { fixes: 956, medianAccM: 5.2, p90AccM: 7.6, maxGapSec: 2.0, distanceKm: 9.9 },
    h7: { fixes: 959, medianAccM: 3.3, p90AccM: 5.2, maxGapSec: 1.0, distanceKm: 9.95 },
    trackMedianSepM: 4.2,
    trackMatchedPct: 100,
  },

  battery: {
    startPct: 96,
    startTimeNz: '06:45',
    endTimeNz: '17:01',
    snapshotPct: 64,
    elapsedH: 10.3,
    dropPct: 32,
    drainPerH: 3.1,
    estFullChargeH: 32,
    dataUsageMb: 36,
    gpsRateHz: 1,
    profile: '1 Hz GPS + background recording',
    status: 'complete',
  },

  /** ~8 h active day at measured 1 Hz drain — well within single-charge regatta day. */
  regattaDayActiveH: 8,
  regattaDayDrainPctAt1Hz: 25,

  /** Prior A1 reference at 30 s GPS (Jun 2026 documents hub). */
  refA1DrainPerH: 3.7,
  refA1EstFullH: 27,
};

/** Headline field runtime for proposal docs (continuous 1 Hz; regatta mixed profile uses less). */
export const M26_FIELD_BATTERY_HOURS = M26_FIELD_TEST.battery.estFullChargeH;

export function m26GpsSummaryHtml() {
  const g = M26_FIELD_TEST.gps;
  return `<p class="muted">Field test ${M26_FIELD_TEST.testDate}: ${g.windowNz} drive (~${g.distanceKm} km) at ~${g.fixRateHz} Hz.
    M26 median GPS accuracy <strong>${g.h7.medianAccM} m</strong> (p90 ${g.h7.p90AccM} m) vs S21 reference ${g.h6.medianAccM} m;
    fix continuity ${g.h7.maxGapSec} s max gap on M26. Track agreement median ${g.trackMedianSepM} m.</p>`;
}

export function m26BatterySummaryHtml() {
  const b = M26_FIELD_TEST.battery;
  return `<p class="muted">Battery ${M26_FIELD_TEST.testDate}: ${b.startPct}% @ ${b.startTimeNz} NZ → ${b.snapshotPct}% after ${b.elapsedH} h
    (~${b.drainPerH} %/h at ${b.profile}; ~${b.estFullChargeH} h from full charge; app data ${b.dataUsageMb} MB).
    An ${M26_FIELD_TEST.regattaDayActiveH}-hour active day at 1 Hz uses ~${M26_FIELD_TEST.regattaDayDrainPctAt1Hz}% — no mid-day charge required.</p>`;
}

export function m26FieldValidationTableHtml() {
  const g = M26_FIELD_TEST.gps;
  const b = M26_FIELD_TEST.battery;
  return `
  <h3>Field validation — ${M26_FIELD_TEST.handset} (${M26_FIELD_TEST.testDate})</h3>
  <table>
    <thead><tr><th>Test</th><th>M26 (H7)</th><th>S21 reference (H6)</th></tr></thead>
    <tbody>
      <tr><td>GPS fix rate (~10 km drive)</td><td>${g.fixRateHz} Hz</td><td>${g.fixRateHz} Hz</td></tr>
      <tr><td>Median accuracy</td><td><strong>${g.h7.medianAccM} m</strong></td><td>${g.h6.medianAccM} m</td></tr>
      <tr><td>p90 accuracy</td><td><strong>${g.h7.p90AccM} m</strong></td><td>${g.h6.p90AccM} m</td></tr>
      <tr><td>Max fix gap</td><td>${g.h7.maxGapSec} s</td><td>${g.h6.maxGapSec} s</td></tr>
      <tr><td>Track agreement</td><td colspan="2">Median ${g.trackMedianSepM} m separation (${g.trackMatchedPct}% matched ±3 s)</td></tr>
      <tr><td>Battery (${b.elapsedH} h @ ${b.gpsRateHz} Hz)</td><td colspan="2">${b.startPct}% → ${b.snapshotPct}% · ~${b.drainPerH} %/h · ~${b.estFullChargeH} h from 100%</td></tr>
      <tr><td>App cellular data (${b.elapsedH} h)</td><td colspan="2">${b.dataUsageMb} MB</td></tr>
      <tr><td>8 h regatta day @ 1 Hz (est.)</td><td colspan="2">~${M26_FIELD_TEST.regattaDayDrainPctAt1Hz}% drain — overnight charge sufficient</td></tr>
    </tbody>
  </table>`;
}
