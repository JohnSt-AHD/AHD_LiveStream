import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

export const ROWIT_FILES = ['events', 'daysheet', 'results', 'competitors'];
export const ROWIT_BASES = [
    'https://l.rowit.nz/altitude',
    'https://rowit.nz/altitude',
];

const STALE_MS = Number(process.env.ROWIT_CACHE_MS || 60_000);
const watched = new Set();
const memory = new Map();
let diskOk = null;
let refreshChain = Promise.resolve();

function cacheRoot() {
    return (
        String(process.env.ROWIT_CACHE_DIR || '').trim() ||
        join(ROOT, 'public', 'data', 'rowit-live')
    );
}

export function normalizeRegattaCode(raw) {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
}

const NZ_TZ = 'Pacific/Auckland';
const ARCHIVE_CODES_PATH = join(ROOT, 'public', 'data', 'regatta-archive-codes.json');
let archiveCodesCache = null;

export function todayYmdNz(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: NZ_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}

function loadArchiveCodes() {
    if (archiveCodesCache) return archiveCodesCache;
    try {
        archiveCodesCache = JSON.parse(readFileSync(ARCHIVE_CODES_PATH, 'utf8'));
    } catch {
        archiveCodesCache = { regattas: [] };
    }
    return archiveCodesCache;
}

/** Codes with startDate/endDate only poll on those NZ calendar days. No dates = always poll. */
export function isLiveCsvPollDay(code) {
    const c = normalizeRegattaCode(code);
    const entry = (loadArchiveCodes().regattas || []).find(
        (r) => normalizeRegattaCode(r.code) === c,
    );
    if (!entry?.startDate || !entry?.endDate) return true;
    const today = todayYmdNz();
    return today >= entry.startDate && today <= entry.endDate;
}

export function parseRowitUrl(raw) {
    try {
        const u = new URL(String(raw || '').trim());
        const m = u.pathname.match(
            /\/altitude\/([a-z0-9_-]+)\/(events|daysheet|results|competitors)\.csv$/i,
        );
        if (!m) return null;
        return {
            code: normalizeRegattaCode(m[1]),
            fileId: m[2].toLowerCase(),
            url: u.href,
        };
    } catch {
        return null;
    }
}

export function watchCode(code) {
    const c = normalizeRegattaCode(code);
    if (c) watched.add(c);
    return c;
}

export function watchedCodes() {
    return [...watched];
}

function sha256(text) {
    return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

export function isCsvLike(text) {
    const t = String(text || '')
        .replace(/^\uFEFF/, '')
        .trim();
    if (t.length < 20 || !t.includes(',')) return false;
    if (/^<!doctype html/i.test(t) || /<html[\s>]/i.test(t)) return false;
    if (/nothing published/i.test(t)) return false;
    return /event|race|day |competitor|lane_/i.test(t);
}

function memKey(code, fileId) {
    return `${code}/${fileId}`;
}

function filePaths(code, fileId) {
    const dir = join(cacheRoot(), code);
    return {
        dir,
        csv: join(dir, `${fileId}.csv`),
        meta: join(dir, `${fileId}.json`),
    };
}

function ensureDisk() {
    if (diskOk != null) return diskOk;
    try {
        mkdirSync(cacheRoot(), { recursive: true });
        diskOk = true;
    } catch {
        diskOk = false;
    }
    return diskOk;
}

function readEntry(code, fileId) {
    const key = memKey(code, fileId);
    if (ensureDisk()) {
        const { csv, meta } = filePaths(code, fileId);
        if (!existsSync(csv)) return memory.get(key) || null;
        try {
            const text = readFileSync(csv, 'utf8').replace(/^\uFEFF/, '');
            let info = {};
            if (existsSync(meta)) {
                try {
                    const raw = readFileSync(meta, 'utf8').replace(/^\uFEFF/, '');
                    info = JSON.parse(raw);
                } catch {
                    info = {};
                }
            }
            const row = {
                code,
                fileId,
                text,
                bytes: Buffer.byteLength(text, 'utf8'),
                hash: info.hash || sha256(text),
                sourceUrl: info.sourceUrl || '',
                updatedAt: Number(info.updatedAt) || 0,
                changed: Boolean(info.changed),
            };
            memory.set(key, row);
            return row;
        } catch {
            return memory.get(key) || null;
        }
    }
    return memory.get(key) || null;
}

function writeEntry(code, fileId, text, sourceUrl, changed) {
    const row = {
        code,
        fileId,
        text,
        bytes: Buffer.byteLength(text, 'utf8'),
        hash: sha256(text),
        sourceUrl: sourceUrl || '',
        updatedAt: Date.now(),
        changed: Boolean(changed),
    };
    memory.set(memKey(code, fileId), row);
    if (ensureDisk()) {
        const { dir, csv, meta } = filePaths(code, fileId);
        mkdirSync(dir, { recursive: true });
        writeFileSync(csv, text, 'utf8');
        writeFileSync(
            meta,
            JSON.stringify(
                {
                    hash: row.hash,
                    sourceUrl: row.sourceUrl,
                    updatedAt: row.updatedAt,
                    bytes: row.bytes,
                    changed: row.changed,
                },
                null,
                2,
            ),
            'utf8',
        );
    }
    return row;
}

export async function fetchUpstream(code, fileId) {
    let lastErr = null;
    for (const base of ROWIT_BASES) {
        const url = `${base}/${code}/${fileId}.csv`;
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: { Accept: 'text/csv,text/plain,*/*' },
                signal: AbortSignal.timeout(20000),
            });
            const text = await res.text();
            if (res.ok && isCsvLike(text)) {
                return { text, url, bytes: Buffer.byteLength(text, 'utf8') };
            }
            lastErr = new Error(`HTTP ${res.status} from ${url}`);
        } catch (err) {
            lastErr = err instanceof Error ? err : new Error(String(err));
        }
    }
    throw lastErr || new Error(`No CSV for ${code}/${fileId}`);
}

export async function refreshFile(code, fileId, { force = false } = {}) {
    const c = normalizeRegattaCode(code);
    const f = String(fileId || '').toLowerCase();
    if (!c || !ROWIT_FILES.includes(f)) {
        throw new Error('Invalid regatta code or file');
    }
    watchCode(c);
    let cached = readEntry(c, f);
    if (cached && !isCsvLike(cached.text)) cached = null;
    const ageMs = cached ? Date.now() - cached.updatedAt : Infinity;
    if (cached && !force && ageMs < STALE_MS) {
        return {
            ok: true,
            status: 'fresh',
            changed: false,
            ageMs,
            ...publicMeta(cached),
        };
    }

    try {
        const up = await fetchUpstream(c, f);
        const changed = !cached || cached.hash !== sha256(up.text);
        const row = writeEntry(c, f, up.text, up.url, changed);
        return {
            ok: true,
            status: changed ? 'updated' : 'unchanged',
            changed,
            ageMs: 0,
            ...publicMeta(row),
        };
    } catch (err) {
        if (cached) {
            return {
                ok: true,
                status: 'offline',
                changed: false,
                ageMs,
                error: err instanceof Error ? err.message : String(err),
                ...publicMeta(cached),
            };
        }
        throw err;
    }
}

function publicMeta(row) {
    return {
        code: row.code,
        fileId: row.fileId,
        bytes: row.bytes,
        hash: row.hash,
        sourceUrl: row.sourceUrl,
        updatedAt: row.updatedAt,
        storage: ensureDisk() ? 'disk' : 'memory',
    };
}

export async function refreshCode(code, files = ROWIT_FILES, opts = {}) {
    const c = watchCode(code);
    const list = (files || ROWIT_FILES).filter((f) => ROWIT_FILES.includes(f));
    const results = [];
    for (const fileId of list) {
        results.push(await refreshFile(c, fileId, opts));
    }
    return { code: c, files: results };
}

export async function refreshWatched(opts = {}) {
    const codes = watchedCodes().filter((c) => isLiveCsvPollDay(c));
    const out = [];
    for (const code of codes) {
        out.push(await refreshCode(code, ROWIT_FILES, opts));
    }
    return out;
}

export function queueRefreshWatched() {
    refreshChain = refreshChain
        .then(() => refreshWatched({ force: true }))
        .then((rows) => {
            const changed = rows.flatMap((r) => r.files).filter((f) => f.changed);
            if (changed.length) {
                console.log(
                    '[rowit] updated',
                    changed.map((f) => `${f.code}/${f.fileId}`).join(', '),
                );
            }
            return rows;
        })
        .catch((err) => {
            console.error('[rowit] refresh failed', err.message || err);
        });
    return refreshChain;
}

export function getCachedText(code, fileId) {
    const row = readEntry(normalizeRegattaCode(code), String(fileId || '').toLowerCase());
    return row || null;
}

function refreshBackground(code, fileId) {
    refreshFile(code, fileId, { force: true }).catch((err) => {
        console.error('[rowit] background', code, fileId, err.message || err);
    });
}

/** Serve CSV for overlays: local copy first; refresh RowIT in the background if stale. */
export async function serveCachedCsv(targetUrl, { force = false } = {}) {
    const parsed = parseRowitUrl(targetUrl);
    if (!parsed) return null;
    watchCode(parsed.code);
    if (force) {
        const result = await refreshFile(parsed.code, parsed.fileId, { force: true });
        const row = readEntry(parsed.code, parsed.fileId);
        return { text: row?.text || '', meta: result };
    }
    const cached = readEntry(parsed.code, parsed.fileId);
    if (cached && isCsvLike(cached.text)) {
        const ageMs = Date.now() - cached.updatedAt;
        if (ageMs >= STALE_MS && isLiveCsvPollDay(parsed.code)) {
            refreshBackground(parsed.code, parsed.fileId);
        }
        return {
            text: cached.text,
            meta: {
                ok: true,
                status: ageMs >= STALE_MS ? 'stale' : 'cache',
                changed: false,
                ageMs,
                ...publicMeta(cached),
            },
        };
    }
    const result = await refreshFile(parsed.code, parsed.fileId, { force: true });
    const row = readEntry(parsed.code, parsed.fileId);
    return { text: row?.text || '', meta: result };
}

export function cacheStatus(code) {
    const codes = code ? [watchCode(code)] : watchedCodes();
    return {
        staleMs: STALE_MS,
        storage: ensureDisk() ? 'disk' : 'memory',
        dir: ensureDisk() ? cacheRoot() : null,
        codes: codes.filter(Boolean).map((c) => ({
            code: c,
            files: ROWIT_FILES.map((fileId) => {
                const row = readEntry(c, fileId);
                if (!row) {
                    return { fileId, cached: false };
                }
                return {
                    fileId,
                    cached: true,
                    ageMs: Date.now() - row.updatedAt,
                    bytes: row.bytes,
                    updatedAt: row.updatedAt,
                    sourceUrl: row.sourceUrl,
                    storage: ensureDisk() ? 'disk' : 'memory',
                };
            }),
        })),
    };
}

export function seedWatchedFromEnv() {
    const raw = String(process.env.ROWIT_REGATTA_CODE || '').trim();
    if (raw) watchCode(raw);
}
