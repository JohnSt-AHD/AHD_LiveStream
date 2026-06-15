#!/usr/bin/env node
/**
 * H7 M26 battery + data test @ 10 s reporting — PDF report.
 * Usage: node scripts/generate-m26-h7-10s-test-pdf.mjs
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { M26_H7_10S_BATTERY_TEST as T } from './lib/m26-h7-10s-battery-test.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_PUBLIC = join(ROOT, 'public', 'docs');
const OUT_DOCS = join(ROOT, 'docs', 'field-tests');
const PDF_NAME = 'M26-H7-10s-Test-Report-2026-06-15.pdf';

const RECORDER = 'https://rowing-app-recorder-pwa.vercel.app';

function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

async function fetchSessionIngest() {
    const url = `${RECORDER}/api/history?uniqueId=H7&from=${encodeURIComponent(T.start.startIso)}&to=${encodeURIComponent(T.end.endIso)}`;
    const pts = await (await fetch(url)).json();
    const arr = Array.isArray(pts) ? pts : [];
    const sorted = [...arr].sort(
        (a, b) => new Date(a.fixTime || a.deviceTime) - new Date(b.fixTime || b.deviceTime),
    );
    if (!sorted.length) return T.ingest;

    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
        gaps.push(
            (new Date(sorted[i].fixTime || sorted[i].deviceTime) -
                new Date(sorted[i - 1].fixTime || sorted[i - 1].deviceTime)) /
                1000,
        );
    }
    const spanSec =
        (new Date(sorted.at(-1).fixTime || sorted.at(-1).deviceTime) -
            new Date(sorted[0].fixTime || sorted[0].deviceTime)) /
        1000;
    const activeGaps = gaps.filter((g) => g <= 15);
    const activeMedian = median(activeGaps);

    return {
        totalSamples: sorted.length,
        sessionAvgHz: spanSec > 0 ? Number((sorted.length / spanSec).toFixed(3)) : T.ingest.sessionAvgHz,
        activeMedianGapSec: activeMedian != null ? Number(activeMedian.toFixed(1)) : T.ingest.activeMedianGapSec,
        activeRateHz: activeMedian > 0 ? Number((1 / activeMedian).toFixed(3)) : T.ingest.activeRateHz,
        gapsOver60s: gaps.filter((g) => g > 60).length,
    };
}

function reportHtml(ingest) {
    const e = T.end;
    const ref = T.compareRef;
    const sessionDataMb = e.sessionDataMb ?? (e.dataUsageMb - T.start.dataUsageMb).toFixed(2);
    const dataPerH = (sessionDataMb / e.elapsedH).toFixed(2);
    const date = new Date(e.endIso).toLocaleDateString('en-NZ', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    const regatta8hBat = Math.round(e.drainPerH * 8);
    const regatta8hData = Math.round((sessionDataMb / e.elapsedH) * 8 * 10) / 10;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>M26 H7 10 s Test Report — ${T.testDate}</title>
  <style>
    @page { size: A4; margin: 14mm 14mm 16mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; font-size: 9.8pt; line-height: 1.42; margin: 0; }
    .cover { padding-top: 18mm; min-height: 240mm; }
    .logo { font-size: 26pt; font-weight: 800; color: #0e7490; margin: 0 0 4px; }
    .subtitle { font-size: 13pt; color: #475569; margin: 0 0 20px; }
    .meta { font-size: 9pt; color: #64748b; margin-bottom: 18px; }
    h2 { font-size: 11.5pt; color: #0e7490; margin: 14px 0 6px; border-bottom: 2px solid #ccfbf1; padding-bottom: 3px; }
    p { margin: 0 0 7px; }
    ul { margin: 4px 0 8px; padding-left: 17px; }
    li { margin-bottom: 3px; }
    table { width: 100%; border-collapse: collapse; margin: 7px 0 10px; font-size: 9.2pt; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; }
    th { background: #ecfeff; color: #0e7490; font-weight: 600; }
    tr:nth-child(even) td { background: #f8fafc; }
    .verdict { background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 8px; padding: 10px 12px; margin: 10px 0; }
    .footer { margin-top: 16px; font-size: 8.5pt; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="cover">
    <p class="logo">RNZ Recorder</p>
    <p class="subtitle">M26 (H7) battery + data test — 10 s reporting</p>
    <p class="meta">Generated ${date} · session ${T.start.startNz} → ${e.endNz} NZST<br/>
    Device: H7 = One NZ Smart M26 quote handset</p>

    <h2>1. Session summary</h2>
    <table>
      <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Reporting interval</td><td><strong>10 s</strong></td></tr>
        <tr><td>Session start</td><td>${T.start.startNz} at ${T.start.batteryPct}%</td></tr>
        <tr><td>Session end</td><td>${e.endNz} at ${e.batteryPct}%</td></tr>
        <tr><td>Elapsed</td><td><strong>${e.elapsedH} h</strong></td></tr>
        <tr><td>Battery drop</td><td>${e.dropPct}% (${T.start.batteryPct}% → ${e.batteryPct}%)</td></tr>
        <tr><td>Drain rate</td><td><strong>~${e.drainPerH} %/h</strong></td></tr>
        <tr><td>Est. runtime from 100%</td><td><strong>~${e.estFullChargeH} h</strong></td></tr>
        <tr><td>App data (cumulative at end)</td><td>${e.dataUsageMb} MB OS total</td></tr>
        <tr><td>Session data (delta)</td><td><strong>${sessionDataMb} MB</strong> (~${dataPerH} MB/h)</td></tr>
      </tbody>
    </table>

    <h2>2. Ingest (recorder history)</h2>
    <table>
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Total samples</td><td>${ingest.totalSamples}</td></tr>
        <tr><td>Active logging median gap</td><td><strong>${ingest.activeMedianGapSec} s</strong> (~${ingest.activeRateHz} Hz)</td></tr>
        <tr><td>Session average ingest</td><td>${ingest.sessionAvgHz} Hz</td></tr>
        <tr><td>Gaps &gt; 60 s</td><td>${ingest.gapsOver60s}</td></tr>
      </tbody>
    </table>
    <p>When actively logging, fix spacing matched the <strong>10 s</strong> configured interval. This session had no gaps &gt; 60 s — tighter upload cadence than the 30 s test (which had long doze gaps on WiFi).</p>

    <h2>3. Comparison — 10 s vs 1 Hz vs 30 s (same handset, Jun 2026)</h2>
    <table>
      <thead><tr><th>Metric</th><th>1 Hz (${ref.oneHz.elapsedH} h)</th><th>10 s (${e.elapsedH} h)</th><th>30 s (${ref.thirtySec.elapsedH} h)</th></tr></thead>
      <tbody>
        <tr><td>Battery drain</td><td>~${ref.oneHz.drainPerH} %/h</td><td><strong>~${e.drainPerH} %/h</strong></td><td>~${ref.thirtySec.drainPerH} %/h</td></tr>
        <tr><td>Session data</td><td>${ref.oneHz.sessionDataMb} MB</td><td><strong>${sessionDataMb} MB</strong></td><td>${ref.thirtySec.sessionDataMb} MB</td></tr>
        <tr><td>Est. full charge</td><td>~${ref.oneHz.estFullChargeH} h</td><td>~${e.estFullChargeH} h</td><td>~${ref.thirtySec.estFullChargeH} h</td></tr>
        <tr><td>8 h regatta day (est.)</td><td>~25% · ~28 MB</td><td>~${regatta8hBat}% · ~${regatta8hData} MB</td><td>~20% · ~5 MB</td></tr>
      </tbody>
    </table>
    <div class="verdict">
      <strong>Verdict:</strong> 10 s on M26 sits between 30 s and 1 Hz for data (~${Math.round((1 - sessionDataMb / ref.oneHz.sessionDataMb) * 100)}% less than 1 Hz, ~${Math.round((sessionDataMb / ref.thirtySec.sessionDataMb - 1) * 100)}% more than 30 s). Drain was ~${e.drainPerH} %/h — higher than the 1 Hz headline rate because this session logged continuously with no long idle gaps. Good middle tier for active racing visibility without full 1 Hz cost.
    </div>

    <h2>4. Conclusion</h2>
    <ul>
      <li>M26 at 10 s validated: ~${e.drainPerH} %/h drain, ${sessionDataMb} MB over ${e.elapsedH} h continuous session.</li>
      <li>8 h regatta day at 10 s uses ~${regatta8hBat}% battery — still within single-charge day with overnight top-up.</li>
      <li>Fleet recommendation: 30 s default · 10 s for heats/finals where smoother trails help · 1 Hz for broadcast / incident windows.</li>
    </ul>

    <p class="footer">RNZ / KRI field testing · rowing-app-recorder-pwa.vercel.app · Altitude HD overlay</p>
  </div>
</body>
</html>`;
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
    console.log('Fetching session ingest…');
    const ingest = await fetchSessionIngest();
    const html = reportHtml(ingest);

    await mkdir(OUT_PUBLIC, { recursive: true });
    await mkdir(OUT_DOCS, { recursive: true });

    const publicPath = join(OUT_PUBLIC, PDF_NAME);
    const docsPath = join(OUT_DOCS, PDF_NAME);

    console.log('Generating PDF…');
    await writePdf(html, publicPath);
    await copyFile(publicPath, docsPath);

    const metaPath = join(ROOT, 'public', 'data', 'm26-h7-10s-test-meta.json');
    await writeFile(
        metaPath,
        JSON.stringify(
            {
                testId: T.id,
                status: 'complete',
                deviceId: T.deviceId,
                handset: T.handset,
                reportingIntervalSec: T.reportingIntervalSec,
                generatedAt: T.end.endIso,
                generatedNz: T.end.endNz,
                battery: {
                    startPct: T.start.batteryPct,
                    startNz: T.start.startNz,
                    endPct: T.end.batteryPct,
                    endNz: T.end.endNz,
                    elapsedH: String(T.end.elapsedH),
                    dropPct: String(T.end.dropPct),
                    drainPerH: String(T.end.drainPerH),
                    estFullH: String(T.end.estFullChargeH),
                    dataUsageMbAtStart: T.start.dataUsageMb,
                    dataUsageMbAtEnd: T.end.dataUsageMb,
                    sessionDataMb: String(T.end.sessionDataMb),
                },
                ingest,
                compareRef: T.compareRef,
            },
            null,
            2,
        ),
    );

    console.log(`Wrote ${publicPath}`);
    console.log(`Wrote ${docsPath}`);
    console.log(
        `Battery: ${T.start.batteryPct}% → ${T.end.batteryPct}% over ${T.end.elapsedH}h (~${T.end.drainPerH} %/h); session data ${T.end.sessionDataMb} MB`,
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
