#!/usr/bin/env node
/**
 * One-page U19 trial day sheet — Sat 18 July 2026, Big Manly Beach.
 * Usage: node scripts/generate-u19-trial-day-sheet-pdf.mjs
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import {
  ARRIVAL_TIME,
  BOAT_CJM1X,
  BOAT_CJM2X,
  BOAT_CJW1X,
  BOAT_CJW2X,
  BOAT_CJMix2X,
  BRIEFING_TIME,
  CONTINGENCY_DATE,
  DAY_SHEET_ROLES,
  INTERVAL_MIN,
  RACING_START,
  SELECTOR_DISCLAIMER,
  TRIAL_DATE,
  TRIAL_VENUE,
  U19_MEN,
  U19_WOMEN,
  buildDaySheetSchedule,
} from './lib/u19-trial-plan.mjs';
import { loadTrialAthletes, normalizeName } from './lib/beach-sprint-selection.mjs';

const TRIAL_CSV =
  process.env.BEACH_SPRINT_TRIAL_CSV ||
  'C:/Users/JohnSt/Desktop/RNZ/Beach Sprints/Dev Trial Info/AthleteStats (3).csv';
const OUT_DIR =
  process.env.BEACH_SPRINT_OUT_DIR ||
  'C:/Users/JohnSt/Desktop/RNZ/Beach Sprints/Dev Trial Info';
const BASE_NAME = '2026-U19-Beach-Sprint-Trial-Day-Sheet';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function enrichAthletes(list, byNorm) {
  return list.map((a) => {
    const hit = byNorm.get(normalizeName(a.name));
    return { ...a, club: hit?.club || a.club || '—' };
  });
}

function shortClub(club) {
  const c = String(club || '—');
  if (c.length <= 28) return c;
  return c.replace(/ Rowing Club/g, ' RC').slice(0, 28).trim() + '…';
}

function athleteList(athletes, label) {
  return `
  <div class="athlete-col">
    <h3>${esc(label)}</h3>
    <table class="athletes">
      <thead><tr><th class="num">#</th><th>Name</th><th>Club</th></tr></thead>
      <tbody>
        ${athletes
          .map(
            (a, i) =>
              `<tr><td class="num">${i + 1}</td><td><strong>${esc(a.name)}</strong></td><td class="club">${esc(shortClub(a.club))}</td></tr>`,
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
  const schedule = buildDaySheetSchedule();
  const total = women.length + men.length;
  const menCount = men.length;

  return `<!DOCTYPE html>
<html lang="en-NZ">
<head>
  <meta charset="utf-8" />
  <title>U19 Beach Sprint Trial — Day Sheet · 18 July 2026</title>
  <style>
    @page { size: A4 landscape; margin: 7mm 8mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #0f172a;
      font-size: 7.5pt;
      line-height: 1.25;
      margin: 0;
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
    td.club { color: #475569; font-size: 6.5pt; }
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
    .info-box p { margin: 0 0 3px; }
    .schedule th.time, .schedule td.time {
      width: 38px;
      text-align: center;
      font-weight: 700;
      white-space: nowrap;
    }
    .schedule th.activity { width: 150px; }
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
    footer {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 6px;
      margin-top: 4px;
      padding-top: 4px;
      border-top: 1px solid #e2e8f0;
      font-size: 6.8pt;
    }
    .roles table td:first-child { font-weight: 600; width: 88px; white-space: nowrap; }
    .footer-note { color: #64748b; font-size: 6.5pt; margin-top: 2px; }
    .disclaimer {
      border-top: 1px solid #e2e8f0;
      margin-top: 4px;
      padding-top: 4px;
      font-size: 6.5pt;
      color: #64748b;
    }
    .outputs {
      background: #f0fdf4;
      border-left: 3px solid #16a34a;
      padding: 4px 6px;
      border-radius: 0 4px 4px 0;
    }
    .outputs strong { color: #166534; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>U19 Beach Sprint Selection Trial — Day Sheet</h1>
      <p class="meta">${esc(TRIAL_DATE)} · ${esc(TRIAL_VENUE)} · Arrive ${esc(ARRIVAL_TIME)} · Briefing ${esc(BRIEFING_TIME)} · First race ${esc(RACING_START)} · ${INTERVAL_MIN}-min starts</p>
    </div>
    <div class="meta-grid">
      <span><span class="meta-label">Trialists</span><span class="meta-value">${total} U19</span></span>
      <span><span class="meta-label">Contingency</span><span class="meta-value">${esc(CONTINGENCY_DATE)}</span></span>
      <span><span class="meta-label">Finish</span><span class="meta-value">~13:20</span></span>
      <span><span class="meta-label">Generated</span><span class="meta-value">${esc(generatedAt)}</span></span>
    </div>
  </header>

  <div class="session-bar">
    <div class="session-pill"><strong>Session 1 · 08:30–10:20</strong>${BOAT_CJW1X} &amp; ${BOAT_CJM1X} — women&apos;s TT · men&apos;s TT · women&apos;s KO · men&apos;s KO</div>
    <div class="session-pill"><strong>Session 2 · 11:20–12:05</strong>${BOAT_CJMix2X} matrix — W1/M1 solo refs · W2/W3 × M2/M3 H2H</div>
    <div class="session-pill"><strong>Session 3 · 13:05–13:11</strong>Doubles speed trial — ${BOAT_CJMix2X} · W3+W4 · M3+M4</div>
  </div>

  <div class="top-grid">
    ${athleteList(women, "Women's U19")}
    ${athleteList(men, "Men's U19")}
    <div class="info-box">
      <h3>On-the-day reminders</h3>
      <ul>
        <li>Publish <strong>W1–W6 / M1–M${menCount}</strong> board before Session 2</li>
        <li>Wx / Mx labels = Session 1 rank (fastest = 1)</li>
        <li>After Session 1: <strong>lower ranked solo eliminated</strong> (W5, W6 &amp; M5)</li>
        <li>M4 not eliminated from solo · W4/M4 for Session 3 doubles</li>
        <li>Compulsory pre-selection camp: 4–5 Jul, Orewa</li>
        <li>Weather contingency: ${esc(CONTINGENCY_DATE)}</li>
      </ul>
      <p><strong>Session 2:</strong> W1/M1 solo refs only — mix H2H among W2/W3 × M2/M3 (ranks 1–3 per gender).</p>
      <p><strong>Session 3:</strong> Processional doubles TT — ${BOAT_CJMix2X}, W3+W4, M3+M4 (@ ${INTERVAL_MIN} min).</p>
    </div>
  </div>

  ${scheduleTable(schedule)}

  <footer>
    <div class="roles">
      <table>
        <tbody>
          ${DAY_SHEET_ROLES.map((r) => `<tr><td>${esc(r.role)}</td><td>${esc(r.who)}</td></tr>`).join('')}
        </tbody>
      </table>
      <p class="footer-note">Athletes: self-funded transport, food, accommodation. Adjust times ±15 min for conditions.</p>
    </div>
    <div class="outputs">
      <strong>Selection outputs</strong><br>
      ${BOAT_CJW1X} &amp; ${BOAT_CJM1X} — Session 1 knockout · ${BOAT_CJMix2X} — Session 2 matrix · ${BOAT_CJW2X} &amp; ${BOAT_CJM2X} — Session 3 doubles speed trial (if fast enough)<br>
      <span class="footer-note">Full format in trial plan document.</span>
    </div>
  </footer>
  <div class="disclaimer">
    <strong>Recommended format only.</strong> ${esc(SELECTOR_DISCLAIMER)}
  </div>
</body>
</html>`;
}

async function main() {
  const athletes = await loadTrialAthletes(TRIAL_CSV);
  const byNorm = new Map(athletes.map((a) => [normalizeName(a.fullName), a]));
  const women = enrichAthletes(U19_WOMEN, byNorm);
  const men = enrichAthletes(U19_MEN, byNorm);

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
  await page.setContent(html, { waitUntil: 'networkidle' });
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
