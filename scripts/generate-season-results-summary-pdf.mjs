#!/usr/bin/env node
/**
 * One-page 2025/26 season summary — beach sprint & classic Open/Premier standouts (RowIT).
 * Usage: node scripts/generate-season-results-summary-pdf.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildSeasonResultsSummary } from './lib/season-results-summary.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR =
  process.env.SEASON_SUMMARY_OUT_DIR ||
  'C:/Users/JohnSt/Desktop/RNZ/26 Selection 2nd Trial';
const BASE_NAME = '2026-Season-Results-Summary-Open-Prem';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function medal(place) {
  if (place === 1) return '🥇';
  if (place === 2) return '🥈';
  if (place === 3) return '🥉';
  return `${place}.`;
}

function podiumRows(podium) {
  if (!podium?.rows?.length) return '<tr><td colspan="3" class="muted">No final results</td></tr>';
  return podium.rows
    .slice(0, 3)
    .map((r) => {
      const ord = r.place === 1 ? '1st' : r.place === 2 ? '2nd' : '3rd';
      return `<tr>
        <td class="place">${medal(r.place)}</td>
        <td><strong>${esc(r.name)}</strong></td>
        <td class="time">${esc(r.time || '')}</td>
      </tr>`;
    })
    .join('');
}

function eventBlock(podium) {
  if (!podium) return '';
  return `
  <div class="event">
    <div class="event-title">${esc(podium.eventType)} <span class="regatta">${esc(podium.regatta)}</span></div>
    <div class="event-sub">${esc(podium.finalLabel)}</div>
    <table class="mini">
      <tbody>${podiumRows(podium)}</tbody>
    </table>
  </div>`;
}

function standoutsList(items) {
  if (!items?.length) return '<p class="muted">No results available.</p>';
  return `<ul class="standouts">${items
    .slice(0, 6)
    .map(
      (a) =>
        `<li><strong>${esc(a.name)}</strong><span class="pts">${Math.round(a.points)} pts</span><br><span class="hl">${esc(a.highlights[0] || '')}</span></li>`,
    )
    .join('')}</ul>`;
}

function buildHtml(data, generatedAt) {
  const beachFlagship = data.beachSprint.flagship.slice(0, 4);
  const classicFlagship = data.classic.flagship.slice(0, 6);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>2025/26 Season Results — Open &amp; Premier</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 8.5pt;
      line-height: 1.25;
      color: #0f172a;
      margin: 0;
      padding: 0;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 3px solid #0d9488;
      padding-bottom: 4px;
      margin-bottom: 6px;
    }
    h1 {
      font-size: 14pt;
      margin: 0;
      color: #0f766e;
      letter-spacing: -0.02em;
    }
    .meta { font-size: 7.5pt; color: #64748b; text-align: right; }
    .scope { font-size: 7.5pt; color: #475569; margin: 0 0 6px; }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .col {
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 6px 8px;
      background: #f8fafc;
    }
    .col h2 {
      margin: 0 0 4px;
      font-size: 10pt;
      color: #0d9488;
      border-bottom: 1px solid #99f6e4;
      padding-bottom: 2px;
    }
    .sources { font-size: 7pt; color: #64748b; margin: 0 0 5px; }
    .events {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 8px;
      margin-bottom: 6px;
    }
    .event { background: #fff; border: 1px solid #e2e8f0; border-radius: 3px; padding: 3px 5px; }
    .event-title { font-weight: 700; font-size: 7.5pt; }
    .regatta { font-weight: 400; color: #64748b; }
    .event-sub { font-size: 6.5pt; color: #64748b; margin-bottom: 2px; }
    table.mini { width: 100%; border-collapse: collapse; font-size: 7pt; }
    table.mini td { padding: 1px 2px; vertical-align: top; }
    td.place { width: 14px; }
    td.time { text-align: right; color: #475569; white-space: nowrap; }
    h3 { margin: 4px 0 2px; font-size: 8pt; color: #334155; }
    ul.standouts { margin: 0; padding-left: 14px; font-size: 7pt; }
    ul.standouts li { margin-bottom: 3px; }
    .pts { float: right; color: #0d9488; font-weight: 600; }
    .hl { color: #64748b; font-size: 6.5pt; }
    .muted { color: #94a3b8; font-size: 7pt; }
    footer {
      margin-top: 5px;
      font-size: 6.5pt;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 3px;
    }
    .note { font-size: 6.5pt; color: #b45309; margin: 0 0 4px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>2025/26 Season — Open &amp; Premier Standouts</h1>
      <p class="scope">RowIT regatta results · ${esc(data.scope)}</p>
    </div>
    <div class="meta">Generated ${esc(generatedAt)}</div>
  </header>

  <div class="grid">
    <section class="col">
      <h2>Beach Sprint</h2>
      <p class="sources">${esc(data.beachSprint.sources.join(' · '))}</p>
      <div class="events">
        ${beachFlagship.map(eventBlock).join('')}
      </div>
      <h3>Season standouts</h3>
      ${standoutsList(data.beachSprint.standouts)}
    </section>

    <section class="col">
      <h2>Classic (Flat-water)</h2>
      <p class="sources">${esc(data.classic.sources.join(' · ') || 'NICC 2026')}</p>
      ${data.classic.note ? `<p class="note">${esc(data.classic.note)}</p>` : ''}
      <div class="events">
        ${classicFlagship.map(eventBlock).join('')}
      </div>
      <h3>Season standouts</h3>
      ${standoutsList(data.classic.standouts)}
    </section>
  </div>

  <footer>
    Points weight A-final placings (singles highest). Open/Premier events only. For selection context — not an official RNZ ranking.
  </footer>
</body>
</html>`;
}

async function main() {
  console.log('Building season summary from RowIT…');
  const data = await buildSeasonResultsSummary();

  const generatedAt = new Date().toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  await mkdir(OUT_DIR, { recursive: true });
  const jsonPath = join(OUT_DIR, `${BASE_NAME}.json`);
  await writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8');

  const html = buildHtml(data, generatedAt);
  const htmlPath = join(OUT_DIR, `${BASE_NAME}.html`);
  const pdfPath = join(OUT_DIR, `${BASE_NAME}.pdf`);
  await writeFile(htmlPath, html, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    landscape: true,
    printBackground: true,
    margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
  });
  await browser.close();

  console.log('Wrote:');
  console.log(' ', pdfPath);
  console.log(' ', htmlPath);
  console.log(' ', jsonPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
