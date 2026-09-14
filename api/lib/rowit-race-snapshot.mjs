import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ARCHIVE = join(ROOT, 'public', 'data', 'archives');
const ROWIT_BASES = [
    'https://l.rowit.nz/altitude',
    'https://rowit.nz/altitude',
];

const csvCache = new Map();
const CACHE_MS = 20_000;

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

export function parseRaceLabel(raw) {
    const s = String(raw || '').trim();
    const withLetter = s.match(/^(\d+)\s*\(([A-Za-z])\)\s*$/);
    if (withLetter) {
        return {
            raceNum: parseInt(withLetter[1], 10),
            label: `${withLetter[1]} (${withLetter[2].toUpperCase()})`,
        };
    }
    const plain = s.match(/^(\d+)/);
    if (plain) return { raceNum: parseInt(plain[1], 10), label: s };
    return { raceNum: null, label: s };
}

function parseDayHeader(line) {
    const m = String(line || '').match(
        /DAY\s+\d+:\s+(\w+)\s+(\d{1,2})(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/i,
    );
    if (!m) return null;
    const months = {
        january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
        april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
        august: 7, aug: 7, september: 8, sep: 8, sept: 8,
        october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
    };
    const month = months[m[3].toLowerCase()];
    if (month === undefined) return null;
    const date = new Date(parseInt(m[4], 10), month, parseInt(m[2], 10));
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return {
        ymd: `${y}-${mo}-${d}`,
        label: `${m[1]} ${m[2]} ${m[3]} ${m[4]}`,
        clock: null,
    };
}

function walkDays(text, onRow) {
    let day = null;
    for (const line of String(text || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^DAY\s+\d+:/i.test(trimmed)) {
            day = parseDayHeader(trimmed);
            continue;
        }
        if (/^Race,/i.test(trimmed) || /as at/i.test(trimmed)) continue;
        if (!day) continue;
        const cols = parseCsvLine(trimmed);
        if (cols.length < 5) continue;
        const info = parseRaceLabel(cols[0]);
        if (!info.raceNum) continue;
        onRow(day, info, cols);
    }
}

function parseDaysheet(text) {
    const races = [];
    walkDays(text, (day, info, cols) => {
        const lanes = [];
        for (let i = 6; i < cols.length; i++) {
            const cell = String(cols[i] || '').trim();
            if (!cell || cell === '-' || /^lane_/i.test(cell) || /progress/i.test(cell)) continue;
            if (!/^([A-Za-z*]{3,5})\b/.test(cell)) continue;
            lanes.push({ lane: i - 5, crew: cell });
        }
        races.push({
            raceNum: info.raceNum,
            race: info.label,
            time: String(cols[1] || '').trim(),
            eventNum: String(cols[2] || '').trim(),
            eventType: String(cols[3] || '').trim(),
            round: String(cols[4] || '').trim(),
            division: String(cols[5] || '').trim(),
            date: day.ymd,
            dateLabel: day.label,
            lanes,
        });
    });
    return races;
}

function parseCompetitors(text) {
    const byRace = new Map();
    walkDays(text, (_day, info, cols) => {
        const names = String(cols[6] || '')
            .split(',')
            .map((n) => n.trim())
            .filter((n) => n.length >= 2);
        byRace.set(info.raceNum, {
            race: info.label,
            eventType: String(cols[3] || '').trim(),
            round: String(cols[4] || '').trim(),
            names,
        });
    });
    return byRace;
}

function parseResults(text) {
    const byRace = new Map();
    for (const line of String(text || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || !/^\d/.test(trimmed)) continue;
        const cols = parseCsvLine(trimmed);
        if (cols.length < 6) continue;
        const raceNum = parseInt(cols[0], 10);
        if (!Number.isFinite(raceNum)) continue;
        const placings = [];
        for (let i = 6; i + 2 < cols.length; i += 3) {
            const place = parseInt(cols[i], 10);
            const competitor = String(cols[i + 1] || '').trim();
            const time = String(cols[i + 2] || '').trim();
            if (!Number.isFinite(place) || place < 1 || !competitor) continue;
            placings.push({ place, competitor, time });
        }
        placings.sort((a, b) => a.place - b.place);
        byRace.set(raceNum, {
            status: String(cols[5] || '').trim(),
            eventNum: String(cols[1] || '').trim(),
            round: String(cols[2] || '').trim(),
            division: String(cols[3] || '').trim(),
            placings,
        });
    }
    return byRace;
}

async function readLocalCsv(code, fileId) {
    try {
        return await readFile(join(ARCHIVE, code, 'latest', `${fileId}.csv`), 'utf8');
    } catch {
        return '';
    }
}

async function fetchLiveCsv(code, fileId) {
    for (const base of ROWIT_BASES) {
        try {
            const res = await fetch(`${base}/${code}/${fileId}.csv`, {
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) continue;
            const text = await res.text();
            if (text.length > 40 && text.includes(',') && !/nothing published/i.test(text)) {
                return text;
            }
        } catch {
            /* next */
        }
    }
    return '';
}

async function loadCsv(code, fileId) {
    const key = `${code}:${fileId}`;
    const hit = csvCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
    let text = await readLocalCsv(code, fileId);
    if (fileId === 'results' || !text) {
        const live = await fetchLiveCsv(code, fileId);
        if (live) text = live;
    }
    csvCache.set(key, { at: Date.now(), text });
    return text;
}

export async function raceSnapshot(code, raceQuery) {
    const c = String(code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const wanted = parseRaceLabel(raceQuery);
    if (!c || !wanted.raceNum) return null;
    const [daysheet, competitors, results] = await Promise.all([
        loadCsv(c, 'daysheet'),
        loadCsv(c, 'competitors'),
        loadCsv(c, 'results'),
    ]);
    const dayRows = parseDaysheet(daysheet);
    const row = dayRows.find((r) => r.raceNum === wanted.raceNum)
        || dayRows.find((r) => r.race === wanted.label);
    const names = parseCompetitors(competitors).get(wanted.raceNum);
    const result = parseResults(results).get(wanted.raceNum);
    if (!row && !names) {
        return {
            raceNum: wanted.raceNum,
            race: wanted.label,
            eventType: '',
            round: '',
            time: '',
            date: '',
            dateLabel: '',
            lanes: [],
            competitors: [],
            results: result || null,
        };
    }
    return {
        raceNum: row?.raceNum || wanted.raceNum,
        race: row?.race || names?.race || wanted.label,
        eventNum: row?.eventNum || '',
        eventType: row?.eventType || names?.eventType || '',
        round: row?.round || names?.round || '',
        division: row?.division || '',
        time: row?.time || '',
        date: row?.date || '',
        dateLabel: row?.dateLabel || '',
        lanes: row?.lanes || [],
        competitors: names?.names || [],
        results: result || null,
    };
}
