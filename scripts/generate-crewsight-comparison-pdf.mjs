#!/usr/bin/env node
/**
 * Generate CrewSight competitive comparison PDF (LoRaWAN / GeoRacing).
 * 270 devices · 4-month season · ops-only vs live-stream tiers.
 * Usage: node scripts/generate-crewsight-comparison-pdf.mjs
 */
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { uploadPdfToDrive } from './lib/upload-proposal-to-drive.mjs';
import { M26_FIELD_TEST, m26BatterySummaryHtml, m26GpsSummaryHtml } from './lib/m26-field-test-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs', 'proposals');

const GST = 0.15;
const FLEET = 270;
const HANDSET_SELL = 130;
const PLATFORM_FEE = 6000;
const SIM_MONTH = 5;
const SEASON_MONTHS = 4;
const MOUNT_SELL = 50;
const REGATTA_DAYS = 32;
const REGATTA_COUNT = 8;

/** Indicative EUR/NZD — update when Trimaran quote received. */
const EUR_TO_NZD = 1.82;

/** CrewSight virtual livestream add-on — per regatta day (NZD; not on-site cameras). */
const CREWSIGHT_VIRTUAL_STREAM_DAY_NZD = 750;

/**
 * GeoRacing indicative turnkey estimate (270 devices · 4-month season · 32 tracking days).
 * Device rental + platform in EUR.
 * Virtual livestream: Fan Experience / 2D Race Viewer package — €48,000 season add-on (GeoRacing commercial terms).
 */
const GEORACING_EUR = {
  deviceMonth: 42,
  platformSetup: 16_500,
  /** Virtual 2D livestream / on-air graphics — season add-on (not on-site cameras). */
  virtualLivestreamSeason: 48_000,
};

const LORA_TRACKER_NZD = 199;
const LORA_GATEWAY_NZD = 1400;
const LORA_SETUP_NZD = 500;
const LORA_CLOUD_30_YR_NZD = 990;
const LORA_UPDATE_SEC = 10;

function money(n, { gst = false, currency = 'NZD', decimals = 0 } = {}) {
  const v = gst ? n * (1 + GST) : n;
  const sym = currency === 'EUR' ? '€' : '$';
  return `${sym}${v.toLocaleString('en-NZ', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function eurAndNzd(eur) {
  return { eur, nzd: eur * EUR_TO_NZD };
}

function loraCloudSeason(devices, months = SEASON_MONTHS) {
  const tiers = Math.ceil(devices / 30);
  return tiers * LORA_CLOUD_30_YR_NZD * (months / 12);
}

function loraGateways(devices) {
  return Math.max(1, Math.ceil(devices / 40));
}

function loraSeason(devices) {
  const gateways = loraGateways(devices);
  const trackers = devices * LORA_TRACKER_NZD;
  const gatewayCost = gateways * LORA_GATEWAY_NZD;
  const setup = LORA_SETUP_NZD;
  const cloud = loraCloudSeason(devices);
  return { devices, gateways, trackers, gatewayCost, setup, cloud, total: trackers + gatewayCost + setup + cloud };
}

function crewsightSeason(devices, { withMounting = false } = {}) {
  const handsets = devices * HANDSET_SELL;
  const sim = devices * SIM_MONTH * SEASON_MONTHS;
  const platform = PLATFORM_FEE;
  const mounting = withMounting ? devices * MOUNT_SELL : 0;
  const included = handsets + platform + sim + mounting;
  return { handsets, sim, platform, mounting, included };
}

function georacingSeason({ withVirtualLiveStream = false } = {}) {
  const deviceRental = FLEET * GEORACING_EUR.deviceMonth * SEASON_MONTHS;
  const platform = GEORACING_EUR.platformSetup;
  const opsEur = deviceRental + platform;
  const virtualStreamEur = withVirtualLiveStream ? GEORACING_EUR.virtualLivestreamSeason : 0;
  const virtualStreamNzd = virtualStreamEur * EUR_TO_NZD;
  const opsNzd = opsEur * EUR_TO_NZD;
  const totalNzd = opsNzd + virtualStreamNzd;
  return {
    deviceRental,
    platform,
    virtualStreamEur,
    virtualStreamNzd,
    withVirtualLiveStream,
    eur: opsEur,
    nzd: opsNzd,
    totalNzd,
    totalEur: opsEur + virtualStreamEur,
  };
}

function comparisonHtml() {
  const date = new Date().toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const cs = crewsightSeason(FLEET);
  const csMounted = crewsightSeason(FLEET, { withMounting: true });
  const csVirtualSeason = REGATTA_DAYS * CREWSIGHT_VIRTUAL_STREAM_DAY_NZD;
  const csWithVirtual = cs.included + csVirtualSeason;
  const geoVirtualSeasonEur = GEORACING_EUR.virtualLivestreamSeason;
  const geoVirtualSeasonNzd = geoVirtualSeasonEur * EUR_TO_NZD;
  const lora = loraSeason(FLEET);
  const geoOps = georacingSeason({ withVirtualLiveStream: false });
  const geoVirtual = georacingSeason({ withVirtualLiveStream: true });
  const cloud4moPer30 = money(loraCloudSeason(30));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CrewSight — Competitive comparison (270 devices)</title>
  <style>
    @page { size: A4; margin: 12mm 12mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; font-size: 9pt; line-height: 1.36; margin: 0; }
    header { border-bottom: 3px solid #0e7490; padding-bottom: 10px; margin-bottom: 12px; }
    .brand { font-size: 18pt; font-weight: 800; color: #0e7490; margin: 0; }
    .brand-sub { font-weight: 600; color: #164e63; font-size: 9.8pt; margin: 2px 0 0; }
    .tagline { color: #64748b; font-size: 8.8pt; margin: 4px 0 0; }
    h2 { font-size: 10.5pt; color: #0e7490; margin: 12px 0 5px; border-bottom: 1px solid #ccfbf1; padding-bottom: 3px; page-break-after: avoid; }
    h3 { font-size: 9.5pt; color: #155e75; margin: 8px 0 4px; page-break-after: avoid; }
    p { margin: 0 0 6px; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 8.2pt; }
    th, td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: left; vertical-align: top; }
    th { background: #ecfeff; font-weight: 600; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .win { background: #ecfdf5; font-weight: 600; color: #047857; }
    .gap { background: #fef2f2; }
    .na { color: #94a3b8; font-style: italic; }
    .highlight { background: #ecfeff; border: 1px solid #99f6e4; border-radius: 6px; padding: 8px 10px; margin: 8px 0; }
    .muted { color: #64748b; font-size: 7.8pt; }
    ul { margin: 3px 0 6px; padding-left: 16px; }
    li { margin-bottom: 2px; }
    footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 7.8pt; color: #64748b; }
  </style>
</head>
<body>
  <header>
    <p class="brand">CrewSight</p>
    <p class="brand-sub">Competitive comparison — ${FLEET} devices · 4-month season · ops / tracking + virtual livestream</p>
    <p class="tagline">Altitude HD · ${date}</p>
  </header>

  <div class="highlight">
    <strong>Scope:</strong> ${FLEET}-device fleet · ${SEASON_MONTHS}-month season · ${REGATTA_COUNT} regattas · ${REGATTA_DAYS} tracking days.
    Two tiers: <strong>ops / tracking only</strong> (fleet + platform + data) vs <strong>+ virtual livestream</strong> (2D race viewer / on-air graphics — no on-site cameras).
    CrewSight season quote is <strong>ops / tracking</strong> at ${money(cs.included)} — vMix / AHD overlay feeds <strong>supported</strong>, regatta production not included. Optional CrewSight <strong>virtual livestream</strong> add-on:
    ${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/regatta day × ${REGATTA_DAYS} days = ${money(csVirtualSeason)}.
    GeoRacing virtual livestream per Fan Experience / 2D Race Viewer package: ${money(geoVirtualSeasonEur, { currency: 'EUR' })} season add-on (~${money(geoVirtualSeasonNzd)} NZD).
    On-site cameras <strong>not included</strong> by either vendor. GeoRacing ops tier indicative in EUR → NZD @ ${EUR_TO_NZD}.
  </div>

  <h2>Season cost summary — ${FLEET} devices (ex GST)</h2>
  <table>
    <thead>
      <tr>
        <th>Solution</th>
        <th class="num">Ops / tracking only</th>
        <th class="num">+ Virtual livestream</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>CrewSight</strong></td>
        <td class="num win"><strong>${money(cs.included)}</strong><br /><span class="muted">${money(cs.included * (1 + GST), { gst: false })} incl</span></td>
        <td class="num win"><strong>${money(csWithVirtual)}</strong><br /><span class="muted">${money(csWithVirtual * (1 + GST), { gst: false })} incl</span></td>
        <td>Ops / tracking in base quote. Livestream overlay feeds supported. Virtual livestream: +${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/day × ${REGATTA_DAYS} days. No on-site cameras.</td>
      </tr>
      <tr>
        <td><strong>IQnexus LoRaWAN</strong></td>
        <td class="num">${money(lora.total)}</td>
        <td class="num na">${money(lora.total)}</td>
        <td class="gap">No livestream path — tracking portal only</td>
      </tr>
      <tr>
        <td><strong>GeoRacing</strong> (indicative)</td>
        <td class="num">${money(geoOps.nzd)}<br /><span class="muted">${money(geoOps.eur, { currency: 'EUR' })}</span></td>
        <td class="num">${money(geoVirtual.totalNzd)}<br /><span class="muted">+${money(geoVirtualSeasonEur, { currency: 'EUR' })} virtual</span></td>
        <td>Virtual livestream add-on (2D viewer / GFX) — <strong>not</strong> on-site cameras; ${money(geoVirtualSeasonEur, { currency: 'EUR' })} season (GeoRacing package)</td>
      </tr>
    </tbody>
  </table>
  <p class="muted">Per device (ops tier): CrewSight ${money(cs.included / FLEET)} · LoRa ${money(lora.total / FLEET)} · GeoRacing ${money(geoOps.nzd / FLEET)} (${money(geoOps.eur / FLEET, { currency: 'EUR' })})</p>

  <p class="muted">CrewSight virtual livestream add-on: ${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)} × ${REGATTA_DAYS} regatta days = ${money(csVirtualSeason)} ex GST.
    GeoRacing virtual livestream: ${money(geoVirtualSeasonEur, { currency: 'EUR' })} season add-on (~${money(geoVirtualSeasonNzd)} NZD @ ${EUR_TO_NZD}).</p>

  <h2>GeoRacing indicative estimate — EUR → NZD</h2>
  <p class="muted">GeoRacing device/platform in EUR. Virtual livestream per Fan Experience / 2D Race Viewer package: ${money(geoVirtualSeasonEur, { currency: 'EUR' })} season add-on (not on-site cameras). Conversion: 1 EUR = ${EUR_TO_NZD} NZD.</p>
  <table>
    <thead>
      <tr>
        <th>Tier</th>
        <th>Includes</th>
        <th class="num">EUR (ops)</th>
        <th class="num">NZD total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Ops / tracking only</strong></td>
        <td>270× tracker rental + LTE · 2D race viewer · ${SEASON_MONTHS}-mo platform</td>
        <td class="num">${money(geoOps.eur, { currency: 'EUR' })}</td>
        <td class="num">${money(geoOps.nzd)}</td>
      </tr>
      <tr>
        <td><strong>+ Virtual livestream</strong></td>
        <td>Above + virtual 2D livestream / on-air graphics (${money(geoVirtualSeasonEur, { currency: 'EUR' })} season add-on) — no on-site cameras</td>
        <td class="num">${money(geoVirtual.totalEur, { currency: 'EUR' })}</td>
        <td class="num">${money(geoVirtual.totalNzd)}</td>
      </tr>
    </tbody>
  </table>

  <h3>GeoRacing &amp; CrewSight — virtual livestream line item</h3>
  <table>
    <thead><tr><th>Item</th><th class="num">CrewSight (NZD)</th><th class="num">GeoRacing (NZD)</th></tr></thead>
    <tbody>
      <tr><td>Fleet / platform (ops / tracking)</td><td class="num">${money(cs.included)}</td><td class="num">${money(geoOps.nzd)}</td></tr>
      <tr><td>Virtual livestream</td><td class="num">${money(csVirtualSeason)}<br /><span class="muted">${REGATTA_DAYS} days × ${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}</span></td><td class="num">${money(geoVirtualSeasonNzd)}<br /><span class="muted">${money(geoVirtualSeasonEur, { currency: 'EUR' })}</span></td></tr>
      <tr><th>Total with virtual livestream</th><th class="num">${money(csWithVirtual)}</th><th class="num">${money(geoVirtual.totalNzd)}</th></tr>
    </tbody>
  </table>

  <h2>Line-item comparison — ops / tracking (${FLEET} devices · ${SEASON_MONTHS} mo)</h2>
  <table>
    <thead><tr><th>Cost element</th><th class="num">CrewSight</th><th class="num">LoRaWAN</th><th class="num">GeoRacing (NZD)</th></tr></thead>
    <tbody>
      <tr><td>End devices</td><td class="num">${money(cs.handsets)} purchase</td><td class="num">${money(lora.trackers)} purchase</td><td class="num">${money(geoOps.deviceRental * EUR_TO_NZD)} rental</td></tr>
      <tr><td>Gateways / infrastructure</td><td class="num">$0</td><td class="num">${money(lora.gatewayCost)} (${lora.gateways}×)</td><td class="num">In rental</td></tr>
      <tr><td>Platform / cloud</td><td class="num">${money(cs.platform)}</td><td class="num">${money(lora.cloud)}</td><td class="num">${money(geoOps.platform * EUR_TO_NZD)}</td></tr>
      <tr><td>Cellular / IoT data</td><td class="num">${money(cs.sim)}</td><td class="num">$0*</td><td class="num">In rental</td></tr>
      <tr><td>Livestream data / vMix feeds</td><td class="num">Supported</td><td class="num">Not included</td><td class="num">In platform</td></tr>
      <tr><td>Virtual livestream</td><td class="num">Optional +${money(csVirtualSeason)}<br /><span class="muted">${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/day</span></td><td class="num">—</td><td class="num">Optional +${money(geoVirtualSeasonNzd)}<br /><span class="muted">${money(geoVirtualSeasonEur, { currency: 'EUR' })}</span></td></tr>
      <tr><td>On-site cameras</td><td class="na" colspan="3">Not included — neither CrewSight nor GeoRacing virtual tier uses on-site cameras</td></tr>
      <tr><td>Boat mounting (rowing)</td><td class="win">${money(MOUNT_SELL)}/boat optional</td><td class="gap">Not offered</td><td class="gap">Not offered</td></tr>
      <tr><th>Total ex GST</th><th class="num">${money(cs.included)}</th><th class="num">${money(lora.total)}</th><th class="num">${money(geoOps.nzd)}</th></tr>
    </tbody>
  </table>

  <h2>Ops / tracking vs virtual livestream</h2>
  <table>
    <thead>
      <tr><th>Capability</th><th>CrewSight (ops)</th><th>CrewSight (+ virtual)</th><th>LoRaWAN</th><th>GeoRacing (ops)</th><th>GeoRacing (+ virtual)</th></tr>
    </thead>
    <tbody>
      <tr><td><strong>Season cost (NZD)</strong></td><td class="num win">${money(cs.included)}</td><td class="num win">${money(csWithVirtual)}</td><td class="num">${money(lora.total)}</td><td class="num">${money(geoOps.nzd)}</td><td class="num">${money(geoVirtual.totalNzd)}</td></tr>
      <tr><td><strong>Tracking data for livestream</strong></td><td class="win">Supported — vMix / AHD feeds</td><td class="win">Supported — vMix / AHD feeds</td><td class="gap">Not available</td><td class="na">2D viewer</td><td class="win">Included</td></tr>
      <tr><td><strong>Virtual livestream (2D / GFX)</strong></td><td class="na">Optional add-on</td><td class="win">${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/regatta day</td><td class="gap">—</td><td class="na">Optional add-on</td><td class="win">${money(geoVirtualSeasonEur, { currency: 'EUR' })} season</td></tr>
      <tr><td><strong>On-site cameras</strong></td><td class="na" colspan="2">Not included</td><td class="gap">—</td><td class="na" colspan="2">Not included</td></tr>
      <tr><td><strong>Capsize / hull alert</strong></td><td class="win" colspan="2">Yes — rowing-tuned</td><td>Generic motion</td><td colspan="2">Emergency button</td></tr>
      <tr><td><strong>Rowing dashboard</strong></td><td class="win" colspan="2">Karāpiro · RowIT · ops monitor</td><td>Generic IoT</td><td colspan="2">Custom per event</td></tr>
      <tr><td><strong>Boat mounting</strong></td><td class="win" colspan="2">Optional ${money(MOUNT_SELL)}/boat</td><td class="gap">Not offered</td><td class="gap" colspan="2">Not offered</td></tr>
      <tr><td><strong>Device ownership</strong></td><td class="win" colspan="2">KRI owns handsets</td><td>KRI owns</td><td colspan="2">Rental / turnkey</td></tr>
      <tr><td><strong>Handset field test (Jun 2026)</strong></td><td class="win" colspan="2">M26: ${M26_FIELD_TEST.gps.h7.medianAccM} m GPS · ~${M26_FIELD_TEST.battery.estFullChargeH} h @ 1 Hz</td><td class="na">Not quoted</td><td class="na" colspan="2">Rental hardware</td></tr>
    </tbody>
  </table>

  <h2>M26 field validation (${M26_FIELD_TEST.testDate})</h2>
  ${m26GpsSummaryHtml()}
  ${m26BatterySummaryHtml()}

  <p class="muted">
    <strong>Ops / tracking</strong> (CrewSight ${money(cs.included)}): GPS fleet, platform, and data — vMix / AHD overlay feeds supported for livestream (regatta production quoted separately).
    <strong>Virtual livestream</strong> optional — CrewSight at ${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/regatta day (${REGATTA_DAYS} days = ${money(csVirtualSeason)}); GeoRacing ${money(geoVirtualSeasonEur, { currency: 'EUR' })} season add-on per Fan Experience package. 2D race viewer / on-air graphics; <strong>no on-site cameras</strong>.
  </p>

  <h2>CrewSight strengths</h2>
  <ul>
    <li><strong>Capsize alert</strong> · <strong>Custom rowing dashboard</strong> · <strong>Designed for NZ regatta programme</strong></li>
    <li><strong>Livestream supported</strong> — vMix / AHD overlay feeds in ops tier · optional <strong>virtual livestream</strong> at ${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/regatta day</li>
    <li><strong>Rowing boat mounting</strong> optional; competitors do not supply shell mounting</li>
  </ul>

  <h2>Summary</h2>
  <p>
    <strong>Ops / tracking:</strong> CrewSight ${money(cs.included)} vs LoRa ${money(lora.total)} vs GeoRacing ~${money(geoOps.nzd)}.
    <strong>+ Virtual livestream:</strong> CrewSight ${money(csWithVirtual)} (+${money(csVirtualSeason)} at ${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/day) vs GeoRacing ~${money(geoVirtual.totalNzd)} (+${money(geoVirtualSeasonEur, { currency: 'EUR' })} / ~${money(geoVirtualSeasonNzd)} NZD).
    Neither vendor includes on-site cameras in the virtual livestream tier. CrewSight owns fleet CAPEX; GeoRacing is rental-based.
  </p>
  <p class="muted">
    Optional CrewSight mounting (${FLEET} boats): +${money(csMounted.mounting)} ex GST.
    LoRa gateway WAN backhaul not itemised. GeoRacing estimate replaces firm € quote when received — update constants in generate-crewsight-comparison-pdf.mjs.
  </p>

  <footer>Altitude HD · CrewSight · Commercial in confidence · ged@altitudehd.nz</footer>
</body>
</html>`;
}

async function writePdf(html, pdfOut, htmlOut) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(htmlOut, html, 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const tmpPdf = `${pdfOut}.tmp`;
  try {
    await page.pdf({ path: tmpPdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
    await page.close();
    const { rename, copyFile } = await import('node:fs/promises');
    try {
      await rename(tmpPdf, pdfOut);
    } catch {
      await copyFile(tmpPdf, pdfOut);
      await unlink(tmpPdf).catch(() => {});
    }
    console.log('Wrote', pdfOut);
    console.log('Wrote', htmlOut);
  } catch (err) {
    await page.close();
    throw err;
  }
  await browser.close();
}

async function main() {
  const htmlOut = join(OUT_DIR, 'CrewSight-Competitive-Comparison.html');
  const pdfOut = join(OUT_DIR, 'CrewSight-Competitive-Comparison.pdf');
  await writePdf(comparisonHtml(), pdfOut, htmlOut);
  await uploadPdfToDrive(pdfOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
