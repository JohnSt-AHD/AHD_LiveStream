import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ARCHIVE = join(__dirname, '..', '..', 'public', 'data', 'archives', 'cnzb2026', 'latest');

async function resolveCnzbFile(dir, names) {
  for (const name of names) {
    try {
      return await readFile(join(dir, name), 'utf8');
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Missing CNZB file in ${dir}: tried ${names.join(', ')}`);
}

export async function loadNationalsIndex(options = {}) {
  const dir = options.dir || process.env.BEACH_SPRINT_CNZB_DIR || DEFAULT_ARCHIVE;
  const [competitorsRaw, resultsRaw, eventsRaw, daysheetRaw] = await Promise.all([
    resolveCnzbFile(dir, ['cnzb2026-competitornames (2).csv', 'competitors.csv']),
    resolveCnzbFile(dir, ['cnzb2026-results.csv', 'results.csv']),
    resolveCnzbFile(dir, ['events.csv']).catch(() => readFile(join(DEFAULT_ARCHIVE, 'events.csv'), 'utf8')),
    resolveCnzbFile(dir, ['cnzb2026-daysheet.csv', 'daysheet.csv']),
  ]);
  return {
    competitors: parseCompetitors(competitorsRaw),
    results: parseResults(resultsRaw),
    events: parseEvents(eventsRaw),
    daysheet: parseDaysheet(daysheetRaw),
  };
}

const ROUND_RANK = {
  heat: 1,
  repechage: 2,
  'quarter-final': 3,
  'semi-final': 4,
  final: 5,
};

const ROUND_CODE = { h: 'heat', r: 'repechage', q: 'quarter-final', s: 'semi-final', f: 'final' };

const FINAL_POINTS = { 1: 100, 2: 85, 3: 70, 4: 55 };

/** Boat-class multipliers — singles weighted highest (selection priority). */
const BOAT_CLASS_WEIGHT = { C1X: 1.0, C2X: 0.55, C4X: 0.3, OTHER: 0.25 };

/** Age-class multipliers — higher age group preferred (U18 over U17, Open over U18). */
const AGE_CLASS_WEIGHT = {
  OPEN: 1.0,
  U18: 0.95,
  CLB: 0.9,
  U17: 0.75,
  MASTER: 0.65,
  OTHER: 0.8,
};

function normalizeRoundKey(round) {
  const s = String(round || '').toLowerCase();
  if (/semi.?final/.test(s)) return 'semi-final';
  if (/quarter.?final/.test(s)) return 'quarter-final';
  if (/repechage/.test(s)) return 'repechage';
  if (/final/.test(s)) return 'final';
  if (/heat/.test(s)) return 'heat';
  return s || 'heat';
}

/** Results col D / competitors division: A or 1 = A-final, B or 2 = B-final. */
export function parseFinalTier(division) {
  const d = String(division || '').trim().toUpperCase();
  if (d === 'B' || d === '2') return 'B';
  return 'A';
}

export function finalDivisionLabel(division) {
  return parseFinalTier(division) === 'B' ? 'B' : 'A';
}

function divisionForAppearance(app, resultsByRace) {
  return app.division || resultsByRace.get(app.race)?.division || '';
}

function getAFinalBoatCount(index, eventNum) {
  const aFinal = index.competitors.find(
    (c) => c.eventNum === eventNum && c.round === 'final' && parseFinalTier(c.division) === 'A',
  );
  return aFinal?.names?.length || 2;
}

/** Overall C1X rank when A-final places 1..n then B-final places n+1.. */
export function overallC1XPlace(finalTier, placeInRace, aFinalBoatCount = 2) {
  if (!placeInRace) return null;
  if (parseFinalTier(finalTier) === 'B') return aFinalBoatCount + placeInRace;
  return placeInRace;
}

/** Round base points — C1X semi-finalists score above multi-crew final wins. */
function roundBasePoints(boatClass, round, place, { finalTier, aFinalBoatCount = 2 } = {}) {
  const r = normalizeRoundKey(round);

  if (boatClass === 'C1X') {
    if (r === 'final') {
      if (parseFinalTier(finalTier) === 'B' && place) {
        const overall = overallC1XPlace('B', place, aFinalBoatCount);
        return FINAL_POINTS[overall] ?? 40;
      }
      if (place === 2) return 87;
      return FINAL_POINTS[place] ?? 40;
    }
    if (r === 'semi-final') return 78;
    if (r === 'quarter-final') return 40;
    if (r === 'repechage') return 15;
    return 8;
  }

  if (r === 'final') return FINAL_POINTS[place] ?? 40;
  if (r === 'semi-final') return 20;
  if (r === 'quarter-final') return 12;
  if (r === 'repechage') return 8;
  return 5;
}

function roundPointsFromAppearance(app, finalPlace, resultsByRace, index) {
  const boatClass = boatClassKey(app.eventType);
  const division = divisionForAppearance(app, resultsByRace);
  const finalTier = normalizeRoundKey(app.round) === 'final' ? parseFinalTier(division) : null;
  const aFinalBoatCount =
    finalTier === 'B' && index ? getAFinalBoatCount(index, app.eventNum) : 2;
  return roundBasePoints(boatClass, app.round, finalPlace, { finalTier, aFinalBoatCount });
}

function resolveFinalPlace(app, resultsByRace, athlete, norm, daysheetMap) {
  let finalPlace = null;
  let finalTime = null;
  if (app.round !== 'final') return { finalPlace, finalTime };

  const raceResult = resultsByRace.get(app.race);
  if (!raceResult) return { finalPlace, finalTime };

  if (/C1X/.test(app.eventType) && app.names.length <= 2) {
    const idx = app.names.findIndex((n) => athleteInNames(norm, [n]));
    const ds = daysheetMap?.get(app.race);
    if (idx >= 0 && ds) {
      const lanes = [ds.lane1, ds.lane2].filter(Boolean);
      if (lanes[idx]) {
        const entry = raceResult.entries.find(
          (e) => crewCodeToken(e.crew) === crewCodeToken(lanes[idx]),
        );
        if (entry) {
          return { finalPlace: entry.place, finalTime: entry.time };
        }
      }
    }
    if (idx >= 0 && raceResult.entries[idx]) {
      return {
        finalPlace: raceResult.entries[idx].place,
        finalTime: raceResult.entries[idx].time,
      };
    }
  }

  const athleteCode = clubCodeForAthlete(athlete.club);
  if (raceResult && athleteCode) {
    for (const entry of raceResult.entries) {
      const resultCode = crewCodeToken(entry.crew);
      if (
        resultCode &&
        athleteCode &&
        (resultCode.startsWith(athleteCode.slice(0, 3)) || athleteCode.startsWith(resultCode.slice(0, 3)))
      ) {
        finalPlace = entry.place;
        finalTime = entry.time;
        break;
      }
    }
  }
  return { finalPlace, finalTime };
}

function boatClassKey(eventType) {
  const t = String(eventType || '').toUpperCase();
  if (/C1X|\b1X\b/.test(t)) return 'C1X';
  if (/C4X|4X\+/.test(t)) return 'C4X';
  if (/C2X|\b2X\b/.test(t)) return 'C2X';
  return 'OTHER';
}

export function isC4XPlusEvent(eventType) {
  return /C4X\+|4X\+/i.test(String(eventType || ''));
}

function ageClassKey(eventType) {
  const t = String(eventType || '').toUpperCase();
  if (/OPN|SNR|OPEN|SENIOR/.test(t)) return 'OPEN';
  if (/\bU18\b/.test(t)) return 'U18';
  if (/\bU17\b/.test(t)) return 'U17';
  if (/CLB/.test(t)) return 'CLB';
  if (/MST|C-D|E-F|MASTER/.test(t)) return 'MASTER';
  return 'OTHER';
}

export function eventPerformanceWeight(eventType) {
  const boat = BOAT_CLASS_WEIGHT[boatClassKey(eventType)] ?? BOAT_CLASS_WEIGHT.OTHER;
  const age = AGE_CLASS_WEIGHT[ageClassKey(eventType)] ?? AGE_CLASS_WEIGHT.OTHER;
  return { boat, age, combined: boat * age, boatClass: boatClassKey(eventType), ageClass: ageClassKey(eventType) };
}

function scoreEventResult(eventType, round, place, roundLabel = round) {
  const boatClass = boatClassKey(eventType);
  const base = roundBasePoints(boatClass, roundLabel || round, place);

  const w = eventPerformanceWeight(eventType);
  const weightedPoints = base * w.combined;
  return {
    eventType,
    round: roundLabel || round,
    finalPlace: place,
    basePoints: base,
    boatWeight: w.boat,
    ageWeight: w.age,
    boatClass: w.boatClass,
    ageClass: w.ageClass,
    weightedPoints,
    points: weightedPoints,
  };
}

function eventRoundRank(event) {
  return ROUND_RANK[normalizeRoundKey(event.round)] ?? 0;
}

function sortEventsByWeight(events) {
  return [...events].sort(
    (a, b) =>
      b.weightedPoints - a.weightedPoints ||
      eventRoundRank(b) - eventRoundRank(a) ||
      (a.overallPlace ?? a.finalPlace ?? 99) - (b.overallPlace ?? b.finalPlace ?? 99) ||
      b.boatWeight - a.boatWeight ||
      b.ageWeight - a.ageWeight ||
      b.basePoints - a.basePoints,
  );
}

function reachedC1xSemiFinalOrBetter(event) {
  if (event.boatClass !== 'C1X') return false;
  const r = normalizeRoundKey(event.round);
  return r === 'semi-final' || r === 'final';
}

/** Prefer C1X semi-final+ over any larger-boat result when selecting the headline regatta score. */
function pickBestScoringEvent(events) {
  if (!events.length) return null;
  const singlesDeep = events.filter(reachedC1xSemiFinalOrBetter);
  if (singlesDeep.length) {
    const c1xFinals = singlesDeep.filter(
      (e) => e.boatClass === 'C1X' && normalizeRoundKey(e.round) === 'final',
    );
    if (c1xFinals.length) return sortEventsByWeight(c1xFinals)[0];
    return sortEventsByWeight(singlesDeep)[0];
  }
  return sortEventsByWeight(events)[0];
}

function formatEventRoundLabel(event) {
  const r = normalizeRoundKey(event.round);
  if (r === 'final' && event.finalTier === 'B') return 'B Final';
  if (r === 'final' && event.finalTier === 'A') return 'A Final';
  return event.round;
}

export function formatNationalsEventLabel(event) {
  const roundLabel = formatEventRoundLabel(event);
  const place = event.placeInRace ?? event.finalPlace;
  const placeLabel = place ? ` ${ordinal(place)}` : '';
  return `${event.eventType} (${roundLabel}${placeLabel})`;
}

function summariseBestEvent(best) {
  if (!best) return 'Competed';
  const roundLabel = formatEventRoundLabel(best);
  const placeInRace = best.placeInRace ?? best.finalPlace;
  const placeLabel = placeInRace ? ` (${ordinal(placeInRace)})` : '';
  return `${best.eventType} — ${roundLabel}${placeLabel}${best.finalTime ? ` ${best.finalTime}` : ''}`;
}

export function normalizeName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/[^a-z0-9-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const CLUB_CODE_HINTS = [
  ['north shore', 'nsh'],
  ['waikato', 'wkoc'],
  ['whangarei', 'wrec'],
  ['sacred heart', 'shac'],
  ['bay of plenty', 'bpc'],
  ['boast busters', 'bpc'],
  ['bpc coast', 'bpc'],
  ['tauranga', 'tga'],
  ['wellington', 'welc'],
  ['west end', 'wesc'],
  ['avon', 'avnc'],
  ['canterbury', 'cash'],
  ['cashmere', 'cash'],
  ['petone', 'petc'],
  ['hamilton', 'ham'],
  ['auckland grammar', 'agsb'],
  ['mount albert', 'mtal'],
  ['te awamutu', 'wtmc'],
  ['takapuna', 'tgsc'],
  ['horowhenua', 'howi'],
  ['nelson', 'nels'],
  ['star boating', 'stac'],
  ['porirua', 'porc'],
  ['victoria', 'vilc'],
  ['cambridge', 'camc'],
  ['howick', 'hwbc'],
  ['duke of argyll', 'duac'],
  ['eastbourne', 'ebsc'],
  ['union', 'uncc'],
  ['glendowie', 'glen'],
  ['kings', 'kicc'],
  ['st paul', 'spsc'],
  ['waitemata', 'wtmc'],
];

function clubCodeForAthlete(clubText) {
  const c = String(clubText || '').toLowerCase();
  for (const [needle, code] of CLUB_CODE_HINTS) {
    if (c.includes(needle)) return code;
  }
  return null;
}

function crewCodeToken(crew) {
  return String(crew || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\*.*$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === ',' && !q) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseTimeSec(text) {
  const t = String(text || '').trim();
  if (!t || /dnf|dns|dsq/i.test(t)) return null;
  const m = t.match(/^(\d+):(\d{1,2})(?:\.(\d+))?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
}

function split2k(text) {
  const sec = parseTimeSec(text);
  if (sec == null || sec <= 0 || sec > 600) return null;
  return sec;
}

function ageBand(category) {
  const c = String(category || '').trim();
  if (/^U1[89]$|^U18$|^U19$/i.test(c)) return 'U19';
  if (/^Senior$|^U2[23]$|^Open$/i.test(c)) return 'Open';
  if (/^U22$/i.test(c)) return 'Open';
  return c || 'Unknown';
}

function pathwayFlags(text) {
  const t = String(text || '');
  return {
    international: /international pathway/i.test(t),
    domestic: /domestic pathway/i.test(t),
    coastal: /coastal beach sprint/i.test(t),
    para: /para pathway/i.test(t),
  };
}

function dedupeAthletes(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeName(row.fullName);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, row);
      continue;
    }
    const score = (r) =>
      (split2k(r.latest2k) ? 4 : 0) +
      (Number.parseFloat(String(r.crewlabPotential || '').replace('%', '')) || 0) / 10 +
      (r.teamInterest ? 2 : 0) +
      (r.crewlabStars ? 1 : 0);
    if (score(row) > score(prev)) map.set(key, row);
  }
  return [...map.values()];
}

export async function loadTrialAthletes(csvPath) {
  const raw = await readFile(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const rows = lines.slice(1).map((line) => {
    const c = parseCsvLine(line);
    const get = (k) => c[idx[k]]?.trim() ?? '';
    return {
      fullName: get('Full Name').replace(/\s+/g, ' ').trim(),
      teamInterest: get('2026 Team Interest'),
      positions: get('Position (in order of preference)'),
      club: get('Club Affiliation'),
      gender: get('Gender'),
      ageCategory: get('Age Category in 2026'),
      ageBand: ageBand(get('Age Category in 2026')),
      latest2k: get('Latest 2k Split'),
      latest5k: get('Latest 5k Split'),
      latest5kTime: get('Latest 5k Time'),
      crewlabPotential: get('CREWLAB National Team Potential'),
      crewlabRowScore: get('CREWLAB RowScore'),
      crewlabBoatSpeed: get('CrewLAB Predicted Boat Speed (8+ in m/s)'),
      crewlabStars: get('CREWLAB Star Rating'),
      flags: pathwayFlags(get('2026 Team Interest')),
    };
  });
  return dedupeAthletes(rows);
}

function parseCompetitors(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    if (!/^\d+,/.test(line)) continue;
    const m = line.match(/^(\d+),([^,]*),(\d+),([^,]+),([^,]+),([^,]*),"([^"]*)"/);
    if (!m) continue;
    entries.push({
      race: Number(m[1]),
      eventNum: Number(m[3]),
      eventType: m[4],
      round: m[5],
      division: m[6],
      names: m[7].split(',').map((n) => n.trim()).filter(Boolean),
    });
  }
  return entries;
}

function parseResults(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\d+,/.test(line)) continue;
    const p = parseCsvLine(line);
    if (p.length < 8) continue;
    rows.push({
      race: Number(p[0]),
      eventNum: Number(p[1]),
      roundCode: p[2],
      division: p[3],
      entries: [
        { place: Number(p[6]), crew: p[7], time: p[8] },
        p.length >= 11 ? { place: Number(p[9]), crew: p[10], time: p[11] } : null,
      ].filter(Boolean),
    });
  }
  return rows;
}

function parseEvents(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!/^\d+,/.test(line)) continue;
    const p = parseCsvLine(line);
    const eventNum = Number(p[0]);
    if (!eventNum) continue;
    map.set(eventNum, {
      eventNum,
      eventType: p[1],
      gender: p[2],
      className: p[3],
      boat: p[4],
    });
  }
  return map;
}

function athleteInNames(athleteNorm, names) {
  const parts = athleteNorm.split(' ').filter(Boolean);
  if (!parts.length) return false;
  const last = parts.at(-1);
  const first = parts[0];
  return names.some((n) => {
    const nn = normalizeName(n);
    if (nn === athleteNorm) return true;
    const np = nn.split(' ').filter(Boolean);
    if (!np.length) return false;
    return np.at(-1) === last && np[0] === first;
  });
}

function bestNameMatch(targetNorm, candidates) {
  let best = null;
  for (const c of candidates) {
    const n = normalizeName(`${c[0]} ${c[1]}`);
    if (n === targetNorm) return { first: c[0], last: c[1], pid: c[2], score: 100 };
    const parts = targetNorm.split(' ');
    const last = parts.at(-1);
    const first = parts[0];
    let score = 0;
    if (n.includes(last) && n.includes(first)) score = 80;
    else if (n.includes(last)) score = 40;
    if (score > (best?.score ?? 0)) best = { first: c[0], last: c[1], pid: c[2], score };
  }
  return best?.score >= 80 ? best : null;
}

/** @deprecated use loadNationalsIndex({ dir }) */
const ARCHIVE = DEFAULT_ARCHIVE;

function parseDaysheet(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!/^\d+,/.test(line)) continue;
    const p = parseCsvLine(line);
    if (p.length < 7) continue;
    map.set(Number(p[0]), {
      race: Number(p[0]),
      eventNum: Number(p[2]),
      eventType: p[3],
      round: p[4],
      lane1: p[6]?.trim() || '',
      lane2: p[7]?.trim() || '',
    });
  }
  return map;
}

function crewMatchesClub(crew, clubText) {
  const code = clubCodeForAthlete(clubText);
  const token = crewCodeToken(crew);
  if (!code || !token) return false;
  return token.startsWith(code.slice(0, 3)) || code.startsWith(token.slice(0, 3));
}

function assignNamesToCrews(names, crews, nomineeClubs) {
  if (!crews.length) return names.map((name) => ({ name, crew: '' }));
  if (names.length === 1) {
    const club = nomineeClubs[0];
    const crew = (club && crews.find((c) => crewMatchesClub(c, club))) || crews[0];
    return [{ name: names[0], crew }];
  }
  if (names.length === 2 && crews.length >= 2) {
    const [n0, n1] = names;
    const [c0, c1] = [crews[0], crews[1]];
    const club0 = nomineeClubs[0] || '';
    const club1 = nomineeClubs[1] || '';
    if (club0 && crewMatchesClub(c0, club0) && club1 && crewMatchesClub(c1, club1)) {
      return [{ name: n0, crew: c0 }, { name: n1, crew: c1 }];
    }
    if (club0 && crewMatchesClub(c1, club0) && club1 && crewMatchesClub(c0, club1)) {
      return [{ name: n0, crew: c1 }, { name: n1, crew: c0 }];
    }
    return [{ name: n0, crew: c0 }, { name: n1, crew: c1 }];
  }
  return names.map((name, i) => ({ name, crew: crews[Math.min(i, crews.length - 1)] }));
}

function collectC1XAthleteRuns(index, eventNum, nomineeByNorm) {
  const runs = new Map();
  const comps = index.competitors.filter((c) => c.eventNum === eventNum);

  for (const comp of comps) {
    const ds = index.daysheet.get(comp.race);
    const result = index.results.find((r) => r.race === comp.race);
    if (!ds || !result) continue;

    const crews = [ds.lane1, ds.lane2].filter(Boolean);
    const nomineeClubs = comp.names.map((n) => nomineeByNorm.get(normalizeName(n))?.club || '');
    const assigned = assignNamesToCrews(comp.names, crews, nomineeClubs);
    const roundRank = ROUND_RANK[comp.round] ?? 0;

    for (const { name, crew } of assigned) {
      if (!name || !crew) continue;
      const entry = result.entries.find((e) => crewCodeToken(e.crew) === crewCodeToken(crew));
      if (!entry || !Number.isFinite(entry.place)) continue;

      const key = normalizeName(name);
      const rec = {
        displayName: name.trim(),
        round: comp.round,
        division: finalDivisionLabel(comp.division || result.division || ds.round || ''),
        roundRank,
        placeInRace: entry.place,
        time: entry.time,
        race: comp.race,
        eventType: comp.eventType,
      };
      const prev = runs.get(key) || [];
      prev.push(rec);
      runs.set(key, prev);
    }
  }
  return runs;
}

function rankC1XStandings(runs, aFinalBoatCount = 2) {
  const athletes = [...runs.entries()].map(([key, appearances]) => {
    const best = [...appearances].sort((a, b) => b.roundRank - a.roundRank || a.placeInRace - b.placeInRace)[0];
    const finalApp = appearances.find((a) => a.round === 'final');
    const semiApps = appearances.filter((a) => a.round === 'semi-final');
    const quarterApps = appearances.filter((a) => a.round === 'quarter-final');
    return {
      key,
      displayName: best.displayName,
      best,
      finalApp,
      semiApps,
      quarterApps,
      appearances,
    };
  });

  const ranked = [];
  const used = new Set();

  const finals = athletes
    .filter((a) => a.finalApp)
    .map((a) => ({
      ...a,
      overallPlace: overallC1XPlace(a.finalApp.division, a.finalApp.placeInRace, aFinalBoatCount),
    }))
    .sort((a, b) => a.overallPlace - b.overallPlace);
  for (const a of finals) {
    ranked.push({
      rank: a.overallPlace,
      name: a.displayName,
      time: a.finalApp.time,
      note: `${finalDivisionLabel(a.finalApp.division)} Final — ${ordinal(a.finalApp.placeInRace)}`,
      round: 'final',
    });
    used.add(a.key);
  }

  const semiLosers = athletes
    .filter((a) => !used.has(a.key) && a.semiApps.length)
    .map((a) => {
      const semi = [...a.semiApps].sort((a2, b2) => a2.placeInRace - b2.placeInRace)[0];
      return { ...a, semi };
    })
    .sort((a, b) => parseTimeSec(a.semi.time) - parseTimeSec(b.semi.time));
  for (const a of semiLosers) {
    if (ranked.length >= 8) break;
    ranked.push({
      rank: ranked.length + 1,
      name: a.displayName,
      time: a.semi.time,
      note: 'Lost in semi-final',
      round: 'semi-final',
    });
    used.add(a.key);
  }

  const qfLosers = athletes
    .filter((a) => !used.has(a.key) && a.quarterApps.length)
    .map((a) => {
      const qf = [...a.quarterApps].sort((a2, b2) => a2.placeInRace - b2.placeInRace)[0];
      return { ...a, qf };
    })
    .sort((a, b) => parseTimeSec(a.qf.time) - parseTimeSec(b.qf.time));
  for (const a of qfLosers) {
    if (ranked.length >= 8) break;
    ranked.push({
      rank: ranked.length + 1,
      name: a.displayName,
      time: a.qf.time,
      note: 'Lost in quarter-final',
      round: 'quarter-final',
    });
    used.add(a.key);
  }

  return ranked.sort((a, b) => a.rank - b.rank).slice(0, 8);
}

export function buildC1XNationalsTables(index, assessed) {
  const nomineeByNorm = new Map(assessed.map((a) => [normalizeName(a.fullName), a]));

  function findNominee(name) {
    const norm = normalizeName(name);
    if (nomineeByNorm.has(norm)) return nomineeByNorm.get(norm);
    for (const [k, v] of nomineeByNorm) {
      const nParts = norm.split(' ');
      const kParts = k.split(' ');
      if (nParts.at(-1) === kParts.at(-1) && nParts[0] === kParts[0]) return v;
    }
    return null;
  }

  const events = [
    { id: 'bu18', title: 'B U18 C1X (U19 Men\'s Single)', eventNum: 1 },
    { id: 'gu18', title: 'G U18 C1X (U19 Women\'s Single)', eventNum: 2 },
    { id: 'mopn', title: 'M Open C1X', eventNum: 19 },
    { id: 'wopn', title: 'W Open C1X', eventNum: 20 },
  ];

  return events.map(({ id, title, eventNum }) => {
    const runs = collectC1XAthleteRuns(index, eventNum, nomineeByNorm);
    const aFinalBoatCount = getAFinalBoatCount(index, eventNum);
    const standings = rankC1XStandings(runs, aFinalBoatCount).map((row) => {
      const nominee = findNominee(row.name);
      return {
        ...row,
        nominated: Boolean(nominee),
        recommendation: nominee?.recommendation || '—',
        nomineeCategory: nominee ? `${nominee.gender} / ${nominee.ageCategory}` : '—',
      };
    });
    return { id, title, eventNum, standings };
  });
}

export function nationalsForAthlete(athlete, index, { c4xPlusOnly = false } = {}) {
  const norm = normalizeName(athlete.fullName);
  const appearances = index.competitors.filter((c) => athleteInNames(norm, c.names));
  if (!appearances.length) {
    return {
      participated: false,
      summary: c4xPlusOnly ? 'No CNZB 2026 C4X+ result' : 'No CNZB 2026 record found',
      events: [],
      bestScore: 0,
    };
  }

  const resultsByRace = new Map(index.results.map((r) => [r.race, r]));
  const events = [];

  for (const app of appearances) {
    if (c4xPlusOnly && !isC4XPlusEvent(app.eventType)) continue;
    const roundRank = ROUND_RANK[app.round] ?? 0;
    const w = eventPerformanceWeight(app.eventType);
    const division = divisionForAppearance(app, resultsByRace);
    const finalTier =
      normalizeRoundKey(app.round) === 'final' ? parseFinalTier(division) : null;
    const aFinalBoatCount =
      finalTier === 'B' ? getAFinalBoatCount(index, app.eventNum) : 2;
    const { finalPlace, finalTime } = resolveFinalPlace(app, resultsByRace, athlete, norm, index.daysheet);
    const placeInRace = finalPlace;
    const overallPlace =
      w.boatClass === 'C1X' && finalTier && placeInRace
        ? overallC1XPlace(finalTier, placeInRace, aFinalBoatCount)
        : placeInRace;
    const basePoints = roundPointsFromAppearance(app, placeInRace, resultsByRace, index);
    const weightedPoints = basePoints * w.combined;

    events.push({
      eventType: app.eventType,
      eventNum: app.eventNum,
      round: app.round,
      roundRank,
      finalPlace: placeInRace,
      placeInRace,
      overallPlace,
      finalTier,
      finalTime,
      basePoints,
      boatWeight: w.boat,
      ageWeight: w.age,
      boatClass: w.boatClass,
      ageClass: w.ageClass,
      weightedPoints,
      points: weightedPoints,
      crew: app.names.join(', '),
    });
  }

  const ranked = sortEventsByWeight(events);
  const best = pickBestScoringEvent(events);
  const participated = events.length > 0;
  const summary = participated
    ? summariseBestEvent(best) || 'Competed at CNZB 2026'
    : c4xPlusOnly
      ? 'No CNZB 2026 C4X+ result'
      : 'No CNZB 2026 record found';

  return {
    participated,
    summary,
    events: ranked.slice(0, 6),
    allEvents: ranked,
    bestScore: best?.weightedPoints ?? 0,
    bestEvent: best,
  };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export async function loadCnibAthleteDirectory() {
  const html = await fetch('https://rowit.nz/cnib2026/results', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  }).then((r) => r.text());
  const m = html.match(/var selectAthOptions=\[(.*?)\];/s);
  if (!m) return [];
  const inner = m[1];
  const re = /\["([^"]*)","([^"]*)","(\d+)"/g;
  const out = [];
  let match;
  while ((match = re.exec(inner))) {
    out.push([match[1], match[2], match[3]]);
  }
  return out;
}

function parseCnibAthleteHtml(html) {
  const events = [];
  const groupRe = /<section class="resultGroup">([\s\S]*?)<\/section>/g;
  let group;
  while ((group = groupRe.exec(html))) {
    const block = group[1];
    const eventMatch = block.match(/<span class="cardKeyCode">([^<]+)<\/span>/);
    if (!eventMatch) continue;
    const eventType = eventMatch[1].trim();
    const placesMatch = block.match(/<div class="result-places">\s*<ul>([\s\S]*?)<\/ul>/);
    if (!placesMatch) continue;
    const rounds = [];
    const resultRe = /<li><a[^>]*>([^<]+)<\/a>:\s*placed\s*(\d+)[^()]*\(([^)]+)\)/gi;
    let r;
    while ((r = resultRe.exec(placesMatch[1]))) {
      rounds.push({ round: r[1].trim(), place: Number(r[2]), time: r[3].trim() });
    }
    if (!rounds.length) continue;
    const final = rounds.find((x) => /final/i.test(x.round));
    const bestRound = final || rounds.at(-1);
    const scored = scoreEventResult(eventType, bestRound.round, bestRound.place, bestRound.round);
    events.push({ eventType, rounds, best: bestRound, ...scored });
  }
  const ranked = sortEventsByWeight(events);
  return ranked;
}

export async function northIslandForAthlete(athlete, directory) {
  const match = bestNameMatch(normalizeName(athlete.fullName), directory);
  if (!match) {
    return { participated: false, summary: 'No CNIB 2026 record found', events: [], bestScore: 0 };
  }
  const html = await fetch(`https://rowit.nz/cnib2026/results?pid=${match.pid}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  }).then((r) => r.text());
  const events = parseCnibAthleteHtml(html);
  if (!events.length) {
    return { participated: false, summary: 'Listed at CNIB 2026 but no published results', events: [], bestScore: 0 };
  }
  const ranked = sortEventsByWeight(events);
  const best = pickBestScoringEvent(events);
  if (!best) {
    return { participated: false, summary: 'Listed at CNIB 2026 but no published results', events: [], bestScore: 0 };
  }
  const summary = `${best.eventType} — ${best.best.round} (${ordinal(best.best.place)}) ${best.best.time}`;
  return {
    participated: true,
    summary,
    events: ranked.slice(0, 5),
    allEvents: ranked,
    bestScore: best.weightedPoints,
    bestEvent: best,
  };
}

function summariseCnibBestEvent(best) {
  if (!best?.best) return 'No CNIB 2026 C4X+ result';
  return `${best.eventType} — ${best.best.round} (${ordinal(best.best.place)}) ${best.best.time}`;
}

export function coxRegattaFromResults(athlete, nationals, northIsland) {
  const c4xNationals = filterRegattaToC4XPlus(nationals, { source: 'CNZB', athlete });
  const c4xNorthIsland = filterRegattaToC4XPlus(northIsland, { source: 'CNIB', athlete });
  return { nationals: c4xNationals, northIsland: c4xNorthIsland };
}

/** Nominees with no credited C4X+ cox results — listed as cox but only rowed in fours. */
const COX_RESULTS_EXCLUDED = new Set([normalizeName('Tallulah Kubaisi-Gallagher')]);

export function isExcludedFromCoxResults(athlete) {
  return COX_RESULTS_EXCLUDED.has(normalizeName(athlete.fullName));
}

/** C4X+ results that count toward cox scoring — excludes junior crews for dual-role nominees (rowing seats). */
export function countsAsCoxC4XResult(athlete, eventType) {
  if (isExcludedFromCoxResults(athlete)) return false;
  if (!isC4XPlusEvent(eventType)) return false;
  if (isCoxPrimaryNominee(athlete)) return true;
  if (!isCoxswainNominee(athlete)) return false;
  const t = String(eventType || '').toUpperCase();
  // Dual-role (scull/row + cox): B/G U17/U18 and Mx U18 fours are rowing, not cox.
  if (/\b[BG]\s+U1[78]\b/i.test(t)) return false;
  if (/\bMX\s+U18\b/i.test(t)) return false;
  return true;
}

function filterRegattaToC4XPlus(regatta, { source = 'CNZB', athlete = null } = {}) {
  const pool = regatta?.allEvents || regatta?.events || [];
  const events = pool.filter((e) =>
    athlete ? countsAsCoxC4XResult(athlete, e.eventType) : isC4XPlusEvent(e.eventType),
  );
  if (!events.length) {
    return {
      participated: false,
      summary: source === 'CNIB' ? 'No CNIB 2026 C4X+ result' : 'No CNZB 2026 C4X+ result',
      events: [],
      bestScore: 0,
    };
  }
  const ranked = sortEventsByWeight(events);
  const best = sortEventsByWeight(events)[0];
  const summary =
    source === 'CNIB' ? summariseCnibBestEvent(best) : summariseBestEvent(best) || 'Competed at CNZB 2026';
  return {
    participated: true,
    summary,
    events: ranked.slice(0, 5),
    bestScore: best.weightedPoints,
    bestEvent: best,
  };
}

export function assessCoxswainRegattaScore(coxNationals, coxNorthIsland) {
  const nationalsPts = coxNationals.bestScore * 0.55;
  const niPts = coxNorthIsland.bestScore * 0.25;
  const round1 = (n) => Math.round(n * 10) / 10;
  return {
    nationalsPts: round1(nationalsPts),
    niPts: round1(niPts),
    total: round1(nationalsPts + niPts),
  };
}

function ergScore(athlete, gender) {
  const sec = split2k(athlete.latest2k);
  if (!sec) return 0;
  const benchmark = gender === 'Female' ? 110 : 100;
  const delta = benchmark - sec;
  return Math.max(0, Math.min(30, Math.round(delta * 4)));
}

function crewlabScore(athlete) {
  const pct = Number.parseFloat(String(athlete.crewlabPotential || '').replace('%', ''));
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(20, Math.round(pct / 5)));
}

function pathwayScore(athlete) {
  let s = 0;
  if (athlete.flags.international) s += 6;
  if (athlete.flags.domestic) s += 4;
  if (athlete.flags.coastal) s += 8;
  if (/scull/i.test(athlete.positions)) s += 4;
  if (/coxswain/i.test(athlete.positions)) s += 2;
  return Math.min(15, s);
}

export function assessAthlete(athlete, nationals, northIsland) {
  const issues = [];
  if (athlete.flags.para) issues.push('Para selection not being considered in 2026 guidelines');
  if (!nationals.participated) issues.push('No 2026 National Beach Sprint Champs (CNZB) result — guideline 2.1.c');
  if (athlete.ageBand === 'U19' && athlete.gender === 'Male') {
    // U19 male must be born no earlier than 1 Jan 2008 — age category from nomination assumed OK
  }

  const nationalsPts = nationals.bestScore * 0.55;
  const niBoatWeight = northIsland.bestEvent?.boatWeight ?? 1;
  const niPts = northIsland.bestScore * 0.25 * niBoatWeight;
  const ergPts = ergScore(athlete, athlete.gender);
  const crewlabPts = crewlabScore(athlete);
  const pathPts = pathwayScore(athlete);

  let total = nationalsPts + niPts + ergPts * 0.25 + crewlabPts * 0.35 + pathPts;
  if (!nationals.participated) total = ergPts * 0.5 + crewlabPts * 0.4 + pathPts * 0.5;

  const eligible = !athlete.flags.para && nationals.participated;
  const flatwaterCrossover = !nationals.participated && (ergPts >= 12 || crewlabPts >= 12);

  let recommendation = 'Monitor';
  if (!eligible && !flatwaterCrossover) recommendation = 'Not recommended for trial invite';
  else if (flatwaterCrossover && !nationals.participated) recommendation = 'Flat-water crossover — GM/coach approval required';
  else if (total >= 55) recommendation = 'Strong trial invite';
  else if (total >= 38) recommendation = 'Trial invite';
  else if (total >= 25) recommendation = 'Camp reserve / late invite';

  const primaryBoats = suggestBoats(athlete);

  return {
    ...athlete,
    nationals,
    northIsland,
    scoring: {
      nationalsPts: round1(nationalsPts),
      niPts: round1(niPts),
      ergPts: round1(ergPts),
      crewlabPts: round1(crewlabPts),
      pathPts: round1(pathPts),
      total: round1(total),
    },
    eligible,
    flatwaterCrossover,
    issues,
    recommendation,
    primaryBoats,
  };
}

export const MAX_RECOMMENDATIONS_PER_GROUP = 5;

const POSITIVE_RECOMMENDATIONS = new Set([
  'Strong trial invite',
  'Trial invite',
  'Flat-water crossover — GM/coach approval required',
  'Camp reserve / late invite',
]);

const RECOMMENDATION_PRIORITY = {
  'Strong trial invite': 4,
  'Trial invite': 3,
  'Flat-water crossover — GM/coach approval required': 2,
  'Camp reserve / late invite': 1,
};

/** Manual group corrections where nomination age category differs from development squad grouping. */
const RECOMMENDATION_GROUP_OVERRIDES = new Map([
  [normalizeName('Hazel Church'), 'U19 Women'],
]);

export function getRecommendationGroup(athlete) {
  const override = RECOMMENDATION_GROUP_OVERRIDES.get(normalizeName(athlete.fullName));
  if (override) return override;
  if (athlete.ageBand === 'U19' && athlete.gender === 'Male') return 'U19 Men';
  if (athlete.ageBand === 'U19' && athlete.gender === 'Female') return 'U19 Women';
  if (athlete.ageBand === 'Open') return 'Open';
  return 'Other';
}

/** Cap positive recommendations to top N athletes per U19 Men / U19 Women / Open. */
export function applyGroupRecommendationCap(assessed, maxPerGroup = MAX_RECOMMENDATIONS_PER_GROUP) {
  const byGroup = new Map();
  for (const athlete of assessed) {
    const group = getRecommendationGroup(athlete);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(athlete);
  }

  for (const [group, members] of byGroup) {
    const ranked = members
      .filter((a) => POSITIVE_RECOMMENDATIONS.has(a.recommendation))
      .sort((a, b) => {
        const byTier = RECOMMENDATION_PRIORITY[b.recommendation] - RECOMMENDATION_PRIORITY[a.recommendation];
        if (byTier !== 0) return byTier;
        return b.scoring.total - a.scoring.total;
      });

    for (let i = maxPerGroup; i < ranked.length; i++) {
      const athlete = ranked[i];
      if (isProposedTrialInvite(athlete.fullName)) continue;
      athlete.recommendation = 'Monitor';
      athlete.issues = [...(athlete.issues || []), `Outside top ${maxPerGroup} in ${group} — monitor only`];
    }
  }

  return assessed;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function suggestBoats(athlete) {
  const boats = [];
  const g = athlete.gender;
  const age = athlete.ageBand;
  const pos = athlete.positions.toLowerCase();
  if (/coxswain/.test(pos)) boats.push('CMix4x+ (cox)');
  if (/scull/.test(pos) || /stroke/.test(pos)) {
    if (age === 'U19' && g === 'Male') boats.push('U19 M1x-', 'U19 M2x-', 'U19 Mix2x-');
    if (age === 'U19' && g === 'Female') boats.push('U19 W1x-', 'U19 W2x-', 'U19 Mix2x-');
    if (age === 'Open') boats.push('Open Mix4x+', g === 'Male' ? 'Open M1x-' : 'Open W1x-');
  }
  if (age === 'U19') boats.push('U19 crew combinations');
  if (age === 'Open') boats.push('Open Mix4x+');
  return [...new Set(boats)];
}

export function isCoxswainNominee(athlete) {
  return /coxswain/i.test(athlete.positions || '');
}

/** Cox-only nominees, or cox listed ahead of scull/stroke/bow — ranked separately from rower groups. */
export function isCoxPrimaryNominee(athlete) {
  if (!isCoxswainNominee(athlete)) return false;
  const parts = String(athlete.positions || '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return false;
  const hasRowerRole = parts.some(
    (p) => p.includes('scull') || p.includes('stroke') || p.includes('bow'),
  );
  if (!hasRowerRole) return true;
  return parts[0] === 'coxswain';
}

export function buildCoxswainNominees(assessed) {
  const all = assessed
    .filter(isCoxswainNominee)
    .filter((a) => !isExcludedFromCoxResults(a))
    .sort((a, b) => (b.coxScoring?.total ?? 0) - (a.coxScoring?.total ?? 0));
  const males = all.filter((a) => a.gender === 'Male');
  const females = all.filter((a) => a.gender === 'Female');

  const recommendFrom = (list) =>
    list.find((a) => !isProposedTrialInvite(a.fullName) && a.coxNationals?.participated) ||
    list.find((a) => !isProposedTrialInvite(a.fullName) && a.coxNorthIsland?.participated) ||
    list.find((a) => !isProposedTrialInvite(a.fullName)) ||
    null;

  return {
    all,
    males,
    females,
    recommendedMale: recommendFrom(males),
    recommendedFemale: recommendFrom(females),
  };
}

/** Rowers and dual-role nominees — excludes cox-primary from rower working analysis and appendix. */
export function rowerAnalysisNominees(assessed) {
  return assessed.filter((a) => !isCoxPrimaryNominee(a));
}

export function buildCrewSuggestions(assessed) {
  const u19M = assessed.filter((a) => a.eligible && a.gender === 'Male' && a.ageBand === 'U19' && a.scoring.total >= 38);
  const u19F = assessed.filter((a) => a.eligible && a.gender === 'Female' && a.ageBand === 'U19' && a.scoring.total >= 38);
  const open = assessed.filter((a) => a.eligible && a.ageBand === 'Open' && a.scoring.total >= 38);
  const cox = assessed.filter((a) => a.eligible && /coxswain/i.test(a.positions));

  u19M.sort((a, b) => b.scoring.total - a.scoring.total);
  u19F.sort((a, b) => b.scoring.total - a.scoring.total);
  open.sort((a, b) => b.scoring.total - a.scoring.total);

  return {
    u19M2x: u19M.slice(0, 4).map((a) => a.fullName),
    u19W2x: u19F.slice(0, 4).map((a) => a.fullName),
    u19Mix2x: [
      u19M[0]?.fullName,
      u19F[0]?.fullName,
    ].filter(Boolean),
    openMix4x: [
      ...open.slice(0, 2).map((a) => a.fullName),
      ...u19M.slice(0, 1).map((a) => a.fullName),
      ...u19F.slice(0, 1).map((a) => a.fullName),
    ].filter(Boolean),
    coxCandidates: cox.sort((a, b) => b.scoring.total - a.scoring.total).slice(0, 3).map((a) => a.fullName),
  };
}

/** Concise trial invite lists by selector group (summary page). */
export const TRIAL_LIST_BY_GROUP = [
  {
    id: 'open',
    title: 'Open',
    invites: [
      {
        name: 'Holly Chaafe',
        reason: 'W Open C1X B-final winner at CNZB 2026 — leading open women’s nominee.',
      },
      {
        name: 'Coby Goode',
        reason: 'M Open C1X B-final 2nd (overall 4th) at CNZB 2026 — leading open men’s nominee.',
      },
      {
        name: 'Liam Collins',
        reason: 'M Open C1X semi-finalist at CNZB and CNIB 2026.',
      },
    ],
  },
  {
    id: 'u19Men',
    title: 'Men’s U19',
    invites: [
      { name: 'Arthur Crimmins', reason: 'B U18 C1X A-final 1st at CNZB 2026.' },
      { name: 'Guy Smith', reason: 'B U18 C1X semi-finalist at CNZB 2026.' },
      { name: 'Henry Johnston', reason: 'B U18 C1X semi-finalist at CNZB 2026.' },
      { name: 'Leonardo Bacchus', reason: 'B U18 C1X A-final 2nd at CNZB 2026.' },
      { name: 'Jacob Haley', reason: 'Mx U18 C2X A-final winner at CNZB 2026 (Mix2x pathway).' },
      { name: 'Kaine Goonan', reason: 'B U18 C2X A-final winner at CNZB 2026 (partner not nominated).' },
    ],
  },
  {
    id: 'u19Women',
    title: 'Women’s U19',
    invites: [
      { name: 'Elizabeth Keddell', reason: 'G U18 C1X semi-finalist at CNZB 2026.' },
      { name: 'Emily Pengelly', reason: 'G U18 C1X A-final 1st and G U18 C2X A-final winner at CNZB 2026.' },
      { name: 'Tallulah Kubaisi-Gallagher', reason: 'G U18 C1X A-final 2nd at CNZB 2026.' },
      { name: 'Millie Brooks', reason: 'Mx U18 C2X A-final winner at CNZB 2026 (Mix2x pathway).' },
    ],
  },
];

export function isProposedTrialInvite(fullName) {
  for (const group of TRIAL_LIST_BY_GROUP) {
    for (const inv of group.invites) {
      if (namesLooselyMatch(inv.name, fullName)) return true;
    }
  }
  return false;
}

/** Badge/recommendation for appendix — selector trial list overrides composite tier. */
export function appendixRecommendation(athlete) {
  if (isProposedTrialInvite(athlete.fullName)) {
    return athlete.scoring.total >= 55 ? 'Strong trial invite' : 'Trial invite';
  }
  return athlete.recommendation;
}

/** Boat-class consideration in Olympic priority order (summary page 2). */
export const BOAT_CLASS_CONSIDERATION = [
  {
    priority: 1,
    title: 'Open',
    classes: [
      { boat: 'Open Mix4x+ / senior coastal', athletes: ['Holly Chaafe', 'Coby Goode'] },
      { boat: 'M Open C1X', athletes: ['Coby Goode', 'Liam Collins'] },
      { boat: 'W Open C1X', athletes: ['Holly Chaafe'] },
    ],
  },
  {
    priority: 2,
    title: 'U19 singles (1x)',
    classes: [
      {
        boat: 'U19 M1x-',
        athletes: ['Arthur Crimmins', 'Guy Smith', 'Henry Johnston', 'Leonardo Bacchus'],
      },
      {
        boat: 'U19 W1x-',
        athletes: ['Elizabeth Keddell', 'Emily Pengelly', 'Tallulah Kubaisi-Gallagher'],
      },
    ],
  },
  {
    priority: 3,
    title: 'U19 mixed double (Mix2x-)',
    classes: [{ boat: 'U19 Mix2x-', athletes: ['Jacob Haley', 'Millie Brooks'] }],
  },
  {
    priority: 4,
    title: "U19 men's double (M2x-)",
    classes: [{ boat: 'U19 M2x-', athletes: ['Kaine Goonan'] }],
  },
  {
    priority: 5,
    title: "U19 women's double (W2x-)",
    classes: [{ boat: 'U19 W2x-', athletes: ['Emily Pengelly'] }],
  },
];

/** @deprecated use BOAT_CLASS_CONSIDERATION — kept for imports that expect event-shaped rows */
export const COACH_TRIAL_SELECTION = BOAT_CLASS_CONSIDERATION.flatMap((section) =>
  section.classes.map((cls) => ({
    id: cls.boat.replace(/\s+/g, '-').toLowerCase(),
    boat: cls.boat,
    priority: String(section.priority),
    title: cls.boat,
    rationale: section.title,
    athletes: cls.athletes,
    nationalsNote: '',
    notes: [],
  })),
);

export const U19_BOAT_PRIORITY = ['U19 1x (singles)', 'U19 Mix2x-', 'U19 2x- (same-gender)'];

function namesLooselyMatch(a, b) {
  const na = normalizeName(a).split(' ').filter(Boolean);
  const nb = normalizeName(b).split(' ').filter(Boolean);
  if (!na.length || !nb.length) return false;
  return na.at(-1) === nb.at(-1) && na[0] === nb[0];
}

export function findAssessedAthlete(fullName, assessed) {
  const norm = normalizeName(fullName);
  return (
    assessed.find((a) => normalizeName(a.fullName) === norm) ||
    assessed.find((a) => namesLooselyMatch(a.fullName, fullName)) ||
    null
  );
}

export function trialBoatsForAthlete(fullName, consideration = BOAT_CLASS_CONSIDERATION) {
  const boats = [];
  for (const section of consideration) {
    for (const cls of section.classes) {
      if (cls.athletes.some((n) => namesLooselyMatch(n, fullName))) {
        boats.push(cls.boat);
      }
    }
  }
  return [...new Set(boats)];
}

export function buildCoachTrialInviteIndex(assessed, consideration = BOAT_CLASS_CONSIDERATION) {
  const rows = [];
  const seen = new Set();

  for (const section of consideration) {
    for (const cls of section.classes) {
      for (const name of cls.athletes) {
        const athlete = findAssessedAthlete(name, assessed);
        const key = athlete ? normalizeName(athlete.fullName) : normalizeName(name);
        if (seen.has(key)) {
          const existing = rows.find((r) => r.key === key);
          existing.boats.push(cls.boat);
          continue;
        }
        seen.add(key);
        rows.push({
          key,
          name: athlete?.fullName || name,
          boats: [cls.boat],
          athlete,
          nominated: Boolean(athlete),
          nationals: athlete?.nationals.summary || '—',
          club: athlete?.club || '—',
        });
      }
    }
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function decisionSummaryForAthlete(athlete, consideration = BOAT_CLASS_CONSIDERATION) {
  const boats = trialBoatsForAthlete(athlete.fullName, consideration);
  if (boats.length) {
    return `Trial invite — ${boats.join(', ')} (selector recommendation)`;
  }
  if (athlete.recommendation === 'Flat-water crossover — GM/coach approval required') {
    return `${athlete.recommendation} — not on U19 boat-class trial list; GM/coach review required.`;
  }
  if (athlete.recommendation === 'Not recommended for trial invite') {
    return 'Not recommended for trial invite at this stage.';
  }
  if (athlete.recommendation === 'Monitor' && athlete.issues.some((i) => /Outside top/i.test(i))) {
    return `Monitor — ${athlete.issues.find((i) => /Outside top/i.test(i)) || 'below category cap'}.`;
  }
  return athlete.recommendation;
}
