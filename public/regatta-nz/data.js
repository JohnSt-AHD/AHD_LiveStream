/**
 * Regatta NZ — NZ Masters 2026 RowIT sample (daysheet, competitors, results).
 */

const REGATTA = {
  code: 'nzmm2026',
  name: 'NZ Masters Championships 2026',
  venue: 'Lake Karāpiro',
  demoLiveRaceKey: '1 (A)',
  /** Assumed on-course window when result time is missing (ms). */
  defaultRaceMs: 8 * 60 * 1000,
  startBlocksMs: 10 * 60 * 1000,
  finishedWindowMs: 10 * 60 * 1000,
  /**
   * Broadcast / YouTube / Vimeo / club stream for this regatta.
   * Set `active: true` and a real `url` when the stream is on.
   */
  livestream: {
    label: 'Watch the livestream',
    url: '',
    active: false,
    note: 'Livestream link will appear here when this regatta is on air.',
  },
};

const LOOKUP_URL = new URL('../data/ahd-lookup.json', import.meta.url).href;
const LS_CODE = 'altitudeHdRegattaCode_v1';
const LS_RNZ = 'altitudeHdRegattaNz_v1';

function normalizeCode(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

function applyConfigOverlay(cfg, raw) {
  if (!raw || typeof raw !== 'object') return;
  const c = normalizeCode(raw.code);
  if (c) cfg.code = c;
  if (raw.livestreamUrl != null) cfg.livestreamUrl = String(raw.livestreamUrl).trim();
  if (raw.livestreamActive != null) cfg.livestreamActive = Boolean(raw.livestreamActive);
  if (raw.livestreamLabel) cfg.livestreamLabel = String(raw.livestreamLabel).trim();
  if (raw.mode === 'live' || raw.mode === 'sim') cfg.mode = raw.mode;
  if (raw.streamId && /^[a-zA-Z0-9._-]{1,128}$/.test(String(raw.streamId))) {
    cfg.streamId = String(raw.streamId).trim();
  }
}

const REMOTE_CFG_URL = new URL('../api/regatta-nz-config', import.meta.url).href;

/** Hub localStorage + shared API + query override for spectator settings. */
export async function readSpectatorConfig() {
  const cfg = {
    code: REGATTA.code,
    livestreamUrl: REGATTA.livestream?.url || '',
    livestreamActive: Boolean(REGATTA.livestream?.active),
    livestreamLabel: REGATTA.livestream?.label || 'Watch the livestream',
    mode: 'sim',
    streamId: 'ged-sim',
  };
  try {
    const fromLs = normalizeCode(localStorage.getItem(LS_CODE));
    if (fromLs && fromLs !== 'mads2026') cfg.code = fromLs;
  } catch {
    /* ignore */
  }
  try {
    applyConfigOverlay(cfg, JSON.parse(localStorage.getItem(LS_RNZ) || '{}'));
  } catch {
    /* ignore */
  }
  // Shared hub→phone config (APK does not share the operator browser's localStorage).
  try {
    const res = await fetch(REMOTE_CFG_URL, { cache: 'no-store' });
    if (res.ok) applyConfigOverlay(cfg, await res.json());
  } catch {
    /* ignore offline / missing API */
  }
  try {
    const q = new URLSearchParams(location.search);
    const qc = normalizeCode(q.get('regatta') || q.get('code'));
    if (qc) cfg.code = qc;
    if (q.get('mode') === 'live' || q.get('mode') === 'sim') cfg.mode = q.get('mode');
    if (q.get('sim') === '1') cfg.mode = 'sim';
    if (q.get('sim') === '0') cfg.mode = 'live';
  } catch {
    /* ignore */
  }
  if (cfg.livestreamActive && !cfg.livestreamUrl) cfg.livestreamActive = false;
  return cfg;
}

function isCsvLike(text) {
  const t = String(text || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (t.length < 20 || !t.includes(',')) return false;
  // Vercel often serves index.html (200) for missing static paths.
  if (/^<!doctype html/i.test(t) || /<html[\s>]/i.test(t)) return false;
  if (/nothing published/i.test(t)) return false;
  return /event|race|day |competitor|lane_/i.test(t);
}

async function fetchTextFirst(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        lastErr = new Error(`${url} ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!isCsvLike(text)) {
        lastErr = new Error(`${url} not CSV`);
        continue;
      }
      return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No data URL succeeded');
}

function fetchCsvProxy(absoluteCsvUrl) {
  return new URL(
    `../api/fetch-csv?url=${encodeURIComponent(absoluteCsvUrl)}`,
    import.meta.url,
  ).href;
}

function pathsForCode(code) {
  const c = normalizeCode(code) || REGATTA.code;
  const live = new URL(`../data/rowit-live/${c}/`, import.meta.url).href;
  const archive = new URL(`../data/archives/${c}/latest/`, import.meta.url).href;
  const rowitFile = (file) => `https://l.rowit.nz/altitude/${c}/${file}`;
  // Prefer archives (in git/deploy), then local live cache, then RowIT via API proxy.
  return {
    code: c,
    daysheet: [
      `${archive}daysheet.csv`,
      `${live}daysheet.csv`,
      fetchCsvProxy(rowitFile('daysheet.csv')),
    ],
    competitors: [
      `${archive}competitors.csv`,
      `${live}competitors.csv`,
      fetchCsvProxy(rowitFile('competitors.csv')),
    ],
    results: [
      `${archive}results.csv`,
      `${live}results.csv`,
      fetchCsvProxy(rowitFile('results.csv')),
    ],
  };
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function clubCodeFromEntry(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/^([A-Z]{2,5}\*?)/i);
  return m ? m[1].toUpperCase() : s.split(/\s+/)[0].toUpperCase();
}

/** Followable age-group chips (ids stored in localStorage). */
export const AGE_GROUP_OPTIONS = [
  { id: 'U15', label: 'U15' },
  { id: 'U16', label: 'U16' },
  { id: 'U17', label: 'U17' },
  { id: 'U18', label: 'U18' },
  { id: 'U21', label: 'U21' },
  { id: 'N18', label: 'Novice U18' },
  { id: 'Open', label: 'Open' },
  { id: 'Masters', label: 'Masters' },
  { id: 'Club', label: 'Club' },
  { id: 'Intermediate', label: 'Intermediate' },
  { id: 'Senior', label: 'Senior' },
  { id: 'Premier', label: 'Premier' },
];

/** Followable gender chips (ids stored in localStorage). */
export const GENDER_OPTIONS = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'mixed', label: 'Mixed' },
];

/** Boat-class token from RowIT event type (1X, 2X, 4+, 8+, …). */
export function parseBoatClass(eventType) {
  const s = String(eventType || '');
  // No trailing \b: tokens like 4+ / 8+ end on non-word chars, so \b never matches.
  const m = s.match(/\b(8X?\+|8X|8\+|8|4X?\+|4X|4\+|4-|2X|2-|1X)(?!\w)/i);
  if (!m) return null;
  return m[1].toUpperCase().replace(/\s+/g, '');
}

/**
 * Parse RowIT event-type codes into age group + gender + boat class tags.
 * School: "B U17 1X", "G U15 4X+", "B N18 2X"
 * Masters: "W Mst C 2X", "Mx G-M 2X", "Opn 1X (P)"
 * Club: "M Clb 2X", "W Int 4+", "M Snr 2-", "W Prm 1X", "W Nov 2X"
 * @param {string} eventType
 * @returns {{ ageGroup: string|null, gender: string|null, boatClass: string|null, raw: string }}
 */
export function parseEventTags(eventType) {
  const raw = String(eventType || '').trim();
  const s = raw.replace(/\s+/g, ' ');
  let gender = null;
  let ageGroup = null;

  if (/^Mx\b/i.test(s) || /\bMx\b/i.test(s) || /\bmix(ed)?\b/i.test(s)) {
    gender = 'mixed';
  } else if (/^(W|G)\b/i.test(s) || /\b(Wom|Girl)/i.test(s)) {
    gender = 'female';
  } else if (/^(M|B)\b/i.test(s) || /\b(Men|Boy)/i.test(s)) {
    gender = 'male';
  }

  const u = s.match(/\bU(?:nder)?\s*(\d{2})\b/i);
  if (u) {
    ageGroup = `U${u[1]}`;
  } else if (/\bN\s*18\b/i.test(s) || /\bN18\b/i.test(s)) {
    ageGroup = 'N18';
  } else if (/\bMst\b/i.test(s) || /\bMasters?\b/i.test(s)) {
    ageGroup = 'Masters';
  } else if (/\bOpn\b/i.test(s) || /\bOpen\b/i.test(s)) {
    ageGroup = 'Open';
  } else if (/\bClb\b/i.test(s) || /\bClub\b/i.test(s)) {
    ageGroup = 'Club';
  } else if (/\bInt\b/i.test(s) || /\bIntermediate\b/i.test(s)) {
    ageGroup = 'Intermediate';
  } else if (/\bSnr\b/i.test(s) || /\bSenior\b/i.test(s)) {
    ageGroup = 'Senior';
  } else if (/\bPrm\b/i.test(s) || /\bPremier\b/i.test(s)) {
    ageGroup = 'Premier';
  } else if (/\bNov\b/i.test(s) || /\bNovice\b/i.test(s)) {
    ageGroup = 'N18';
  } else if (/\bMNw\b|\bMNv\b/i.test(s)) {
    ageGroup = 'Masters';
  } else if (/\b[A-I](?:-[A-I])?\b/.test(s) && /\b(M|W|Mx)\b/i.test(s)) {
    // Masters letter bands e.g. "M A-C 2-", "W G-M 4-" without explicit Mst
    ageGroup = 'Masters';
  }

  return { ageGroup, gender, boatClass: parseBoatClass(s), raw };
}

/**
 * Seats per crew from boat class (includes cox when class has +).
 * @param {string} eventType
 * @returns {number}
 */
export function boatSeatCount(eventType) {
  const boat = parseBoatClass(eventType);
  if (!boat) return 1;
  if (boat.startsWith('8')) return boat.includes('+') ? 9 : 8;
  if (boat.startsWith('4')) return boat.includes('+') ? 5 : 4;
  if (boat.startsWith('2')) return 2;
  return 1;
}

/** Compact school-style event type: "G U15 2X" → "GU15 2X". */
export function compactEventType(eventType) {
  return String(eventType || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^([BG])\s+(U\d{2}|N\s*18|N18)\b/i, (_, g, age) => {
      return `${g.toUpperCase()}${String(age).replace(/\s+/g, '').toUpperCase()}`;
    });
}

/** Spectator crew label e.g. "WAKA GU15 2X". */
export function crewDisplayLabel(clubCode, eventType) {
  const code = String(clubCode || '').trim().toUpperCase() || '?';
  const et = compactEventType(eventType);
  return et ? `${code} ${et}` : code;
}

/**
 * Map flat competitor names onto lanes using boat seat count.
 * @param {object} race
 * @returns {Map<string, object>} athlete name (lower) → crew stub for that race
 */
function crewAssignmentsForRace(race) {
  const byName = new Map();
  const lanes = race.lanes || [];
  const names = race.athletes || [];
  if (!lanes.length || !names.length) return byName;

  let seats = boatSeatCount(race.eventType);
  if (names.length === lanes.length) seats = 1;
  else if (names.length % lanes.length === 0) seats = names.length / lanes.length;
  else if (Math.abs(lanes.length * seats - names.length) > lanes.length) {
    seats = Math.max(1, Math.round(names.length / lanes.length));
  }

  for (let i = 0; i < names.length; i++) {
    const laneIndex = Math.min(Math.floor(i / seats), lanes.length - 1);
    const lane = lanes[laneIndex];
    const name = names[i];
    const id = `${race.id}|${lane.lane}`;
    const label = crewDisplayLabel(lane.clubCode || lane.clubName, race.eventType);
    byName.set(name.toLowerCase(), {
      id,
      label,
      raceId: race.id,
      raceKey: race.key,
      lane: lane.lane,
      clubId: lane.clubId,
      clubCode: lane.clubCode,
      athleteName: name,
      eventType: race.eventType,
      time: race.time,
    });
  }
  return byName;
}

function normalizeClubId(code) {
  return String(code || '')
    .toLowerCase()
    .replace(/\*$/, '');
}

function raceNum(key) {
  const m = String(key || '').match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

function parseClockToMs(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2])) * 60 * 1000;
}

function parseResultTimeToMs(raw) {
  const s = String(raw || '').trim();
  if (!s || /^(SCR|DNS|DNF|EXC|NUL)$/i.test(s)) return null;
  const m = s.match(/^(\d+):(\d{2}(?:\.\d+)?)$/);
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000;
}

function parseResultPlacings(cols) {
  const placings = [];
  for (let i = 6; i + 2 < cols.length; i += 3) {
    const place = parseInt(cols[i], 10);
    const competitor = (cols[i + 1] || '').trim();
    const time = (cols[i + 2] || '').trim();
    if (!Number.isFinite(place) || !competitor) continue;
    placings.push({
      place,
      competitor,
      time,
      clubCode: clubCodeFromEntry(competitor),
      clubId: normalizeClubId(clubCodeFromEntry(competitor)),
      timeMs: parseResultTimeToMs(time),
    });
  }
  return placings.sort((a, b) => {
    const ra = a.place >= 90 ? 999 : a.place;
    const rb = b.place >= 90 ? 999 : b.place;
    return ra - rb;
  });
}

function parseResultsCsv(text) {
  /** @type {Map<number, object[]>} */
  const byRaceNum = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/^\d/.test(trimmed)) continue;
    const cols = splitCsvLine(trimmed);
    if (cols.length < 6) continue;
    const num = parseInt(cols[0], 10);
    if (!Number.isFinite(num)) continue;
    const row = {
      raceNum: num,
      eventNum: String(cols[1] || '').trim(),
      round: String(cols[2] || '').trim(),
      division: String(cols[3] || '').trim(),
      status: String(cols[5] || '').trim(),
      placings: parseResultPlacings(cols),
    };
    if (!byRaceNum.has(num)) byRaceNum.set(num, []);
    byRaceNum.get(num).push(row);
  }
  return byRaceNum;
}

function parseCompetitors(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  let headers = null;
  const namesByKey = new Map();
  for (const line of lines) {
    if (/^DAY\s/i.test(line)) continue;
    if (/^"?Race"?,/i.test(line) || line.startsWith('Race,')) {
      headers = splitCsvLine(line);
      continue;
    }
    if (!headers) continue;
    const cols = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? '';
    });
    const key = obj.Race || obj.race;
    const eventNum = obj['Event #'] || obj.event || '';
    if (!key) continue;
    const id = `${key}#${eventNum}`;
    namesByKey.set(id, String(obj.Names || obj.names || ''));
    if (!namesByKey.has(key)) namesByKey.set(key, String(obj.Names || obj.names || ''));
  }
  return namesByKey;
}

function parseDaysheet(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length);

  const days = [];
  let current = null;
  let headers = null;

  for (const line of lines) {
    const dayMatch = line.match(/^DAY\s+(\d+)\s*:\s*(.+)$/i);
    if (dayMatch) {
      current = {
        index: Number(dayMatch[1]),
        label: dayMatch[2].trim(),
        races: [],
      };
      days.push(current);
      headers = null;
      continue;
    }
    if (/^"?Race"?,/i.test(line) || line.startsWith('Race,')) {
      headers = splitCsvLine(line);
      continue;
    }
    if (!current || !headers) continue;
    if (/^"DAY SHEETS/i.test(line)) continue;

    const cols = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? '';
    });
    const key = obj.Race || obj.race;
    if (!key) continue;

    const lanes = [];
    for (let n = 1; n <= 9; n++) {
      const entry = obj[`lane_${n}`] || '';
      if (!String(entry).trim()) continue;
      const code = clubCodeFromEntry(entry);
      lanes.push({
        lane: n,
        entry: String(entry).trim(),
        clubCode: code,
        clubId: normalizeClubId(code),
      });
    }

    const eventNum = String(obj['Event #'] || '').trim();
    const time = obj.Time || '';
    const id = `${key}#${eventNum || '0'}`;
    const eventType = obj['Event Type'] || '';
    const tags = parseEventTags(eventType);

    current.races.push({
      id,
      key,
      raceNum: raceNum(key),
      dayIndex: current.index,
      dayLabel: current.label,
      time,
      startMsOfDay: parseClockToMs(time),
      eventNum,
      eventType,
      ageGroup: tags.ageGroup,
      gender: tags.gender,
      boatClass: tags.boatClass,
      round: obj.Round || '',
      division: obj.Division || '',
      progression: obj.Progression || '',
      lanes,
      athletes: [],
      result: null,
      hasResult: false,
      raceDurationMs: REGATTA.defaultRaceMs,
      isDemoLive: key === REGATTA.demoLiveRaceKey,
    });
  }

  return days;
}

function clubLogoUrl(lookup, clubId) {
  if (!clubId || !lookup?.clubs) return null;
  const info = lookup.clubs[clubId] || lookup.clubs[`${clubId}*`];
  if (!info?.logo) return null;
  // Relative to /regatta-nz/ pages — encode once (do not wrap in new URL).
  return `../assets/school-logos/${encodeURIComponent(info.logo)}`;
}

export async function loadRegatta() {
  const spectator = await readSpectatorConfig();
  const paths = pathsForCode(spectator.code);

  const [daysheetText, competitorsText, resultsText, lookup] = await Promise.all([
    fetchTextFirst(paths.daysheet),
    fetchTextFirst(paths.competitors),
    fetchTextFirst(paths.results).catch(() => ''),
    fetch(LOOKUP_URL)
      .then((r) => (r.ok ? r.json() : { clubs: {} }))
      .catch(() => ({ clubs: {} })),
  ]);

  const days = parseDaysheet(daysheetText);
  const namesByKey = parseCompetitors(competitorsText);
  const resultsByNum = parseResultsCsv(resultsText);
  const races = days.flatMap((d) => d.races);

  for (const race of races) {
    const names =
      namesByKey.get(race.id) || namesByKey.get(race.key) || '';
    race.athletes = String(names)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const candidates = resultsByNum.get(race.raceNum) || [];
    const match =
      candidates.find((r) => r.eventNum === race.eventNum) ||
      candidates[0] ||
      null;
    if (match && match.placings?.length) {
      race.result = match;
      race.hasResult = true;
      const win = match.placings.find((p) => p.place === 1 && p.timeMs);
      if (win?.timeMs) {
        race.raceDurationMs = Math.max(90_000, Math.min(15 * 60_000, win.timeMs + 30_000));
      }
    }

    for (const lane of race.lanes) {
      lane.logoUrl = clubLogoUrl(lookup, lane.clubId);
      const info = lookup.clubs?.[lane.clubId];
      lane.clubName = info?.name || lane.clubCode;
    }
    if (race.result) {
      for (const p of race.result.placings) {
        p.logoUrl = clubLogoUrl(lookup, p.clubId);
      }
    }
  }

  const clubs = new Map();
  for (const race of races) {
    for (const lane of race.lanes) {
      if (!lane.clubId) continue;
      if (!clubs.has(lane.clubId)) {
        clubs.set(lane.clubId, {
          id: lane.clubId,
          code: lane.clubCode,
          name: lane.clubName,
          logo: lane.logoUrl,
          raceCount: 0,
          crewCount: 0,
        });
      }
      const club = clubs.get(lane.clubId);
      club.raceCount += 1;
      club.crewCount += 1;
    }
  }

  const athletes = new Map();
  for (const race of races) {
    const assigned = crewAssignmentsForRace(race);
    for (const name of race.athletes) {
      const id = name.toLowerCase();
      if (!athletes.has(id)) athletes.set(id, { id, name, raceIds: [], crews: [] });
      const athlete = athletes.get(id);
      athlete.raceIds.push(race.id);
      let crew = assigned.get(id);
      if (!crew && race.lanes.length) {
        // Best-effort: last lane when seat math overflows (draw edits / odd name counts)
        const lane = race.lanes[race.lanes.length - 1];
        crew = {
          id: `${race.id}|${lane.lane}`,
          label: crewDisplayLabel(lane.clubCode || lane.clubName, race.eventType),
          raceId: race.id,
          raceKey: race.key,
          lane: lane.lane,
          clubId: lane.clubId,
          clubCode: lane.clubCode,
          athleteName: name,
          eventType: race.eventType,
          time: race.time,
        };
      }
      if (crew) athlete.crews.push(crew);
    }
  }

  for (const athlete of athletes.values()) {
    const seen = new Set();
    athlete.crews = athlete.crews.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }

  const meta = {
    ...REGATTA,
    code: paths.code,
    name:
      paths.code === REGATTA.code
        ? REGATTA.name
        : `Regatta ${paths.code.toUpperCase()}`,
    feedMode: spectator.mode,
    streamId: spectator.streamId,
    livestream: {
      ...REGATTA.livestream,
      label: spectator.livestreamLabel || REGATTA.livestream.label,
      url: spectator.livestreamUrl || '',
      active: Boolean(spectator.livestreamActive && spectator.livestreamUrl),
      note:
        spectator.livestreamActive && spectator.livestreamUrl
          ? ''
          : REGATTA.livestream.note,
    },
  };

  return {
    meta,
    spectator,
    days,
    races,
    clubs: [...clubs.values()].sort((a, b) => a.name.localeCompare(b.name)),
    clubById: clubs,
    athletes: [...athletes.values()].sort((a, b) => a.name.localeCompare(b.name)),
    raceById: new Map(races.map((r) => [r.id, r])),
    raceByKey: new Map(races.map((r) => [r.key, r])),
  };
}

/**
 * @param {number} nowMsOfDay minutes from midnight in ms
 * @param {object} race
 */
export function racePhase(nowMsOfDay, race) {
  const start = race.startMsOfDay;
  if (!Number.isFinite(start) || !Number.isFinite(nowMsOfDay)) {
    return { status: 'scheduled', label: 'Scheduled' };
  }
  const duration = race.raceDurationMs || REGATTA.defaultRaceMs;
  const finish = start + duration;
  const { startBlocksMs, finishedWindowMs } = REGATTA;

  if (nowMsOfDay >= start - startBlocksMs && nowMsOfDay < start) {
    return { status: 'start_blocks', label: 'In the start blocks' };
  }
  if (nowMsOfDay >= start && nowMsOfDay < finish) {
    return { status: 'live', label: 'Live' };
  }
  if (
    race.hasResult &&
    nowMsOfDay >= finish &&
    nowMsOfDay < finish + finishedWindowMs
  ) {
    return { status: 'finished', label: 'Finished' };
  }
  if (race.hasResult && nowMsOfDay >= finish + finishedWindowMs) {
    return { status: 'result', label: 'Result' };
  }
  if (nowMsOfDay < start - startBlocksMs) {
    return { status: 'upcoming', label: 'Upcoming' };
  }
  return { status: 'done', label: 'Done' };
}

export function msOfDayFromDate(d = new Date()) {
  return (
    ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 +
    d.getMilliseconds()
  );
}

export function formatMsOfDay(ms) {
  if (!Number.isFinite(ms)) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export { REGATTA };
