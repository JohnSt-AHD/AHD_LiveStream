#!/usr/bin/env node
/**
 * Generate internal RNZ livestream season pricing PDF (CPI + day-count options).
 * Usage: node scripts/generate-rnz-season-pricing-pdf.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
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
const CORE_PIN = 175_000;
const MASTERS_LIST = 10_000;
const MASTERS_SEASON = 5_000;
const AGREE_FULL = Math.round((19.5 * DAY_CPI) / 500) * 500;

const money = (n, d = 0) =>
  `$${n.toLocaleString('en-NZ', { minimumFractionDigits: d, maximumFractionDigits: d })}`;

const events = [
  { name: 'NZ Rowing Champs', lyD: 4, agD: 4 },
  { name: 'NI Secondary School', lyD: 2, agD: 3 },
  { name: 'SI Secondary School', lyD: 2, agD: 2 },
  { name: 'Maadi Regatta', lyD: 6, agD: 6 },
  { name: 'Universities Champs', lyD: 1, agD: 1.5 },
  { name: 'Beach / Coastal Champs', lyD: 1, agD: 3 },
];

function eventRows() {
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

const html = `<!DOCTYPE html>
<html lang="en-NZ">
<head>
  <meta charset="utf-8" />
  <title>AHD · RNZ Livestream Season Pricing (Internal)</title>
  <style>
    @page { size: A4; margin: 16mm 14mm 18mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #0f172a;
      font-size: 10pt;
      line-height: 1.4;
      margin: 0;
    }
    header {
      border-bottom: 3px solid #0e7490;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .brand { font-size: 18pt; font-weight: 800; color: #0e7490; margin: 0; }
    .tagline { color: #64748b; margin: 4px 0 0; font-size: 9.5pt; }
    h2 {
      font-size: 11.5pt;
      color: #0e7490;
      margin: 16px 0 6px;
      border-bottom: 1px solid #ccfbf1;
      padding-bottom: 3px;
    }
    h3 { font-size: 10.5pt; margin: 12px 0 4px; color: #164e63; }
    p { margin: 0 0 7px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 6px 0 10px;
      font-size: 9pt;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 5px 7px;
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
      padding: 10px 12px;
      margin: 8px 0 12px;
    }
    .box.warn {
      background: #fff7ed;
      border-color: #fed7aa;
    }
    .box.danger {
      background: #fef2f2;
      border-color: #fecaca;
    }
    .muted { color: #64748b; font-size: 8.5pt; }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin: 8px 0 12px;
    }
    .stat {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 8px;
    }
    .stat .v { font-size: 12pt; font-weight: 700; color: #0e7490; }
    .stat .l { font-size: 8pt; color: #64748b; margin-top: 2px; }
    ul { margin: 4px 0 8px; padding-left: 16px; }
    li { margin-bottom: 3px; }
    .page-break { break-before: page; page-break-before: always; }
    footer {
      margin-top: 14px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      color: #94a3b8;
      font-size: 8pt;
    }
  </style>
</head>
<body>
  <header>
    <p class="brand">AltitudeHD · Internal</p>
    <p class="tagline">RNZ livestream season pricing — last year vs CPI vs agreement days · All figures ex GST</p>
  </header>

  <div class="stats">
    <div class="stat"><div class="v">${money(OLD_TOTAL)}</div><div class="l">Last year (16 days)</div></div>
    <div class="stat"><div class="v">${money(SAME_MIX_CPI)}</div><div class="l">Same mix + 3% CPI</div></div>
    <div class="stat"><div class="v">${money(CORE_PIN)}</div><div class="l">Proposed Core (Fixed ×4)</div></div>
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
      ${eventRows()}
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
        <td>4 Fixed Events (Maadi locked in)</td>
        <td class="num">${money(CORE_PIN)}</td>
        <td class="num">Same headline $</td>
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
  <p class="muted">~$10k is slightly under the CPI day rate (${money(DAY_CPI, 2)}). Half-price only when Uni and Beach are both taken — rewards season take-up.</p>

  <div class="page-break"></div>

  <h2>4. “Why is Core still ~$175k?” — cost pools</h2>
  <div class="box warn">
    <strong>Fixed days did not shrink in the RNZ draft.</strong>
    NI Secondary goes 2 → 3 days, so Fixed is 14 → 15. Core-only is fewer <em>events</em> than last year’s paid six, not a lighter Fixed day load.
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
  <p><strong>Say this:</strong> Last year’s $175k bought a season production platform, not 16 identical day-units. About 80–90% sits in standing crew, peak Maadi kit, and systems that still run for the four Fixed Events. Pure day maths on Fixed alone after CPI is ~${money(14 * DAY_CPI)} (same days) or ~${money(15 * DAY_CPI)} (agreement). Core at $175k is the platform price with Maadi inside.</p>

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
    <li>Core (4 Fixed, Maadi in) stays ${money(CORE_PIN)} — standing cost pools, not a day chop.</li>
    <li>Want the same season as last year? ${money(SAME_MIX_CPI)} (+3% CPI). That’s the ~$5k conversation.</li>
    <li>Want draft day counts? Classic ~${money(AGREE_FULL)}.</li>
    <li>Masters +1 day: ${money(MASTERS_LIST)} à la carte, ${money(MASTERS_SEASON)} when Uni + Beach are both taken.</li>
  </ol>

  <footer>
    AltitudeHD internal negotiation aid · Generated ${new Date().toISOString().slice(0, 10)} ·
    Method: $175,000/16 × 1.03 × days · Not a client-facing proposal · Not legal advice
  </footer>
</body>
</html>
`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(ARTIFACTS, { recursive: true });

  const htmlName = 'RNZ-Livestream-Season-Pricing-Internal.html';
  const pdfName = 'RNZ-Livestream-Season-Pricing-Internal.pdf';
  const htmlPath = join(OUT_DIR, htmlName);
  const pdfPath = join(OUT_DIR, pdfName);

  await writeFile(htmlPath, html, 'utf8');

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/local/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
    });
  } finally {
    await browser.close();
  }

  // Copy to artifacts for easy download in Cloud Agent UI
  const { copyFile } = await import('node:fs/promises');
  await copyFile(htmlPath, join(ARTIFACTS, htmlName));
  await copyFile(pdfPath, join(ARTIFACTS, pdfName));

  console.log(`Wrote ${htmlPath}`);
  console.log(`Wrote ${pdfPath}`);
  console.log(`Copied to ${ARTIFACTS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
