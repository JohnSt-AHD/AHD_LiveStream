#!/usr/bin/env node
/**
 * 2026 NZ Beach Sprint Development Squad — trial recommendation PDF.
 * Usage: node scripts/generate-beach-sprint-selection-pdf.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  applyGroupRecommendationCap,
  appendixRecommendation,
  assessAthlete,
  assessCoxswainRegattaScore,
  buildC1XNationalsTables,
  buildCoxswainNominees,
  coxRegattaFromResults,
  decisionSummaryForAthlete,
  getRecommendationGroup,
  isCoxPrimaryNominee,
  isCoxswainNominee,
  loadCnibAthleteDirectory,
  loadNationalsIndex,
  loadTrialAthletes,
  nationalsForAthlete,
  northIslandForAthlete,
  rowerAnalysisNominees,
  TRIAL_LIST_BY_GROUP,
  formatNationalsEventLabel,
} from './lib/beach-sprint-selection.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TRIAL_CSV =
  process.env.BEACH_SPRINT_TRIAL_CSV ||
  'C:/Users/JohnSt/Desktop/RNZ/Beach Sprints/Dev Trial Info/AthleteStats (3).csv';
const CNZB_DIR =
  process.env.BEACH_SPRINT_CNZB_DIR ||
  'C:/Users/JohnSt/Desktop/RNZ/Beach Sprints/Dev Trial Info';
const OUT_DIR =
  process.env.BEACH_SPRINT_OUT_DIR ||
  'C:/Users/JohnSt/Desktop/RNZ/Beach Sprints/Dev Trial Info';
const PDF_NAME = '2026-Beach-Sprint-Development-Trial-Recommendations.pdf';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function badge(text, tone = 'neutral') {
  const colors = {
    strong: '#065f46',
    invite: '#0e7490',
    reserve: '#92400e',
    no: '#991b1b',
    neutral: '#475569',
  };
  return `<span class="badge" style="background:${colors[tone] || colors.neutral}">${esc(text)}</span>`;
}

function recTone(rec) {
  if (rec === 'Strong trial invite') return 'strong';
  if (rec === 'Trial invite') return 'invite';
  if (rec === 'Camp reserve / late invite') return 'reserve';
  if (rec === 'Flat-water crossover — GM/coach approval required') return 'reserve';
  return 'no';
}

function c1xRowClass(row) {
  if (!row.nominated) return '';
  if (row.recommendation === 'Strong trial invite') return 'nominee-row-strong';
  if (row.recommendation === 'Trial invite' || row.recommendation === 'Flat-water crossover — GM/coach approval required') {
    return 'nominee-row';
  }
  return 'nominee-row';
}

function categoryRowClass(a) {
  const rec = appendixRecommendation(a);
  if (rec === 'Strong trial invite') return 'trial-row trial-row-strong';
  if (rec === 'Trial invite') return 'trial-row trial-row-invite';
  if (rec === 'Flat-water crossover — GM/coach approval required') return 'trial-row trial-row-crossover';
  return '';
}

function categoryRow(a, i) {
  const rec = appendixRecommendation(a);
  const cls = categoryRowClass(a);
  return `<tr class="${cls}">
    <td class="num">${i + 1}</td>
    <td><strong>${esc(a.fullName)}</strong></td>
    <td class="num">${a.scoring.total.toFixed(1)}</td>
    <td>${esc(a.nationals.summary)}</td>
    <td>${esc(a.northIsland.summary)}</td>
    <td>${badge(rec, recTone(rec))}</td>
  </tr>`;
}

function groupRankingsSection(assessed) {
  const groups = [
    { key: 'Open', title: 'Open' },
    { key: 'U19 Men', title: 'U19 boys' },
    { key: 'U19 Women', title: 'U19 girls' },
  ];

  const tables = groups
    .map(({ key, title }) => {
      const members = assessed
        .filter((a) => getRecommendationGroup(a) === key && !isCoxPrimaryNominee(a))
        .sort((a, b) => b.scoring.total - a.scoring.total);
      if (!members.length) return '';
      return `
  <h3>${esc(title)}</h3>
  <table>
    <thead>
      <tr>
        <th class="num">Rank</th>
        <th>Athlete</th>
        <th class="num">Score</th>
        <th>CNZB 2026</th>
        <th>CNIB 2026</th>
        <th>Assessment</th>
      </tr>
    </thead>
    <tbody>${members.map(categoryRow).join('')}</tbody>
  </table>`;
    })
    .join('');

  return `
  <h3>Overall nomination ranking by group</h3>
  <p class="muted">Rower nominees ranked by composite score within Open, U19 boys, and U19 girls. Cox-primary nominees are ranked in the coxswain section below.</p>
  ${tables}`;
}

function coxAssessmentBadge(athlete, recommended) {
  if (recommended) return badge('Recommended cox', 'strong');
  const participated = athlete.coxNationals?.participated || athlete.coxNorthIsland?.participated;
  if (!participated) return badge('No C4X+ result', 'no');
  const total = athlete.coxScoring?.total ?? 0;
  if (total >= 40) return badge('Strong cox candidate', 'strong');
  if (total >= 15) return badge('Cox candidate', 'invite');
  return badge('Monitor', 'no');
}

function coxNomineeRow(a, i, recommended) {
  const cls = recommended ? 'trial-row trial-row-strong' : '';
  return `<tr class="${cls}">
    <td class="num">${i + 1}</td>
    <td><strong>${esc(a.fullName)}</strong></td>
    <td class="num">${(a.coxScoring?.total ?? 0).toFixed(1)}</td>
    <td>${esc(a.coxNationals?.summary || '—')}</td>
    <td>${esc(a.coxNorthIsland?.summary || '—')}</td>
    <td>${coxAssessmentBadge(a, recommended)}</td>
  </tr>`;
}

function coxswainSection(assessed) {
  const { males, females, recommendedMale, recommendedFemale } = buildCoxswainNominees(assessed);
  if (!males.length && !females.length) return '';

  const table = (title, list, recommended) => {
    if (!list.length) return '';
    return `
  <h4>${esc(title)}</h4>
  <table>
    <thead>
      <tr>
        <th class="num">Rank</th>
        <th>Athlete</th>
        <th class="num">Score</th>
        <th>CNZB 2026</th>
        <th>CNIB 2026</th>
        <th>Assessment</th>
      </tr>
    </thead>
    <tbody>${list.map((a, i) => coxNomineeRow(a, i, a === recommended)).join('')}</tbody>
  </table>`;
  };

  const recommendationNote =
    recommendedMale || recommendedFemale
      ? `<p class="note"><strong>Suggested coxswains (C4X+ score):</strong>${
          recommendedMale
            ? ` Top male — ${esc(recommendedMale.fullName)} (${(recommendedMale.coxScoring?.total ?? 0).toFixed(1)}).`
            : ''
        }${
          recommendedFemale
            ? ` Top female — ${esc(recommendedFemale.fullName)} (${(recommendedFemale.coxScoring?.total ?? 0).toFixed(1)}).`
            : ''
        } Excludes athletes already on the proposed rowing trial list.</p>`
      : '';

  return `
  <h3>Coxswain nominations</h3>
  <p class="muted">Coxswain nominees ranked by composite score using <strong>C4X+ cox results only</strong> (CNZB 55%, CNIB 25%). B/G U17/U18 and Mx U18 fours are excluded for dual-role nominees where the athlete was rowing. Erg and pathway data are not included.</p>
  ${recommendationNote}
  ${table('Male coxswain nominees', males, recommendedMale)}
  ${table('Female coxswain nominees', females, recommendedFemale)}`;
}

function c1xStandingsSection(tables, filterIds = null) {
  const list = filterIds ? tables.filter((t) => filterIds.includes(t.id)) : tables;
  const tableHtml = (t) => `
  <h3>${esc(t.title)}</h3>
  <table>
    <thead>
      <tr>
        <th class="num">Pl</th>
        <th>Athlete</th>
        <th>Time</th>
        <th>Result</th>
        <th>Development nominee?</th>
        <th>Composite score note</th>
      </tr>
    </thead>
    <tbody>
      ${t.standings.length ? t.standings.map((row) => `
      <tr class="${c1xRowClass(row)}">
        <td class="num">${row.rank}</td>
        <td><strong>${esc(row.name)}</strong>${row.nominated ? ` ${badge('Nominee', row.recommendation === 'Strong trial invite' ? 'strong' : 'invite')}` : ''}</td>
        <td>${esc(row.time || '—')}</td>
        <td>${esc(row.note)}</td>
        <td>${row.nominated ? esc(row.nomineeCategory) : '—'}</td>
        <td>${row.nominated ? badge(row.recommendation, recTone(row.recommendation)) : '—'}</td>
      </tr>`).join('') : '<tr><td colspan="6">No standings available</td></tr>'}
    </tbody>
  </table>`;

  return `
  <h3>CNZB 2026 C1X — Nationals top 8 vs development nominees</h3>
  <p class="muted">
    Overall top-eight placings derived from CNZB 2026 knockout progression (A final, then semi-final losers, then quarter-final losers by time).
    Green highlighting indicates athletes who submitted a development squad nomination.
  </p>
  ${list.map(tableHtml).join('')}
  `;
}

function groupTrialTable(group) {
  return `
  <h3>${esc(group.title)}</h3>
  <table class="summary-table">
    <thead><tr><th>Athlete</th><th>Reason for trial invite</th></tr></thead>
    <tbody>
      ${group.invites
        .map(
          (inv) => `<tr>
        <td><strong>${esc(inv.name)}</strong></td>
        <td>${esc(inv.reason)}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>`;
}

function summaryBar(assessed) {
  const totalNominees = assessed.length;
  const rowerCount = rowerAnalysisNominees(assessed).length;
  const coxPrimaryCount = assessed.filter(isCoxPrimaryNominee).length;
  const trialInvites = TRIAL_LIST_BY_GROUP.reduce((n, g) => n + g.invites.length, 0);
  const openN = TRIAL_LIST_BY_GROUP.find((g) => g.id === 'open')?.invites.length ?? 0;
  const u19MenN = TRIAL_LIST_BY_GROUP.find((g) => g.id === 'u19Men')?.invites.length ?? 0;
  const u19WomenN = TRIAL_LIST_BY_GROUP.find((g) => g.id === 'u19Women')?.invites.length ?? 0;
  const { recommendedMale, recommendedFemale } = buildCoxswainNominees(assessed);
  const cnzbCount = assessed.filter((a) => a.nationals.participated).length;

  const stat = (label, value, detail = '') =>
    `<div class="stat">
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-value">${esc(String(value))}</span>
      ${detail ? `<span class="stat-detail">${esc(detail)}</span>` : ''}
    </div>`;

  return `
  <div class="summary-bar">
    ${stat('Nominations received', totalNominees, `${rowerCount} rowers · ${coxPrimaryCount} cox-only`)}
    ${stat('CNZB 2026 results', cnzbCount, `${totalNominees - cnzbCount} without nationals result`)}
    ${stat('Proposed trial invites', trialInvites, `Open ${openN} · U19 M ${u19MenN} · U19 W ${u19WomenN}`)}
    ${stat('Suggested coxswains', recommendedMale && recommendedFemale ? '2' : recommendedMale || recommendedFemale ? '1' : '—', [recommendedMale?.fullName, recommendedFemale?.fullName].filter(Boolean).join(' · ') || 'See cox section')}
    ${stat('Key dates', 'Jul 2026', 'Camp 4–5 · Trial 18')}
  </div>`;
}

function summarySection() {
  const totalInvites = TRIAL_LIST_BY_GROUP.reduce((n, g) => n + g.invites.length, 0);
  return `
  <h2>Summary — proposed trial invites</h2>
  <p class="muted">
    Development Camp 4–5 July 2026 · Selection Trial 18 July 2026 · Based on CNZB 2026 Beach Sprint Nationals and nominations received.
  </p>
  ${TRIAL_LIST_BY_GROUP.map(groupTrialTable).join('')}
  <p class="note"><strong>${totalInvites} athletes</strong> invited across Open, Men&apos;s U19, and Women&apos;s U19.</p>`;
}

function buildHtml(assessed, c1xTables, generatedAt) {
  const rowers = rowerAnalysisNominees(assessed);
  const crossover = rowers.filter((a) => a.flatwaterCrossover);
  const byScore = [...rowers].sort((a, b) => b.scoring.total - a.scoring.total);

  const detail = (a) => {
    const rec = appendixRecommendation(a);
    return `
    <div class="athlete-card">
      <h3>${esc(a.fullName)} ${badge(rec, recTone(rec))}</h3>
      <p class="decision"><strong>Decision:</strong> ${esc(decisionSummaryForAthlete(a))}</p>
      <p class="muted">${esc(a.club)} · ${esc(a.gender)} · ${esc(a.ageCategory)} · ${esc(a.teamInterest || 'No pathway tag')}</p>
      <div class="grid2">
        <div>
          <h4>Regatta results</h4>
          <ul>
            <li><strong>CNZB 2026:</strong> ${esc(a.nationals.summary)}</li>
            <li><strong>CNIB 2026:</strong> ${esc(a.northIsland.summary)}</li>
          </ul>
          ${a.nationals.events.length ? `<p class="small"><strong>Nationals events:</strong> ${a.nationals.events.map((e) => esc(formatNationalsEventLabel(e))).join('; ')}</p>` : ''}
        </div>
        <div>
          <h4>Composite assessment</h4>
          <ul>
            <li>Composite score: <strong>${a.scoring.total.toFixed(1)}</strong></li>
            <li>Target boats: ${esc(a.primaryBoats.join(', ') || '—')}</li>
            <li>2k erg: ${esc(a.latest2k || '—')} · CrewLAB: ${esc(a.crewlabPotential || '—')}</li>
          </ul>
          ${a.issues.length ? `<p class="warn">${a.issues.map(esc).join('<br>')}</p>` : ''}
        </div>
      </div>
    </div>`;
  };

  return `<!DOCTYPE html>
<html lang="en-NZ">
<head>
  <meta charset="utf-8" />
  <title>CONFIDENTIAL — 2026 Beach Sprint Development Trial Recommendations</title>
  <style>
    @page { size: A4; margin: 14mm 12mm 16mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; font-size: 9.5pt; line-height: 1.4; margin: 0; }
    .confidential-banner { background: #7f1d1d; color: #fff; text-align: center; font-weight: 800; letter-spacing: 0.18em; padding: 7px 10px; font-size: 10pt; }
    .confidential-footer { text-align: center; color: #991b1b; font-weight: 700; font-size: 8pt; letter-spacing: 0.12em; margin-top: 8px; }
    header { border-bottom: 3px solid #0e7490; padding: 10px 0; margin-bottom: 14px; }
    h1 { font-size: 17pt; margin: 0; color: #0e7490; }
    .sub { color: #64748b; margin-top: 4px; }
    h2 { font-size: 11pt; color: #0e7490; margin: 16px 0 8px; border-bottom: 1px solid #ccfbf1; padding-bottom: 3px; }
    h3 { font-size: 10pt; margin: 12px 0 6px; color: #0f766e; }
    h4 { font-size: 9pt; margin: 0 0 4px; color: #334155; }
    p, ul { margin: 0 0 8px; }
    ul { padding-left: 18px; }
    ul.compact { margin: 0 0 6px 16px; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 8.5pt; }
    th, td { border: 1px solid #cbd5e1; padding: 4px 5px; vertical-align: top; }
    th { background: #ecfeff; text-align: left; }
    th.num, td.num { text-align: center; width: 36px; }
    .muted { color: #64748b; font-size: 8pt; }
    .small { font-size: 8pt; color: #475569; }
    .warn { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; padding: 6px 8px; border-radius: 4px; font-size: 8pt; }
    .decision { background: #f0f9ff; border-left: 3px solid #0e7490; padding: 4px 8px; font-size: 8.5pt; margin: 4px 0 6px; }
    .badge { color: #fff; font-size: 7pt; font-weight: 700; padding: 2px 6px; border-radius: 999px; white-space: nowrap; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .athlete-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; margin: 0 0 8px; break-inside: avoid; }
    .priority-block { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; margin: 0 0 8px; }
    .priority-block h3 { margin: 0 0 6px; color: #0e7490; }
    .boat-class { margin: 4px 0 2px; font-size: 8.5pt; }
    .note { background: #f0fdf4; border-left: 4px solid #16a34a; padding: 8px 10px; margin: 8px 0; font-size: 8.5pt; }
    .summary-bar { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 0 0 14px; }
    .stat { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 6px; padding: 8px 6px; text-align: center; }
    .stat-label { display: block; font-size: 7pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
    .stat-value { display: block; font-size: 12pt; font-weight: 700; color: #0e7490; line-height: 1.2; }
    .stat-detail { display: block; font-size: 6.5pt; color: #475569; margin-top: 3px; line-height: 1.3; }
    .disclaimer { font-size: 7.5pt; color: #64748b; margin-top: 14px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
    .page-break { break-before: page; }
    tr.nominee-row td { background: #f0fdf4; }
    tr.nominee-row-strong td { background: #ecfdf5; }
    tr.trial-row td { background: #f0fdf4; }
    tr.trial-row-strong td { background: #ecfdf5; }
  </style>
</head>
<body>
  <div class="confidential-banner">CONFIDENTIAL — NOT FOR DISTRIBUTION</div>

  <header>
    <h1>2026 Beach Sprint Development Squad</h1>
    <p class="sub">Selection trial recommendations · Generated ${esc(generatedAt)} · Rowing NZ internal use only</p>
  </header>

  ${summaryBar(assessed)}
  ${summarySection()}

  <h2 class="page-break">Working analysis</h2>
  <p class="muted">
    Supporting analysis only. Composite score blends CNZB 2026 (55%), CNIB 2026 (25%), and erg/CrewLAB/pathway data.
    C1X results are weighted above C2X/C4X+; singles semi-final+ preferred over larger-boat finals.
  </p>

  ${groupRankingsSection(assessed)}

  ${coxswainSection(assessed)}

  ${c1xStandingsSection(c1xTables, ['bu18', 'gu18'])}

  ${crossover.length ? `<h3>Flat-water crossover (GM approval required)</h3>
  <ul>${crossover.map((a) => `<li><strong>${esc(a.fullName)}</strong> — 2k ${esc(a.latest2k || '—')}, CrewLAB ${esc(a.crewlabPotential || '—')}</li>`).join('')}</ul>` : ''}

  <div class="disclaimer">
    Data: nomination CSV, rowit CNZB 2026 archive, rowit CNIB 2026. Advisory only — trial performance and RNZ selection authority remain decisive.
  </div>

  <h2 class="page-break">Appendix — nomination assessment &amp; decisions</h2>
  <p class="muted">One entry per rower nominee. Cox-primary nominees are assessed in the coxswain section only. <strong>Decision</strong> reflects the proposed trial list where applicable.</p>
  ${byScore.map(detail).join('')}

  <div class="confidential-footer">CONFIDENTIAL — ROWING NZ INTERNAL USE ONLY</div>
</body>
</html>`;
}

async function main() {
  console.log('Loading trial athletes from', TRIAL_CSV);
  const athletes = await loadTrialAthletes(TRIAL_CSV);
  console.log(`Loaded ${athletes.length} unique nominees`);

  console.log('Loading CNZB 2026 archive…');
  const nationalsIndex = await loadNationalsIndex({ dir: CNZB_DIR });

  console.log('Loading CNIB 2026 directory…');
  const cnibDirectory = await loadCnibAthleteDirectory();
  console.log(`CNIB directory entries: ${cnibDirectory.length}`);

  const assessed = [];
  for (const athlete of athletes) {
    process.stdout.write(`Analysing ${athlete.fullName}… `);
    const nationals = nationalsForAthlete(athlete, nationalsIndex);
    const northIsland = await northIslandForAthlete(athlete, cnibDirectory);
    assessed.push(assessAthlete(athlete, nationals, northIsland));
    const entry = assessed.at(-1);
    if (isCoxswainNominee(entry)) {
      const { nationals: coxNationals, northIsland: coxNorthIsland } = coxRegattaFromResults(
        entry,
        nationals,
        northIsland,
      );
      entry.coxNationals = coxNationals;
      entry.coxNorthIsland = coxNorthIsland;
      entry.coxScoring = assessCoxswainRegattaScore(coxNationals, coxNorthIsland);
    }
    console.log(`${entry.scoring.total.toFixed(1)} (${entry.recommendation})`);
    await new Promise((r) => setTimeout(r, 150));
  }

  applyGroupRecommendationCap(assessed);

  const c1xTables = buildC1XNationalsTables(nationalsIndex, rowerAnalysisNominees(assessed));
  const generatedAt = new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' });
  const html = buildHtml(assessed, c1xTables, generatedAt);

  await mkdir(OUT_DIR, { recursive: true });
  const htmlPath = join(OUT_DIR, PDF_NAME.replace('.pdf', '.html'));
  const pdfPath = join(OUT_DIR, PDF_NAME);
  await writeFile(htmlPath, html, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', right: '10mm', bottom: '14mm', left: '10mm' },
  });
  await browser.close();

  console.log('\nWrote:');
  console.log(' ', pdfPath);
  console.log(' ', htmlPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
