#!/usr/bin/env node
/**
 * Athlete run sheet — U19 beach sprint trial (no seat swap / progression detail).
 * Usage: node scripts/generate-u19-trial-athlete-run-sheet-pdf.mjs
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import {
  ARRIVAL_TIME,
  ATHLETE_RUN_SHEET_REMINDERS,
  BOAT_CJM1X,
  BOAT_CJM2X,
  BOAT_CJW1X,
  BOAT_CJW2X,
  BOAT_CJMix2X,
  BRIEFING_TIME,
  CONTINGENCY_DATE,
  INTERVAL_MIN,
  RACING_START,
  TRIAL_DATE,
  TRIAL_LOCATION_NAME,
  TRIAL_MAPS_EMBED_URL,
  TRIAL_MAPS_URL,
  TRIAL_VENUE,
  U19_MEN,
  U19_WOMEN,
  buildAthleteRunSheetSchedule,
} from './lib/u19-trial-plan.mjs';

const OUT_DIR =
  process.env.BEACH_SPRINT_OUT_DIR ||
  'C:/Users/JohnSt/Desktop/RNZ/Beach Sprints/Dev Trial Info';
const BASE_NAME = '2026-U19-Beach-Sprint-Trial-Athlete-Run-Sheet';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function athleteList(athletes, label) {
  return `
  <div class="athlete-col">
    <h3>${esc(label)}</h3>
    <table class="athletes">
      <thead><tr><th class="num">#</th><th>Name</th></tr></thead>
      <tbody>
        ${athletes
          .map(
            (a, i) =>
              `<tr><td class="num">${i + 1}</td><td><strong>${esc(a.name)}</strong></td></tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </div>`;
}

function scheduleTable(rows) {
  return `
  <table class="schedule">
    <thead>
      <tr>
        <th class="time">Time</th>
        <th class="activity">Activity</th>
        <th class="note">Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map((r) => {
          const breakRow = /break/i.test(r.activity);
          const cls = breakRow ? ' class="break-row"' : '';
          return `<tr${cls}><td class="time">${esc(r.time)}</td><td><strong>${esc(r.activity)}</strong></td><td>${esc(r.note)}</td></tr>`;
        })
        .join('')}
    </tbody>
  </table>`;
}

function buildHtml({ women, men, generatedAt }) {
  const schedule = buildAthleteRunSheetSchedule();
  const total = women.length + men.length;

  return `<!DOCTYPE html>
<html lang="en-NZ">
<head>
  <meta charset="utf-8" />
  <title>U19 Beach Sprint Trial — Athlete Run Sheet · 18 July 2026</title>
  <style>
    @page { size: A4 landscape; margin: 7mm 8mm; }
    * { box-sizing: border-box; }
    html, body {
      height: 196mm;
      width: 100%;
    }
    body {
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #0f172a;
      font-size: 7.5pt;
      line-height: 1.25;
      margin: 0;
      display: flex;
      flex-direction: column;
    }
    .sheet-top {
      flex: 0 0 auto;
    }
    header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: end;
      border-bottom: 2px solid #0e7490;
      padding-bottom: 4px;
      margin-bottom: 5px;
    }
    h1 {
      font-size: 14pt;
      margin: 0;
      color: #0e7490;
      letter-spacing: -0.01em;
    }
    .meta { color: #64748b; font-size: 7pt; margin-top: 1px; }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, auto);
      gap: 3px 10px;
      font-size: 7pt;
      text-align: right;
    }
    .meta-grid span { display: block; }
    .meta-label {
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 6pt;
    }
    .meta-value { font-weight: 700; color: #0e7490; }
    .top-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 0.95fr;
      gap: 6px;
      margin-bottom: 5px;
    }
    h3 {
      font-size: 8pt;
      margin: 0 0 2px;
      color: #0f766e;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7pt;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 1px 4px;
      vertical-align: top;
    }
    th { background: #ecfeff; text-align: left; font-weight: 600; }
    th.num, td.num { width: 16px; text-align: center; padding: 1px 2px; }
    .athlete-col { min-width: 0; }
    .info-box {
      border: 1px solid #99f6e4;
      background: #f0fdfa;
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 6.8pt;
    }
    .info-box h3 { margin-bottom: 3px; }
    .info-box ul {
      margin: 0;
      padding-left: 14px;
    }
    .info-box li { margin-bottom: 1px; }
    .map-section {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
      margin-top: 4px;
    }
    .map-box {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
      border: 1px solid #99f6e4;
      background: #fff;
      border-radius: 4px;
      overflow: hidden;
    }
    .map-box h3 {
      flex: 0 0 auto;
      margin: 0;
      padding: 3px 6px;
      background: #ecfeff;
      border-bottom: 1px solid #99f6e4;
      font-size: 7pt;
    }
    .map-frame-wrap {
      flex: 1 1 auto;
      min-height: 0;
      position: relative;
    }
    .map-box iframe {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: 0;
    }
    .map-caption {
      flex: 0 0 auto;
      padding: 2px 6px 3px;
      font-size: 6.5pt;
      color: #475569;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }
    .map-caption a { color: #0e7490; text-decoration: none; font-weight: 600; }
    .schedule th.time, .schedule td.time {
      width: 38px;
      text-align: center;
      font-weight: 700;
      white-space: nowrap;
    }
    .schedule th.activity { width: 170px; }
    .schedule tr.break-row td { background: #fffbeb; }
    .session-bar {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      margin-bottom: 4px;
    }
    .session-pill {
      background: #ecfeff;
      border: 1px solid #99f6e4;
      border-radius: 4px;
      padding: 3px 5px;
      font-size: 6.8pt;
    }
    .session-pill strong { display: block; color: #0e7490; font-size: 7pt; }
    .schedule-wrap { margin-bottom: 0; }
    .schedule-guide-note {
      margin: 0 0 3px;
      padding: 4px 8px;
      background: #fffbeb;
      border: 1px solid #f59e0b;
      border-left: 4px solid #d97706;
      border-radius: 4px;
      font-size: 7pt;
      font-weight: 700;
      color: #92400e;
    }
  </style>
</head>
<body>
  <div class="sheet-top">
  <header>
    <div>
      <h1>U19 Beach Sprint Selection Trial — Athlete Run Sheet</h1>
      <p class="meta">${esc(TRIAL_DATE)} · ${esc(TRIAL_VENUE)} · Arrive ${esc(ARRIVAL_TIME)} · Briefing ${esc(BRIEFING_TIME)} · First race ${esc(RACING_START)}</p>
    </div>
    <div class="meta-grid">
      <span><span class="meta-label">Trialists</span><span class="meta-value">${total} U19</span></span>
      <span><span class="meta-label">Contingency</span><span class="meta-value">${esc(CONTINGENCY_DATE)}</span></span>
      <span><span class="meta-label">Finish</span><span class="meta-value">~13:20</span></span>
      <span><span class="meta-label">Generated</span><span class="meta-value">${esc(generatedAt)}</span></span>
    </div>
  </header>

  <div class="session-bar">
    <div class="session-pill"><strong>Session 1 · 08:30–10:20</strong>Women&apos;s solo · Men&apos;s solo (${BOAT_CJW1X} &amp; ${BOAT_CJM1X})</div>
    <div class="session-pill"><strong>Session 2 · 11:20–12:05</strong>${BOAT_CJMix2X}</div>
    <div class="session-pill"><strong>Session 3 · 13:05–13:11</strong>Doubles speed trial (${BOAT_CJW2X} · ${BOAT_CJM2X})</div>
  </div>

  <div class="top-grid">
    ${athleteList(women, "Women's U19")}
    ${athleteList(men, "Men's U19")}
    <div class="info-box">
      <h3>What you need to know</h3>
      <ul>
        ${ATHLETE_RUN_SHEET_REMINDERS.map((item) => `<li>${esc(item)}</li>`).join('')}
      </ul>
      <p style="margin-top:4px">Three racing sessions with about an hour between each. Time trials use a <strong>${INTERVAL_MIN}-minute</strong> interval between starts. Times may shift ±15 minutes for weather or conditions.</p>
    </div>
  </div>

  <div class="schedule-wrap">
    <p class="schedule-guide-note">This timetable is a guide only — exact times and racing order may change on the day.</p>
    ${scheduleTable(schedule)}
  </div>
  </div>

  <div class="map-section">
    <div class="map-box">
      <h3>Trial location — satellite view</h3>
      <div class="map-frame-wrap">
        <iframe
          title="Trial location map"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          src="${esc(TRIAL_MAPS_EMBED_URL)}"
        ></iframe>
      </div>
      <p class="map-caption">
        ${esc(TRIAL_LOCATION_NAME)}, ${esc(TRIAL_VENUE)} ·
        <a href="${esc(TRIAL_MAPS_URL)}">Open in Google Maps</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  const women = U19_WOMEN;
  const men = U19_MEN;

  const generatedAt = new Date().toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const html = buildHtml({ women, men, generatedAt });
  const htmlPath = join(OUT_DIR, `${BASE_NAME}.html`);
  const pdfPath = join(OUT_DIR, `${BASE_NAME}.pdf`);

  await writeFile(htmlPath, html, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1123, height: 794 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForSelector('.map-box iframe', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    landscape: true,
    printBackground: true,
    margin: { top: '7mm', right: '8mm', bottom: '7mm', left: '8mm' },
  });
  await browser.close();

  console.log('Wrote:');
  console.log(' ', pdfPath);
  console.log(' ', htmlPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
