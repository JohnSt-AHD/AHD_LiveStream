#!/usr/bin/env node
/**
 * Build RowIT-shaped CSV pack for U19 coastal selection trial (U19_CT_26).
 * Usage: node scripts/generate-u19-trial-regatta-csv.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOAT_CJM1X,
  BOAT_CJM2X,
  BOAT_CJW1X,
  BOAT_CJW2X,
  BOAT_CJMix2X,
  INTERVAL_MIN,
  RACING_START,
  U19_MEN,
  U19_WOMEN,
  menKnockoutBracket,
  womenKnockoutBracket,
} from './lib/u19-trial-plan.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'data', 'archives', 'u19_ct_26', 'latest');

function codeFromName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length < 2) return parts[0]?.slice(0, 4).toUpperCase() || 'ATH';
  return parts[parts.length - 1].slice(0, 4).toUpperCase();
}

const WOMEN = U19_WOMEN.map((a) => ({ ...a, code: codeFromName(a.name) }));
const MEN = U19_MEN.map((a) => ({ ...a, code: codeFromName(a.name) }));

function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

/** @type {{ raceNum: number, time: string, eventNum: number, eventType: string, round: string, division: string, lanes: Record<string, string> }[]} */
const races = [];
let raceNum = 0;

function pushRace(time, eventNum, eventType, round, division, lane1 = '', lane2 = '') {
  raceNum += 1;
  races.push({
    raceNum,
    time,
    eventNum,
    eventType,
    round,
    division,
    lanes: { lane_1: lane1, lane_2: lane2 },
  });
}

// Session 1 — women's TT (nomination order; re-rank after results)
let t = RACING_START;
for (let i = 0; i < WOMEN.length; i++) {
  pushRace(t, 1, `G U19 ${BOAT_CJW1X}`, 'time trial', String(i + 1), WOMEN[i].code);
  t = addMinutes(t, INTERVAL_MIN);
}

// Men's TT
t = '08:50';
for (let i = 0; i < MEN.length; i++) {
  pushRace(t, 2, `B U19 ${BOAT_CJM1X}`, 'time trial', String(i + 1), MEN[i].code);
  t = addMinutes(t, INTERVAL_MIN);
}

// Women's knockout
const wBracket = womenKnockoutBracket();
t = '09:10';
for (const m of wBracket.playIn) {
  const [a, b] = m.label.split(' vs ').map((s) => s.trim());
  pushRace(t, 3, `G U19 ${BOAT_CJW1X}`, 'heat', m.id, `W${a}`, `W${b}`);
  t = addMinutes(t, 8);
}
for (const m of wBracket.semiFinals) {
  const parts = m.label.split(' vs ');
  pushRace(t, 3, `G U19 ${BOAT_CJW1X}`, 'sf', m.id, parts[0].trim(), parts[1].trim());
  t = addMinutes(t, 8);
}
pushRace(t, 3, `G U19 ${BOAT_CJW1X}`, 'final', 'WF', 'WSF1', 'WSF2');
t = addMinutes(t, 8);
pushRace(t, 3, `G U19 ${BOAT_CJW1X}`, 'final', 'WB', 'loser (WSF1)', 'loser (WSF2)');

// Men's knockout
const mBracket = menKnockoutBracket();
t = '09:35';
for (const m of mBracket.playIn) {
  const [a, b] = m.label.split(' vs ').map((s) => s.trim());
  pushRace(t, 4, `B U19 ${BOAT_CJM1X}`, 'heat', m.id, `M${a}`, `M${b}`);
  t = addMinutes(t, 8);
}
for (const m of mBracket.semiFinals) {
  const parts = m.label.split(' vs ');
  pushRace(t, 4, `B U19 ${BOAT_CJM1X}`, 'sf', m.id, parts[0].trim(), parts[1].trim());
  t = addMinutes(t, 8);
}
pushRace(t, 4, `B U19 ${BOAT_CJM1X}`, 'final', 'MF', 'MSF1', 'MSF2');
t = addMinutes(t, 8);
pushRace(t, 4, `B U19 ${BOAT_CJM1X}`, 'final', 'MB', 'loser (MSF1)', 'loser (MSF2)');

// Session 2 — mix matrix (2 H2H + W1/M1 solo refs noted in division)
t = '11:25';
pushRace(t, 5, `Mx U19 ${BOAT_CJMix2X}`, 'heat', 'MX1', 'M2+W2', 'M3+W3');
t = addMinutes(t, 20);
pushRace(t, 5, `Mx U19 ${BOAT_CJMix2X}`, 'heat', 'MX2', 'M2+W3', 'M3+W2');

// Session 3 — doubles speed trial
t = '13:05';
pushRace(t, 6, `U19 Doubles TT`, 'time trial', 'D1', BOAT_CJMix2X, '');
t = addMinutes(t, INTERVAL_MIN);
pushRace(t, 6, `U19 Doubles TT`, 'time trial', 'D2', `${BOAT_CJW2X} W3+W4`, '');
t = addMinutes(t, INTERVAL_MIN);
pushRace(t, 6, `U19 Doubles TT`, 'time trial', 'D3', `${BOAT_CJM2X} M3+M4`, '');

const eventsCsv = `Event #,Event Type,Gender,Class,Boat,Seats,Oars,Coxed,Other,Sponsor
1,G U19 ${BOAT_CJW1X},W,U19 ,1X,1,Scull,N,,U19 Selection Trial
2,B U19 ${BOAT_CJM1X},M,U19 ,1X,1,Scull,N,,U19 Selection Trial
3,G U19 ${BOAT_CJW1X} KO,W,U19 ,1X,1,Scull,N,,U19 Selection Trial
4,B U19 ${BOAT_CJM1X} KO,M,U19 ,1X,1,Scull,N,,U19 Selection Trial
5,Mx U19 ${BOAT_CJMix2X},Mx,U19 ,2X,2,Scull,N,,U19 Selection Trial
6,U19 Doubles TT,Mx,U19 ,2X,2,Scull,N,,U19 Selection Trial
`;

const daysheetCsv = [
  '"DAY SHEETS — U19 Coastal Selection Trial, Big Manly Beach"',
  'DAY 1: Saturday 18th July 2026',
  'Race,Time,Event #,Event Type,Round,Division,lane_1,lane_2',
  ...races.map((r) =>
    [
      r.raceNum,
      r.time,
      r.eventNum,
      r.eventType,
      r.round,
      r.division,
      r.lanes.lane_1,
      r.lanes.lane_2,
    ].join(','),
  ),
].join('\n');

const competitorRows = races.map((r) => {
  const names = [r.lanes.lane_1, r.lanes.lane_2].filter(Boolean).join(', ');
  return `${r.raceNum},${r.time},${r.eventNum},${r.eventType},${r.round},${r.division},"${names}"`;
});

const competitorsCsv = [
  '"COMPETITOR NAMES — U19 Coastal Selection Trial"',
  'DAY 1: Saturday 18th July 2026',
  'Race,Time,Event #,Event Type,Round,Division,Names',
  ...competitorRows,
].join('\n');

const resultsCsv = [
  '# Live results — enter on dashboard or append rows: Race,Event,Round,Div,Status,Place,Crew,Time,...',
].join('\n');

const metaJson = {
  code: 'u19_ct_26',
  name: 'U19 Coastal Selection Trial 2026',
  location: 'Big Manly Beach',
  venue: 'Manly Sailing Club',
  date: '2026-07-18',
  trialPlan: true,
  gpsDevices: ['C1X_A', 'C1X_B'],
  athletes: {
    women: WOMEN,
    men: MEN,
  },
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, 'events.csv'), eventsCsv, 'utf8');
await writeFile(join(OUT_DIR, 'daysheet.csv'), daysheetCsv, 'utf8');
await writeFile(join(OUT_DIR, 'competitors.csv'), competitorsCsv, 'utf8');
await writeFile(join(OUT_DIR, 'results.csv'), resultsCsv, 'utf8');
await writeFile(join(OUT_DIR, 'trial-meta.json'), `${JSON.stringify(metaJson, null, 2)}\n`, 'utf8');

console.log(`Wrote ${races.length} races to ${OUT_DIR}`);
