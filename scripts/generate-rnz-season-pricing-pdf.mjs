#!/usr/bin/env node
/**
 * Generate RNZ livestream season pricing PDFs (internal + client-facing).
 *
 * Rate card: fee = setup + dayRate × days, with the same tier multiplier
 * applied to both setup and day rate.
 *   Standard setup $6,000 · day $6,500
 *   NZ Champs 1.25× · Maadi 1.75× (both on setup & day)
 * Same+CPI scales rates ×1.03.
 *
 * Package discount only applies when list > $200k (pay threshold + 50% of excess).
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
const CPI = 1.03;
const DISCOUNT_THRESHOLD = 200_000;
const EXCESS_KEEP = 0.5;
const TODAY = new Date().toISOString().slice(0, 10);

/** Standard base rates; NZ/Maadi multipliers apply to both setup and day */
const SETUP_STD_LY = 6_000;
const DAY_STD_LY = 6_500;
const MULT_STD = 1.0;
const MULT_NZ = 1.25;
const MULT_MAADI = 1.75;
const MULT_NZ_L = MULT_NZ.toFixed(2);
const MULT_MAADI_L = MULT_MAADI.toFixed(2);

const events = [
  { name: 'NZ Rowing Champs', lyD: 4, agD: 4, bucket: 'fixed', tier: 'nz' },
  { name: 'NI Secondary School', lyD: 2, agD: 3, bucket: 'fixed', tier: 'std' },
  { name: 'SI Secondary School', lyD: 2, agD: 2, bucket: 'fixed', tier: 'std' },
  { name: 'Maadi Regatta', lyD: 6, agD: 6, bucket: 'fixed', tier: 'maadi' },
  { name: 'Universities Champs', lyD: 1, agD: 1.5, bucket: 'other', tier: 'std' },
  { name: 'Beach / Coastal Champs', lyD: 1, agD: 3, bucket: 'other', tier: 'std' },
];

const fixedEvents = events.filter((e) => e.bucket === 'fixed');

function tierMult(tier) {
  if (tier === 'nz') return MULT_NZ;
  if (tier === 'maadi') return MULT_MAADI;
  return MULT_STD;
}

function tierRates(tier, cpi = false) {
  const m = tierMult(tier);
  const scale = cpi ? CPI : 1;
  return {
    setup: SETUP_STD_LY * m * scale,
    day: DAY_STD_LY * m * scale,
  };
}

/** fee = setup + dayRate × days */
function eventFee(e, dayKey, cpi = false) {
  const { setup, day } = tierRates(e.tier, cpi);
  return setup + day * e[dayKey];
}

function sumFees(list, dayKey, cpi = false) {
  return list.reduce((s, e) => s + eventFee(e, dayKey, cpi), 0);
}

const LY_TOTAL = sumFees(events, 'lyD', false);
const SAME_CPI = sumFees(events, 'lyD', true);
const CORE_AGREE = sumFees(fixedEvents, 'agD', true);
const EXTENDED_AGREE = sumFees(events, 'agD', true);

const STD_LY = tierRates('std', false);
const NZ_LY = tierRates('nz', false);
const MAADI_LY = tierRates('maadi', false);
const STD_CPI = tierRates('std', true);
const NZ_CPI = tierRates('nz', true);
const MAADI_CPI = tierRates('maadi', true);

/** Masters: standard 1-day = setup + day at CPI; season = 50% off */
const MASTERS_LIST = Math.round(STD_CPI.setup + STD_CPI.day);
const MASTERS_SEASON = Math.round(MASTERS_LIST / 2);

function contractPrice(listPrice) {
  if (listPrice <= DISCOUNT_THRESHOLD) {
    return { contract: listPrice, discount: 0 };
  }
  const excess = listPrice - DISCOUNT_THRESHOLD;
  return {
    contract: DISCOUNT_THRESHOLD + excess * EXCESS_KEEP,
    discount: excess * (1 - EXCESS_KEEP),
  };
}

const pkgCore = contractPrice(CORE_AGREE);
const pkgClassic = contractPrice(SAME_CPI);
const pkgClassicMasters = contractPrice(SAME_CPI + MASTERS_SEASON);
const pkgExtended = contractPrice(EXTENDED_AGREE);
const pkgExtendedMasters = contractPrice(EXTENDED_AGREE + MASTERS_SEASON);

const money = (n, d = 0) =>
  `$${n.toLocaleString('en-NZ', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;

const moneyR = (n) =>
  `$${Math.round(n).toLocaleString('en-NZ')}`;

function sharedCss({ compact = false } = {}) {
  if (compact) {
    return `
    @page { size: A4; margin: 9mm 9mm 9mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; font-size: 8.5pt; line-height: 1.25; margin: 0; }
    header { border-bottom: 2px solid #0e7490; padding-bottom: 4px; margin-bottom: 5px; }
    .brand { font-size: 14pt; font-weight: 800; color: #0e7490; margin: 0; }
    .tagline { color: #64748b; margin: 1px 0 0; font-size: 8pt; }
    h2 { font-size: 9.5pt; color: #0e7490; margin: 7px 0 2px; border-bottom: 1px solid #ccfbf1; padding-bottom: 1px; }
    p { margin: 0 0 3px; }
    table { width: 100%; border-collapse: collapse; margin: 2px 0 4px; font-size: 7.5pt; }
    th, td { border: 1px solid #cbd5e1; padding: 2px 5px; text-align: left; vertical-align: top; }
    th { background: #ecfeff; font-weight: 600; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tr.total td { font-weight: 700; background: #f8fafc; }
    tr.accent td { background: #ecfeff; font-weight: 600; }
    tr.maadi td { background: #fff7ed; }
    tr.nz td { background: #f0fdf4; }
    .box { background: #ecfeff; border: 1px solid #99f6e4; border-radius: 4px; padding: 4px 8px; margin: 3px 0 4px; }
    .box.warn { background: #fff7ed; border-color: #fed7aa; }
    .muted { color: #64748b; font-size: 7pt; margin-bottom: 2px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 3px 0 4px; }
    .stat { border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 5px; }
    .stat .v { font-size: 10pt; font-weight: 700; color: #0e7490; }
    .stat .l { font-size: 6.5pt; color: #64748b; }
    ul, ol { margin: 2px 0 3px; padding-left: 14px; }
    li { margin-bottom: 1px; }
    footer { margin-top: 5px; padding-top: 3px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 6.5pt; }`;
  }

  return `
    @page { size: A4; margin: 14mm 14mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; font-size: 10.5pt; line-height: 1.4; margin: 0; }
    header { border-bottom: 3px solid #0e7490; padding-bottom: 10px; margin-bottom: 14px; }
    .brand { font-size: 20pt; font-weight: 800; color: #0e7490; margin: 0; }
    .brand-sub { font-size: 11pt; font-weight: 600; color: #164e63; margin: 2px 0 0; }
    .tagline { color: #64748b; margin: 4px 0 0; font-size: 9.5pt; }
    h2 { font-size: 12pt; color: #0e7490; margin: 16px 0 6px; border-bottom: 1px solid #ccfbf1; padding-bottom: 3px; }
    p { margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9.5pt; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 9px; text-align: left; vertical-align: top; }
    th { background: #ecfeff; font-weight: 600; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tr.total td { font-weight: 700; background: #f8fafc; }
    tr.accent td { background: #ecfeff; font-weight: 600; }
    tr.maadi td { background: #fff7ed; }
    tr.nz td { background: #f0fdf4; }
    .box { background: #ecfeff; border: 1px solid #99f6e4; border-radius: 6px; padding: 12px 14px; margin: 10px 0 14px; }
    .muted { color: #64748b; font-size: 9pt; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0 14px; }
    .stat { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; }
    .stat .v { font-size: 14pt; font-weight: 700; color: #0e7490; }
    .stat .l { font-size: 8.5pt; color: #64748b; margin-top: 3px; }
    ul { margin: 6px 0 10px; padding-left: 18px; }
    li { margin-bottom: 4px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 8px 0 12px; }
    .card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px 14px; }
    .card h3 { margin: 0 0 6px; font-size: 11pt; color: #0e7490; }
    footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 8pt; }`;
}

function rowClass(e) {
  if (e.tier === 'maadi') return ' class="maadi"';
  if (e.tier === 'nz') return ' class="nz"';
  return '';
}

function tierLabel(e) {
  if (e.tier === 'maadi') return ` (${MULT_MAADI_L}×)`;
  if (e.tier === 'nz') return ` (${MULT_NZ_L}×)`;
  return '';
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
    <p class="tagline">RNZ pricing — setup + day rate card · NZ ${MULT_NZ_L}× · Maadi ${MULT_MAADI_L}× (both on setup &amp; day) · discount only above ${moneyR(DISCOUNT_THRESHOLD)} · ex GST</p>
  </header>

  <div class="stats">
    <div class="stat"><div class="v">${moneyR(OLD_TOTAL)}</div><div class="l">Last year season (16d)</div></div>
    <div class="stat"><div class="v">${moneyR(pkgCore.contract)}</div><div class="l">Core (15d agree) + CPI</div></div>
    <div class="stat"><div class="v">${moneyR(pkgClassic.contract)}</div><div class="l">Classic same-mix + CPI</div></div>
    <div class="stat"><div class="v">${moneyR(pkgExtended.contract)}</div><div class="l">Extended after discount</div></div>
  </div>

  <div class="box warn">
    <strong>Rate card:</strong> each regatta = <em>setup + day rate × days</em>.
    The tier multiplier applies to <strong>both</strong> setup and day rate
    (Standard ${MULT_STD}× · NZ ${MULT_NZ_L}× · Maadi ${MULT_MAADI_L}×).
    Standard setup ${moneyR(SETUP_STD_LY)} · day ${moneyR(DAY_STD_LY)}.
    Same+CPI multiplies rates by ${((CPI - 1) * 100).toFixed(0)}%.
    Prior contracted season reference: ${moneyR(OLD_TOTAL)}.
    <strong>Discount:</strong> only if package list &gt; ${moneyR(DISCOUNT_THRESHOLD)} — then pay threshold + 50% of the excess.
  </div>

  <h2>1. Rate card (LY base → +CPI)</h2>
  <table>
    <thead>
      <tr>
        <th>Tier</th>
        <th class="num">Mult</th>
        <th class="num">Setup (LY)</th>
        <th class="num">Day (LY)</th>
        <th class="num">Setup (+CPI)</th>
        <th class="num">Day (+CPI)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Standard</td>
        <td class="num">${MULT_STD.toFixed(2)}×</td>
        <td class="num">${moneyR(STD_LY.setup)}</td>
        <td class="num">${moneyR(STD_LY.day)}</td>
        <td class="num">${moneyR(STD_CPI.setup)}</td>
        <td class="num">${moneyR(STD_CPI.day)}</td>
      </tr>
      <tr class="nz">
        <td>NZ Rowing Champs</td>
        <td class="num">${MULT_NZ_L}×</td>
        <td class="num">${moneyR(NZ_LY.setup)}</td>
        <td class="num">${moneyR(NZ_LY.day)}</td>
        <td class="num">${moneyR(NZ_CPI.setup)}</td>
        <td class="num">${moneyR(NZ_CPI.day)}</td>
      </tr>
      <tr class="maadi">
        <td>Maadi Regatta</td>
        <td class="num">${MULT_MAADI_L}×</td>
        <td class="num">${moneyR(MAADI_LY.setup)}</td>
        <td class="num">${moneyR(MAADI_LY.day)}</td>
        <td class="num">${moneyR(MAADI_CPI.setup)}</td>
        <td class="num">${moneyR(MAADI_CPI.day)}</td>
      </tr>
    </tbody>
  </table>
  <p class="muted">Worked shape (LY): 1-day standard ${moneyR(STD_LY.setup + STD_LY.day)} · 2-day ${moneyR(STD_LY.setup + 2 * STD_LY.day)} · NZ 4-day ${moneyR(NZ_LY.setup + 4 * NZ_LY.day)} · Maadi 6-day ${moneyR(MAADI_LY.setup + 6 * MAADI_LY.day)}.</p>

  <h2>2. Cost table — last year · same+CPI · agreement days</h2>
  <p class="muted">Fee = setup + day × days at the tier rate. LY uses base rates (total ${moneyR(LY_TOTAL)}); Same/Agree use +${((CPI - 1) * 100).toFixed(0)}% CPI rates.</p>
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
      ${events
        .map((e) => {
          return `<tr${rowClass(e)}>
            <td>${e.name}${tierLabel(e)}</td>
            <td class="num">${e.lyD}</td>
            <td class="num">${moneyR(eventFee(e, 'lyD', false))}</td>
            <td class="num">${moneyR(eventFee(e, 'lyD', true))}</td>
            <td class="num">${e.agD}</td>
            <td class="num">${moneyR(eventFee(e, 'agD', true))}</td>
          </tr>`;
        })
        .join('\n')}
      <tr>
        <td>Masters Regatta (new)</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">${moneyR(MASTERS_LIST)} list</td>
        <td class="num">1</td>
        <td class="num">${moneyR(MASTERS_LIST)} list</td>
      </tr>
      <tr class="total">
        <td>Fixed Events (Core)</td>
        <td class="num">14</td>
        <td class="num">${moneyR(sumFees(fixedEvents, 'lyD', false))}</td>
        <td class="num">${moneyR(sumFees(fixedEvents, 'lyD', true))}</td>
        <td class="num">15</td>
        <td class="num">${moneyR(CORE_AGREE)}</td>
      </tr>
      <tr class="accent">
        <td>Full season (ex Masters)</td>
        <td class="num">16</td>
        <td class="num">${moneyR(LY_TOTAL)}</td>
        <td class="num">${moneyR(SAME_CPI)}</td>
        <td class="num">19.5</td>
        <td class="num">${moneyR(EXTENDED_AGREE)}</td>
      </tr>
      <tr class="total">
        <td>Full season + Masters (season rate)</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">${moneyR(SAME_CPI + MASTERS_SEASON)}</td>
        <td class="num">20.5</td>
        <td class="num">${moneyR(EXTENDED_AGREE + MASTERS_SEASON)}</td>
      </tr>
    </tbody>
  </table>

  <h2>3. Package options</h2>
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
        <td>4 Fixed Events · <strong>15 days</strong> (agreement) · rate card + CPI</td>
        <td class="num">${moneyR(pkgCore.contract)}</td>
        <td class="num">−${moneyR(OLD_TOTAL - pkgCore.contract)} vs LY full season</td>
      </tr>
      <tr class="accent">
        <td>Same as last season + CPI</td>
        <td>Same 6 regattas / 16 days</td>
        <td class="num">${moneyR(pkgClassic.contract)}</td>
        <td class="num">+${moneyR(pkgClassic.contract - OLD_TOTAL)} vs LY ${moneyR(OLD_TOTAL)}</td>
      </tr>
      <tr>
        <td>Same as LY + CPI + Masters</td>
        <td>Above + Masters 1 day (season rate)</td>
        <td class="num">${moneyR(pkgClassicMasters.contract)}</td>
        <td class="num">+${moneyR(pkgClassicMasters.contract - OLD_TOTAL)}</td>
      </tr>
      <tr>
        <td>Agreement-days Classic</td>
        <td>Draft days 19.5 · list ${moneyR(EXTENDED_AGREE)}${
          pkgExtended.discount > 0
            ? `, discount above ${moneyR(DISCOUNT_THRESHOLD)}`
            : ''
        }</td>
        <td class="num">${moneyR(pkgExtended.contract)}</td>
        <td class="num">+${moneyR(pkgExtended.contract - OLD_TOTAL)}${
          pkgExtended.discount > 0
            ? ` (save ${moneyR(pkgExtended.discount)})`
            : ''
        }</td>
      </tr>
      <tr>
        <td>Agreement Classic + Masters</td>
        <td>20.5 days · Masters at season rate + same discount rule</td>
        <td class="num">${moneyR(pkgExtendedMasters.contract)}</td>
        <td class="num">+${moneyR(pkgExtendedMasters.contract - OLD_TOTAL)}${
          pkgExtendedMasters.discount > 0
            ? ` (save ${moneyR(pkgExtendedMasters.discount)})`
            : ''
        }</td>
      </tr>
    </tbody>
  </table>

  <h2>4. Masters add-on</h2>
  <table>
    <thead><tr><th>When</th><th class="num">Masters 1 day</th></tr></thead>
    <tbody>
      <tr><td>Standalone / Core only / partial extras (standard 1-day = setup + day)</td><td class="num">${moneyR(MASTERS_LIST)}</td></tr>
      <tr class="accent"><td>Full season (all Fixed + Uni + Beach)</td><td class="num">${moneyR(MASTERS_SEASON)} (50% off)</td></tr>
    </tbody>
  </table>

  <h2>5. Notes for the room</h2>
  <div class="box">
    Setup is charged once per regatta; extra days at the same venue only add the day rate.
    NZ and Maadi run a higher multiplier on <strong>both</strong> setup and day (resource intensity).
    Classic same-mix + CPI stays ${moneyR(SAME_CPI)}. Core agree is ${moneyR(CORE_AGREE)};
    Extended list is ${moneyR(EXTENDED_AGREE)}${
      pkgExtended.discount > 0
        ? ` → ${moneyR(pkgExtended.contract)} after the &gt;${moneyR(DISCOUNT_THRESHOLD)} discount`
        : ''
    }.
  </div>

  <footer>
    AltitudeHD internal · Generated ${TODAY} · Setup+day rate card · NZ ${MULT_NZ_L}× · Maadi ${MULT_MAADI_L}× · Not client-facing
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
    Fees use a transparent <strong>setup + broadcast day</strong> rate card.
    Each regatta pays a once-per-event setup; additional days at the same venue
    add only the day rate. <strong>NZ Rowing Champs</strong> (${MULT_NZ_L}×) and
    <strong>Maadi Regatta</strong> (${MULT_MAADI_L}×) apply a higher multiplier to
    <strong>both</strong> setup and day rate to reflect resource intensity.
    A <strong>3% CPI</strong> uplift is applied to last season’s rate card.
    Where a package exceeds <strong>${moneyR(DISCOUNT_THRESHOLD)}</strong>, a discount
    applies to the amount above that threshold.
  </p>

  <div class="stats">
    <div class="stat">
      <div class="v">${moneyR(pkgCore.contract)}</div>
      <div class="l">Core · 4 Fixed Events · 15 days</div>
    </div>
    <div class="stat">
      <div class="v">${moneyR(pkgClassic.contract)}</div>
      <div class="l">Classic · same mix as last season · 16 days</div>
    </div>
    <div class="stat">
      <div class="v">${moneyR(pkgExtended.contract)}</div>
      <div class="l">Extended Classic · 19.5 days${
        pkgExtended.discount > 0 ? ' (after discount)' : ''
      }</div>
    </div>
  </div>

  <h2>1. Rate card</h2>
  <table>
    <thead>
      <tr>
        <th>Tier</th>
        <th class="num">Multiplier</th>
        <th class="num">Setup</th>
        <th class="num">Broadcast day</th>
        <th>Example</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Standard</td>
        <td class="num">${MULT_STD.toFixed(2)}×</td>
        <td class="num">${moneyR(STD_CPI.setup)}</td>
        <td class="num">${moneyR(STD_CPI.day)}</td>
        <td>1-day ${moneyR(STD_CPI.setup + STD_CPI.day)} · 2-day ${moneyR(STD_CPI.setup + 2 * STD_CPI.day)}</td>
      </tr>
      <tr class="nz">
        <td>NZ Rowing Champs</td>
        <td class="num">${MULT_NZ_L}×</td>
        <td class="num">${moneyR(NZ_CPI.setup)}</td>
        <td class="num">${moneyR(NZ_CPI.day)}</td>
        <td>4-day ${moneyR(NZ_CPI.setup + 4 * NZ_CPI.day)}</td>
      </tr>
      <tr class="maadi">
        <td>Maadi Regatta</td>
        <td class="num">${MULT_MAADI_L}×</td>
        <td class="num">${moneyR(MAADI_CPI.setup)}</td>
        <td class="num">${moneyR(MAADI_CPI.day)}</td>
        <td>6-day ${moneyR(MAADI_CPI.setup + 6 * MAADI_CPI.day)}</td>
      </tr>
    </tbody>
  </table>

  <h2>2. What’s included</h2>
  <div class="two-col">
    <div class="card">
      <h3>Core package — Fixed Events</h3>
      <ul>
        ${fixed
          .map(
            (e) =>
              `<li>${e.name} · ${e.agD} day${e.agD === 1 ? '' : 's'}${
                e.tier !== 'std' ? ` · ${tierMult(e.tier).toFixed(2)}× rate` : ''
              }</li>`
          )
          .join('')}
      </ul>
      <p class="muted">15 livestream days · ${moneyR(pkgCore.contract)} ex GST</p>
    </div>
    <div class="card">
      <h3>Optional Other Events</h3>
      <ul>
        ${other
          .map(
            (e) =>
              `<li>${e.name} · ${e.agD} day${e.agD === 1 ? '' : 's'} (extended coverage)</li>`
          )
          .join('')}
        <li>Masters Regatta · 1 day (optional add-on)</li>
      </ul>
    </div>
  </div>

  <h2>3. Season packages</h2>
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
        <td class="num">${moneyR(pkgCore.contract)}</td>
      </tr>
      <tr class="accent">
        <td><strong>Classic Season</strong></td>
        <td>Core + Universities + Beach/Coastal — same event mix as last season</td>
        <td class="num">16</td>
        <td class="num">${moneyR(pkgClassic.contract)}</td>
      </tr>
      <tr>
        <td><strong>Classic Season + Masters</strong></td>
        <td>Classic Season + Masters Regatta (season rate)</td>
        <td class="num">17</td>
        <td class="num">${moneyR(pkgClassicMasters.contract)}</td>
      </tr>
      <tr>
        <td><strong>Extended Classic</strong></td>
        <td>Core + Universities + Beach/Coastal at longer proposed day counts</td>
        <td class="num">19.5</td>
        <td class="num">${moneyR(pkgExtended.contract)}</td>
      </tr>
      <tr>
        <td><strong>Extended Classic + Masters</strong></td>
        <td>Extended Classic + Masters Regatta (season rate)</td>
        <td class="num">20.5</td>
        <td class="num">${moneyR(pkgExtendedMasters.contract)}</td>
      </tr>
    </tbody>
  </table>

  <div class="box">
    <strong>Recommended continuity option:</strong> Classic Season at
    <strong>${moneyR(pkgClassic.contract)}</strong> — the same six events and day mix as last season,
    with a 3% CPI adjustment only (+${moneyR(pkgClassic.contract - OLD_TOTAL)} vs ${moneyR(OLD_TOTAL)}).
    Extended Classic list is ${moneyR(EXTENDED_AGREE)}${
      pkgExtended.discount > 0
        ? `; after the discount above ${moneyR(DISCOUNT_THRESHOLD)} the fee is <strong>${moneyR(pkgExtended.contract)}</strong>`
        : ''
    }.
  </div>

  <h2>4. Event day counts &amp; fees</h2>
  <table>
    <thead>
      <tr>
        <th>Event</th>
        <th>Type</th>
        <th class="num">Last season days</th>
        <th class="num">Proposed days</th>
        <th class="num">Fee (agree + CPI)*</th>
      </tr>
    </thead>
    <tbody>
      ${events
        .map((e) => {
          return `<tr${rowClass(e)}>
            <td>${e.name}${tierLabel(e)}</td>
            <td>${e.bucket === 'fixed' ? 'Fixed / Core' : 'Other'}</td>
            <td class="num">${e.lyD}</td>
            <td class="num">${e.agD}</td>
            <td class="num">${moneyR(eventFee(e, 'agD', true))}</td>
          </tr>`;
        })
        .join('\n')}
      <tr>
        <td>Masters Regatta</td>
        <td>Optional add-on</td>
        <td class="num">—</td>
        <td class="num">1</td>
        <td class="num">${moneyR(MASTERS_LIST)}</td>
      </tr>
    </tbody>
  </table>
  <p class="muted">
    *Fees = setup + day rate × days at the CPI rate card. Package fees above are preferred
    when multiple events are taken together.
  </p>

  <h2>5. Masters Regatta add-on</h2>
  <table>
    <thead>
      <tr><th>Selected with</th><th class="num">Masters fee (ex GST)</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>Core only, or Core + only one Other Event</td>
        <td class="num">${moneyR(MASTERS_LIST)}</td>
      </tr>
      <tr class="accent">
        <td>Full Classic or Extended Classic (Core + Universities + Beach/Coastal)</td>
        <td class="num">${moneyR(MASTERS_SEASON)}</td>
      </tr>
    </tbody>
  </table>

  <h2>6. Production scope (summary)</h2>
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

  <h2>7. Notes</h2>
  <ul>
    <li>All fees are in New Zealand dollars and <strong>exclude GST</strong>.</li>
    <li>Classic Season preserves last season’s event mix at a CPI-only uplift.</li>
    <li>Setup is once per regatta; NZ and Maadi multipliers apply to both setup and day rate.</li>
    <li>Packages above ${moneyR(DISCOUNT_THRESHOLD)} receive a 50% discount on the amount above that threshold.</li>
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

  console.log({
    ly: Math.round(LY_TOTAL),
    core: Math.round(pkgCore.contract),
    classic: Math.round(pkgClassic.contract),
    extendedList: Math.round(EXTENDED_AGREE),
    extendedContract: Math.round(pkgExtended.contract),
    mastersList: MASTERS_LIST,
    setupStdLy: SETUP_STD_LY,
    dayStdLy: DAY_STD_LY,
    nzSetupLy: Math.round(NZ_LY.setup),
    nzDayLy: Math.round(NZ_LY.day),
    maadiSetupLy: Math.round(MAADI_LY.setup),
    maadiDayLy: Math.round(MAADI_LY.day),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
