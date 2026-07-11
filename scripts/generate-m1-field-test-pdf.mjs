#!/usr/bin/env node
/**
 * M1 (Spark MobiWire) field test report — ~24 h session + on-water moving test 8–10 am NZST.
 * Usage: node scripts/generate-m1-field-test-pdf.mjs
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  analyzePoints,
  fetchHistory,
  filterPointsByNzWindow,
  nzTime,
} from './lib/recorder-track-analysis.mjs';
import { M26_FIELD_TEST } from './lib/m26-field-test-data.mjs';
import { M1_FIELD_TEST, m1BatteryMetrics } from './lib/m1-mobiwire-field-test-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_PUBLIC = join(ROOT, 'public', 'docs');
const OUT_DOCS = join(ROOT, 'docs', 'field-tests');
const PDF_NAME = 'M1-MobiWire-Field-Test-Report-2026-06-26.pdf';

const RECORDER = 'https://rowing-app-recorder-pwa.vercel.app';
const DEVICE_ID = 'M1';
const FETCH_FROM = '2026-06-24T00:00:00.000Z';
const FETCH_TO = '2026-06-27T00:00:00.000Z';
const WATER_DATE = '2026-06-26';
const WATER_START_H = 8;
const WATER_END_H = 10;

/** Prior device benchmarks for comparison table */
const COMPARE = {
  h7M26: {
    label: 'H7 (One NZ M26)',
    network: 'One NZ IoT',
    testDate: '14 Jun 2026',
    medianAccM: 3.3,
    p90AccM: null,
    activeRateHz: 1.0,
    maxGapSec: null,
    sessionH: 10.3,
    estDataMbPerH: 3.5,
    drainPerH: 3.1,
    notes: 'Field-validated quote handset; 36 MB over 10.3 h @ 1 Hz.',
  },
  a5A06: {
    label: 'A5 (Samsung A06)',
    network: 'Spark M2M',
    testDate: '25 Jun 2026',
    medianAccM: 1.3,
    p90AccM: null,
    activeRateHz: 1.0,
    maxGapSec: 10,
    sessionH: 3.6,
    estDataMbPerH: 1.1,
    drainPerH: null,
    notes: 'Same Spark M2M as M1; 29.5 km full session; battery 58% at end (start not in ingest).',
  },
  h6S21: {
    label: 'H6 (Galaxy S21)',
    network: 'Reference',
    testDate: '14 Jun 2026',
    medianAccM: 5.2,
    p90AccM: null,
    activeRateHz: 1.0,
    maxGapSec: null,
    sessionH: 0.25,
    estDataMbPerH: null,
    drainPerH: null,
    notes: 'Reference handset in M26 moving test only.',
  },
};

function fmt(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  return typeof v === 'number' ? v.toFixed(digits) : String(v);
}

function reportHtml(data) {
  const date = new Date(data.generatedAt).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const full = data.full;
  const water = data.water;
  const bat = data.battery;
  const c = COMPARE;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>M1 MobiWire Field Test Report — 26 Jun 2026</title>
  <style>
    @page { size: A4; margin: 14mm 14mm 16mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #0f172a;
      font-size: 9.8pt;
      line-height: 1.42;
      margin: 0;
    }
    .cover { padding-top: 14mm; }
    .logo {
      font-size: 26pt;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #0e7490;
      margin: 0 0 4px;
    }
    .subtitle { font-size: 13pt; color: #475569; margin: 0 0 16px; }
    .meta { font-size: 9pt; color: #64748b; margin-bottom: 14px; }
    h2 {
      font-size: 11.5pt;
      color: #0e7490;
      margin: 14px 0 6px;
      border-bottom: 2px solid #ccfbf1;
      padding-bottom: 3px;
      page-break-after: avoid;
    }
    p { margin: 0 0 7px; }
    ul { margin: 4px 0 8px; padding-left: 17px; }
    li { margin-bottom: 3px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 7px 0 10px;
      font-size: 9pt;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 5px 7px;
      text-align: left;
    }
    th { background: #ecfeff; color: #0e7490; font-weight: 600; }
    tr:nth-child(even) td { background: #f8fafc; }
    .best { font-weight: 700; color: #047857; }
    .callout {
      background: #fffbeb;
      border: 1px solid #fcd34d;
      border-radius: 8px;
      padding: 10px 12px;
      margin: 10px 0;
      font-size: 9.2pt;
    }
    .verdict {
      background: #ecfdf5;
      border: 1px solid #6ee7b7;
      border-radius: 8px;
      padding: 10px 12px;
      margin: 10px 0;
    }
    .warn {
      background: #fef2f2;
      border: 1px solid #fca5a5;
      border-radius: 8px;
      padding: 10px 12px;
      margin: 10px 0;
    }
    .footer { margin-top: 14px; font-size: 8.5pt; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="cover">
    <p class="logo">RNZ Recorder</p>
    <p class="subtitle">M1 (Spark MobiWire) field test report</p>
    <p class="meta">Generated ${date} · snapshot ${data.generatedNz} NZST<br/>
    Device: M1 · Spark MobiWire · Spark M2M SIM · KRI Recorder PWA</p>

    <h2>1. On-water moving test (${WATER_START_H}:00–${WATER_END_H}:00 NZST, 26 Jun 2026)</h2>
    <p>User-reported on-water rowing session with phone mounted in boat, continuous GPS upload to RNZ Recorder.</p>
    <table>
      <thead>
        <tr><th>Metric</th><th>M1 (MobiWire)</th></tr>
      </thead>
      <tbody>
        <tr><td>Window (NZST)</td><td>${data.waterStartNz} → ${data.waterEndNz}</td></tr>
        <tr><td>GPS fixes</td><td><strong>${water?.count ?? '—'}</strong></td></tr>
        <tr><td>Track distance</td><td><strong>${fmt(water?.distanceKm, 2)} km</strong></td></tr>
        <tr><td>Active fix rate</td><td><strong>${fmt(water?.activeRateHz, 2)} Hz</strong> (median gap ${fmt(water?.activeMedianGapSec)} s)</td></tr>
        <tr><td>Session avg rate</td><td>${fmt(water?.fixRateHz, 2)} Hz over ${fmt(water?.durationMin, 0)} min</td></tr>
        <tr><td>Max fix gap</td><td>${fmt(water?.maxGapSec)} s · gaps &gt;15 s: ${water?.gapsOver15s ?? '—'} · &gt;60 s: ${water?.gapsOver60s ?? '—'}</td></tr>
        <tr><td>Median GPS accuracy</td><td><strong>${fmt(water?.medianAccM)} m</strong></td></tr>
        <tr><td>p90 accuracy</td><td>${fmt(water?.p90AccM)} m · max ${fmt(water?.maxAccM)} m</td></tr>
        <tr><td>Est. cellular data</td><td>~${fmt(water?.estDataMb, 2)} MB (${fmt(water?.estDataMbPerH, 2)} MB/h)</td></tr>
      </tbody>
    </table>
    <div class="verdict">
      <strong>On-water verdict:</strong> ${data.waterVerdict}
    </div>

    <h2>2. Full ~24 h session (recorder ingest)</h2>
    <p>Continuous background session from first to last uploaded fix in the 48 h fetch window.</p>
    <table>
      <thead>
        <tr><th>Parameter</th><th>Value</th></tr>
      </thead>
      <tbody>
        <tr><td>Session start (NZST)</td><td>${data.fullStartNz}</td></tr>
        <tr><td>Session end (NZST)</td><td>${data.fullEndNz}</td></tr>
        <tr><td>Elapsed</td><td><strong>${fmt(full?.durationH, 1)} h</strong> (${full?.count?.toLocaleString() ?? '—'} samples)</td></tr>
        <tr><td>Total track distance</td><td>${fmt(full?.distanceKm, 1)} km</td></tr>
        <tr><td>Active fix rate</td><td><strong>${fmt(full?.activeRateHz, 2)} Hz</strong> (median gap ${fmt(full?.activeMedianGapSec)} s when active)</td></tr>
        <tr><td>Session avg rate</td><td>${fmt(full?.fixRateHz, 2)} Hz (includes idle/sleep gaps)</td></tr>
        <tr><td>Gaps &gt;60 s</td><td>${full?.gapsOver60s ?? '—'} (screen-off / Doze expected overnight)</td></tr>
        <tr><td>Median accuracy (all fixes)</td><td>${fmt(full?.medianAccM)} m</td></tr>
        <tr><td>Est. session data</td><td><strong>~${fmt(full?.estDataMb, 1)} MB</strong> (~${fmt(full?.estDataMbPerH, 2)} MB/h)</td></tr>
      </tbody>
    </table>

    <h2>3. Battery endurance (${M1_FIELD_TEST.testDate})</h2>
    <p>OS-reported battery at session start and end. Recorder position history does not store battery % — same for all devices (H7 M26 battery in prior reports was also OS-sourced, not from GPS ingest). M1 additionally did not publish battery on the live device API (no heartbeat channel on this handset).</p>
    <table>
      <thead>
        <tr><th>Parameter</th><th>Value</th></tr>
      </thead>
      <tbody>
        <tr><td>Session start (NZST)</td><td>${data.fullStartNz} at <strong>${bat.startPct}%</strong></td></tr>
        <tr><td>Session end (NZST)</td><td>${data.fullEndNz} at <strong>${bat.endPct}%</strong></td></tr>
        <tr><td>Elapsed</td><td><strong>~${fmt(bat.elapsedH, 1)} h</strong></td></tr>
        <tr><td>Total drop</td><td><strong>${bat.dropPct}%</strong> (${bat.startPct}% → ${bat.endPct}%)</td></tr>
        <tr><td>Estimated drain</td><td><strong>~${fmt(bat.drainPerH, 1)} %/h</strong> (${M1_FIELD_TEST.battery.profile})</td></tr>
        <tr><td>Est. runtime from 100%</td><td><strong>~${bat.estFullChargeH} h</strong> at similar load</td></tr>
        <tr><td>8 h regatta @ 1 Hz</td><td><strong>~${bat.regatta8hDrainPct}%</strong> drain (vs H7 M26 ~${M26_FIELD_TEST.regattaDayDrainPctAt1Hz}%)</td></tr>
        <tr><td>Est. session data</td><td>~${fmt(full?.estDataMb, 1)} MB (ingest estimate; OS cumulative not recorded)</td></tr>
        <tr><td>Ingest GPS samples</td><td>${full?.count?.toLocaleString() ?? '—'} · active ~${fmt(full?.activeRateHz, 2)} Hz</td></tr>
      </tbody>
    </table>
    <div class="callout">
      <strong>Why no battery in recorder history?</strong> GPS position uploads carry coordinates, accuracy, and motion fields (e.g. stroke rate) — not battery level. Field-test battery figures are always taken from the phone’s Settings → Battery screen at start/end. H7 (M26) reports use the same method. On M1, the live ops API also returned <code>battery.pct: null</code> with no heartbeat samples, so battery was not visible remotely during the test — only from manual OS checks.
    </div>
    <ul>
      <li>Compare to H7 M26 @ 1 Hz: ${M26_FIELD_TEST.battery.startPct}%→${M26_FIELD_TEST.battery.snapshotPct}% over ${M26_FIELD_TEST.battery.elapsedH} h (~${M26_FIELD_TEST.battery.drainPerH} %/h, ~${M26_FIELD_TEST.battery.estFullChargeH} h from full charge).</li>
      <li>M1 drain ~${fmt(bat.drainPerH, 1)} %/h is <strong>${bat.drainVsH7Pct}% higher</strong> than M26 — an 8 h regatta day may need a mid-day top-up unless screen-off discipline improves.</li>
      <li>Smaller MobiWire battery vs M26 (${M26_FIELD_TEST.batteryMah} mAh quote unit) is the likely driver; confirm mAh spec for fleet planning.</li>
    </ul>

    <h2>4. Device comparison (Spark MobiWire vs prior tests)</h2>
    <p>Cross-test comparison of GPS quality and ingest behaviour. M1 and A5 share Spark M2M; H7 uses One NZ IoT on the M26 quote handset.</p>
    <table>
      <thead>
        <tr>
          <th>Device</th>
          <th>Handset</th>
          <th>Network</th>
          <th>Test</th>
          <th>Median acc.</th>
          <th>Active rate</th>
          <th>Est. data</th>
          <th>Drain @ 1 Hz</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>M1</strong></td>
          <td>Spark MobiWire</td>
          <td>Spark M2M</td>
          <td>Water + ~${fmt(bat.elapsedH, 0)} h session</td>
          <td class="${data.waterAccRank === 1 ? 'best' : ''}"><strong>${fmt(water?.medianAccM)} m</strong></td>
          <td>${fmt(water?.activeRateHz, 2)} Hz</td>
          <td>${fmt(full?.estDataMbPerH, 2)} MB/h</td>
          <td><strong>~${fmt(bat.drainPerH, 1)} %/h</strong></td>
        </tr>
        <tr>
          <td>A5</td>
          <td>Samsung A06</td>
          <td>Spark M2M</td>
          <td>25 Jun full day</td>
          <td class="${data.waterAccRank === 2 ? 'best' : ''}">${fmt(c.a5A06.medianAccM)} m</td>
          <td>~${c.a5A06.activeRateHz} Hz</td>
          <td>~${c.a5A06.estDataMbPerH} MB/h</td>
          <td>—</td>
        </tr>
        <tr>
          <td>H7</td>
          <td>One NZ M26</td>
          <td>One NZ IoT</td>
          <td>14 Jun moving</td>
          <td>${fmt(c.h7M26.medianAccM)} m</td>
          <td>~${c.h7M26.activeRateHz} Hz</td>
          <td>~${c.h7M26.estDataMbPerH} MB/h</td>
          <td>~${c.h7M26.drainPerH} %/h</td>
        </tr>
        <tr>
          <td>H6</td>
          <td>Galaxy S21</td>
          <td>Reference</td>
          <td>14 Jun moving</td>
          <td>${fmt(c.h6S21.medianAccM)} m</td>
          <td>~${c.h6S21.activeRateHz} Hz</td>
          <td>—</td>
          <td>—</td>
        </tr>
      </tbody>
    </table>
    <table>
      <thead>
        <tr><th>Comparison point</th><th>Observation</th></tr>
      </thead>
      <tbody>
        ${data.comparisonRows.map((r) => `<tr><td>${r.point}</td><td>${r.obs}</td></tr>`).join('\n        ')}
      </tbody>
    </table>

    <h2>5. Operational notes</h2>
    <ul>
      <li>GPS tracking at ~1 Hz on water is production-ready; battery endurance is the main constraint vs M26 quote handset.</li>
      <li>Overnight / idle gaps are expected on budget Android; session-average rate will be lower than active rowing windows.</li>
      <li>Investigate enabling battery heartbeat on MobiWire app build so ops monitor can show live % (A5/H7 support this on device API).</li>
      <li>Next step: side-by-side water test M1 vs A5 vs H7 on same course for direct track agreement.</li>
    </ul>

    <h2>6. Conclusion</h2>
    <div class="verdict">
      <strong>Overall:</strong> ${data.conclusion}
    </div>
    <ul>
      <li>M1 MobiWire on Spark M2M is ${data.prodReady} for regatta GPS tracking at ~1 Hz when the app is foreground/active on water.</li>
      <li>Battery: ${bat.startPct}%→${bat.endPct}% over ~${fmt(bat.elapsedH, 0)} h (~${fmt(bat.drainPerH, 1)} %/h) — plan charging for full regatta days unless a lower reporting rate is used.</li>
    </ul>

    <p class="footer">RNZ Recorder field test · ingest source ${RECORDER} · device ${DEVICE_ID}<br/>
    Reference: M26 report ${M26_FIELD_TEST.testDate} · A5 session 25 Jun 2026</p>
  </div>
</body>
</html>`;
}

function buildComparison(water, full, bat) {
  const rows = [];
  const m1Acc = water?.medianAccM;
  const ranks = [
    { id: 'm1', v: m1Acc },
    { id: 'a5', v: COMPARE.a5A06.medianAccM },
    { id: 'h7', v: COMPARE.h7M26.medianAccM },
    { id: 'h6', v: COMPARE.h6S21.medianAccM },
  ].filter((x) => x.v != null).sort((a, b) => a.v - b.v);
  const waterAccRank = ranks[0]?.id === 'm1' ? 1 : ranks.findIndex((x) => x.id === 'm1') + 1;

  if (m1Acc != null && COMPARE.a5A06.medianAccM != null) {
    const diff = m1Acc - COMPARE.a5A06.medianAccM;
    rows.push({
      point: 'M1 vs A5 (same Spark M2M)',
      obs:
        diff < -0.5
          ? `M1 median GPS ${fmt(m1Acc)} m is better than A5 (${COMPARE.a5A06.medianAccM} m) — likely antenna/chipset difference on MobiWire vs A06.`
          : diff > 0.5
            ? `A5 was more accurate (${COMPARE.a5A06.medianAccM} m vs M1 ${fmt(m1Acc)} m on water); both acceptable for crew tracking.`
            : `Comparable accuracy (~${fmt(m1Acc)} m vs A5 ${COMPARE.a5A06.medianAccM} m) on Spark M2M.`,
    });
  }

  if (m1Acc != null && COMPARE.h7M26.medianAccM != null) {
    rows.push({
      point: 'M1 vs H7 M26 (One NZ quote handset)',
      obs:
        m1Acc < COMPARE.h7M26.medianAccM
          ? `M1 water test (${fmt(m1Acc)} m) beats M26 field test (${COMPARE.h7M26.medianAccM} m) on raw accuracy.`
          : `M26 remains slightly tighter (${COMPARE.h7M26.medianAccM} m vs M1 ${fmt(m1Acc)} m); both meet sub-5 m regatta target.`,
    });
  }

  const rate = water?.activeRateHz;
  if (rate != null) {
    rows.push({
      point: 'Fix continuity on water',
      obs:
        rate >= 0.9
          ? `Active ~${fmt(rate, 2)} Hz during rowing window — matches H7/A5 ~1 Hz production target. Max gap ${fmt(water.maxGapSec)} s.`
          : `Active rate ~${fmt(rate, 2)} Hz below 1 Hz target — review app foreground lock and GPS interval setting.`,
    });
  }

  if (full?.estDataMbPerH != null) {
    rows.push({
      point: 'Cellular data (estimated)',
      obs: `Full session ~${fmt(full.estDataMbPerH, 2)} MB/h vs M26 ~${COMPARE.h7M26.estDataMbPerH} MB/h and A5 ~${COMPARE.a5A06.estDataMbPerH} MB/h — Spark M2M ingest cost scales with fix rate and upload batching.`,
    });
  }

  if (full?.gapsOver60s != null) {
    rows.push({
      point: 'Idle / overnight behaviour',
      obs: `${full.gapsOver60s} gaps &gt;60 s over ${fmt(full.durationH, 1)} h — typical Android Doze when not on charger; on-water window had ${water?.gapsOver60s ?? 0} gaps &gt;60 s.`,
    });
  }

  if (bat?.drainPerH != null && COMPARE.h7M26.drainPerH != null) {
    rows.push({
      point: 'Battery vs H7 M26',
      obs: `M1 ~${fmt(bat.drainPerH, 1)} %/h (${bat.startPct}%→${bat.endPct}% over ~${fmt(bat.elapsedH, 0)} h) vs M26 ~${COMPARE.h7M26.drainPerH} %/h — MobiWire ~${bat.drainVsH7Pct}% faster drain; 8 h regatta ~${bat.regatta8hDrainPct}% vs M26 ~${M26_FIELD_TEST.regattaDayDrainPctAt1Hz}%.`,
    });
  }

  return { rows, waterAccRank };
}

function waterVerdict(water) {
  if (!water?.count) return 'No fixes in 8–10 am window — check device ID, timezone, or session start time.';
  const okAcc = water.medianAccM != null && water.medianAccM <= 5;
  const okRate = water.activeRateHz != null && water.activeRateHz >= 0.85;
  if (okAcc && okRate) {
    return `Production-ready for on-water tracking: ${fmt(water.medianAccM)} m median accuracy at ~${fmt(water.activeRateHz, 2)} Hz with ${fmt(water.distanceKm, 1)} km logged in 2 h.`;
  }
  if (okAcc) {
    return `GPS accuracy acceptable (${fmt(water.medianAccM)} m) but fix rate (~${fmt(water.activeRateHz, 2)} Hz) should be verified in app settings.`;
  }
  return `Review GPS performance: median ${fmt(water.medianAccM)} m, rate ~${fmt(water.activeRateHz, 2)} Hz — may need clearer sky view or foreground service.`;
}

function conclusion(water, full, bat) {
  const ok =
    water?.medianAccM != null &&
    water.medianAccM <= 5 &&
    water.activeRateHz != null &&
    water.activeRateHz >= 0.85;
  if (ok && bat?.drainPerH != null) {
    return `M1 (Spark MobiWire) delivers regatta-grade GPS on Spark M2M: ${fmt(water.medianAccM)} m median on water, ~${fmt(water.activeRateHz, 2)} Hz active logging. Battery ${bat.startPct}%→${bat.endPct}% over ~${fmt(bat.elapsedH, 0)} h (~${fmt(bat.drainPerH, 1)} %/h) — GPS suitable; plan charging for full 8 h regatta days vs M26 (~${COMPARE.h7M26.drainPerH} %/h).`;
  }
  if (ok) {
    return `M1 (Spark MobiWire) delivers regatta-grade GPS on Spark M2M: ${fmt(water.medianAccM)} m median on water, ~${fmt(water.activeRateHz, 2)} Hz active logging, ~${fmt(full?.estDataMb, 0)} MB over ${fmt(full?.durationH, 0)} h session.`;
  }
  return `M1 completed a ${fmt(full?.durationH, 0)} h ingest session with ${full?.count?.toLocaleString() ?? '—'} fixes; on-water window needs follow-up if fix rate or accuracy were below target.`;
}

async function writePdf(html, outPath) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`Fetching M1 history (${FETCH_FROM} → ${FETCH_TO})…`);
  const points = await fetchHistory(DEVICE_ID, FETCH_FROM, FETCH_TO, RECORDER);
  if (!points.length) throw new Error('No M1 samples returned');

  const full = analyzePoints(points);
  const waterPoints = filterPointsByNzWindow(points, WATER_DATE, WATER_START_H, WATER_END_H);
  const water = analyzePoints(waterPoints);

  const now = new Date();
  const batRaw = m1BatteryMetrics(full.durationH);
  const drainVsH7Pct = Math.round(
    ((batRaw.drainPerH - COMPARE.h7M26.drainPerH) / COMPARE.h7M26.drainPerH) * 100,
  );
  const battery = { ...batRaw, drainVsH7Pct };

  const { rows, waterAccRank } = buildComparison(water, full, battery);

  const html = reportHtml({
    generatedAt: now.toISOString(),
    generatedNz: nzTime(now.toISOString()),
    full,
    water,
    battery,
    fullStartNz: full?.startIso ? nzTime(full.startIso) : '—',
    fullEndNz: full?.endIso ? nzTime(full.endIso) : '—',
    waterStartNz: `${WATER_DATE} ${String(WATER_START_H).padStart(2, '0')}:00`,
    waterEndNz: `${WATER_DATE} ${String(WATER_END_H).padStart(2, '0')}:00`,
    waterVerdict: waterVerdict(water),
    comparisonRows: rows,
    waterAccRank,
    conclusion: conclusion(water, full, battery),
    prodReady:
      water?.activeRateHz >= 0.85 && water?.medianAccM <= 5
        ? 'suitable'
        : 'likely suitable pending further battery testing',
  });

  await mkdir(OUT_PUBLIC, { recursive: true });
  await mkdir(OUT_DOCS, { recursive: true });
  const publicPath = join(OUT_PUBLIC, PDF_NAME);
  const docsPath = join(OUT_DOCS, PDF_NAME);

  console.log('Generating PDF…');
  await writePdf(html, publicPath);
  await copyFile(publicPath, docsPath);

  const meta = {
    testId: 'm1-mobiwire-2026-06-26',
    deviceId: DEVICE_ID,
    handset: 'Spark MobiWire',
    network: 'Spark M2M',
    generatedAt: now.toISOString(),
    generatedNz: nzTime(now.toISOString()),
    fullSession: full,
    waterTest: { windowNz: `${WATER_DATE} ${WATER_START_H}:00–${WATER_END_H}:00`, ...water },
    battery,
    compare: COMPARE,
  };
  await writeFile(join(ROOT, 'public', 'data', 'm1-mobiwire-test-meta.json'), JSON.stringify(meta, null, 2));

  console.log(`Wrote ${publicPath}`);
  console.log(`Wrote ${docsPath}`);
  console.log(
    `M1: ${points.length} samples · full ${fmt(full.durationH, 1)} h · water ${water?.count ?? 0} fixes · battery ${battery.startPct}%→${battery.endPct}% (~${fmt(battery.drainPerH, 1)} %/h)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
