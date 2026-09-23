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

/** Hub + query override for spectator settings. */
export function readSpectatorConfig() {
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
    const rawCfg = JSON.parse(localStorage.getItem(LS_RNZ) || '{}');
    if (rawCfg && typeof rawCfg === 'object') {
      const c = normalizeCode(rawCfg.code);
      if (c) cfg.code = c;
      if (rawCfg.livestreamUrl != null) cfg.livestreamUrl = String(rawCfg.livestreamUrl).trim();
      if (rawCfg.livestreamActive != null) cfg.livestreamActive = Boolean(rawCfg.livestreamActive);
      if (rawCfg.livestreamLabel) cfg.livestreamLabel = String(rawCfg.livestreamLabel).trim();
      if (rawCfg.mode === 'live' || rawCfg.mode === 'sim') cfg.mode = rawCfg.mode;
      if (rawCfg.streamId && /^[a-zA-Z0-9._-]{1,128}$/.test(String(rawCfg.streamId))) {
        cfg.streamId = String(rawCfg.streamId).trim();
      }
    }
  } catch {
    /* ignore */
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

async function fetchTextFirst(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`${url} ${res.status}`);
        continue;
      }
      return await res.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No data URL succeeded');
}

function pathsForCode(code) {
  const c = normalizeCode(code) || REGATTA.code;
  const live = new URL(`../data/rowit-live/${c}/`, import.meta.url).href;
  const archive = new URL(`../data/archives/${c}/latest/`, import.meta.url).href;
  return {
    code: c,
    daysheet: [`${live}daysheet.csv`, `${archive}daysheet.csv`],
    competitors: [`${live}competitors.csv`, `${archive}competitors.csv`],
    results: [`${archive}results.csv`, `${live}results.csv`],
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

    current.races.push({
      id,
      key,
      raceNum: raceNum(key),
      dayIndex: current.index,
      dayLabel: current.label,
      time,
      startMsOfDay: parseClockToMs(time),
      eventNum,
      eventType: obj['Event Type'] || '',
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
  const spectator = readSpectatorConfig();
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
        });
      }
      clubs.get(lane.clubId).raceCount += 1;
    }
  }

  const athletes = new Map();
  for (const race of races) {
    for (const name of race.athletes) {
      const id = name.toLowerCase();
      if (!athletes.has(id)) athletes.set(id, { id, name, raceIds: [] });
      athletes.get(id).raceIds.push(race.id);
    }
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
