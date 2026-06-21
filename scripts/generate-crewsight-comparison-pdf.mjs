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
import { parseProposalArgs } from './lib/proposal-cli.mjs';
import { M26_FIELD_TEST, m26BatterySummaryHtml, m26GpsSummaryHtml } from './lib/m26-field-test-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_OUT_DIR = join(ROOT, 'docs', 'proposals');

const GST = 0.15;
const FLEET = 270;
const HANDSET_SELL = 130;
const PLATFORM_FEE = 6000;
const SEASON_MONTHS = 4;
const MOUNT_SELL = 50;
const REGATTA_DAYS = 32;
const REGATTA_COUNT = 8;

/** EUR/NZD — update if exchange rate changes. */
const EUR_TO_NZD = 1.82;

/** CrewSight virtual livestream add-on — per regatta day (NZD; not on-site cameras). */
const CREWSIGHT_VIRTUAL_STREAM_DAY_NZD = 750;

/**
 * GeoRacing preliminary budget (Trimaran email — hardware purchase + per-event licensing).
 * All EUR figures excl. tax/shipping unless noted. SIM cards not included in tracker price.
 * @see GEORACING_Fan_Experience_Package_2D_Race_Viewer_V2.pdf (hardware specs)
 */
const GEORACING_EUR = {
  /** One-time GPS tracker purchase (excl. tax, shipping). Quote example: 120 × €140 = €16,800. */
  trackerPurchase: 140,
  /** One-day online training webinar — paid upon order. */
  training: 800,
  /** Safety package — private fleet monitoring link. */
  safetyPerDay: 150,
  /** Fan Experience — public iframe, app, leaderboard (up to 20k connections/day). */
  fanExperiencePerDay: 300,
  /** API access — connect GeoRacing data to livestream partner graphics (e.g. vMix). */
  apiPerDay: 200,
};

const LORA_TRACKER_NZD = 199;
const LORA_GATEWAY_NZD = 1400;
const LORA_SETUP_NZD = 500;
const LORA_CLOUD_30_YR_NZD = 990;
/** Assumed uplink interval for IQnexus LoRa trackers in comparison (confirm with vendor). */
const LORA_UPDATE_SEC = 10;
/** Typical outdoor LoRaWAN gateway reach — line-of-sight; obstructions reduce range. */
const LORA_RANGE_LOS_KM = '2–5 km';

/** GeoRacing LTE tracker — from Fan Experience / 2D Race Viewer package PDF (Trimaran). */
const GEORACING_DEVICE = {
  gpsAccuracyM: 1,
  weightG: 93,
  batteryMah: 2600,
  batteryHoursMin: 14,
  batteryHoursMax: 70,
  bufferMessages: 10_000,
  connectivity: 'LTE Cat M1 + 2G fallback',
  dimensionsMm: '39.9 × 26.7 × 77.9',
};

const M26_BATTERY_MAH = M26_FIELD_TEST.batteryMah;

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

function crewsightSeason(devices, simMonth, { withMounting = false } = {}) {
  const handsets = devices * HANDSET_SELL;
  const sim = devices * simMonth * SEASON_MONTHS;
  const platform = PLATFORM_FEE;
  const mounting = withMounting ? devices * MOUNT_SELL : 0;
  const included = handsets + platform + sim + mounting;
  return { handsets, sim, platform, mounting, included };
}

function georacingSeason(simMonth, { withVirtualLiveStream = false } = {}) {
  const hardware = FLEET * GEORACING_EUR.trackerPurchase;
  const training = GEORACING_EUR.training;
  const days = REGATTA_DAYS;

  const safetyLicensing = GEORACING_EUR.safetyPerDay * days;
  const fanLicensing = GEORACING_EUR.fanExperiencePerDay * days;
  const apiLicensing = GEORACING_EUR.apiPerDay * days;
  const virtualLicensing = fanLicensing + apiLicensing;
  const virtualAddonEur = virtualLicensing - safetyLicensing;

  const opsEur = hardware + training + safetyLicensing;
  const withVirtualEur = hardware + training + virtualLicensing;

  /** SIMs not in GeoRacing quote — same One NZ rate as CrewSight for like-for-like. */
  const simNzd = FLEET * simMonth * SEASON_MONTHS;

  return {
    hardware,
    training,
    safetyLicensing,
    fanLicensing,
    apiLicensing,
    virtualLicensing,
    virtualAddonEur,
    simNzd,
    opsEur,
    withVirtualEur,
    opsNzd: opsEur * EUR_TO_NZD + simNzd,
    withVirtualNzd: withVirtualEur * EUR_TO_NZD + simNzd,
    virtualAddonNzd: virtualAddonEur * EUR_TO_NZD,
    withVirtualLiveStream,
    /** Active tier totals for callers that pass withVirtualLiveStream. */
    eur: withVirtualLiveStream ? withVirtualEur : opsEur,
    nzd: (withVirtualLiveStream ? withVirtualEur : opsEur) * EUR_TO_NZD,
    totalNzd: withVirtualLiveStream ? withVirtualEur * EUR_TO_NZD + simNzd : opsEur * EUR_TO_NZD + simNzd,
  };
}

function deviceHardwareComparisonHtml(simMonth) {
  const cs = crewsightSeason(FLEET, simMonth);
  const lora = loraSeason(FLEET);
  const geo = georacingSeason(simMonth);
  const loraHz = (1 / LORA_UPDATE_SEC).toFixed(2);
  const geoHardwareNzd = geo.hardware * EUR_TO_NZD;

  return `
  <h2>Device &amp; hardware comparison</h2>
  <p class="muted">Side-by-side tracker/handset characteristics for ops / tracking. Season costs in earlier tables include platform, data, and gateways where applicable.</p>
  <table>
    <thead>
      <tr>
        <th>Attribute</th>
        <th>CrewSight</th>
        <th>IQnexus LoRaWAN</th>
        <th>GeoRacing</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Device type</strong></td>
        <td>Android smartphone (One NZ Smart M26)</td>
        <td>Dedicated LoRa GPS tracker</td>
        <td>Dedicated LTE GPS tracker (purchase)</td>
      </tr>
      <tr>
        <td><strong>Device cost (${FLEET} fleet)</strong></td>
        <td class="win">${money(cs.handsets)} purchase<br /><span class="muted">${money(HANDSET_SELL)}/unit · KRI owns</span></td>
        <td>${money(lora.trackers)} purchase<br /><span class="muted">${money(LORA_TRACKER_NZD)}/unit · KRI owns</span></td>
        <td>${money(geoHardwareNzd)} purchase<br /><span class="muted">${money(GEORACING_EUR.trackerPurchase, { currency: 'EUR' })}/unit · KRI owns · excl. tax/shipping</span></td>
      </tr>
      <tr>
        <td><strong>Extra infrastructure</strong></td>
        <td>None (cellular)</td>
        <td>${money(lora.gatewayCost)} — ${lora.gateways}× outdoor gateway @ ${money(LORA_GATEWAY_NZD)}<br /><span class="muted">+ ${money(lora.setup)} setup · WAN backhaul per site</span></td>
        <td>None — cellular trackers</td>
      </tr>
      <tr>
        <td><strong>Connectivity / range</strong></td>
        <td class="win">Cellular LTE — national coverage; not line-of-sight limited</td>
        <td>LoRaWAN to gateway — <strong>line-of-sight ~${LORA_RANGE_LOS_KM}</strong> per outdoor gateway; plan coverage for full 2 km course + return lanes</td>
        <td>${GEORACING_DEVICE.connectivity} — cellular; not line-of-sight limited</td>
      </tr>
      <tr>
        <td><strong>GPS update rate</strong></td>
        <td class="win"><strong>1 Hz</strong> on water (field-validated); configurable <strong>1 s–30 s+</strong><br /><span class="muted">Mixed regatta profile: 1 s / 5 s / 30 s</span></td>
        <td><strong>${LORA_UPDATE_SEC} s</strong> assumed (~${loraHz} Hz) — confirm with IQnexus</td>
        <td class="na">Not stated in vendor materials — OTA configurable; confirm with Trimaran</td>
      </tr>
      <tr>
        <td><strong>GPS accuracy</strong></td>
        <td><strong>${M26_FIELD_TEST.gps.h7.medianAccM} m</strong> median (field test ${M26_FIELD_TEST.testDate})</td>
        <td class="na">Not quoted — confirm with vendor</td>
        <td><strong>${GEORACING_DEVICE.gpsAccuracyM} m</strong> (vendor spec)</td>
      </tr>
      <tr>
        <td><strong>Battery / runtime</strong></td>
        <td>${M26_BATTERY_MAH.toLocaleString()} mAh · <strong>~${M26_FIELD_TEST.battery.estFullChargeH} h</strong> @ 1 Hz continuous<br /><span class="muted">~${M26_FIELD_TEST.regattaDayDrainPctAt1Hz}% for ${M26_FIELD_TEST.regattaDayActiveH} h regatta day — overnight charge</span></td>
        <td class="na">Not quoted — typically long-life replaceable cell at low duty cycle; confirm</td>
        <td>${GEORACING_DEVICE.batteryMah} mAh · <strong>${GEORACING_DEVICE.batteryHoursMin}–${GEORACING_DEVICE.batteryHoursMax} h</strong> autonomy (vendor spec; rate-dependent)</td>
      </tr>
      <tr>
        <td><strong>Weight / size</strong></td>
        <td>Smartphone (~${M26_BATTERY_MAH} mAh handset)</td>
        <td class="na">Compact tracker — confirm model with IQnexus</td>
        <td><strong>${GEORACING_DEVICE.weightG} g</strong> · ${GEORACING_DEVICE.dimensionsMm} mm</td>
      </tr>
      <tr>
        <td><strong>Capsize / safety alert</strong></td>
        <td class="win">Automatic hull &amp; crew event detection (rowing-tuned)</td>
        <td>Generic motion — not rowing-specific</td>
        <td>Manual emergency button only</td>
      </tr>
      <tr>
        <td><strong>Offline buffer</strong></td>
        <td>App queues uploads; cellular backfill when coverage returns</td>
        <td>LoRa store-and-forward via gateway</td>
        <td>Up to ${GEORACING_DEVICE.bufferMessages.toLocaleString()} messages (vendor spec)</td>
      </tr>
      <tr>
        <td><strong>Rowing boat mounting</strong></td>
        <td class="win">Optional ${money(MOUNT_SELL)}/boat</td>
        <td class="gap">Not offered</td>
        <td class="gap">Not offered</td>
      </tr>
      <tr>
        <td><strong>Livestream / vMix data feed</strong></td>
        <td class="win">Supported — AHD overlay APIs</td>
        <td class="gap">Not available</td>
        <td>Fan Experience + API (${money(GEORACING_EUR.fanExperiencePerDay, { currency: 'EUR' })} + ${money(GEORACING_EUR.apiPerDay, { currency: 'EUR' })}/day) — optional TV GFX rental extra</td>
      </tr>
      <tr>
        <td><strong>Cellular data (season)</strong></td>
        <td>${money(cs.sim)} (${money(simMonth)}/SIM/mo × ${FLEET})</td>
        <td>$0 per device (gateway WAN only)</td>
        <td class="na">Not included in tracker price — budget ${money(geo.simNzd)} (${money(simMonth)}/SIM/mo × ${FLEET}, same as CrewSight)</td>
      </tr>
    </tbody>
  </table>
  <p class="muted">
    <strong>Sources:</strong> CrewSight — M26 field test ${M26_FIELD_TEST.testDate} (Karāpiro). LoRaWAN — IQnexus pricing &amp; ${LORA_UPDATE_SEC} s uplink assumption; gateway range indicative.
    GeoRacing — Trimaran preliminary budget email + Fan Experience PDF (hardware specs); reporting rate not published.
  </p>`;
}

function comparisonHtml(simMonth) {
  const simNote =
    simMonth !== 5
      ? `<p class="muted"><strong>IoT data rate for this variant:</strong> ${money(simMonth)}/SIM/month (previous baseline ${money(5)}/SIM/month).</p>`
      : '';
  const date = new Date().toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const cs = crewsightSeason(FLEET, simMonth);
  const csMounted = crewsightSeason(FLEET, simMonth, { withMounting: true });
  const csVirtualSeason = REGATTA_DAYS * CREWSIGHT_VIRTUAL_STREAM_DAY_NZD;
  const csWithVirtual = cs.included + csVirtualSeason;
  const lora = loraSeason(FLEET);
  const geoOps = georacingSeason(simMonth, { withVirtualLiveStream: false });
  const geoVirtual = georacingSeason(simMonth, { withVirtualLiveStream: true });
  const cloud4moPer30 = money(loraCloudSeason(30));
  const geoVirtualAddonEur = geoOps.virtualAddonEur;
  const geoVirtualAddonNzd = geoOps.virtualAddonNzd;

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
    GeoRacing per Trimaran preliminary budget: tracker <strong>purchase</strong> ${money(GEORACING_EUR.trackerPurchase, { currency: 'EUR' })}/unit;
    Safety ${money(GEORACING_EUR.safetyPerDay, { currency: 'EUR' })}/day · Fan Experience ${money(GEORACING_EUR.fanExperiencePerDay, { currency: 'EUR' })}/day + API ${money(GEORACING_EUR.apiPerDay, { currency: 'EUR' })}/day for public/broadcast.
    SIMs <strong>not included</strong> in GeoRacing hardware quote — comparison adds ${money(simMonth)}/SIM/mo for parity. EUR → NZD @ ${EUR_TO_NZD}.
  </div>
  ${simNote}

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
        <td><strong>GeoRacing</strong> (Trimaran budget)</td>
        <td class="num">${money(geoOps.opsNzd)}<br /><span class="muted">${money(geoOps.opsEur, { currency: 'EUR' })} + SIM</span></td>
        <td class="num">${money(geoVirtual.withVirtualNzd)}<br /><span class="muted">${money(geoVirtual.withVirtualEur, { currency: 'EUR' })} + SIM</span></td>
        <td>Ops: Safety package ${money(GEORACING_EUR.safetyPerDay, { currency: 'EUR' })}/day. Virtual: Fan Experience + API (${money(GEORACING_EUR.fanExperiencePerDay, { currency: 'EUR' })} + ${money(GEORACING_EUR.apiPerDay, { currency: 'EUR' })}/day × ${REGATTA_DAYS} days). TV GFX rental optional extra.</td>
      </tr>
    </tbody>
  </table>
  <p class="muted">Per device (ops tier, incl. modelled SIM): CrewSight ${money(cs.included / FLEET)} · LoRa ${money(lora.total / FLEET)} · GeoRacing ${money(geoOps.opsNzd / FLEET)} (${money(geoOps.opsEur / FLEET, { currency: 'EUR' })} hardware/licensing + SIM)</p>

  <p class="muted">CrewSight virtual livestream add-on: ${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)} × ${REGATTA_DAYS} regatta days = ${money(csVirtualSeason)} ex GST.
    GeoRacing virtual tier upgrade: Fan Experience + API = ${money(geoVirtualAddonEur, { currency: 'EUR' })} (${money(geoVirtualAddonNzd)} NZD) over Safety package for ${REGATTA_DAYS} days.</p>

  <h2>GeoRacing preliminary budget — EUR → NZD</h2>
  <p class="muted">Trimaran email quote: hardware purchase + per-event licensing (excl. tax/shipping). ${FLEET} devices scaled from vendor example (120 × ${money(GEORACING_EUR.trackerPurchase, { currency: 'EUR' })}).
    SIMs modelled at ${money(simMonth)}/device/mo × ${SEASON_MONTHS} mo (not in GeoRacing quote). Conversion: 1 EUR = ${EUR_TO_NZD} NZD.</p>
  <table>
    <thead>
      <tr>
        <th>Tier</th>
        <th>Includes</th>
        <th class="num">EUR (ex tax)</th>
        <th class="num">NZD + SIM</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Ops / tracking only</strong></td>
        <td>${FLEET}× tracker purchase · ${money(GEORACING_EUR.training, { currency: 'EUR' })} training · Safety ${money(GEORACING_EUR.safetyPerDay, { currency: 'EUR' })}/day × ${REGATTA_DAYS} days</td>
        <td class="num">${money(geoOps.opsEur, { currency: 'EUR' })}</td>
        <td class="num">${money(geoOps.opsNzd)}</td>
      </tr>
      <tr>
        <td><strong>+ Virtual livestream</strong></td>
        <td>Above with Fan Experience ${money(GEORACING_EUR.fanExperiencePerDay, { currency: 'EUR' })}/day + API ${money(GEORACING_EUR.apiPerDay, { currency: 'EUR' })}/day (public viewer + broadcast partner) — no on-site cameras</td>
        <td class="num">${money(geoVirtual.withVirtualEur, { currency: 'EUR' })}</td>
        <td class="num">${money(geoVirtual.withVirtualNzd)}</td>
      </tr>
    </tbody>
  </table>

  <h3>GeoRacing line items (${FLEET} devices · ${REGATTA_DAYS} tracking days)</h3>
  <table>
    <thead><tr><th>Item</th><th class="num">Ops (EUR)</th><th class="num">+ Virtual (EUR)</th></tr></thead>
    <tbody>
      <tr><td>GPS trackers (${FLEET} × ${money(GEORACING_EUR.trackerPurchase, { currency: 'EUR' })}, purchase)</td><td class="num">${money(geoOps.hardware, { currency: 'EUR' })}</td><td class="num">${money(geoVirtual.hardware, { currency: 'EUR' })}</td></tr>
      <tr><td>Initial training (1-day webinar)</td><td class="num">${money(geoOps.training, { currency: 'EUR' })}</td><td class="num">${money(geoVirtual.training, { currency: 'EUR' })}</td></tr>
      <tr><td>Safety package (private monitoring)</td><td class="num">${money(geoOps.safetyLicensing, { currency: 'EUR' })}<br /><span class="muted">${REGATTA_DAYS} × ${money(GEORACING_EUR.safetyPerDay, { currency: 'EUR' })}</span></td><td class="num">—</td></tr>
      <tr><td>Fan Experience (public iframe / app / leaderboard)</td><td class="num">—</td><td class="num">${money(geoVirtual.fanLicensing, { currency: 'EUR' })}<br /><span class="muted">${REGATTA_DAYS} × ${money(GEORACING_EUR.fanExperiencePerDay, { currency: 'EUR' })}</span></td></tr>
      <tr><td>GEORACING API (livestream partner graphics)</td><td class="num">—</td><td class="num">${money(geoVirtual.apiLicensing, { currency: 'EUR' })}<br /><span class="muted">${REGATTA_DAYS} × ${money(GEORACING_EUR.apiPerDay, { currency: 'EUR' })}</span></td></tr>
      <tr><th>Subtotal (ex tax/shipping/SIM)</th><th class="num">${money(geoOps.opsEur, { currency: 'EUR' })}</th><th class="num">${money(geoVirtual.withVirtualEur, { currency: 'EUR' })}</th></tr>
      <tr><td>Cellular SIMs (modelled — not in GeoRacing quote)</td><td class="num">${money(geoOps.simNzd)}</td><td class="num">${money(geoVirtual.simNzd)}</td></tr>
      <tr><th>NZD total (incl. modelled SIM)</th><th class="num">${money(geoOps.opsNzd)}</th><th class="num">${money(geoVirtual.withVirtualNzd)}</th></tr>
    </tbody>
  </table>
  <p class="muted">Optional extras not in totals: remote support ${money(450, { currency: 'EUR' })}/day · on-site ${money(550, { currency: 'EUR' })}/day · TV graphics rental ${money(500, { currency: 'EUR' })}/day + setup ${money(1200, { currency: 'EUR' })}–${money(3000, { currency: 'EUR' })}.</p>

  <h3>GeoRacing &amp; CrewSight — virtual livestream line item</h3>
  <table>
    <thead><tr><th>Item</th><th class="num">CrewSight (NZD)</th><th class="num">GeoRacing (NZD)</th></tr></thead>
    <tbody>
      <tr><td>Fleet / platform (ops / tracking)</td><td class="num">${money(cs.included)}</td><td class="num">${money(geoOps.opsNzd)}</td></tr>
      <tr><td>Virtual livestream licensing</td><td class="num">${money(csVirtualSeason)}<br /><span class="muted">${REGATTA_DAYS} days × ${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}</span></td><td class="num">${money(geoVirtualAddonNzd)}<br /><span class="muted">${money(geoVirtualAddonEur, { currency: 'EUR' })} (Fan + API − Safety)</span></td></tr>
      <tr><th>Total with virtual livestream</th><th class="num">${money(csWithVirtual)}</th><th class="num">${money(geoVirtual.withVirtualNzd)}</th></tr>
    </tbody>
  </table>

  <h2>Line-item comparison — ops / tracking (${FLEET} devices · ${SEASON_MONTHS} mo)</h2>
  <table>
    <thead><tr><th>Cost element</th><th class="num">CrewSight</th><th class="num">LoRaWAN</th><th class="num">GeoRacing (NZD)</th></tr></thead>
    <tbody>
      <tr><td>End devices</td><td class="num">${money(cs.handsets)} purchase</td><td class="num">${money(lora.trackers)} purchase</td><td class="num">${money(geoOps.hardware * EUR_TO_NZD)} purchase<br /><span class="muted">${money(GEORACING_EUR.trackerPurchase, { currency: 'EUR' })}/unit</span></td></tr>
      <tr><td>Gateways / infrastructure</td><td class="num">$0</td><td class="num">${money(lora.gatewayCost)} (${lora.gateways}×)</td><td class="num">$0</td></tr>
      <tr><td>Platform / event licensing</td><td class="num">${money(cs.platform)}</td><td class="num">${money(lora.cloud)}</td><td class="num">${money((geoOps.training + geoOps.safetyLicensing) * EUR_TO_NZD)}<br /><span class="muted">training + Safety ${REGATTA_DAYS}d</span></td></tr>
      <tr><td>Cellular / IoT data</td><td class="num">${money(cs.sim)}</td><td class="num">$0*</td><td class="num">${money(geoOps.simNzd)}<br /><span class="muted">not in GeoRacing quote</span></td></tr>
      <tr><td>Livestream data / vMix feeds</td><td class="num">Supported</td><td class="num">Not included</td><td class="num">API tier (+virtual)</td></tr>
      <tr><td>Virtual livestream</td><td class="num">Optional +${money(csVirtualSeason)}<br /><span class="muted">${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/day</span></td><td class="num">—</td><td class="num">Optional +${money(geoVirtualAddonNzd)}<br /><span class="muted">Fan + API − Safety</span></td></tr>
      <tr><td>On-site cameras</td><td class="na" colspan="3">Not included — neither CrewSight nor GeoRacing virtual tier uses on-site cameras</td></tr>
      <tr><td>Boat mounting (rowing)</td><td class="win">${money(MOUNT_SELL)}/boat optional</td><td class="gap">Not offered</td><td class="gap">Not offered</td></tr>
      <tr><th>Total ex GST</th><th class="num">${money(cs.included)}</th><th class="num">${money(lora.total)}</th><th class="num">${money(geoOps.opsNzd)}</th></tr>
    </tbody>
  </table>

  ${deviceHardwareComparisonHtml(simMonth)}

  <h2>Ops / tracking vs virtual livestream</h2>
  <table>
    <thead>
      <tr><th>Capability</th><th>CrewSight (ops)</th><th>CrewSight (+ virtual)</th><th>LoRaWAN</th><th>GeoRacing (ops)</th><th>GeoRacing (+ virtual)</th></tr>
    </thead>
    <tbody>
      <tr><td><strong>Season cost (NZD)</strong></td><td class="num win">${money(cs.included)}</td><td class="num win">${money(csWithVirtual)}</td><td class="num">${money(lora.total)}</td><td class="num">${money(geoOps.opsNzd)}</td><td class="num">${money(geoVirtual.withVirtualNzd)}</td></tr>
      <tr><td><strong>Tracking data for livestream</strong></td><td class="win">Supported — vMix / AHD feeds</td><td class="win">Supported — vMix / AHD feeds</td><td class="gap">Not available</td><td class="na">Safety (private)</td><td class="win">Fan Experience + API</td></tr>
      <tr><td><strong>Virtual livestream (2D / GFX)</strong></td><td class="na">Optional add-on</td><td class="win">${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/regatta day</td><td class="gap">—</td><td class="na">Safety only</td><td class="win">Fan ${money(GEORACING_EUR.fanExperiencePerDay, { currency: 'EUR' })}/d + API ${money(GEORACING_EUR.apiPerDay, { currency: 'EUR' })}/d</td></tr>
      <tr><td><strong>On-site cameras</strong></td><td class="na" colspan="2">Not included</td><td class="gap">—</td><td class="na" colspan="2">Not included</td></tr>
      <tr><td><strong>Capsize / hull alert</strong></td><td class="win" colspan="2">Yes — rowing-tuned</td><td>Generic motion</td><td colspan="2">Emergency button</td></tr>
      <tr><td><strong>Rowing dashboard</strong></td><td class="win" colspan="2">Karāpiro · RowIT · ops monitor</td><td>Generic IoT</td><td colspan="2">Custom per event</td></tr>
      <tr><td><strong>Boat mounting</strong></td><td class="win" colspan="2">Optional ${money(MOUNT_SELL)}/boat</td><td class="gap">Not offered</td><td class="gap" colspan="2">Not offered</td></tr>
      <tr><td><strong>Device ownership</strong></td><td class="win" colspan="2">KRI owns handsets</td><td>KRI owns</td><td class="win" colspan="2">KRI owns trackers (purchase)</td></tr>
      <tr><td><strong>Handset field test (Jun 2026)</strong></td><td class="win" colspan="2">M26: ${M26_FIELD_TEST.gps.h7.medianAccM} m GPS · ~${M26_FIELD_TEST.battery.estFullChargeH} h @ 1 Hz</td><td class="na">Not quoted</td><td class="na" colspan="2">${GEORACING_DEVICE.weightG} g LTE tracker (vendor spec)</td></tr>
    </tbody>
  </table>

  <h2>M26 field validation (${M26_FIELD_TEST.testDate})</h2>
  ${m26GpsSummaryHtml()}
  ${m26BatterySummaryHtml()}

  <p class="muted">
    <strong>Ops / tracking</strong> (CrewSight ${money(cs.included)}): GPS fleet, platform, and data — vMix / AHD overlay feeds supported for livestream (regatta production quoted separately).
    <strong>Virtual livestream</strong> optional — CrewSight at ${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/regatta day (${REGATTA_DAYS} days = ${money(csVirtualSeason)}); GeoRacing Fan Experience + API (${money(GEORACING_EUR.fanExperiencePerDay, { currency: 'EUR' })} + ${money(GEORACING_EUR.apiPerDay, { currency: 'EUR' })}/day). 2D race viewer / broadcast API; <strong>no on-site cameras</strong>.
  </p>

  <h2>CrewSight strengths</h2>
  <ul>
    <li><strong>Capsize alert</strong> · <strong>Custom rowing dashboard</strong> · <strong>Designed for NZ regatta programme</strong></li>
    <li><strong>Livestream supported</strong> — vMix / AHD overlay feeds in ops tier · optional <strong>virtual livestream</strong> at ${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/regatta day</li>
    <li><strong>Rowing boat mounting</strong> optional; competitors do not supply shell mounting</li>
  </ul>

  <h2>Summary</h2>
  <p>
    <strong>Ops / tracking:</strong> CrewSight ${money(cs.included)} vs LoRa ${money(lora.total)} vs GeoRacing ${money(geoOps.opsNzd)} (${money(geoOps.opsEur, { currency: 'EUR' })} + modelled SIM).
    <strong>+ Virtual livestream:</strong> CrewSight ${money(csWithVirtual)} (+${money(csVirtualSeason)} at ${money(CREWSIGHT_VIRTUAL_STREAM_DAY_NZD)}/day) vs GeoRacing ${money(geoVirtual.withVirtualNzd)} (${money(geoVirtual.withVirtualEur, { currency: 'EUR' })} + SIM).
    Neither vendor includes on-site cameras. Both CrewSight and GeoRacing are purchase-based CAPEX; GeoRacing adds per-event licensing.
  </p>
  <p class="muted">
    Optional CrewSight mounting (${FLEET} boats): +${money(csMounted.mounting)} ex GST.
    LoRa gateway WAN backhaul not itemised. GeoRacing pricing from Trimaran preliminary budget email; tax/shipping/SIM configuration extra.
  </p>

  <footer>Altitude HD · CrewSight · Commercial in confidence · ged@altitudehd.nz</footer>
</body>
</html>`;
}

async function writePdf(html, pdfOut, htmlOut, outDir) {
  await mkdir(outDir, { recursive: true });
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
  const { simMonth, outDir, skipDrive } = parseProposalArgs(ROOT);
  const htmlOut = join(outDir, 'CrewSight-Competitive-Comparison.html');
  const pdfOut = join(outDir, 'CrewSight-Competitive-Comparison.pdf');
  await writePdf(comparisonHtml(simMonth), pdfOut, htmlOut, outDir);
  if (!skipDrive) {
    await uploadPdfToDrive(pdfOut);
  } else {
    console.log('Drive upload skipped (alternate output folder or --skip-drive).');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
