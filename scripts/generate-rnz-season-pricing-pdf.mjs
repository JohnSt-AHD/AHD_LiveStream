#!/usr/bin/env node
/**
 * Generate RNZ livestream season pricing PDFs (internal + client-facing).
 * Usage: node scripts/generate-rnz-season-pricing-pdf.mjs
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs', 'proposals', 'rnz-livestream');
const ARTIFACTS = '/opt/cursor/artifacts';

const OLD_TOTAL = 175_000;
const DAY_OLD = OLD_TOTAL / 16;
const DAY_CPI = DAY_OLD * 1.03;
const SAME_MIX_CPI = OLD_TOTAL * 1.03;
const CORE_DAYS = 15;
const CORE_PIN = CORE_DAYS * DAY_CPI;
const MASTERS_LIST = 10_000;
const MASTERS_SEASON = 5_000;
const AGREE_FULL = Math.round((19.5 * DAY_CPI) / 500) * 500;
const TODAY = new Date().toISOString().slice(0, 10);

const money = (n, d = 0) =>
  `$${n.toLocaleString('en-NZ', { minimumFractionDigits: d, maximumFractionDigits: d })}`;

const events = [
  { name: 'NZ Rowing Champs', lyD: 4, agD: 4, bucket: 'fixed' },
  { name: 'NI Secondary School', lyD: 2, agD: 3, bucket: 'fixed' },
  { name: 'SI Secondary School', lyD: 2, agD: 2, bucket: 'fixed' },
  { name: 'Maadi Regatta', lyD: 6, agD: 6, bucket: 'fixed' },
  { name: 'Universities Champs', lyD: 1, agD: 1.5, bucket: 'other' },
  { name: 'Beach / Coastal Champs', lyD: 1, agD: 3, bucket: 'other' },
];

function eventRowsInternal() {
  return events
    .map((e) => {
      const ly = e.lyD * DAY_OLD;
      const same = e.lyD * DAY_CPI;
      const agree = e.agD * DAY_CPI;
      return `<tr>
        <td>${e.name}</td>
        <td class="num">${e.lyD}</td>
        <td class="num">${money(ly)}</td>
        <td class="num">${money(same)}</td>
        <td class="num">${e.agD}</td>
        <td class="num">${money(agree)}</td>
      </tr>`;
    })
    .join('\n');
}

function sharedCss({ compact = false } = {}) {
  if (compact) {
    return `
    @page { size: A4; margin: 9mm 9mm 9mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #0f172a;
      font-size: 8.5pt;
      line-height: 1.25;
      margin: 0;
    }
    header {
      border-bottom: 2px solid #0e7490;
      padding-bottom: 4px;
      margin-bottom: 5px;
    }
    .brand { font-size: 14pt; font-weight: 800; color: #0e7490; margin: 0; }
    .tagline { color: #64748b; margin: 1px 0 0; font-size: 8pt; }
    h2 {
      font-size: 9.5pt;
      color: #0e7490;
      margin: 7px 0 2px;
      border-bottom: 1px solid #ccfbf1;
      padding-bottom: 1px;
    }
    p { margin: 0 0 3px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 2px 0 4px;
      font-size: 7.5pt;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 2px 5px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #ecfeff; font-weight: 600; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tr.total td { font-weight: 700; background: #f8fafc; }
    tr.accent td { background: #ecfeff; font-weight: 600; }
    .box {
      background: #ecfeff;
      border: 1px solid #99f6e4;
      border-radius: 4px;
      padding: 4px 8px;
      margin: 3px 0 4px;
    }
    .box.warn { background: #fff7ed; border-color: #fed7aa; }
    .box.danger { background: #fef2f2; border-color: #fecaca; }
    .muted { color: #64748b; font-size: 7pt; margin-bottom: 2px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
      margin: 3px 0 4px;
    }
    .stat {
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 3px 5px;
    }
    .stat .v { font-size: 10pt; font-weight: 700; color: #0e7490; }
    .stat .l { font-size: 6.5pt; color: #64748b; margin-top: 0; }
    ul, ol { margin: 2px 0 3px; padding-left: 14px; }
    li { margin-bottom: 1px; }
    footer {
      margin-top: 5px;
      padding-top: 3px;
      border-top: 1px solid #e2e8f0;
      color: #94a3b8;
      font-size: 6.5pt;
    }`;
  }

  return `
    @page { size: A4; margin: 14mm 14mm 14mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #0f172a;
      font-size: 10.5pt;
      line-height: 1.4;
      margin: 0;
    }
    header {
      border-bottom: 3px solid #0e7490;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .brand { font-size: 20pt; font-weight: 800; color: #0e7490; margin: 0; }
    .brand-sub { font-size: 11pt; font-weight: 600; color: #164e63; margin: 2px 0 0; }
    .tagline { color: #64748b; margin: 4px 0 0; font-size: 9.5pt; }
    h2 {
      font-size: 12pt;
      color: #0e7490;
      margin: 16px 0 6px;
      border-bottom: 1px solid #ccfbf1;
      padding-bottom: 3px;
    }
    p { margin: 0 0 8px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 12px;
      font-size: 9.5pt;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 7px 9px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #ecfeff; font-weight: 600; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tr.total td { font-weight: 700; background: #f8fafc; }
    tr.accent td { background: #ecfeff; font-weight: 600; }
    .box {
      background: #ecfeff;
      border: 1px solid #99f6e4;
      border-radius: 6px;
      padding: 12px 14px;
      margin: 10px 0 14px;
    }
    .muted { color: #64748b; font-size: 9pt; }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin: 10px 0 14px;
    }
    .stat {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 12px;
    }
    .stat .v { font-size: 14pt; font-weight: 700; color: #0e7490; }
    .stat .l { font-size: 8.5pt; color: #64748b; margin-top: 3px; }
    ul { margin: 6px 0 10px; padding-left: 18px; }
    li { margin-bottom: 4px; }
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin: 8px 0 12px;
    }
    .card {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 12px 14px;
    }
    .card h3 {
      margin: 0 0 6px;
      font-size: 11pt;
      color: #0e7490;
    }
    footer {
      margin-top: 16px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      color: #94a3b8;
      font-size: 8pt;
    }`;
}

function buildInternalHtml() {
  return `<!DOCTYPE html>
<html lang="en-NZ">
<head>
  <meta charset="utf-8" />
  <title>AHD · RNZ Livestream Season Pricing (Internal)</title>
  <style>${sharedCss({ compact: true })}</style>
</head>
<body>
  <header>
    <p class="brand">AltitudeHD · Internal</p>
    <p class="tagline">RNZ livestream season pricing — last year vs CPI vs agreement days · All figures ex GST</p>
  </header>

  <div class="stats">
    <div class="stat"><div class="v">${money(OLD_TOTAL)}</div><div class="l">Last year (16 days)</div></div>
    <div class="stat"><div class="v">${money(SAME_MIX_CPI)}</div><div class="l">Same mix + 3% CPI</div></div>
    <div class="stat"><div class="v">${money(CORE_PIN)}</div><div class="l">Core — 15 Fixed days + CPI</div></div>
    <div class="stat"><div class="v">${money(AGREE_FULL)}</div><div class="l">Agreement-days Classic</div></div>
  </div>

  <div class="box">
    <strong>Keep last season’s days &amp; regattas:</strong>
    Same six events / 16 days as last year, +3% CPI only → <strong>${money(SAME_MIX_CPI)}</strong>
    (+${money(SAME_MIX_CPI - OLD_TOTAL)}). This is the inflation-only path.
  </div>

  <h2>1. Cost table — last year · same+CPI · agreement days</h2>
  <p class="muted">Day rate: ${money(DAY_OLD, 2)} last year → ${money(DAY_CPI, 2)} after 3% CPI.</p>
  <table>
    <thead>
      <tr>
        <th>Event</th>
        <th class="num">LY days</th>
        <th class="num">LY fee</th>
        <th class="num">Same days + CPI</th>
        <th class="num">Agree. days</th>
        <th class="num">Agree. + CPI</th>
      </tr>
    </thead>
    <tbody>
      ${eventRowsInternal()}
      <tr>
        <td>Masters Regatta (new)</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">${money(MASTERS_LIST)} list</td>
        <td class="num">1</td>
        <td class="num">${money(MASTERS_LIST)} list</td>
      </tr>
      <tr class="total">
        <td>Fixed Events (Core)</td>
        <td class="num">14</td>
        <td class="num">${money(14 * DAY_OLD)}</td>
        <td class="num">${money(14 * DAY_CPI)}</td>
        <td class="num">15</td>
        <td class="num">${money(15 * DAY_CPI)}</td>
      </tr>
      <tr class="accent">
        <td>Full season (ex Masters)</td>
        <td class="num">16</td>
        <td class="num">${money(OLD_TOTAL)}</td>
        <td class="num">${money(SAME_MIX_CPI)}</td>
        <td class="num">19.5</td>
        <td class="num">${money(19.5 * DAY_CPI)}</td>
      </tr>
      <tr class="total">
        <td>Full season + Masters (season rate)</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">${money(SAME_MIX_CPI + MASTERS_SEASON)}</td>
        <td class="num">20.5</td>
        <td class="num">${money(AGREE_FULL + MASTERS_SEASON)}</td>
      </tr>
    </tbody>
  </table>

  <h2>2. Package options</h2>
  <table>
    <thead>
      <tr>
        <th>Package</th>
        <th>What it is</th>
        <th class="num">Price</th>
        <th class="num">vs last year</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Core only</td>
        <td>4 Fixed Events · <strong>15 days</strong> (agreement) · matches Table 1</td>
        <td class="num">${money(CORE_PIN)}</td>
        <td class="num">−${money(OLD_TOTAL - CORE_PIN)} vs LY full season</td>
      </tr>
      <tr class="accent">
        <td>Same as last season + CPI</td>
        <td>Same 6 regattas / 16 days</td>
        <td class="num">${money(SAME_MIX_CPI)}</td>
        <td class="num">+${money(SAME_MIX_CPI - OLD_TOTAL)} (CPI only)</td>
      </tr>
      <tr>
        <td>Same as LY + CPI + Masters</td>
        <td>Above + Masters 1 day (season rate)</td>
        <td class="num">${money(SAME_MIX_CPI + MASTERS_SEASON)}</td>
        <td class="num">+${money(SAME_MIX_CPI + MASTERS_SEASON - OLD_TOTAL)}</td>
      </tr>
      <tr>
        <td>Agreement-days Classic</td>
        <td>Draft days 19.5 (NI/Uni/Beach longer)</td>
        <td class="num">${money(AGREE_FULL)}</td>
        <td class="num">+${money(AGREE_FULL - OLD_TOTAL)}</td>
      </tr>
      <tr>
        <td>Agreement Classic + Masters</td>
        <td>20.5 days · Masters at season rate</td>
        <td class="num">${money(AGREE_FULL + MASTERS_SEASON)}</td>
        <td class="num">+${money(AGREE_FULL + MASTERS_SEASON - OLD_TOTAL)}</td>
      </tr>
    </tbody>
  </table>

  <h2>3. Masters add-on</h2>
  <table>
    <thead><tr><th>When</th><th class="num">Masters 1 day</th></tr></thead>
    <tbody>
      <tr><td>Standalone / Core only / partial extras</td><td class="num">${money(MASTERS_LIST)}</td></tr>
      <tr class="accent"><td>Full season (all Fixed + Uni + Beach)</td><td class="num">${money(MASTERS_SEASON)} (50% off)</td></tr>
    </tbody>
  </table>
  <p class="muted">~$10k is slightly under the CPI day rate (${money(DAY_CPI, 2)}). Half-price only when Uni and Beach are both taken.</p>

  <h2>4. Core pricing &amp; cost pools</h2>
  <div class="box warn">
    <strong>Core only = ${money(CORE_PIN)} for 15 days</strong> (NZ 4 + NI 3 + SI 2 + Maadi 6) —
    the same figure as Table 1 “Fixed Events / Agree. + CPI”. Fixed days did not shrink in the RNZ draft
    (NI 2 → 3); Core-only is fewer <em>events</em> than last year’s paid six, not a lighter Fixed day load.
  </div>
  <table>
    <thead>
      <tr><th>Cost pool</th><th>Share of Core</th><th>Why it does not fall linearly with days</th></tr>
    </thead>
    <tbody>
      <tr><td>Season standing crew &amp; key contractors</td><td>35–40%</td><td>Retained across the Fixed calendar — not hired per isolated day</td></tr>
      <tr><td>Kit, vehicles, insurance, freight</td><td>20–25%</td><td>Peak kit list set by Maadi; amortised across the season</td></tr>
      <tr><td>Maadi peak production</td><td>20–25%</td><td>Longest / heaviest event; locked inside Core</td></tr>
      <tr><td>Platforms, graphics, IP, prep</td><td>10–15%</td><td>Largely season-fixed once RNZ is the client</td></tr>
      <tr><td>Travel / venue variable</td><td>5–10%</td><td>True mover with ± days and new venues</td></tr>
    </tbody>
  </table>
  <p><strong>Say this:</strong> Last year’s ${money(OLD_TOTAL)} bought a season platform for six events / 16 days.
  Core is the four Fixed Events only, priced at CPI × agreement days = <strong>${money(CORE_PIN)}</strong> (15 days).
  Same-mix full season stays <strong>${money(SAME_MIX_CPI)}</strong> (+3% CPI only).</p>

  <h2>5. “So extra days are only ~$5k?”</h2>
  <div class="box danger">
    <strong>Do not price extra days at ~$5k.</strong>
    The only honest ~$5k line is: same mix as last year + 3% CPI = ${money(SAME_MIX_CPI)}
    (+${money(SAME_MIX_CPI - OLD_TOTAL)}). That is <em>inflation on repeating last season</em> — not the marginal cost of days.
    Agreement-day Classic is ~${money(AGREE_FULL)}. Masters is ${money(MASTERS_LIST)} list / ${money(MASTERS_SEASON)} with full season.
  </div>

  <h2>6. Suggested spoken path</h2>
  <ol>
    <li>Last year ${money(OLD_TOTAL)} = season platform for 6 events / 16 days.</li>
    <li>Core (4 Fixed / 15 agreement days, Maadi in) = ${money(CORE_PIN)} — matches Table 1 Fixed + CPI.</li>
    <li>Want the same season as last year? ${money(SAME_MIX_CPI)} (+3% CPI). That’s the ~$5k conversation.</li>
    <li>Want draft day counts? Classic ~${money(AGREE_FULL)}.</li>
    <li>Masters +1 day: ${money(MASTERS_LIST)} à la carte, ${money(MASTERS_SEASON)} when Uni + Beach are both taken.</li>
  </ol>

  <footer>
    AltitudeHD internal negotiation aid · Generated ${TODAY} ·
    Method: $175,000/16 × 1.03 × days · Core = 15 × CPI day rate · Not a client-facing proposal · Not legal advice
  </footer>
</body>
</html>`;
}

function buildExternalHtml() {
  const fixed = events.filter((e) => e.bucket === 'fixed');
  const other = events.filter((e) => e.bucket === 'other');

  return `<!DOCTYPE html>
<html lang="en-NZ">
<head>
  <meta charset="utf-8" />
  <title>AltitudeHD · Livestream Season Proposal for Rowing New Zealand</title>
  <style>${sharedCss({ compact: false })}</style>
</head>
<body>
  <header>
    <p class="brand">AltitudeHD</p>
    <p class="brand-sub">Livestream season proposal · Rowing New Zealand</p>
    <p class="tagline">2027–2029 season options · All figures exclude GST · Prepared ${TODAY}</p>
  </header>

  <p>
    This proposal sets out livestream production packages for the national rowing calendar.
    Fees reflect a <strong>3% CPI uplift</strong> on the prior season day rate, applied to the
    broadcast days in each package.
  </p>

  <div class="stats">
    <div class="stat">
      <div class="v">${money(CORE_PIN)}</div>
      <div class="l">Core · 4 Fixed Events · 15 days</div>
    </div>
    <div class="stat">
      <div class="v">${money(SAME_MIX_CPI)}</div>
      <div class="l">Classic · same mix as last season · 16 days</div>
    </div>
    <div class="stat">
      <div class="v">${money(AGREE_FULL)}</div>
      <div class="l">Extended Classic · agreement day counts · 19.5 days</div>
    </div>
  </div>

  <h2>1. What’s included</h2>
  <div class="two-col">
    <div class="card">
      <h3>Core package — Fixed Events</h3>
      <ul>
        ${fixed.map((e) => `<li>${e.name} · ${e.agD} day${e.agD === 1 ? '' : 's'}</li>`).join('')}
      </ul>
      <p class="muted">${CORE_DAYS} livestream days · ${money(CORE_PIN)} ex GST</p>
    </div>
    <div class="card">
      <h3>Optional Other Events</h3>
      <ul>
        ${other.map((e) => `<li>${e.name} · ${e.agD} day${e.agD === 1 ? '' : 's'} (agreement coverage)</li>`).join('')}
        <li>Masters Regatta · 1 day (optional add-on)</li>
      </ul>
      <p class="muted">Priced as season packages or individual add-ons below.</p>
    </div>
  </div>

  <h2>2. Season packages</h2>
  <table>
    <thead>
      <tr>
        <th>Package</th>
        <th>Includes</th>
        <th class="num">Days</th>
        <th class="num">Fee (ex GST)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Core</strong></td>
        <td>NZ Champs, NI Secondary, SI Secondary, Maadi</td>
        <td class="num">15</td>
        <td class="num">${money(CORE_PIN)}</td>
      </tr>
      <tr class="accent">
        <td><strong>Classic Season</strong></td>
        <td>Core + Universities + Beach/Coastal — same event mix as last season</td>
        <td class="num">16</td>
        <td class="num">${money(SAME_MIX_CPI)}</td>
      </tr>
      <tr>
        <td><strong>Classic Season + Masters</strong></td>
        <td>Classic Season + Masters Regatta (season rate)</td>
        <td class="num">17</td>
        <td class="num">${money(SAME_MIX_CPI + MASTERS_SEASON)}</td>
      </tr>
      <tr>
        <td><strong>Extended Classic</strong></td>
        <td>Core + Universities + Beach/Coastal at proposed longer day counts</td>
        <td class="num">19.5</td>
        <td class="num">${money(AGREE_FULL)}</td>
      </tr>
      <tr>
        <td><strong>Extended Classic + Masters</strong></td>
        <td>Extended Classic + Masters Regatta (season rate)</td>
        <td class="num">20.5</td>
        <td class="num">${money(AGREE_FULL + MASTERS_SEASON)}</td>
      </tr>
    </tbody>
  </table>

  <div class="box">
    <strong>Recommended continuity option:</strong> Classic Season at
    <strong>${money(SAME_MIX_CPI)}</strong> — the same six events and day mix as last season,
    with a 3% CPI adjustment only (+${money(SAME_MIX_CPI - OLD_TOTAL)} vs ${money(OLD_TOTAL)}).
  </div>

  <h2>3. Event day counts</h2>
  <table>
    <thead>
      <tr>
        <th>Event</th>
        <th>Type</th>
        <th class="num">Last season days</th>
        <th class="num">Proposed / agreement days</th>
        <th class="num">Fee if taken alone*</th>
      </tr>
    </thead>
    <tbody>
      ${events
        .map((e) => {
          const fee = e.agD * DAY_CPI;
          return `<tr>
            <td>${e.name}</td>
            <td>${e.bucket === 'fixed' ? 'Fixed / Core' : 'Other'}</td>
            <td class="num">${e.lyD}</td>
            <td class="num">${e.agD}</td>
            <td class="num">${money(fee)}</td>
          </tr>`;
        })
        .join('\n')}
      <tr>
        <td>Masters Regatta</td>
        <td>Optional add-on</td>
        <td class="num">—</td>
        <td class="num">1</td>
        <td class="num">${money(MASTERS_LIST)}</td>
      </tr>
    </tbody>
  </table>
  <p class="muted">
    *Standalone fees use the CPI day rate (${money(DAY_CPI, 2)}/day) on proposed days.
    Package pricing above is preferred when multiple events are taken together.
    Fixed Events are not sold individually outside the Core package.
  </p>

  <h2>4. Masters Regatta add-on</h2>
  <table>
    <thead>
      <tr><th>Selected with</th><th class="num">Masters fee (ex GST)</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>Core only, or Core + only one Other Event</td>
        <td class="num">${money(MASTERS_LIST)}</td>
      </tr>
      <tr class="accent">
        <td>Full Classic or Extended Classic (Core + Universities + Beach/Coastal)</td>
        <td class="num">${money(MASTERS_SEASON)}</td>
      </tr>
    </tbody>
  </table>

  <h2>5. Production scope (summary)</h2>
  <ul>
    <li>Multi-camera livestream production for each selected event day</li>
    <li>Distribution via RNZ Authorised Platforms (e.g. rowingnz.kiwi and RNZ YouTube)</li>
    <li>Graphics, partner branding integration, and agreed commentary plan</li>
    <li>Post-event deliverables as agreed in the production schedule</li>
  </ul>
  <p class="muted">
    Detailed technical specifications, host venue responsibilities, and payment schedule
    are set out in the Livestreaming Production and Service Agreement.
  </p>

  <h2>6. Notes</h2>
  <ul>
    <li>All fees are in New Zealand dollars and <strong>exclude GST</strong>.</li>
    <li>Classic Season preserves last season’s event mix at a CPI-only uplift.</li>
    <li>Extended Classic reflects longer NI Secondary, Universities, and Beach/Coastal coverage.</li>
    <li>Additional or substitute events (including Oceania Coastal) are quoted separately if required.</li>
  </ul>

  <footer>
    AltitudeHD Limited · Prepared for Rowing New Zealand Incorporated · ${TODAY} ·
    Proposal figures ex GST · Subject to signed agreement
  </footer>
</body>
</html>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(ARTIFACTS, { recursive: true });

  const docs = [
    {
      base: 'RNZ-Livestream-Season-Pricing-Internal',
      html: buildInternalHtml(),
      pdfMargin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
    },
    {
      base: 'RNZ-Livestream-Season-Pricing-External',
      html: buildExternalHtml(),
      pdfMargin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    },
  ];

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/local/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    for (const doc of docs) {
      const htmlPath = join(OUT_DIR, `${doc.base}.html`);
      const pdfPath = join(OUT_DIR, `${doc.base}.pdf`);
      await writeFile(htmlPath, doc.html, 'utf8');

      const page = await browser.newPage();
      try {
        await page.setContent(doc.html, { waitUntil: 'networkidle' });
        await page.pdf({
          path: pdfPath,
          format: 'A4',
          printBackground: true,
          margin: doc.pdfMargin,
        });
      } finally {
        await page.close();
      }

      await copyFile(htmlPath, join(ARTIFACTS, `${doc.base}.html`));
      await copyFile(pdfPath, join(ARTIFACTS, `${doc.base}.pdf`));
      console.log(`Wrote ${pdfPath}`);
    }
  } finally {
    await browser.close();
  }

  console.log(`Copied to ${ARTIFACTS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
