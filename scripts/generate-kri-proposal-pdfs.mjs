#!/usr/bin/env node
/**
 * Generate CrewSight season proposal PDFs (50- and 270-device tiers).
 * Usage: node scripts/generate-kri-proposal-pdfs.mjs
 */
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { uploadPdfsToDrive } from './lib/upload-proposal-to-drive.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs', 'proposals');

const GST = 0.15;
const M26_COST = 86.09;
const M26_SELL = 130;
const DEVICE_MARGIN = M26_SELL - M26_COST;
/** Flat season platform fee — same for 50- and 270-device tiers. */
const PLATFORM_FEE = 6000;
/** Customer-facing label — no model or supplier on proposals. */
const HANDSET_LABEL = 'GPS handsets';
const SIM_MONTH = 5;
const REGATTA_DAYS = 32;
const SEASON_MONTHS = 4;
const MOUNT_SELL = 50;

const REGATTAS = [
  { count: 5, days: 3 },
  { count: 2, days: 5 },
  { count: 1, days: 7 },
];

const LEGACY_FILES = [
  'KRI-Safety-Season-Proposal-50-devices.pdf',
  'KRI-Safety-Season-Proposal-50-devices.html',
  'KRI-Safety-Season-Proposal-270-devices.pdf',
  'KRI-Safety-Season-Proposal-270-devices.html',
  'KRI-Safety-Season-Business-Case-Internal.pdf',
  'KRI-Safety-Season-Business-Case-Internal.html',
];

const SHARED_STYLES = `
    @page { size: A4; margin: 18mm 16mm 20mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #0f172a;
      font-size: 10.5pt;
      line-height: 1.45;
      margin: 0;
    }
    header {
      border-bottom: 3px solid #0e7490;
      padding-bottom: 12px;
      margin-bottom: 18px;
    }
    .brand {
      font-size: 22pt;
      font-weight: 800;
      color: #0e7490;
      margin: 0;
      letter-spacing: -0.02em;
    }
    .brand-sub { font-weight: 600; color: #164e63; font-size: 11pt; }
    .tagline { color: #64748b; margin: 4px 0 0; font-size: 10pt; }
    h2 {
      font-size: 12pt;
      color: #0e7490;
      margin: 18px 0 8px;
      border-bottom: 1px solid #ccfbf1;
      padding-bottom: 4px;
    }
    p { margin: 0 0 8px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 12px;
      font-size: 10pt;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 7px 9px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #ecfeff; font-weight: 600; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .highlight {
      background: #ecfeff;
      border: 1px solid #99f6e4;
      border-radius: 6px;
      padding: 12px 14px;
      margin: 12px 0;
    }
    .highlight strong { color: #0f766e; font-size: 11pt; }
    .muted { color: #64748b; font-size: 9pt; }
    ul { margin: 6px 0 10px; padding-left: 18px; }
    li { margin-bottom: 4px; }
    footer {
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      font-size: 9pt;
      color: #64748b;
    }
    .badge {
      display: inline-block;
      background: #cffafe;
      color: #0e7490;
      font-size: 9pt;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 999px;
      margin-left: 8px;
    }
    .disclaimer {
      background: #fffbeb;
      border: 1px solid #fcd34d;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 8.5pt;
      color: #78350f;
      margin-top: 12px;
    }
`;

const SAMPLES_PER_DEVICE_DAY = 6840;
const BYTES_PER_SAMPLE = 450;

function money(n, { gst = false } = {}) {
  const v = gst ? n * (1 + GST) : n;
  return `$${v.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Season cloud infra estimate (4 months, 32 regatta tracking days). */
function estimateCloudCosts(devices) {
  const samples = devices * SAMPLES_PER_DEVICE_DAY * REGATTA_DAYS;
  const storageGb = (samples * BYTES_PER_SAMPLE) / 1024 ** 3;
  const vercelPro = 20 * SEASON_MONTHS;
  const neonStorage =
    storageGb * 0.3 * (SEASON_MONTHS / 2);
  const neon = 5 * SEASON_MONTHS + neonStorage;
  const upstash = devices >= 200 ? 40 : 20;
  const bandwidth = devices >= 200 ? 15 : 5;
  const ingestM = samples / 1_000_000;
  const pollsM = (5 * ((8 * 3600) / 2) * REGATTA_DAYS) / 1_000_000;
  const invM = ingestM + pollsM + 0.2;
  const overageM = Math.max(0, invM - 30);
  const serverlessOverage = overageM * 0.6;
  const resend = 0;
  const total = vercelPro + neon + upstash + bandwidth + serverlessOverage + resend;

  return {
    samples,
    storageGb,
    ingestM,
    vercelPro,
    neon,
    neonStorage,
    upstash,
    bandwidth,
    serverlessOverage,
    resend,
    total,
  };
}

function buildTier(devices) {
  const cloud = estimateCloudCosts(devices);
  const hardwareCost = devices * M26_COST;
  const hardwareSell = devices * M26_SELL;
  const deviceProfit = devices * DEVICE_MARGIN;
  const platformProfitGross = PLATFORM_FEE;
  const platformProfitNet = PLATFORM_FEE - cloud.total;
  const totalProfit = deviceProfit + PLATFORM_FEE;
  const netProfit = totalProfit - cloud.total;

  /** IoT SIM: $5/SIM/month × full 4-month season (data-included option). */
  const simSeason = devices * SIM_MONTH * SEASON_MONTHS;
  /** Regatta-day-only activation (internal comparison). */
  const simRegatta = devices * SIM_MONTH * (REGATTA_DAYS / 30);

  const platformFeeOnly = PLATFORM_FEE;
  const platformWithSimSeason = simSeason + PLATFORM_FEE;

  const bundledDataExcluded = hardwareSell + platformFeeOnly;
  const bundledDataIncluded = hardwareSell + platformWithSimSeason;

  const mountOptional = devices * MOUNT_SELL;

  const totalCostIncluded = hardwareCost + simSeason + cloud.total;
  const totalCostExcluded = hardwareCost + cloud.total;
  const totalCostRegattaSim = hardwareCost + simRegatta + cloud.total;

  const hardwareSellIncl = hardwareSell * (1 + GST);

  return {
    devices,
    totalProfit,
    netProfit,
    deviceProfit,
    platformProfitGross,
    platformProfitNet,
    cloud,
    deviceMarginUnit: DEVICE_MARGIN,
    hardwareCost,
    hardwareSell,
    hardwareSellIncl,
    simRegatta,
    simSeason,
    simPerDeviceSeason: SIM_MONTH * SEASON_MONTHS,
    simSavedVsSeason: simSeason - simRegatta,
    platformFeeOnly,
    platformWithSimSeason,
    serviceExcluded: platformFeeOnly,
    serviceIncluded: platformWithSimSeason,
    serviceExcludedIncl: platformFeeOnly * (1 + GST),
    serviceIncludedIncl: platformWithSimSeason * (1 + GST),
    bundledDataExcluded,
    bundledDataIncluded,
    bundledDataExcludedIncl: bundledDataExcluded * (1 + GST),
    bundledDataIncludedIncl: bundledDataIncluded * (1 + GST),
    bundledExcludedWithMount: bundledDataExcluded + mountOptional,
    bundledIncludedWithMount: bundledDataIncluded + mountOptional,
    bundledExcludedWithMountIncl: (bundledDataExcluded + mountOptional) * (1 + GST),
    bundledIncludedWithMountIncl: (bundledDataIncluded + mountOptional) * (1 + GST),
    mountOptional,
    mountUnit: MOUNT_SELL,
    perDeviceExcluded: bundledDataExcluded / devices,
    perDeviceIncluded: bundledDataIncluded / devices,
    perRegattaDayExcluded: bundledDataExcluded / REGATTA_DAYS,
    perRegattaDayIncluded: bundledDataIncluded / REGATTA_DAYS,
    totalCostIncluded,
    totalCostExcluded,
    totalCostRegattaSim,
    netProfitExcluded: bundledDataExcluded - totalCostExcluded,
    netProfitIncluded: bundledDataIncluded - totalCostIncluded,
  };
}

function tierProfitRows(t) {
  return `
      <tr>
        <td>${t.devices}-device tier</td>
        <td class="num">${t.devices}</td>
        <td class="num">${money(t.deviceProfit)}</td>
        <td class="num">${money(t.platformProfitGross)}</td>
        <td class="num">${money(t.cloud.total)}</td>
        <td class="num">${money(t.platformProfitNet)}</td>
        <td class="num">${money(t.netProfitIncluded)}</td>
        <td class="num">${money(t.bundledDataIncluded)}</td>
        <td class="num">${((t.netProfitIncluded / t.bundledDataIncluded) * 100).toFixed(1)}%</td>
      </tr>`;
}

function cloudCostRows(t) {
  const c = t.cloud;
  return `
      <tr><td>Vercel Pro (AHD-LiveStream + recorder ingest, ${SEASON_MONTHS} mo @ $20)</td><td class="num">${money(c.vercelPro)}</td></tr>
      <tr><td>Neon Postgres (~${c.storageGb.toFixed(1)} GB season samples @ $5/mo + storage)</td><td class="num">${money(c.neon)}</td></tr>
      <tr><td>Upstash Redis / KV (CV positions, alert state)</td><td class="num">${money(c.upstash)}</td></tr>
      <tr><td>Bandwidth &amp; CDN (maps, overlays)</td><td class="num">${money(c.bandwidth)}</td></tr>
      <tr><td>Serverless overage (~${c.ingestM.toFixed(1)}M ingest invocations, conservative)</td><td class="num">${money(c.serverlessOverage)}</td></tr>
      <tr><th>Cloud subtotal (season)</th><th class="num">${money(c.total)}</th></tr>`;
}

function tierPricingRows(t, { simIncluded = true } = {}) {
  const sim = simIncluded ? t.simSeason : 0;
  const platformInvoice = simIncluded ? t.platformWithSimSeason : t.platformFeeOnly;
  const total = simIncluded ? t.bundledDataIncluded : t.bundledDataExcluded;
  const totalIncl = simIncluded ? t.bundledDataIncludedIncl : t.bundledDataExcludedIncl;
  const simLabel = simIncluded
    ? `IoT data (${SEASON_MONTHS} mo @ ${money(SIM_MONTH)}/SIM/mo × ${t.devices})`
    : 'IoT data (customer-provided — excluded)';
  return `
      <tr><td>Handsets — cost (${money(M26_COST)} × ${t.devices})</td><td class="num">${money(t.hardwareCost)}</td></tr>
      <tr><td>Handsets — sell (${money(M26_SELL)} × ${t.devices})</td><td class="num">${money(t.hardwareSell)}</td></tr>
      <tr><td>Handset margin (${money(DEVICE_MARGIN)}/unit)</td><td class="num">${money(t.deviceProfit)}</td></tr>
      <tr><td>${simLabel}</td><td class="num">${money(sim)}</td></tr>
      <tr><td>CrewSight platform (${money(PLATFORM_FEE)} season fee${simIncluded ? '' : ' only'})</td><td class="num">${money(platformInvoice)}</td></tr>
      <tr><th>Customer total (ex GST)</th><th class="num">${money(total)}</th></tr>
      <tr><th>Customer total (incl GST)</th><th class="num">${money(totalIncl, { gst: false })}</th></tr>
      <tr><td>Optional boat mounting (${money(MOUNT_SELL)} × ${t.devices})</td><td class="num">${money(t.mountOptional)}</td></tr>
      <tr><th>With mounting (ex GST)</th><th class="num">${money(total + t.mountOptional)}</th></tr>`;
}

function proposalHtml(t) {
  const tierLabel = t.devices === 50 ? 'Pilot fleet' : 'Full regatta fleet';
  const date = new Date().toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CrewSight Season Proposal — ${t.devices} devices</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <header>
    <p class="brand">CrewSight <span class="badge">${tierLabel} · ${t.devices} devices</span></p>
    <p class="brand-sub">by Altitude HD</p>
    <p class="tagline">Racing season proposal · ${date}</p>
  </header>

  <h2>Executive summary</h2>
  <p>
    <strong>CrewSight</strong> delivers live crew visibility — GPS fleet tracking, hull event detection,
    zone alerts, and operations maps — for a <strong>4-month racing season</strong> covering
    <strong>8 regattas</strong> and <strong>${REGATTA_DAYS} active tracking days</strong>.
  </p>
  <div class="highlight">
    <strong>Option A — Data included (4-month season connectivity): ${money(t.bundledDataIncludedIncl, { gst: false })} incl GST</strong><br />
    <strong>Option B — Data excluded (customer-provided SIM): ${money(t.bundledDataExcludedIncl, { gst: false })} incl GST</strong><br />
    <span class="muted">${HANDSET_LABEL} ${money(M26_SELL)}/unit · IoT data included = ${money(SIM_MONTH)}/SIM/mo × ${SEASON_MONTHS} months × ${t.devices} devices (${money(t.simSeason)} ex GST)</span>
  </div>

  <h2>Season schedule</h2>
  <table>
    <thead><tr><th>Regattas</th><th>Duration</th><th class="num">Tracking days</th></tr></thead>
    <tbody>
      ${REGATTAS.map((r) => `<tr><td>${r.count} regatta${r.count > 1 ? 's' : ''}</td><td>${r.days} days each</td><td class="num">${r.count * r.days}</td></tr>`).join('')}
      <tr><th colspan="2">Total active tracking days</th><th class="num">${REGATTA_DAYS}</th></tr>
    </tbody>
  </table>
  <p class="muted">Daily profile: 8 hours — 1 hr @ 1 s · 4 hr @ 5 s · 3 hr @ 30 s reporting.</p>

  <h2>Season pricing options (ex GST)</h2>
  <table>
    <thead>
      <tr><th>Line item</th><th class="num">Data included</th><th class="num">Data excluded</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>${HANDSET_LABEL} (${t.devices} × ${money(M26_SELL)})</td>
        <td class="num">${money(t.hardwareSell)}</td>
        <td class="num">${money(t.hardwareSell)}</td>
      </tr>
      <tr>
        <td>Cellular data — ${SEASON_MONTHS}-month season (${money(SIM_MONTH)}/device/mo × ${t.devices})</td>
        <td class="num">${money(t.simSeason)}</td>
        <td class="num">—</td>
      </tr>
      <tr>
        <td>CrewSight platform — maps, event alerts, ops monitor, provisioning &amp; support (${money(PLATFORM_FEE)} season)</td>
        <td class="num">${money(PLATFORM_FEE)}</td>
        <td class="num">${money(PLATFORM_FEE)}</td>
      </tr>
      <tr>
        <th>Platform + data invoice (excl. handsets)</th>
        <th class="num">${money(t.serviceIncluded)}</th>
        <th class="num">${money(t.serviceExcluded)}</th>
      </tr>
      <tr>
        <th>Season total</th>
        <th class="num">${money(t.bundledDataIncluded)}</th>
        <th class="num">${money(t.bundledDataExcluded)}</th>
      </tr>
      <tr>
        <th>Season total (incl GST)</th>
        <th class="num">${money(t.bundledDataIncludedIncl, { gst: false })}</th>
        <th class="num">${money(t.bundledDataExcludedIncl, { gst: false })}</th>
      </tr>
    </tbody>
  </table>
  <p class="muted"><strong>Data included:</strong> managed IoT SIMs active for the full ${SEASON_MONTHS}-month season (${money(t.simPerDeviceSeason)}/device). <strong>Data excluded:</strong> customer supplies own cellular; platform and handsets only.</p>

  <h2>Optional extra — boat mounting</h2>
  <table>
    <tbody>
      <tr>
        <td>Boat mounting kit (${t.devices} × ${money(MOUNT_SELL)}) — optional</td>
        <td class="num">${money(t.mountOptional)} ex GST · ${money(t.mountOptional * (1 + GST), { gst: false })} incl GST</td>
      </tr>
      <tr>
        <th>Season total with mounting — data included</th>
        <th class="num">${money(t.bundledIncludedWithMountIncl, { gst: false })} incl GST</th>
      </tr>
      <tr>
        <th>Season total with mounting — data excluded</th>
        <th class="num">${money(t.bundledExcludedWithMountIncl, { gst: false })} incl GST</th>
      </tr>
    </tbody>
  </table>

  <h2>Commercial structure (CAPEX-focused, low OPEX)</h2>
  <table>
    <thead>
      <tr><th>Line item</th><th>Type</th><th class="num">Amount (ex GST)</th><th class="num">Incl GST</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>${HANDSET_LABEL} (${t.devices} × ${money(M26_SELL)})</td>
        <td>CAPEX — device purchase</td>
        <td class="num">${money(t.hardwareSell)}</td>
        <td class="num">${money(t.hardwareSellIncl, { gst: false })}</td>
      </tr>
      <tr>
        <td>Boat mounting kit (optional, ${t.devices} × ${money(MOUNT_SELL)})</td>
        <td>CAPEX — optional add-on</td>
        <td class="num">${money(t.mountOptional)}</td>
        <td class="num">${money(t.mountOptional * (1 + GST), { gst: false })}</td>
      </tr>
    </tbody>
  </table>

  <h2>Pricing at a glance</h2>
  <table>
    <thead><tr><th></th><th class="num">Data included</th><th class="num">Data excluded</th></tr></thead>
    <tbody>
      <tr><td>Per device (season)</td><td class="num"><strong>${money(t.perDeviceIncluded)}</strong></td><td class="num"><strong>${money(t.perDeviceExcluded)}</strong></td></tr>
      <tr><td>Per regatta day (whole fleet)</td><td class="num">${money(t.perRegattaDayIncluded)}</td><td class="num">${money(t.perRegattaDayExcluded)}</td></tr>
      <tr><td>Data saving (excluded vs included)</td><td class="num">—</td><td class="num">${money(t.simSeason)}</td></tr>
      <tr><td>Ongoing monthly fees after season</td><td class="num"><strong>$0</strong></td><td class="num"><strong>$0</strong></td></tr>
    </tbody>
  </table>

  <h2>What's included</h2>
  <ul>
    <li>CrewSight GPS app rollout on supplied handsets</li>
    <li>Live fleet maps, geofenced zone alerts, and hull &amp; crew event detection</li>
    <li>Operations monitor — device list, ingest rates, session history</li>
    <li>Cloud hosting on Vercel + Postgres (included in season platform fee)</li>
    <li>Cellular data for full ${SEASON_MONTHS}-month season (data-included option only)</li>
    <li>On-water connectivity validation and device ID setup</li>
    <li>Season support during regatta events</li>
  </ul>
  <p class="muted">See <em>CrewSight-Technical-Overview.pdf</em> for full platform capabilities including vMix overlays and broadcast integration.</p>

  <h2>Customer requirements</h2>
  <ul>
    <li>Shared APN must allow HTTPS to cloud endpoints (pre-deployment check for data-included option)</li>
    <li>Battery unrestricted · Location “Allow all the time” · Notifications enabled on each handset</li>
    <li>Handsets charged and tested before each regatta block</li>
  </ul>

  <div class="disclaimer">
    <strong>Important.</strong> CrewSight is a situational-awareness and fleet-visibility platform for rowing operations
    and broadcast. It is not certified rescue equipment and does not replace official race rules, patrol boats,
    qualified officials, or personal flotation requirements.
  </div>

  <footer>
    Altitude HD · CrewSight · 28 Harvey Street South, Tauranga · ged@altitudehd.nz · Proposal valid 90 days.
  </footer>
</body>
</html>`;
}

function businessCaseHtml(t50, t270) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CrewSight Season — Internal business case</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 9.5pt; color: #0f172a; line-height: 1.36; }
    h1 { font-size: 16pt; color: #0e7490; margin: 0 0 4px; }
    h2 { font-size: 11pt; color: #0e7490; margin: 14px 0 6px; border-bottom: 1px solid #ccfbf1; page-break-after: avoid; }
    h3 { font-size: 10pt; color: #155e75; margin: 10px 0 4px; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 9pt; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #ecfeff; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .conf { color: #b45309; font-weight: 600; font-size: 9pt; }
    .rec { background: #ecfeff; padding: 10px; border-left: 4px solid #0e7490; margin: 10px 0; font-size: 9.3pt; }
    .note { color: #64748b; font-size: 8.5pt; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .page-break { page-break-before: always; }
  </style>
</head>
<body>
  <p class="conf">Commercial in confidence — Altitude HD internal</p>
  <h1>CrewSight — Season business case</h1>
  <p>4-month season · 8 regattas · ${REGATTA_DAYS} tracking days · Handsets @ ${money(M26_SELL)} · Cloud infra included in net margin</p>

  <h2>Profit summary (gross vs net of cloud)</h2>
  <table>
    <thead>
      <tr>
        <th>Tier</th>
        <th class="num">Devices</th>
        <th class="num">Handset profit</th>
        <th class="num">Platform fee</th>
        <th class="num">Cloud cost</th>
        <th class="num">Platform (net)</th>
        <th class="num">Net profit</th>
        <th class="num">Revenue</th>
        <th class="num">Net margin %</th>
      </tr>
    </thead>
    <tbody>
      ${tierProfitRows(t50)}
      ${tierProfitRows(t270)}
    </tbody>
  </table>
  <p class="note">Platform fee: ${money(PLATFORM_FEE)} flat per season (both tiers). Revenue column uses <strong>data-included</strong> pricing (4-month SIM). Net margin = handset margin + platform fee − cloud.</p>

  <h2>Cellular data — 4-month season vs alternatives (ex GST)</h2>
  <table>
    <thead><tr><th></th><th class="num">50 devices</th><th class="num">270 devices</th></tr></thead>
    <tbody>
      <tr><td>Per SIM / month</td><td class="num">${money(SIM_MONTH)}</td><td class="num">${money(SIM_MONTH)}</td></tr>
      <tr><td>Season months billed</td><td class="num">${SEASON_MONTHS}</td><td class="num">${SEASON_MONTHS}</td></tr>
      <tr><th>Data included — full season (${SEASON_MONTHS} mo × ${money(SIM_MONTH)} × devices)</th><th class="num">${money(t50.simSeason)}</th><th class="num">${money(t270.simSeason)}</th></tr>
      <tr><td>Regatta-only reference (${REGATTA_DAYS} days prorated — not customer default)</td><td class="num">${money(t50.simRegatta)}</td><td class="num">${money(t270.simRegatta)}</td></tr>
      <tr><td>Data excluded — customer SIM (AHD cost)</td><td class="num">$0.00</td><td class="num">$0.00</td></tr>
      <tr><td>Saving: excluded vs included (customer)</td><td class="num">${money(t50.simSeason)}</td><td class="num">${money(t270.simSeason)}</td></tr>
    </tbody>
  </table>

  <h2>Customer pricing — data included vs excluded (ex GST)</h2>
  <table>
    <thead><tr><th></th><th class="num">50 — included</th><th class="num">50 — excluded</th><th class="num">270 — included</th><th class="num">270 — excluded</th></tr></thead>
    <tbody>
      <tr><td>Handsets @ ${money(M26_SELL)}</td><td class="num">${money(t50.hardwareSell)}</td><td class="num">${money(t50.hardwareSell)}</td><td class="num">${money(t270.hardwareSell)}</td><td class="num">${money(t270.hardwareSell)}</td></tr>
      <tr><td>Cellular (${SEASON_MONTHS} mo)</td><td class="num">${money(t50.simSeason)}</td><td class="num">—</td><td class="num">${money(t270.simSeason)}</td><td class="num">—</td></tr>
      <tr><td>CrewSight platform (season)</td><td class="num">${money(PLATFORM_FEE)}</td><td class="num">${money(PLATFORM_FEE)}</td><td class="num">${money(PLATFORM_FEE)}</td><td class="num">${money(PLATFORM_FEE)}</td></tr>
      <tr><th>Season total</th><td class="num">${money(t50.bundledDataIncluded)}</td><td class="num">${money(t50.bundledDataExcluded)}</td><td class="num">${money(t270.bundledDataIncluded)}</td><td class="num">${money(t270.bundledDataExcluded)}</td></tr>
      <tr><th>+ optional mounting @ ${money(MOUNT_SELL)}</th><td class="num">${money(t50.bundledIncludedWithMount)}</td><td class="num">${money(t50.bundledExcludedWithMount)}</td><td class="num">${money(t270.bundledIncludedWithMount)}</td><td class="num">${money(t270.bundledExcludedWithMount)}</td></tr>
    </tbody>
  </table>

  <h2>Cloud &amp; storage costs (season estimate)</h2>
  <p class="note">Stack: <strong>Vercel Pro</strong> (AHD-LiveStream + rowing-app-recorder-pwa) · <strong>Neon Postgres</strong> (ingest/history) · <strong>Upstash Redis</strong> (CV positions, alert state) · Resend email (negligible).</p>
  <div class="grid">
    <div>
      <h3>50-device pilot</h3>
      <table><tbody>${cloudCostRows(t50)}</tbody></table>
      <p class="note">~${(t50.cloud.samples / 1e6).toFixed(1)}M ingest samples · ~${t50.cloud.storageGb.toFixed(1)} GB Postgres (season cumulative)</p>
    </div>
    <div>
      <h3>270-device fleet</h3>
      <table><tbody>${cloudCostRows(t270)}</tbody></table>
      <p class="note">~${(t270.cloud.samples / 1e6).toFixed(1)}M ingest samples · ~${t270.cloud.storageGb.toFixed(1)} GB Postgres (season cumulative)</p>
    </div>
  </div>
  <p class="note">
    Assumptions: ${SAMPLES_PER_DEVICE_DAY.toLocaleString()} uploads/device/regatta day · ~${BYTES_PER_SAMPLE} B stored/sample (GPS, motion, events) ·
    Vercel Pro $20/mo × ${SEASON_MONTHS} months · Neon Launch $5/mo + $0.30/GB-month ·
    Purge old sessions between regattas to control storage. Default 512 MB monitor quota will be exceeded at full fleet — budget Neon Launch and data management.
  </p>

  <h2>Handset economics</h2>
  <table>
    <thead><tr><th></th><th class="num">Per unit</th><th class="num">50 fleet</th><th class="num">270 fleet</th></tr></thead>
    <tbody>
      <tr><td>One NZ cost (Smart M26)</td><td class="num">${money(M26_COST)}</td><td class="num">${money(t50.hardwareCost)}</td><td class="num">${money(t270.hardwareCost)}</td></tr>
      <tr><td>Customer sell price</td><td class="num">${money(M26_SELL)}</td><td class="num">${money(t50.hardwareSell)}</td><td class="num">${money(t270.hardwareSell)}</td></tr>
      <tr><th>Handset gross profit</th><th class="num">${money(DEVICE_MARGIN)}</th><th class="num">${money(t50.deviceProfit)}</th><th class="num">${money(t270.deviceProfit)}</th></tr>
    </tbody>
  </table>

  <div class="grid">
    <div>
      <h3>50-device — data included</h3>
      <table><tbody>${tierPricingRows(t50, { simIncluded: true })}</tbody></table>
    </div>
    <div>
      <h3>50-device — data excluded</h3>
      <table><tbody>${tierPricingRows(t50, { simIncluded: false })}</tbody></table>
    </div>
  </div>
  <div class="grid">
    <div>
      <h3>270-device — data included</h3>
      <table><tbody>${tierPricingRows(t270, { simIncluded: true })}</tbody></table>
    </div>
    <div>
      <h3>270-device — data excluded</h3>
      <table><tbody>${tierPricingRows(t270, { simIncluded: false })}</tbody></table>
    </div>
  </div>

  <h2>Full delivery cost vs revenue (ex GST)</h2>
  <table>
    <thead><tr><th></th><th class="num">50 incl.</th><th class="num">50 excl.</th><th class="num">270 incl.</th><th class="num">270 excl.</th></tr></thead>
    <tbody>
      <tr><td>Handset cost (One NZ)</td><td class="num">${money(t50.hardwareCost)}</td><td class="num">${money(t50.hardwareCost)}</td><td class="num">${money(t270.hardwareCost)}</td><td class="num">${money(t270.hardwareCost)}</td></tr>
      <tr><td>IoT SIMs (${SEASON_MONTHS} months)</td><td class="num">${money(t50.simSeason)}</td><td class="num">$0.00</td><td class="num">${money(t270.simSeason)}</td><td class="num">$0.00</td></tr>
      <tr><td>Cloud &amp; storage (season)</td><td class="num">${money(t50.cloud.total)}</td><td class="num">${money(t50.cloud.total)}</td><td class="num">${money(t270.cloud.total)}</td><td class="num">${money(t270.cloud.total)}</td></tr>
      <tr><th>Total delivery cost</th><td class="num">${money(t50.totalCostIncluded)}</td><td class="num">${money(t50.totalCostExcluded)}</td><td class="num">${money(t270.totalCostIncluded)}</td><td class="num">${money(t270.totalCostExcluded)}</td></tr>
      <tr><td>Customer revenue</td><td class="num">${money(t50.bundledDataIncluded)}</td><td class="num">${money(t50.bundledDataExcluded)}</td><td class="num">${money(t270.bundledDataIncluded)}</td><td class="num">${money(t270.bundledDataExcluded)}</td></tr>
      <tr><th>Net profit (after cloud + SIM)</th><td class="num">${money(t50.netProfitIncluded)}</td><td class="num">${money(t50.netProfitExcluded)}</td><td class="num">${money(t270.netProfitIncluded)}</td><td class="num">${money(t270.netProfitExcluded)}</td></tr>
      <tr><th>+ optional mounting (${money(MOUNT_SELL)}/unit)</th><td class="num">${money(t50.mountOptional)}</td><td class="num">${money(t50.mountOptional)}</td><td class="num">${money(t270.mountOptional)}</td><td class="num">${money(t270.mountOptional)}</td></tr>
    </tbody>
  </table>

  <h2>Invoice structure</h2>
  <table>
    <thead><tr><th>Invoice</th><th class="num">50 incl.</th><th class="num">50 excl.</th><th class="num">270 incl.</th><th class="num">270 excl.</th></tr></thead>
    <tbody>
      <tr>
        <td><strong>Invoice 1 — Handsets (CAPEX)</strong></td>
        <td class="num">${money(t50.hardwareSellIncl, { gst: false })}</td>
        <td class="num">${money(t50.hardwareSellIncl, { gst: false })}</td>
        <td class="num">${money(t270.hardwareSellIncl, { gst: false })}</td>
        <td class="num">${money(t270.hardwareSellIncl, { gst: false })}</td>
      </tr>
      <tr>
        <td><strong>Invoice 2 — CrewSight season</strong> (platform ± ${SEASON_MONTHS}-mo data)</td>
        <td class="num">${money(t50.serviceIncludedIncl, { gst: false })}</td>
        <td class="num">${money(t50.serviceExcludedIncl, { gst: false })}</td>
        <td class="num">${money(t270.serviceIncludedIncl, { gst: false })}</td>
        <td class="num">${money(t270.serviceExcludedIncl, { gst: false })}</td>
      </tr>
      <tr>
        <td><strong>Optional — boat mounting</strong></td>
        <td class="num">${money(t50.mountOptional * (1 + GST), { gst: false })}</td>
        <td class="num">${money(t50.mountOptional * (1 + GST), { gst: false })}</td>
        <td class="num">${money(t270.mountOptional * (1 + GST), { gst: false })}</td>
        <td class="num">${money(t270.mountOptional * (1 + GST), { gst: false })}</td>
      </tr>
    </tbody>
  </table>

  <div class="rec">
    <strong>Recommendation:</strong> Quote <strong>data included</strong> for turnkey (${money(t270.bundledDataIncludedIncl, { gst: false })} incl GST, 270 fleet) or <strong>data excluded</strong> if customer has own SIMs (${money(t270.bundledDataExcludedIncl, { gst: false })} incl GST).
    Mounting optional at ${money(MOUNT_SELL)}/boat. Regatta-only SIM (${money(t270.simRegatta)} internal) saves ${money(t270.simSavedVsSeason)} vs full season but is not the default customer offer.
  </div>

  <h2>Cellular &amp; API load check</h2>
  <p class="note">Cellular: ~267 MB/day (50) · ~1.44 GB/day (270) — within One NZ 500 MB/SIM pool. API: up to ~270 ingest POST/s during 1 s reporting hour (270 fleet). Serverless likely within Vercel Pro credits; overage modeled conservatively above.</p>

  <footer style="margin-top:12px;font-size:8.5pt;color:#64748b">Generated ${new Date().toISOString().slice(0, 10)} · CrewSight · AHD - LiveStream</footer>
</body>
</html>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const name of LEGACY_FILES) {
    try {
      await unlink(join(OUT_DIR, name));
    } catch {
      /* ignore missing */
    }
  }

  const t50 = buildTier(50);
  const t270 = buildTier(270);

  const jobs = [
    {
      html: businessCaseHtml(t50, t270),
      pdf: join(OUT_DIR, 'CrewSight-Season-Business-Case-Internal.pdf'),
      htmlOut: join(OUT_DIR, 'CrewSight-Season-Business-Case-Internal.html'),
    },
    {
      html: proposalHtml(t50),
      pdf: join(OUT_DIR, 'CrewSight-Season-Proposal-50-devices.pdf'),
      htmlOut: join(OUT_DIR, 'CrewSight-Season-Proposal-50-devices.html'),
    },
    {
      html: proposalHtml(t270),
      pdf: join(OUT_DIR, 'CrewSight-Season-Proposal-270-devices.pdf'),
      htmlOut: join(OUT_DIR, 'CrewSight-Season-Proposal-270-devices.html'),
    },
  ];

  for (const job of jobs) {
    await writeFile(job.htmlOut, job.html, 'utf8');
  }

  const browser = await chromium.launch();
  for (const job of jobs) {
    const page = await browser.newPage();
    await page.setContent(job.html, { waitUntil: 'load' });
    const tmpPdf = `${job.pdf}.tmp`;
    try {
      await page.pdf({
        path: tmpPdf,
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      });
      await page.close();
      const { rename, copyFile } = await import('node:fs/promises');
      try {
        await rename(tmpPdf, job.pdf);
      } catch {
        await copyFile(tmpPdf, job.pdf);
        await unlink(tmpPdf).catch(() => {});
      }
      console.log('Wrote', job.pdf);
    } catch (err) {
      await page.close();
      console.error('Failed', job.pdf, err.message);
    }
  }
  await browser.close();
  await uploadPdfsToDrive(jobs.map((job) => job.pdf));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
