/**
 * 2025/26 season Open & Premier results summary from RowIT regattas.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  finalDivisionLabel,
  loadNationalsIndex,
  normalizeName,
  overallC1XPlace,
  parseFinalTier,
} from './beach-sprint-selection.mjs';
import { buildDaysheetIndex, readTextIfExists, scrapeRegattaResultsCsv } from './regatta-results-scrape.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARCHIVES = join(__dirname, '..', '..', 'public', 'data', 'archives');
const DATA = join(__dirname, '..', '..', 'public', 'data');

const ROUND_RANK = { heat: 1, repechage: 2, 'quarter-final': 3, 'semi-final': 4, final: 5 };
const FINAL_POINTS = { 1: 100, 2: 85, 3: 70, 4: 55, 5: 45, 6: 40 };

const BEACH_SPRINT_REGATTAS = [
  { code: 'cnzb2026', label: 'CNZB 2026', dir: join(ARCHIVES, 'cnzb2026', 'latest') },
  { code: 'cnib2026', label: 'CNIB 2026', scrape: true },
];

const CLASSIC_REGATTAS = [
  { code: 'nicc2026', label: 'NICC 2026', dir: join(ARCHIVES, 'nicc2026', 'latest'), scrape: true },
  { code: 'nzcc2026', label: 'NZCC 2026', dir: join(ARCHIVES, 'nzcc2026', 'latest'), scrape: true, optional: true },
];

const CLASSIC_SCRAPE_EVENTS = {
  nicc2026: ['8', '9', '19', '20', '30', '38', '47'],
  nzcc2026: ['6', '7', '15', '16', '28', '29', '36', '37', '43', '44'],
};

const FLAGSHIP_BEACH = ['M Opn C1X', 'W Opn C1X', 'Mx Opn C2X', 'Mx Opn C4X+'];
const FLAGSHIP_CLASSIC = [
  'M Prm 1X',
  'W Prm 1X',
  'M Prm 2-',
  'W Prm 2-',
  'M Prm 2X',
  'W Prm 2X',
  'M Prm 4-',
  'W Prm 4-',
  'M Prm 4X-',
  'W Prm 4X-',
];

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

function normalizeRoundKey(round) {
  const s = String(round || '').toLowerCase();
  if (/semi.?final/.test(s)) return 'semi-final';
  if (/quarter.?final/.test(s)) return 'quarter-final';
  if (/repechage/.test(s)) return 'repechage';
  if (/final/.test(s)) return 'final';
  if (/heat/.test(s)) return 'heat';
  return s || 'heat';
}

function roundFromCode(code) {
  const c = String(code || '').toLowerCase();
  if (c === 'f' || c === 'e') return 'final';
  if (c === 's') return 'semi-final';
  if (c === 'q') return 'quarter-final';
  if (c === 'r') return 'repechage';
  return 'heat';
}

function crewCodeToken(crew) {
  return String(crew || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\*.*$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseCompetitors(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\d/.test(line)) continue;
    const p = parseCsvLine(line);
    if (p.length < 7) continue;
    const raceMatch = String(p[0]).match(/^(\d+)/);
    if (!raceMatch) continue;
    const namesRaw = p[p.length - 1];
    const names = String(namesRaw || '')
      .replace(/^"|"$/g, '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    if (!names.length) continue;
    entries.push({
      race: Number(raceMatch[1]),
      eventKey: String(p[2] || '').trim(),
      eventType: p[3] || '',
      round: normalizeRoundKey(p[4]),
      division: p[5]?.trim() || '',
      names,
    });
  }
  return entries;
}

function parseResultsMulti(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\d+,/.test(line)) continue;
    const p = parseCsvLine(line);
    if (p.length < 8) continue;
    const entries = [];
    for (let i = 6; i + 2 < p.length; i += 3) {
      const place = Number(p[i]);
      const crew = p[i + 1];
      const time = p[i + 2];
      if (Number.isFinite(place) && crew) entries.push({ place, crew, time });
    }
    rows.push({
      race: Number(p[0]),
      eventKey: String(p[1]).trim(),
      roundCode: p[2],
      division: p[3],
      round: roundFromCode(p[2]),
      entries,
    });
  }
  return rows;
}

function parseEvents(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const hashCol = header.findIndex((h) => h.trim() === '#');
  const eventNumCol = header.findIndex((h) => /event\s*#/i.test(h));
  const keyCol = hashCol >= 0 ? hashCol : eventNumCol >= 0 ? eventNumCol : 0;
  const typeCol = header.findIndex((h) => /event type/i.test(h));
  const classCol = header.findIndex((h) => /^class$/i.test(h.trim()));
  const genderCol = header.findIndex((h) => /^gender$/i.test(h.trim()));
  const boatCol = header.findIndex((h) => /^boat$/i.test(h.trim()));

  const map = new Map();
  for (const line of lines.slice(1)) {
    if (!/^\d+,/.test(line)) continue;
    const p = parseCsvLine(line);
    const eventKey = String(p[keyCol] || '').trim();
    if (!eventKey) continue;
    map.set(eventKey, {
      eventKey,
      eventType: p[typeCol] || '',
      gender: p[genderCol] || '',
      className: (p[classCol] || '').trim(),
      boat: p[boatCol] || '',
    });
  }
  return map;
}

function parseDaysheetMulti(text) {
  const map = new Map();
  let laneStart = 6;
  let laneCount = 9;
  for (const line of text.split(/\r?\n/)) {
    if (!/^\d/.test(line)) continue;
    const p = parseCsvLine(line);
    if (/^Race,/i.test(p[0])) {
      const header = p;
      laneStart = header.findIndex((h) => /^lane/i.test(String(h)));
      if (laneStart < 0) laneStart = 6;
      laneCount = header.filter((h) => /^lane/i.test(String(h))).length || 9;
      continue;
    }
    const raceMatch = String(p[0]).match(/^(\d+)/);
    if (!raceMatch) continue;
    const race = Number(raceMatch[1]);
    const lanes = p
      .slice(laneStart, laneStart + laneCount)
      .map((x) => x.trim())
      .filter((x) => x && !/^-/.test(x) && !/^medals$/i.test(x));
    map.set(race, {
      race,
      eventKey: String(p[2] || '').trim(),
      eventType: p[3] || '',
      round: normalizeRoundKey(p[4]),
      division: p[5]?.trim() || '',
      lanes,
    });
  }
  return map;
}

function isPremOpenEvent(event) {
  if (!event) return false;
  const cls = String(event.className || '').trim();
  if (/^(Prm|Opn|Open)$/i.test(cls)) return true;
  const type = String(event.eventType || '');
  if (/\(P\)/i.test(type)) return true;
  if (/\bPrm\b/i.test(type)) return true;
  if (/\bOpn\b|\bOpen\b/i.test(type) && !/\bClb\b|\bU1[789]\b|\bInt\b|\bNov\b|\bSnr\b/i.test(type)) return true;
  return false;
}

function isBeachSprintEvent(event) {
  const type = String(event?.eventType || '');
  return /C1X|C2X|C4X/i.test(type) || /\bOpn\b.*C/i.test(type);
}

function eventScrapeNum(eventKey) {
  const m = String(eventKey).match(/^(\d+)/);
  return m ? m[1] : String(eventKey);
}

function resultsHaveFinals(text) {
  return /^\d+,\d+,f,/m.test(String(text || ''));
}

async function fetchRegattaCsv(regattaCode, fileId) {
  for (const base of [`https://l.rowit.nz/altitude/${regattaCode}`, `https://rowit.nz/altitude/${regattaCode}`]) {
    try {
      const res = await fetch(`${base}/${fileId}.csv`, {
        headers: { 'User-Agent': 'Mozilla/5.0 RNZ-season-summary' },
      });
      if (res.ok) {
        const text = await res.text();
        if (text.includes(',') && text.length > 20) return text;
      }
    } catch {
      // try next base
    }
  }
  throw new Error(`Could not fetch ${regattaCode}/${fileId}.csv`);
}

async function loadRegattaCsv(regatta, fileId) {
  const dir = regatta.dir || join(ARCHIVES, regatta.code, 'latest');
  const local = await readTextIfExists(join(dir, `${fileId}.csv`));
  if (local) return local;
  return fetchRegattaCsv(regatta.code, fileId);
}

export async function loadRegattaIndex(regatta) {
  const [competitorsRaw, eventsRaw, daysheetRaw] = await Promise.all([
    loadRegattaCsv(regatta, 'competitors'),
    loadRegattaCsv(regatta, 'events'),
    loadRegattaCsv(regatta, 'daysheet'),
  ]);

  let resultsRaw =
    (await readTextIfExists(join(regatta.dir || join(ARCHIVES, regatta.code, 'latest'), 'results.csv'))) ||
    (await readTextIfExists(join(DATA, `${regatta.code}-results.csv`))) ||
    (regatta.code === 'nicc2026' ? await readTextIfExists(join(DATA, 'nicc-results.csv')) : null);

  const events = parseEvents(eventsRaw);
  const premOpenKeys = [...events.entries()]
    .filter(([, ev]) => isPremOpenEvent(ev) && (!regatta.code.startsWith('cn') || isBeachSprintEvent(ev)))
    .map(([k]) => k);

  const filterFn = regatta.eventFilter || defaultEventFilter;
  const filteredKeys = regatta.scrapeEvents
    ? regatta.scrapeEvents.map(String)
    : [...events.entries()]
        .filter(([, ev]) => filterFn(ev, null, { code: regatta.code }))
        .map(([k]) => k);

  const scrapeNums = [
    ...new Set(
      (regatta.scrapeEventNums ||
        CLASSIC_SCRAPE_EVENTS[regatta.code] ||
        filteredKeys.map(eventScrapeNum)).map(String),
    ),
  ];
  const hasFinals = resultsHaveFinals(resultsRaw);

  if (regatta.scrape && (!resultsRaw || !hasFinals) && scrapeNums.length) {
    try {
      resultsRaw = await scrapeRegattaResultsCsv(regatta.code, scrapeNums, {
        daysheetText: daysheetRaw,
        delayMs: regatta.scrapeDelayMs ?? 150,
      });
    } catch (err) {
      if (!regatta.optional) console.warn(`Scrape ${regatta.code} failed:`, err.message);
    }
  }

  return {
    regatta: regatta.label,
    code: regatta.code,
    events,
    competitors: parseCompetitors(competitorsRaw),
    results: parseResultsMulti(resultsRaw || ''),
    daysheet: parseDaysheetMulti(daysheetRaw),
    premOpenKeys,
  };
}

export async function loadCnzbIndex() {
  const idx = await loadNationalsIndex({ dir: join(ARCHIVES, 'cnzb2026', 'latest') });
  const events = new Map([...idx.events.entries()].map(([k, v]) => [String(k), { ...v, eventKey: String(k) }]));
  return {
    regatta: 'CNZB 2026',
    code: 'cnzb2026',
    events,
    competitors: idx.competitors.map((c) => ({
      ...c,
      eventKey: String(c.eventNum),
      round: normalizeRoundKey(c.round),
    })),
    results: idx.results.map((r) => ({
      ...r,
      eventKey: String(r.eventNum),
      round: roundFromCode(r.roundCode),
    })),
    daysheet: new Map(
      [...idx.daysheet.entries()].map(([k, v]) => [
        k,
        {
          ...v,
          eventKey: String(v.eventNum),
          round: normalizeRoundKey(v.round),
          lanes: [v.lane1, v.lane2].filter(Boolean),
        },
      ]),
    ),
    premOpenKeys: ['19', '20', '25', '30'],
  };
}

function assignNamesToLanes(names, lanes) {
  if (!lanes.length) return names.map((name) => ({ name, crew: '' }));
  if (names.length === lanes.length) {
    return names.map((name, i) => ({ name, crew: lanes[i] || '' }));
  }
  if (names.length > lanes.length && names.length % lanes.length === 0) {
    const group = names.length / lanes.length;
    const out = [];
    for (let li = 0; li < lanes.length; li++) {
      for (const name of names.slice(li * group, (li + 1) * group)) {
        out.push({ name, crew: lanes[li] });
      }
    }
    return out;
  }
  if (names.length === 1) return [{ name: names[0], crew: lanes[0] || '' }];
  if (lanes.length === 2 && names.length === 2) {
    return names.map((name, i) => ({ name, crew: lanes[i] || '' }));
  }
  return names.map((name, i) => ({ name, crew: lanes[Math.min(i, lanes.length - 1)] || '' }));
}

function namesForCrew(assigned, crewCode) {
  const token = crewCodeToken(crewCode);
  const hits = assigned.filter((a) => crewCodeToken(a.crew) === token).map((a) => a.name);
  if (hits.length) return hits.join(' / ');
  return crewCode;
}

function podiumFromRace(index, comp, result) {
  const ds = index.daysheet.get(comp.race);
  if (!ds || !result?.entries?.length) return null;
  if (/cancelled/i.test(comp.names.join(' '))) return null;

  const lanes = ds.lanes?.length ? ds.lanes : [ds.lane1, ds.lane2].filter(Boolean);
  const assigned = assignNamesToLanes(comp.names, lanes);
  const isSingle = /1X|C1X/i.test(comp.eventType);

  const rows = result.entries
    .filter((e) => e.place >= 1 && e.place <= 9)
    .sort((a, b) => a.place - b.place)
    .map((e) => ({
      place: e.place,
      time: e.time,
      crew: e.crew,
      name: isSingle
        ? assigned.find((a) => crewCodeToken(a.crew) === crewCodeToken(e.crew))?.name || namesForCrew(assigned, e.crew)
        : namesForCrew(assigned, e.crew),
    }));

  if (!rows.length) return null;

  const finalTier = parseFinalTier(comp.division || result.division || ds.division);
  return {
    eventType: comp.eventType,
    eventKey: comp.eventKey,
    round: comp.round,
    finalTier: finalTier === 'B' ? 'B' : 'A',
    finalLabel: `${finalDivisionLabel(comp.division || result.division || ds.division)} Final`,
    rows,
  };
}

export function isSchoolsHeadlineEvent(event) {
  const type = String(event?.eventType || '').replace(/\s+/g, ' ').trim();
  return /^[BG] U18 (1X|2X|4X\+|8\+|4\+|2-)/.test(type);
}

export function isCoastalHeadlineEvent(event) {
  const type = String(event?.eventType || '');
  if (!/C1X|C2X|C4X/i.test(type)) return false;
  if (/\bOpn\b|\bOpen\b/i.test(type)) return true;
  if (/\bU18\b/i.test(type) && /C1X|C2X|C4X/i.test(type)) return true;
  return false;
}

function defaultEventFilter(ev, comp, index) {
  if (!ev) return true;
  if (index?.code?.startsWith('cn') && !isBeachSprintEvent(ev)) return false;
  return isPremOpenEvent(ev);
}

function buildEventPodiums(index, options = {}) {
  const eventFilter = options.eventFilter || defaultEventFilter;
  const podiums = [];
  const seen = new Set();

  for (const comp of index.competitors) {
    if (comp.round !== 'final') continue;
    const ev = index.events.get(comp.eventKey);
    if (ev && !eventFilter(ev, comp, index)) continue;

    const key = `${comp.eventKey}|${comp.round}|${comp.division}|${comp.race}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const result = index.results.find((r) => r.race === comp.race);
    const podium = podiumFromRace(index, comp, result);
    if (podium) podiums.push({ regatta: index.regatta, ...podium });
  }
  return podiums;
}

function overallPlaceForRow(podium, row) {
  if (/1X|C1X/i.test(podium.eventType)) {
    const aCount = podium.rows.filter((r) => podium.finalTier === 'A' || podium.finalLabel.startsWith('A')).length;
    if (podium.finalTier === 'B') {
      return overallC1XPlace('B', row.place, Math.max(aCount, 2));
    }
    return row.place;
  }
  return row.place;
}

function pointsForResult(podium, row) {
  const place = overallPlaceForRow(podium, row);
  return FINAL_POINTS[place] ?? Math.max(10, 50 - place * 5);
}

function athleteLabel(name, eventType) {
  if (/1X|C1X/i.test(eventType)) return name;
  return name;
}

export function collectStandouts(podiums, { discipline }) {
  const scores = new Map();

  for (const p of podiums) {
    const weight = /1X|C1X/i.test(p.eventType) ? 1 : /2X|2-|2x/i.test(p.eventType) ? 0.7 : 0.55;
    for (const row of p.rows.slice(0, 3)) {
      const pts = pointsForResult(p, row) * weight;
      const names =
        /1X|C1X/i.test(p.eventType) || row.name === row.crew
          ? [row.name]
          : p.rows.length <= 2
            ? [row.name]
            : [row.name];

      for (const name of names) {
        if (!name || /^\s*$/.test(name) || /^[A-Z0-9*]+\s+\d+$/.test(name)) continue;
        const key = normalizeName(name);
        const rec = scores.get(key) || {
          name: name.trim(),
          points: 0,
          highlights: [],
        };
        rec.points += pts;
        const place = overallPlaceForRow(p, row);
        const ord = place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`;
        rec.highlights.push(`${p.regatta}: ${p.eventType} — ${ord} (${p.finalLabel})`);
        scores.set(key, rec);
      }
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.points - a.points)
    .slice(0, 8)
    .map((a) => ({ ...a, discipline }));
}

export function selectFlagshipPodiums(podiums, flagshipTypes) {
  const out = [];
  for (const type of flagshipTypes) {
    const matches = podiums.filter((p) => p.eventType.replace(/\s+/g, ' ') === type.replace(/\s+/g, ' '));
    const hit =
      matches.find((p) => p.finalTier === 'A' && p.finalLabel.startsWith('A')) ||
      matches.find((p) => p.finalTier === 'A') ||
      matches[0];
    if (hit) out.push(hit);
  }
  return out;
}

export async function buildSeasonResultsSummary() {
  const cnzb = await loadCnzbIndex();
  let cnib = null;
  try {
    cnib = await loadRegattaIndex(BEACH_SPRINT_REGATTAS[1]);
  } catch (err) {
    console.warn('CNIB load skipped:', err.message);
  }

  const beachPodiums = [...buildEventPodiums(cnzb), ...(cnib ? buildEventPodiums(cnib) : [])];

  const classicIndexes = [];
  for (const reg of CLASSIC_REGATTAS) {
    try {
      classicIndexes.push(await loadRegattaIndex(reg));
    } catch (err) {
      if (!reg.optional) console.warn(`${reg.code} load failed:`, err.message);
    }
  }

  const classicPodiums = classicIndexes.flatMap((idx) => buildEventPodiums(idx));

  const sources = {
    beach: ['CNZB 2026 (Coastal Nationals)', cnib ? 'CNIB 2026 (North Island Coastal)' : null].filter(Boolean),
    classic: classicIndexes.map((i) => i.regatta),
  };

  if (!classicIndexes.find((i) => i.code === 'nzcc2026')?.results?.length) {
    sources.classicNote = 'NZCC 2026: results not yet published on RowIT — NICC used as primary classic reference.';
  }

  return {
    generatedAt: new Date().toISOString(),
    season: '2025/26',
    scope: 'Open & Premier events only (RowIT)',
    beachSprint: {
      sources: sources.beach,
      flagship: selectFlagshipPodiums(beachPodiums, FLAGSHIP_BEACH),
      standouts: collectStandouts(beachPodiums, { discipline: 'beach sprint' }),
    },
    classic: {
      sources: sources.classic,
      note: sources.classicNote,
      flagship: selectFlagshipPodiums(classicPodiums, FLAGSHIP_CLASSIC),
      standouts: collectStandouts(classicPodiums, { discipline: 'classic' }),
    },
    allPodiums: { beach: beachPodiums, classic: classicPodiums },
  };
}

export {
  FLAGSHIP_BEACH,
  FLAGSHIP_CLASSIC,
  buildEventPodiums,
  eventScrapeNum,
  isPremOpenEvent,
  isBeachSprintEvent,
};

export function headlineTypesFromEvents(events, matcher) {
  return [...events.values()]
    .filter((ev) => matcher(ev))
    .map((ev) => ev.eventType.replace(/\s+/g, ' ').trim())
    .filter((v, i, a) => a.indexOf(v) === i);
}
