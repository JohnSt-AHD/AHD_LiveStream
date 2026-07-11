/**
 * Scrape RowIT HTML event results into altitude-style results CSV rows.
 * Adapted from scripts/fetch-mads2026-fallback.mjs
 */
import { readFile } from 'node:fs/promises';

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function normalizeRound(raw) {
  const r = String(raw || '').trim().toLowerCase();
  if (r === 'heat' || r === 'h') return 'h';
  if (/quarter|^q/.test(r)) return 'q';
  if (/semi|^s/.test(r)) return 's';
  if (/rep/.test(r)) return 'r';
  if (/final|^f|^e/.test(r)) return 'f';
  return r.slice(0, 1) || 'h';
}

function finalDivisionFromLabel(label) {
  const m = String(label || '').match(/^([A-Z])\s*Final/i);
  if (m) return String(m[1].charCodeAt(0) - 64);
  const n = parseInt(label, 10);
  return Number.isFinite(n) ? n : 1;
}

function parseRoundFromSummary(summary) {
  const s = String(summary || '');
  const m = s.match(/Results for event \d+,\s*(.+)$/i);
  if (!m) return { round: 'h', division: '1', label: '' };
  const label = m[1].trim();
  const lower = label.toLowerCase();
  if (/^heat\s+(\d+)/i.test(label)) {
    return { round: 'h', division: label.match(/\d+/)[0], label };
  }
  if (/quarter/i.test(lower)) {
    const d = label.match(/(\d+)/);
    return { round: 'q', division: d ? d[1] : '1', label };
  }
  if (/semi/i.test(lower)) {
    const d = label.match(/(\d+)/);
    return { round: 's', division: d ? d[1] : '1', label };
  }
  if (/rep/i.test(lower)) {
    const d = label.match(/(\d+)/);
    return { round: 'r', division: d ? d[1] : '1', label };
  }
  if (/final/i.test(lower)) {
    return { round: 'f', division: String(finalDivisionFromLabel(label)), label };
  }
  return { round: 'h', division: '1', label };
}

function parseResultRow(rowHtml) {
  const placeMatch = rowHtml.match(/resultPlaceLink[\s\S]*?<span>(\d+)<sup>/i);
  const place = placeMatch ? parseInt(placeMatch[1], 10) : null;
  const crewMatch = rowHtml.match(/cn=([a-z0-9*]+)(?:&amp;|&)nn=(\d+)/i);
  const clubMatch = rowHtml.match(/class="cardKeyID">([A-Z0-9*]+)</i);
  const timeMatch = rowHtml.match(/class="resultTimeLink"[\s\S]*?<span>([\d:.]+|[A-Z]+)<\/span>/i);
  if (!place || !Number.isFinite(place)) return null;
  let competitor = '';
  if (crewMatch) competitor = `${crewMatch[1].toUpperCase()} ${crewMatch[2]}`;
  else if (clubMatch) competitor = clubMatch[1];
  if (!competitor) return null;
  const time = timeMatch ? timeMatch[1].trim() : '';
  if (/^(scr|dns|dnf|rmv)$/i.test(time)) return { place: 99, crew: competitor, time: time.toUpperCase() };
  return { place, crew: competitor, time };
}

export function parseEventResultsHtml(html, eventNum) {
  const races = [];
  const tableRe =
    /<table class="result-table" summary="Results for event (\d+), ([^"]+)"[\s\S]*?(?=<table class="result-table"|$)/gi;
  let tm;
  while ((tm = tableRe.exec(html)) !== null) {
    const block = tm[0];
    const ev = tm[1];
    const roundLabel = tm[2];
    if (String(ev) !== String(eventNum)) continue;
    const roundInfo = parseRoundFromSummary(`Results for event ${ev}, ${roundLabel}`);
    const progMatch = block.match(/Heat progression:[\s\S]*?<\/span>\s*([^<]+)/i);
    const format = progMatch ? progMatch[1].trim() : '';
    const entries = [];
    const rowRe = /<tr class="result-details">([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(block)) !== null) {
      const row = parseResultRow(rm[1]);
      if (row) entries.push(row);
    }
    if (!entries.length) continue;
    entries.sort((a, b) => a.place - b.place);
    races.push({ eventNum: String(eventNum), ...roundInfo, format, entries });
  }
  return races;
}

export function buildDaysheetIndex(daysheetText) {
  const index = new Map();
  let headerCols = null;
  for (const line of daysheetText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^Race,/i.test(trimmed)) {
      headerCols = parseCsvLine(trimmed);
      continue;
    }
    if (!/^\d/.test(trimmed)) continue;
    const cols = parseCsvLine(trimmed);
    const raceMatch = cols[0].match(/^(\d+)/);
    if (!raceMatch) continue;
    const raceNum = parseInt(raceMatch[1], 10);
    const eventNum = (cols[2] || '').trim();
    const round = normalizeRound(cols[4]);
    let division = (cols[5] || '1').trim();
    if (/^[A-Z]$/i.test(division)) division = String(division.toUpperCase().charCodeAt(0) - 64);
    let progression = '';
    if (headerCols) {
      const pi = headerCols.findIndex((h) => String(h).toLowerCase().includes('progression'));
      if (pi >= 0) progression = (cols[pi] || '').trim();
    } else if (cols.length > 6) {
      progression = cols[cols.length - 1].trim();
    }
    index.set(`${eventNum}|${round}|${division}`, { raceNum, progression });
  }
  return index;
}

function resultsToCsvText(rows) {
  const lines = [];
  for (const row of rows.sort((a, b) => a.race - b.race)) {
    const parts = [row.race, row.eventNum, row.round, row.division, `"${(row.format || '').replace(/"/g, '""')}"`, 'Official'];
    for (const p of row.entries) {
      parts.push(p.place, p.crew, p.time || '');
    }
    lines.push(parts.join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 RNZ-season-summary' } });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.text();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Scrape RowIT results for listed event numbers; returns results CSV text.
 * @param {string} regattaCode e.g. nicc2026
 * @param {string[]} eventNums numeric event ids used in ?en=
 * @param {{ daysheetText?: string, delayMs?: number }} options
 */
export async function scrapeRegattaResultsCsv(regattaCode, eventNums, options = {}) {
  const base = `https://rowit.nz/${regattaCode}`;
  let daysheetText = options.daysheetText;
  if (!daysheetText) {
    for (const alt of [`https://l.rowit.nz/altitude/${regattaCode}/daysheet.csv`, `${base}/daysheet.csv`]) {
      try {
        daysheetText = await fetchText(alt);
        break;
      } catch {
        // try next
      }
    }
  }
  if (!daysheetText) throw new Error(`No daysheet for ${regattaCode}`);

  const dsIndex = buildDaysheetIndex(daysheetText);
  const allRows = [];

  for (let i = 0; i < eventNums.length; i++) {
    const en = eventNums[i];
    const html = await fetchText(`${base}/results?en=${en}`);
    const parsed = parseEventResultsHtml(html, en);
    for (const race of parsed) {
      const key = `${race.eventNum}|${race.round}|${race.division}`;
      const ds = dsIndex.get(key);
      if (!ds) continue;
      allRows.push({
        race: ds.raceNum,
        eventNum: race.eventNum,
        round: race.round,
        division: race.division,
        format:
          race.round === 'r' && ds.progression
            ? ds.progression
            : race.format && !/repechage/i.test(race.format)
              ? race.format
              : ds.progression || race.format,
        entries: race.entries,
      });
    }
    if (options.delayMs) await sleep(options.delayMs);
  }

  const byRace = new Map();
  for (const row of allRows) byRace.set(row.race, row);
  return resultsToCsvText([...byRace.values()]);
}

export async function readTextIfExists(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
