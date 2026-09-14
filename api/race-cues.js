import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRaceLabel, raceSnapshot } from './lib/rowit-race-snapshot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CUES_DIR = join(ROOT, 'public', 'data', 'race-cues');
const DUP_MS = 2500;
const memoryDays = new Map();

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sanitizeCode(raw) {
    return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

function todayNz() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Pacific/Auckland',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function nowIso() {
    return new Date().toISOString();
}

function emptyDay(regatta, date) {
    return {
        regatta,
        date,
        recording: false,
        openId: null,
        updatedAt: nowIso(),
        persisted: false,
        races: [],
    };
}

function dayKey(regatta, date) {
    return `${regatta}:${date}`;
}

function filePath(regatta, date) {
    return join(CUES_DIR, regatta, `${date}.json`);
}

async function loadDay(regatta, date) {
    const key = dayKey(regatta, date);
    try {
        const raw = await readFile(filePath(regatta, date), 'utf8');
        const json = JSON.parse(raw);
        if (json && typeof json === 'object') {
            json.persisted = true;
            memoryDays.set(key, json);
            return json;
        }
    } catch {
        /* missing */
    }
    if (memoryDays.has(key)) return memoryDays.get(key);
    return emptyDay(regatta, date);
}

async function saveDay(day) {
    day.updatedAt = nowIso();
    memoryDays.set(dayKey(day.regatta, day.date), day);
    try {
        const dir = join(CUES_DIR, day.regatta);
        await mkdir(dir, { recursive: true });
        await writeFile(filePath(day.regatta, day.date), `${JSON.stringify(day, null, 2)}\n`, 'utf8');
        day.persisted = true;
    } catch {
        day.persisted = false;
    }
    return day;
}

function openRace(day) {
    if (!day.openId) return null;
    return day.races.find((r) => r.id === day.openId && !r.endAt) || null;
}

function recentMs(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return Infinity;
    return Date.now() - t;
}

async function closeOpen(day, endedBy) {
    const open = openRace(day);
    if (!open) return null;
    open.endAt = nowIso();
    open.endedBy = endedBy;
    if (!open.results) {
        const snap = await raceSnapshot(day.regatta, open.race || String(open.raceNum));
        if (snap?.results) open.results = snap.results;
    }
    day.openId = null;
    return open;
}

function newRaceId(date, raceNum) {
    return `${date}-r${raceNum}-${Date.now().toString(36)}`;
}

async function handleDraw(day, raceRaw) {
    const snap = await raceSnapshot(day.regatta, raceRaw);
    const raceNum = snap?.raceNum || parseRaceLabel(raceRaw).raceNum;
    if (!raceNum) {
        const err = new Error('No race number on the live graphic race.');
        err.statusCode = 400;
        throw err;
    }
    const open = openRace(day);
    if (open && open.raceNum === raceNum && recentMs(open.drawAt) < DUP_MS) {
        return { day, ignored: 'duplicate-draw' };
    }
    if (open && open.raceNum === raceNum) {
        open.drawAgainAt = nowIso();
        return { day, ignored: 'same-race-draw' };
    }
    if (open) await closeOpen(day, 'next-draw');

    const race = {
        id: newRaceId(day.date, raceNum),
        raceNum,
        race: snap?.race || String(raceRaw || raceNum),
        eventNum: snap?.eventNum || '',
        eventType: snap?.eventType || '',
        round: snap?.round || '',
        division: snap?.division || '',
        scheduledTime: snap?.time || '',
        dateLabel: snap?.dateLabel || '',
        drawAt: nowIso(),
        endAt: null,
        endedBy: null,
        lanes: snap?.lanes || [],
        competitors: snap?.competitors || [],
        results: null,
    };
    day.races.push(race);
    day.openId = race.id;
    return { day, opened: race };
}

async function handleResults(day, raceRaw) {
    const open = openRace(day);
    if (!open) return { day, ignored: 'no-open-race' };
    const wanted = parseRaceLabel(raceRaw).raceNum;
    if (wanted && open.raceNum !== wanted && recentMs(open.drawAt) > DUP_MS) {
        // Results for a different race: still close the open window.
    }
    const snap = await raceSnapshot(day.regatta, open.race || raceRaw);
    open.endAt = nowIso();
    open.endedBy = 'results';
    if (snap?.results) open.results = snap.results;
    day.openId = null;
    return { day, closed: open };
}

export default async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const body = req.method === 'POST' ? (req.body || {}) : {};
    const regatta = sanitizeCode(body.regatta || req.query.regatta);
    const date = String(body.date || req.query.date || todayNz()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ ok: false, error: 'Invalid date' });
        return;
    }
    if (!regatta) {
        res.status(400).json({ ok: false, error: 'regatta code required' });
        return;
    }

    if (req.method === 'GET') {
        const day = await loadDay(regatta, date);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ ok: true, ...day });
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'GET or POST' });
        return;
    }

    const action = String(body.action || '').toLowerCase();
    const day = await loadDay(regatta, date);
    day.regatta = regatta;
    day.date = date;

    try {
        if (action === 'recording') {
            day.recording = Boolean(body.recording);
            if (!day.recording && openRace(day)) {
                await closeOpen(day, 'record-stop');
            }
            await saveDay(day);
            res.status(200).json({ ok: true, ...day });
            return;
        }

        if (action === 'draw' || action === 'd') {
            if (!day.recording) {
                res.status(200).json({ ok: true, ignored: 'not-recording', ...day });
                return;
            }
            const result = await handleDraw(day, body.race);
            await saveDay(result.day);
            res.status(200).json({ ok: true, ...result.day, ignored: result.ignored || null });
            return;
        }

        if (action === 'results' || action === 'r') {
            if (!day.recording) {
                res.status(200).json({ ok: true, ignored: 'not-recording', ...day });
                return;
            }
            const result = await handleResults(day, body.race);
            await saveDay(result.day);
            res.status(200).json({ ok: true, ...result.day, ignored: result.ignored || null });
            return;
        }

        res.status(400).json({ ok: false, error: 'action must be recording, draw, or results' });
    } catch (e) {
        const status = Number(e?.statusCode) || 500;
        res.status(status).json({ ok: false, error: e instanceof Error ? e.message : 'Cue failed' });
    }
}
