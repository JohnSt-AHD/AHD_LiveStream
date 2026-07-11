#!/usr/bin/env node
/**
 * One-page PDF summary per major 2026 regatta (RowIT).
 * Usage: node scripts/generate-regatta-summaries-pdf.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildRegattaSummary, REGATTA_CONFIGS } from './lib/regatta-summary.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR =
  process.env.REGATTA_SUMMARY_OUT_DIR ||
  'C:/Users/JohnSt/Desktop/RNZ/26 Selection 2nd Trial/Regatta Summaries';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function medal(place) {
  if (place === 1) return '1';
  if (place === 2) return '2';
  if (place === 3) return '3';
  return String(place);
}

function truncateName(name, max = 48) {
  const s = String(name || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function podiumRows(podium) {
  if (!podium?.rows?.length) {
    return '<tr><td colspan="3" class="muted">—</td></tr>';
  }
  return podium.rows
    .slice(0, 3)
    .map(
      (r) => `<tr>
        <td class="place">${medal(r.place)}</td>
        <td>${esc(truncateName(r.name))}</td>
        <td class="time">${esc(r.time || '')}</td>
      </tr>`,
    )
    .join('');
}

function eventBlock(podium) {
  return `
  <div class="event">
    <div class="event-title">${esc(podium.eventType)}</div>
    <div class="event-sub">${esc(podium.finalLabel)}</div>
    <table class="mini"><tbody>${podiumRows(podium)}</tbody></table>
  </div>`;
}

function standoutsList(items) {
  if (!items?.length) return '<p class="muted">No standout results yet.</p>';
  return `<ul class="standouts">${items
    .slice(0, 8)
    .map(
      (a) =>
        `<li><strong>${esc(truncateName(a.name, 36))}</strong> <span class="pts">${Math.round(a.points)}</span><br><span class="hl">${esc(a.highlights[0] || '')}</span></li>`,
    )
    .join('')}</ul>`;
}

function typeLabel(type) {
  if (type === 'schools') return 'Secondary schools';
  if (type === 'coastal') return 'Coastal / beach sprint';
  return 'Classic flat-water';
}

function buildHtml(data, generatedAt) {
  const events = data.headline.slice(0, 10);
  const cols = events.length > 6 ? 3 : 2;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(data.label)} — Results Summary</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 8pt;
      line-height: 1.2;
      color: #0f172a;
      margin: 0;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 3px solid #0d9488;
      padding-bottom: 4px;
      margin-bottom: 5px;
    }
    h1 { font-size: 13pt; margin: 0; color: #0f766e; }
    .meta { font-size: 7pt; color: #64748b; text-align: right; }
    .sub { font-size: 7.5pt; color: #475569; margin: 0 0 4px; }
    .warn { font-size: 7pt; color: #b45309; margin: 0 0 4px; }
    .layout { display: grid; grid-template-columns: 1fr 220px; gap: 8px; }
    .events {
      display: grid;
      grid-template-columns: repeat(${cols}, 1fr);
      gap: 3px 6px;
    }
    .event {
      border: 1px solid #e2e8f0;
      border-radius: 3px;
      padding: 2px 4px;
      background: #f8fafc;
    }
    .event-title { font-weight: 700; font-size: 7pt; }
    .event-sub { font-size: 6pt; color: #64748b; }
    table.mini { width: 100%; border-collapse: collapse; font-size: 6.5pt; }
    table.mini td { padding: 0; vertical-align: top; }
    td.place { width: 10px; font-weight: 700; color: #0d9488; }
    td.time { text-align: right; color: #64748b; white-space: nowrap; }
    .side h2 { font-size: 8.5pt; margin: 0 0 3px; color: #334155; }
    ul.standouts { margin: 0; padding-left: 12px; font-size: 6.5pt; }
    ul.standouts li { margin-bottom: 2px; }
    .pts { color: #0d9488; font-weight: 600; }
    .hl { color: #64748b; font-size: 6pt; }
    .muted { color: #94a3b8; font-size: 6.5pt; }
    footer {
      margin-top: 4px;
      font-size: 6pt;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 2px;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${esc(data.label)}</h1>
      <p class="sub">${esc(typeLabel(data.type))} · RowIT · ${esc(data.stats?.finals ?? 0)} finals parsed</p>
    </div>
    <div class="meta">${esc(generatedAt)}</div>
  </header>
  ${data.error ? `<p class="warn">Could not load regatta data: ${esc(data.error)}</p>` : ''}
  ${data.note ? `<p class="warn">${esc(data.note)}</p>` : ''}
  <div class="layout">
    <section>
      <div class="events">
        ${events.length ? events.map(eventBlock).join('') : '<p class="muted">No final results available on RowIT.</p>'}
      </div>
    </section>
    <aside class="side">
      <h2>Standouts</h2>
      ${standoutsList(data.standouts)}
    </aside>
  </div>
  <footer>Source: rowit.nz · A-final placings weighted (singles highest). For selection context only.</footer>
</body>
</html>`;
}

async function main() {
  const codes = process.argv.slice(2);
  const list = codes.length
    ? REGATTA_CONFIGS.filter((c) => codes.includes(c.code))
    : REGATTA_CONFIGS;

  console.log(`Building ${list.length} regatta summaries…`);
  await mkdir(OUT_DIR, { recursive: true });

  const summaries = [];
  for (const config of list) {
    process.stdout.write(`  ${config.code}… `);
    const summary = await buildRegattaSummary(config);
    console.log(summary.error ? `skip (${summary.error})` : `${summary.stats.finals} finals`);
    summaries.push(summary);
  }

  const generatedAt = new Date().toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  await writeFile(join(OUT_DIR, '_all-regatta-summaries.json'), JSON.stringify(summaries, null, 2), 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const data of summaries) {
    const html = buildHtml(data, generatedAt);
    const base = data.code.replace(/[^a-z0-9]+/gi, '-');
    const htmlPath = join(OUT_DIR, `${base}-summary.html`);
    const pdfPath = join(OUT_DIR, `${base}-summary.pdf`);
    await writeFile(htmlPath, html, 'utf8');
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    });
    console.log('Wrote', pdfPath);
  }

  await browser.close();
  console.log(`Done — ${summaries.length} PDFs in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
