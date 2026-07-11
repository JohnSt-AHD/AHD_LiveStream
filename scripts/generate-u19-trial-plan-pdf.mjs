#!/usr/bin/env node
/**
 * Draft U19 trial plan — Sat 18 July 2026, Big Manly Beach.
 * Usage: node scripts/generate-u19-trial-plan-pdf.mjs
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  ARRIVAL_TIME,
  BOAT_CJM1X,
  BOAT_CJM2X,
  BOAT_CJW1X,
  BOAT_CJW2X,
  BOAT_CJMix2X,
  BOAT_CLASSES,
  BRIEFING_TIME,
  CONTINGENCY_DATE,
  INTERVAL_MIN,
  LOGIC_REVIEW,
  MIX2X_MATRIX_RUNS,
  RACING_START,
  SELECTOR_DISCLAIMER,
  SESSION2_FIXED,
  SESSION3_DOUBLES_TT,
  TRIAL_DATE,
  TRIAL_VENUE,
  U19_MEN,
  U19_WOMEN,
  buildSchedule,
} from './lib/u19-trial-plan.mjs';
import { loadTrialAthletes, normalizeName } from './lib/beach-sprint-selection.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRIAL_CSV =
  process.env.BEACH_SPRINT_TRIAL_CSV ||
  'C:/Users/JohnSt/Desktop/RNZ/Beach Sprints/Dev Trial Info/AthleteStats (3).csv';
const OUT_DIR =
  process.env.BEACH_SPRINT_OUT_DIR ||
  'C:/Users/JohnSt/Desktop/RNZ/Beach Sprints/Dev Trial Info';
const BASE_NAME = '2026-U19-Beach-Sprint-Trial-Plan-Draft';

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

function athleteTable(athletes, label) {
  return `
  <h3>${esc(label)}</h3>
  <table>
    <thead><tr><th class="num">#</th><th>Athlete</th><th>Club</th></tr></thead>
    <tbody>
      ${athletes
        .map(
          (a, i) =>
            `<tr><td class="num">${i + 1}</td><td><strong>${esc(a.name)}</strong></td><td>${esc(a.club)}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>`;
}

function doublesSpeedTrialTable() {
  const rows = SESSION3_DOUBLES_TT.map(
    (r) => `<tr>
      <td class="num">${r.order}</td>
      <td><strong>${esc(r.crew)}</strong></td>
      <td>${esc(r.label)}</td>
    </tr>`,
  );
  return `
  <table>
    <thead>
      <tr>
        <th class="num">Start</th>
        <th>Crew</th>
        <th>Purpose</th>
      </tr>
    </thead>
    <tbody>${rows.join('')}</tbody>
  </table>
  <p class="small">Processional time trial — one start every ${INTERVAL_MIN} min. Selectors compare doubles times to assess ${BOAT_CJW2X} and ${BOAT_CJM2X} viability alongside confirmed ${BOAT_CJMix2X}.</p>`;
}

function knockoutTree(prefix, title) {
  const slot = (n) => `${prefix}${n}`;
  const playInId = `${prefix}P`;
  const sfId = `${prefix}SF`;
  const finalId = `${prefix}F`;
  const boat = prefix === 'W' ? BOAT_CJW1X : BOAT_CJM1X;
  const bronzeId = `${prefix}B`;
  return `
  <div class="bracket-wrap">
    <h4>${esc(title)} — knockout tree (seeds from time trial)</h4>
    <div class="bracket bracket-6">
      <div class="bracket-round round-labels">
        <span>Play-in</span>
        <span>Semi-finals</span>
        <span>Final</span>
        <span class="outcome">Outcome</span>
      </div>
      <div class="bracket-body bracket-body-6">
        <div class="bracket-col col-playin">
          <div class="match">
            <div class="seed">3</div><div class="slot">${slot(3)}</div>
            <div class="vs">vs</div>
            <div class="seed">6</div><div class="slot">${slot(6)}</div>
            <div class="match-id">${playInId}1</div>
          </div>
          <div class="match">
            <div class="seed">4</div><div class="slot">${slot(4)}</div>
            <div class="vs">vs</div>
            <div class="seed">5</div><div class="slot">${slot(5)}</div>
            <div class="match-id">${playInId}2</div>
          </div>
        </div>
        <div class="bracket-col col-semi">
          <div class="match">
            <div class="seed bye">1</div><div class="slot">${slot(1)}</div>
            <div class="vs">vs</div>
            <div class="slot">${playInId}1 winner</div>
            <div class="match-id">${sfId}1</div>
          </div>
          <div class="match">
            <div class="seed bye">2</div><div class="slot">${slot(2)}</div>
            <div class="vs">vs</div>
            <div class="slot">${playInId}2 winner</div>
            <div class="match-id">${sfId}2</div>
          </div>
        </div>
        <div class="bracket-col col-final">
          <div class="match match-final">
            <div class="slot">${sfId}1 winner</div>
            <div class="vs">vs</div>
            <div class="slot">${sfId}2 winner</div>
            <div class="match-id">${finalId}</div>
          </div>
        </div>
        <div class="bracket-col col-outcome">
          <div class="outcome-box gold">${boat} — gold</div>
          <div class="outcome-box optional">Bronze: ${sfId}1 loser vs ${sfId}2 loser (${bronzeId}, optional)</div>
        </div>
      </div>
    </div>
    <p class="small">${slot(1)} and ${slot(2)} receive byes to the semi-finals. Play-in winners feed into ${sfId}1 and ${sfId}2 respectively.</p>
  </div>`;
}

function knockoutTreeFive(prefix, title) {
  const slot = (n) => `${prefix}${n}`;
  const playInId = `${prefix}P`;
  const sfId = `${prefix}SF`;
  const finalId = `${prefix}F`;
  const boat = prefix === 'W' ? BOAT_CJW1X : BOAT_CJM1X;
  const bronzeId = `${prefix}B`;
  return `
  <div class="bracket-wrap">
    <h4>${esc(title)} — knockout tree (seeds from time trial)</h4>
    <div class="bracket bracket-6">
      <div class="bracket-round round-labels">
        <span>Play-in</span>
        <span>Semi-finals</span>
        <span>Final</span>
        <span class="outcome">Outcome</span>
      </div>
      <div class="bracket-body bracket-body-6">
        <div class="bracket-col col-playin">
          <div class="match">
            <div class="seed">4</div><div class="slot">${slot(4)}</div>
            <div class="vs">vs</div>
            <div class="seed">5</div><div class="slot">${slot(5)}</div>
            <div class="match-id">${playInId}1</div>
          </div>
        </div>
        <div class="bracket-col col-semi">
          <div class="match">
            <div class="seed bye">1</div><div class="slot">${slot(1)}</div>
            <div class="vs">vs</div>
            <div class="seed">3</div><div class="slot">${slot(3)}</div>
            <div class="match-id">${sfId}1</div>
          </div>
          <div class="match">
            <div class="seed bye">2</div><div class="slot">${slot(2)}</div>
            <div class="vs">vs</div>
            <div class="slot">${playInId}1 winner</div>
            <div class="match-id">${sfId}2</div>
          </div>
        </div>
        <div class="bracket-col col-final">
          <div class="match match-final">
            <div class="slot">${sfId}1 winner</div>
            <div class="vs">vs</div>
            <div class="slot">${sfId}2 winner</div>
            <div class="match-id">${finalId}</div>
          </div>
        </div>
        <div class="bracket-col col-outcome">
          <div class="outcome-box gold">${boat} — gold</div>
          <div class="outcome-box optional">Bronze: ${sfId}1 loser vs ${sfId}2 loser (${bronzeId}, optional)</div>
        </div>
      </div>
    </div>
    <p class="small">${slot(1)} and ${slot(2)} receive byes from the play-in. ${slot(3)} meets ${slot(1)} in ${sfId}1; play-in winner meets ${slot(2)} in ${sfId}2.</p>
  </div>`;
}

function mixMatrixTable() {
  const rows = MIX2X_MATRIX_RUNS.map((r) => {
    const h2h = r.h2h.map((h) => `${h.crew} vs ${h.vs}`).join('; ');
    return `<tr>
      <td class="num">${r.run}</td>
      <td class="fixed-col">${esc(SESSION2_FIXED.w1Single)}<br>${esc(SESSION2_FIXED.m1Single)}</td>
      <td>${esc(h2h)}</td>
    </tr>`;
  });
  return `
  <table>
    <thead>
      <tr>
        <th class="num">Run</th>
        <th>Fixed references <span class="muted">(solo only)</span></th>
        <th>Mix2x head-to-head <span class="muted">(${BOAT_CJMix2X} selection · W2/W3 × M2/M3)</span></th>
      </tr>
    </thead>
    <tbody>${rows.join('')}</tbody>
  </table>
  <p class="small">Ranks 1–3 per gender only. W1 and M1 solo repeat every run as fixed references; W2/W3 and M2/M3 race the mix H2H. All pieces @ ${INTERVAL_MIN} min processional intervals within each run. Wx/Mx = Session 1 TT rank.</p>`;
}

function scheduleTable(rows) {
  return `
  <table>
    <thead><tr><th style="width:52px">Time</th><th style="width:120px">Block</th><th>Detail</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r) =>
            `<tr><td>${esc(r.time)}</td><td><strong>${esc(r.block)}</strong></td><td>${esc(r.detail)}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>`;
}

function logicReviewSection() {
  return LOGIC_REVIEW.map((item) => {
    const cls = item.ok ? 'logic-ok' : 'logic-warn';
    const tag = item.ok ? '✓' : '⚠';
    return `<div class="logic-item ${cls}"><strong>${tag} ${esc(item.title)}</strong><p>${esc(item.text)}</p></div>`;
  }).join('');
}

function buildHtml({ women, men, generatedAt }) {
  const schedule = buildSchedule();

  return `<!DOCTYPE html>
<html lang="en-NZ">
<head>
  <meta charset="utf-8" />
  <title>DRAFT — U19 Beach Sprint Selection Trial Plan · 18 July 2026</title>
  <style>
    @page { size: A4; margin: 10mm 10mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; font-size: 9pt; line-height: 1.35; margin: 0; }
    .draft-banner { background: #92400e; color: #fff; text-align: center; font-weight: 800; letter-spacing: 0.12em; padding: 5px 8px; font-size: 9pt; }
    header { border-bottom: 2px solid #0e7490; padding: 6px 0; margin-bottom: 6px; }
    h1 { font-size: 15pt; margin: 0; color: #0e7490; }
    .sub { color: #64748b; margin-top: 2px; font-size: 8.5pt; }
    h2 { font-size: 10.5pt; color: #0e7490; margin: 8px 0 4px; border-bottom: 1px solid #ccfbf1; padding-bottom: 2px; }
    h2:first-of-type { margin-top: 4px; }
    h3 { font-size: 9.5pt; margin: 6px 0 3px; color: #0f766e; }
    p { margin: 0 0 4px; }
    ul, ol { margin: 0 0 4px; padding-left: 16px; }
    li { margin-bottom: 1px; }
    table { width: 100%; border-collapse: collapse; margin: 3px 0 5px; font-size: 8pt; }
    th, td { border: 1px solid #cbd5e1; padding: 2px 5px; vertical-align: top; }
    th { background: #ecfeff; text-align: left; }
    th.num, td.num { text-align: center; width: 32px; }
    .muted { color: #64748b; font-size: 7.5pt; }
    .small { font-size: 7.5pt; color: #475569; margin: 2px 0 0; }
    .note { background: #f0fdf4; border-left: 3px solid #16a34a; padding: 4px 8px; margin: 4px 0; font-size: 8pt; }
    .warn-box { background: #fffbeb; border-left: 3px solid #d97706; padding: 4px 8px; margin: 4px 0; font-size: 8pt; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 0 0 6px; }
    .stat { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 4px; padding: 4px 4px; text-align: center; }
    .stat-label { display: block; font-size: 6.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
    .stat-value { display: block; font-size: 10pt; font-weight: 700; color: #0e7490; margin-top: 1px; line-height: 1.2; }
    .logic-item { border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 8px; margin: 0 0 3px; break-inside: avoid; }
    .logic-item p { margin: 2px 0 0; font-size: 8pt; }
    .logic-ok { border-left: 3px solid #16a34a; background: #f0fdf4; }
    .logic-warn { border-left: 3px solid #d97706; background: #fffbeb; }
    .disclaimer { font-size: 7pt; color: #64748b; margin-top: 6px; border-top: 1px solid #e2e8f0; padding-top: 4px; }
    .fixed-col { background: #f0fdfa; font-size: 7.5pt; line-height: 1.3; }
    .bracket-wrap { margin: 3px 0 5px; break-inside: avoid; }
    .bracket-wrap h4 { margin: 0 0 3px; font-size: 8.5pt; color: #0f766e; }
    .bracket-round.round-labels { display: grid; grid-template-columns: 1fr 0.85fr 0.75fr; gap: 4px; font-size: 6.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
    .bracket-6 .bracket-round.round-labels { grid-template-columns: 0.9fr 1fr 0.75fr 0.75fr; }
    .bracket-body { display: grid; grid-template-columns: 1fr 0.85fr 0.75fr; gap: 4px; align-items: center; }
    .bracket-body-6 { grid-template-columns: 0.9fr 1fr 0.75fr 0.75fr; }
    .bracket-col { display: flex; flex-direction: column; gap: 4px; }
    .match { border: 1px solid #94a3b8; border-radius: 4px; padding: 4px 6px; background: #fff; position: relative; font-size: 7.5pt; }
    .match-final { border-color: #0e7490; background: #ecfeff; }
    .match .seed { display: inline-block; width: 14px; height: 14px; line-height: 14px; text-align: center; border-radius: 999px; background: #e2e8f0; font-size: 6.5pt; font-weight: 700; margin-right: 3px; }
    .match .seed.bye { background: #99f6e4; color: #0f766e; }
    .match .slot { display: inline-block; min-width: 64px; font-weight: 600; }
    .match .vs { text-align: center; color: #64748b; font-size: 6.5pt; margin: 1px 0; }
    .match-id { position: absolute; top: 2px; right: 4px; font-size: 6pt; color: #94a3b8; font-weight: 700; }
    .outcome-box { border-radius: 4px; padding: 4px 6px; font-size: 7.5pt; font-weight: 700; text-align: center; }
    .outcome-box.gold { background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; }
    .outcome-box.optional { background: #f8fafc; border: 1px dashed #cbd5e1; color: #64748b; font-weight: 500; font-size: 6.5pt; margin-top: 4px; }
    .trialists-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .trialists-grid h3 { margin-top: 0; }
  </style>
</head>
<body>
  <div class="draft-banner">DRAFT — FOR SELECTOR REVIEW</div>

  <header>
    <h1>U19 Beach Sprint Selection Trial Plan</h1>
    <p class="sub">${esc(TRIAL_DATE)} · ${esc(TRIAL_VENUE)} · Draft generated ${esc(generatedAt)}</p>
  </header>

  <div class="summary-grid">
    <div class="stat"><span class="stat-label">Date</span><span class="stat-value">18 Jul</span></div>
    <div class="stat"><span class="stat-label">Contingency</span><span class="stat-value">19 Jul</span></div>
    <div class="stat"><span class="stat-label">Trialists</span><span class="stat-value">${women.length + men.length} U19</span></div>
    <div class="stat"><span class="stat-label">Boat classes</span><span class="stat-value">${esc(BOAT_CLASSES)}</span></div>
  </div>

  <h2>Context</h2>
  <p>
    This draft trial plan supports selection of U19 beach sprint crews for the 2026 World Rowing Beach Sprint Finals
    (Qingdao, 18–21 October). It aligns with <em>Planning Doc V1.4</em>: self-funded trial at ${esc(TRIAL_VENUE)}, selection panel
    on the ground with online selectors, David Vallance and volunteers supporting logistics.
  </p>
  <p>
    Trialists are the proposed U19 invites from the development trial recommendations (${women.length} women, ${men.length} men).
    All trialists are expected to have attended the compulsory pre-selection camp (4–5 July, Orewa).
  </p>

  <h2>Trialists</h2>
  <div class="trialists-grid">
    ${athleteTable(women, 'Women’s U19')}
    ${athleteTable(men, 'Men’s U19')}
  </div>
  <h2>Format overview</h2>
  <p>Arrive <strong>${esc(ARRIVAL_TIME)}</strong> to help set up boats; briefing <strong>${esc(BRIEFING_TIME)}</strong>; first race <strong>${esc(RACING_START)}</strong>. Three sessions with <strong>~1 hour rest</strong> between each. All time trials use a <strong>${INTERVAL_MIN}-minute processional interval</strong>. <strong>Six women</strong> and <strong>${men.length} men</strong> (K. Goonan withdrawn).</p>
  <ol>
    <li><strong>Session 1:</strong> women&apos;s time trial, men&apos;s time trial, women&apos;s knockout, men&apos;s knockout (${BOAT_CJW1X} &amp; ${BOAT_CJM1X}); lower ranked solo eliminated after knockouts.</li>
    <li><strong>Session 2:</strong> ${BOAT_CJMix2X} — two matrix runs (W1/M1 solo refs; W2/W3 × M2/M3 mix H2H only).</li>
    <li><strong>Session 3:</strong> Doubles speed trial — ${BOAT_CJMix2X}, then W3+W4, then M3+M4 (@ ${INTERVAL_MIN} min).</li>
  </ol>

  <div class="note">
    <strong>Outputs:</strong> ${BOAT_CJW1X} and ${BOAT_CJM1X} from Session 1 knockout · ${BOAT_CJMix2X} from Session 2 matrix · ${BOAT_CJW2X} and ${BOAT_CJM2X} confirmed from Session 3 doubles speed trial (if fast enough).
  </div>

  <h2>Session 1 — Solo (${BOAT_CJW1X} &amp; ${BOAT_CJM1X})</h2>
  <p><strong>Running order on the day:</strong> women&apos;s time trial → men&apos;s time trial → women&apos;s knockout → men&apos;s knockout.</p>
  <h3>1a. Processional time trial</h3>
  <ul>
    <li><strong>Women first:</strong> ${women.length} starts @ ${INTERVAL_MIN} min → ranks W1–W${women.length} (fastest = W1).</li>
    <li><strong>Men:</strong> ${men.length} starts @ ${INTERVAL_MIN} min → ranks M1–M${men.length} (fastest = M1).</li>
    <li>Ties broken by selectors using CNZB/CNIB or erg data if necessary.</li>
  </ul>

  <h3>1b. Knockout finals</h3>
  <p class="small">Women: seeds 1–6 — play-in 3v6 and 4v5; seeds 1 and 2 receive byes to the semi-finals. Men: seeds 1–5 — play-in 4v5; M1 v M3 and M2 v play-in winner in the semi-finals.</p>
  ${knockoutTree('W', "Women's solo")}
  ${knockoutTreeFive('M', "Men's solo")}
  <p class="small">Knockout champions confirm ${BOAT_CJW1X} and ${BOAT_CJM1X} selections unless selectors invoke exceptional circumstances.</p>

  <div class="warn-box">
    <strong>Lower ranked solo eliminated:</strong> After Session 1, W5, W6 and M5 do not continue. M4 is not eliminated from solo. W4 and M4 remain eligible for Session 3 doubles (W3+W4 and M3+M4 speed trial); only W1–W3 and M1–M3 race Session 2. TT ranks (Wx/Mx) carry forward to later sessions.
  </div>
  <h2>Session 2 — Mixed double (${BOAT_CJMix2X})</h2>
  <p>
    <strong>Ranks 1–3 per gender only.</strong> Each run opens with <strong>W1 and M1 solo</strong> as fixed references, then one head-to-head mix double (${BOAT_CJMix2X} selection) among <strong>W2, W3, M2 and M3</strong>.
    Run 1: aligned pairings (M2+W2 vs M3+W3). Run 2: cross-swap (M2+W3 vs M3+W2). No benchmark or additional mix doubles.
  </p>
  ${mixMatrixTable()}
  <div class="warn-box">
    <strong>Selector note:</strong> Select ${BOAT_CJMix2X} from the two H2H mix races (wins and times vs the fixed W1/M1 solo references). W4 and M4 do not race in Session 2.
  </div>
  <h2>Session 3 — Doubles speed trial</h2>
  <p>
    One processional block @ <strong>${INTERVAL_MIN} min</strong> between starts. Selected <strong>${BOAT_CJMix2X}</strong> races first, then <strong>W3+W4</strong> and <strong>M3+M4</strong> time trials to assess whether the women&apos;s and men&apos;s doubles are fast enough for selection.
  </p>
  ${doublesSpeedTrialTable()}
  <div class="note">
    <strong>Selector note:</strong> Compare doubles times across the three starts. ${BOAT_CJW2X} and ${BOAT_CJM2X} are confirmed only if selectors judge the pairing fast enough; otherwise crews may be reconsidered or not nominated.
  </div>
  <h2>Indicative schedule</h2>
  <p class="muted">Weather contingency: ${esc(CONTINGENCY_DATE)}. Adjust start times ±15 min for conditions.</p>
  ${scheduleTable(schedule)}
  <h2>Logic review</h2>
  <p class="muted">Independent check of the proposed process against athlete numbers and selection intent.</p>
  ${logicReviewSection()}
  <h2>Roles &amp; logistics (from Planning V1.4)</h2>
  <ul>
    <li><strong>Selection panel:</strong> John (on site); Justin &amp; Megan (online).</li>
    <li><strong>Trial manager:</strong> Mike — logistics, communications, results capture.</li>
    <li><strong>Support:</strong> David Vallance, volunteers; Gary, Joe, Mike as available.</li>
    <li><strong>Athletes:</strong> Self-funded transport, food, accommodation; arrive by ${esc(ARRIVAL_TIME)}.</li>
  </ul>

  <div class="disclaimer">
    <strong>Recommended format only.</strong> ${esc(SELECTOR_DISCLAIMER)}
    Based on Planning Doc V1.4 and U19 trial invites from the 2026 Beach Sprint Development Trial Recommendations.
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
    printBackground: true,
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
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
