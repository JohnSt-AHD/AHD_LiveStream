#!/usr/bin/env node
/**
 * Generate RNZ livestream season pricing PDFs (internal + client-facing).
 * - Maadi weighted for higher resource load
 * - Package contract discounts anything above last year's $175k spend
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
/** Maadi resource premium vs standard CPI day rate */
const MAADI_WEIGHT = 1.35;
/** Discount applied to fees above last year's spend */
const EXCESS_KEEP = 0.5; // client pays 50% of (list − $175k)
const MASTERS_LIST = 10_000;
const MASTERS_SEASON = 5_000;
const TODAY = new Date().toISOString().slice(0, 10);

const money = (n, d = 0) =>
  `$${Math.round(n).toLocaleString('en-NZ', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;

const moneyExact = (n, d = 0) =>
  `$${n.toLocaleString('en-NZ', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;

function eventFee(days, weight = 1) {
  return days * DAY_CPI * weight;
}

function contractPrice(listPrice) {
  if (listPrice <= OLD_TOTAL) return { contract: listPrice, discount: 0, excess: 0 };
  const excess = listPrice - OLD_TOTAL;
  const discount = excess * (1 - EXCESS_KEEP);
  return {
    contract: OLD_TOTAL + excess * EXCESS_KEEP,
    discount,
    excess,
  };
}

const events = [
  { name: 'NZ Rowing Champs', lyD: 4, agD: 4, weight: 1, bucket: 'fixed' },
  { name: 'NI Secondary School', lyD: 2, agD: 3, weight: 1, bucket: 'fixed' },
  { name: 'SI Secondary School', lyD: 2, agD: 2, weight: 1, bucket: 'fixed' },
  {
    name: 'Maadi Regatta',
    lyD: 6,
    agD: 6,
    weight: MAADI_WEIGHT,
    bucket: 'fixed',
  },
  { name: 'Universities Champs', lyD: 1, agD: 1.5, weight: 1, bucket: 'other' },
  {
    name: 'Beach / Coastal Champs',
    lyD: 1,
    agD: 3,
    weight: 1,
    bucket: 'other',
  },
];

function sumFees(evts, dayKey) {
  return evts.reduce((s, e) => s + eventFee(e[dayKey], e.weight), 0);
}

const coreAgreeList = sumFees(
  events.filter((e) => e.bucket === 'fixed'),
  'agD'
);
const coreSameList = sumFees(
  events.filter((e) => e.bucket === 'fixed'),
  'lyD'
);
const fullAgreeList = sumFees(events, 'agD');
const fullSameList = sumFees(events, 'lyD');

const coreAgree = contractPrice(coreAgreeList);
const coreSame = contractPrice(coreSameList);
const classicSame = contractPrice(fullSameList);
const classicSameMasters = contractPrice(fullSameList + MASTERS_SEASON);
const extended = contractPrice(fullAgreeList);
const extendedMasters = contractPrice(fullAgreeList + MASTERS_SEASON);

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
    .box { background: #ecfeff; border: 1px solid #99f6e4; border-radius: 4px; padding: 4px 8px; margin: 3px 0 4px; }
    .box.warn { background: #fff7ed; border-color: #fed7aa; }
    .box.danger { background: #fef2f2; border-color: #fecaca; }
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
    <p class="tagline">RNZ pricing — Maadi ${MAADI_WEIGHT}× resource weight · 50% off uplift above ${money(OLD_TOTAL)} · ex GST</p>
  </header>

  <div class="stats">
    <div class="stat"><div class="v">${money(OLD_TOTAL)}</div><div class="l">Last year spend (threshold)</div></div>
    <div class="stat"><div class="v">${money(coreAgree.contract)}</div><div class="l">Core contract (15d, Maadi weighted)</div></div>
    <div class="stat"><div class="v">${money(classicSame.contract)}</div><div class="l">Classic same-mix contract</div></div>
    <div class="stat"><div class="v">${money(extended.contract)}</div><div class="l">Extended Classic contract</div></div>
  </div>

  <div class="box warn">
    <strong>Maadi @ ${MAADI_WEIGHT}×</strong> CPI day rate (${moneyExact(DAY_CPI, 2)} → ${moneyExact(DAY_CPI * MAADI_WEIGHT, 2)}/day)
    reflecting higher crew, kit and peak-week load.
    <strong>Discount rule:</strong> contract = ${money(OLD_TOTAL)} + 50% of any list above last year’s spend.
  </div>

  <h2>1. Rate card (list) — weighted</h2>
  <p class="muted">Base day rate ${moneyExact(DAY_CPI, 2)} after 3% CPI. Maadi days × ${MAADI_WEIGHT}.</p>
  <table>
    <thead>
      <tr>
        <th>Event</th>
        <th class="num">Weight</th>
        <th class="num">Same days</th>
        <th class="num">Same list</th>
        <th class="num">Agree. days</th>
        <th class="num">Agree. list</th>
      </tr>
    </thead>
    <tbody>
      ${events
        .map((e) => {
          const cls = e.weight > 1 ? ' class="maadi"' : '';
          return `<tr${cls}>
            <td>${e.name}${e.weight > 1 ? ` (${e.weight}×)` : ''}</td>
            <td class="num">${e.weight}×</td>
            <td class="num">${e.lyD}</td>
            <td class="num">${money(eventFee(e.lyD, e.weight))}</td>
            <td class="num">${e.agD}</td>
            <td class="num">${money(eventFee(e.agD, e.weight))}</td>
          </tr>`;
        })
        .join('\n')}
      <tr>
        <td>Masters Regatta (new)</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">${money(MASTERS_LIST)} list</td>
        <td class="num">1</td>
        <td class="num">${money(MASTERS_LIST)} list</td>
      </tr>
      <tr class="total">
        <td>Fixed Events (Core) list</td>
        <td class="num"></td>
        <td class="num">14</td>
        <td class="num">${money(coreSameList)}</td>
        <td class="num">15</td>
        <td class="num">${money(coreAgreeList)}</td>
      </tr>
      <tr class="accent">
        <td>Full season list (ex Masters)</td>
        <td class="num"></td>
        <td class="num">16</td>
        <td class="num">${money(fullSameList)}</td>
        <td class="num">19.5</td>
        <td class="num">${money(fullAgreeList)}</td>
      </tr>
    </tbody>
  </table>

  <h2>2. Packages — list vs contract (discount above ${money(OLD_TOTAL)})</h2>
  <table>
    <thead>
      <tr>
        <th>Package</th>
        <th class="num">Days</th>
        <th class="num">List</th>
        <th class="num">Discount</th>
        <th class="num">Contract</th>
        <th class="num">vs LY spend</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Core (agreement days, Maadi weighted)</td>
        <td class="num">15</td>
        <td class="num">${money(coreAgreeList)}</td>
        <td class="num">−${money(coreAgree.discount)}</td>
        <td class="num"><strong>${money(coreAgree.contract)}</strong></td>
        <td class="num">+${money(coreAgree.contract - OLD_TOTAL)}</td>
      </tr>
      <tr class="accent">
        <td>Classic — same mix as last season</td>
        <td class="num">16</td>
        <td class="num">${money(fullSameList)}</td>
        <td class="num">−${money(classicSame.discount)}</td>
        <td class="num"><strong>${money(classicSame.contract)}</strong></td>
        <td class="num">+${money(classicSame.contract - OLD_TOTAL)}</td>
      </tr>
      <tr>
        <td>Classic + Masters (season rate)</td>
        <td class="num">17</td>
        <td class="num">${money(fullSameList + MASTERS_SEASON)}</td>
        <td class="num">−${money(classicSameMasters.discount)}</td>
        <td class="num">${money(classicSameMasters.contract)}</td>
        <td class="num">+${money(classicSameMasters.contract - OLD_TOTAL)}</td>
      </tr>
      <tr>
        <td>Extended Classic (agreement days)</td>
        <td class="num">19.5</td>
        <td class="num">${money(fullAgreeList)}</td>
        <td class="num">−${money(extended.discount)}</td>
        <td class="num">${money(extended.contract)}</td>
        <td class="num">+${money(extended.contract - OLD_TOTAL)}</td>
      </tr>
      <tr>
        <td>Extended + Masters (season rate)</td>
        <td class="num">20.5</td>
        <td class="num">${money(fullAgreeList + MASTERS_SEASON)}</td>
        <td class="num">−${money(extendedMasters.discount)}</td>
        <td class="num">${money(extendedMasters.contract)}</td>
        <td class="num">+${money(extendedMasters.contract - OLD_TOTAL)}</td>
      </tr>
    </tbody>
  </table>

  <h2>3. Masters add-on</h2>
  <table>
    <thead><tr><th>When</th><th class="num">Masters</th></tr></thead>
    <tbody>
      <tr><td>Standalone / partial extras</td><td class="num">${money(MASTERS_LIST)}</td></tr>
      <tr class="accent"><td>With full Classic / Extended (Uni + Beach on)</td><td class="num">${money(MASTERS_SEASON)} then package discount applies to total</td></tr>
    </tbody>
  </table>

  <h2>4. Why Maadi is weighted</h2>
  <div class="box warn">
    Maadi is the longest peak week: largest crew, full kit list, redundancy, and failure cost.
    ${MAADI_WEIGHT}× lifts Maadi’s list to ${money(eventFee(6, MAADI_WEIGHT))} (was ${money(eventFee(6, 1))} on flat CPI days).
    Package discount then shares the uplift above ${money(OLD_TOTAL)} 50/50 with RNZ.
  </div>

  <h2>5. Discount rule (for the room)</h2>
  <div class="box">
    <strong>Contract = ${money(OLD_TOTAL)} + 50% × (List − ${money(OLD_TOTAL)})</strong> when List &gt; last year.
    Example: Extended list ${money(fullAgreeList)} → pay ${money(extended.contract)} (save ${money(extended.discount)}).
    Do <em>not</em> describe the discount as “extra days only cost ~$5k.”
  </div>

  <h2>6. Spoken path</h2>
  <ol>
    <li>Last year ${money(OLD_TOTAL)}. Maadi now carries a ${MAADI_WEIGHT}× resource rate.</li>
    <li>Core (15 days) list ${money(coreAgreeList)} → contract <strong>${money(coreAgree.contract)}</strong>.</li>
    <li>Same mix as last year → contract <strong>${money(classicSame.contract)}</strong> (list ${money(fullSameList)}, save ${money(classicSame.discount)}).</li>
    <li>Agreement longer days → Extended contract <strong>${money(extended.contract)}</strong>.</li>
    <li>Masters ${money(MASTERS_LIST)} / ${money(MASTERS_SEASON)} with full Classic, then same discount rule on the package total.</li>
  </ol>

  <footer>
    AltitudeHD internal · Generated ${TODAY} · Maadi ${MAADI_WEIGHT}× · 50% off uplift above ${money(OLD_TOTAL)} · Not client-facing · Not legal advice
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
    Fees start from last season’s day rate with a <strong>3% CPI uplift</strong>.
    <strong>Maadi Regatta</strong> is priced at a <strong>${MAADI_WEIGHT}× resource rate</strong> reflecting its longer peak production week.
    Where a package list price exceeds last season’s spend of <strong>${money(OLD_TOTAL)}</strong>,
    AltitudeHD applies a <strong>50% discount on the amount above ${money(OLD_TOTAL)}</strong>.
  </p>

  <div class="stats">
    <div class="stat">
      <div class="v">${money(coreAgree.contract)}</div>
      <div class="l">Core · 4 Fixed Events · 15 days</div>
    </div>
    <div class="stat">
      <div class="v">${money(classicSame.contract)}</div>
      <div class="l">Classic · same mix as last season · 16 days</div>
    </div>
    <div class="stat">
      <div class="v">${money(extended.contract)}</div>
      <div class="l">Extended Classic · longer day counts · 19.5 days</div>
    </div>
  </div>

  <h2>1. What’s included</h2>
  <div class="two-col">
    <div class="card">
      <h3>Core package — Fixed Events</h3>
      <ul>
        ${fixed
          .map(
            (e) =>
              `<li>${e.name} · ${e.agD} day${e.agD === 1 ? '' : 's'}${
                e.weight > 1 ? ` · ${e.weight}× resource rate` : ''
              }</li>`
          )
          .join('')}
      </ul>
      <p class="muted">15 livestream days · ${money(coreAgree.contract)} ex GST</p>
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

  <h2>2. Season packages</h2>
  <table>
    <thead>
      <tr>
        <th>Package</th>
        <th>Includes</th>
        <th class="num">Days</th>
        <th class="num">List</th>
        <th class="num">Your price</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Core</strong></td>
        <td>NZ Champs, NI Secondary, SI Secondary, Maadi (${MAADI_WEIGHT}×)</td>
        <td class="num">15</td>
        <td class="num">${money(coreAgreeList)}</td>
        <td class="num"><strong>${money(coreAgree.contract)}</strong></td>
      </tr>
      <tr class="accent">
        <td><strong>Classic Season</strong></td>
        <td>Core + Universities + Beach/Coastal — same event mix as last season</td>
        <td class="num">16</td>
        <td class="num">${money(fullSameList)}</td>
        <td class="num"><strong>${money(classicSame.contract)}</strong></td>
      </tr>
      <tr>
        <td><strong>Classic + Masters</strong></td>
        <td>Classic Season + Masters (season rate)</td>
        <td class="num">17</td>
        <td class="num">${money(fullSameList + MASTERS_SEASON)}</td>
        <td class="num">${money(classicSameMasters.contract)}</td>
      </tr>
      <tr>
        <td><strong>Extended Classic</strong></td>
        <td>Core + Universities + Beach/Coastal at longer proposed day counts</td>
        <td class="num">19.5</td>
        <td class="num">${money(fullAgreeList)}</td>
        <td class="num">${money(extended.contract)}</td>
      </tr>
      <tr>
        <td><strong>Extended + Masters</strong></td>
        <td>Extended Classic + Masters (season rate)</td>
        <td class="num">20.5</td>
        <td class="num">${money(fullAgreeList + MASTERS_SEASON)}</td>
        <td class="num">${money(extendedMasters.contract)}</td>
      </tr>
    </tbody>
  </table>

  <div class="box">
    <strong>How the discount works:</strong> last season’s spend was ${money(OLD_TOTAL)}.
    You pay ${money(OLD_TOTAL)} plus <strong>half</strong> of any amount above that on the package list price.
    Example — Classic list ${money(fullSameList)} → you pay ${money(classicSame.contract)}
    (save ${money(classicSame.discount)}).
  </div>

  <h2>3. Event rate card</h2>
  <table>
    <thead>
      <tr>
        <th>Event</th>
        <th>Type</th>
        <th class="num">Last season days</th>
        <th class="num">Proposed days</th>
        <th class="num">List fee*</th>
      </tr>
    </thead>
    <tbody>
      ${events
        .map((e) => {
          const cls = e.weight > 1 ? ' class="maadi"' : '';
          return `<tr${cls}>
            <td>${e.name}${e.weight > 1 ? ` (${e.weight}× resource)` : ''}</td>
            <td>${e.bucket === 'fixed' ? 'Fixed / Core' : 'Other'}</td>
            <td class="num">${e.lyD}</td>
            <td class="num">${e.agD}</td>
            <td class="num">${money(eventFee(e.agD, e.weight))}</td>
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
    *List fees use the CPI day rate (${moneyExact(DAY_CPI, 2)}/day), with Maadi at ${MAADI_WEIGHT}×.
    Package “Your price” columns already include the uplift discount. Fixed Events are sold as the Core package.
  </p>

  <h2>4. Masters Regatta add-on</h2>
  <table>
    <thead>
      <tr><th>Selected with</th><th class="num">Masters list</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>Core only, or Core + only one Other Event</td>
        <td class="num">${money(MASTERS_LIST)}</td>
      </tr>
      <tr class="accent">
        <td>Full Classic or Extended Classic (Core + Universities + Beach/Coastal)</td>
        <td class="num">${money(MASTERS_SEASON)} (then package discount on the combined total)</td>
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
    <li>Maadi’s ${MAADI_WEIGHT}× rate reflects peak-week resource requirements.</li>
    <li>Package discount: 50% off the portion of list price above last season’s ${money(OLD_TOTAL)}.</li>
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

  console.log('Core list/contract', money(coreAgreeList), money(coreAgree.contract));
  console.log('Classic list/contract', money(fullSameList), money(classicSame.contract));
  console.log('Extended list/contract', money(fullAgreeList), money(extended.contract));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
