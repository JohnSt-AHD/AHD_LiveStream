/**
 * RowIT CSV fetch with local archive fallback (public/data/archives/{code}/).
 * Past regattas: archive first. On regatta days: RowIT live first.
 * 1-min live polling runs only on startDate–endDate (Pacific/Auckland).
 */
(function (global) {
    const MANIFEST_URL = 'data/regatta-archives.json';
    const CONFIG_URL = 'data/regatta-archive-codes.json';
    const ROWIT_BASES = [
        'https://l.rowit.nz/altitude',
        'https://rowit.nz/altitude',
    ];
    const CSV_FILES = new Set(['events', 'daysheet', 'results', 'competitors']);

    const MONTHS = {
        january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
        may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
        september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
        december: 11, dec: 11,
    };

    let manifestCache = null;
    let manifestPromise = null;
    let configCache = null;
    let configPromise = null;
    const scheduleCache = new Map();

    function normalizeRegattaCode(raw) {
        return String(raw || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '');
    }

    const NZ_TZ = 'Pacific/Auckland';

    function ymdLocal(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function todayYmd() {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: NZ_TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
    }

    function formatPollWindow(range) {
        if (!range?.start || !range?.end) return '';
        const fmt = (ymd) => {
            const [y, m, d] = String(ymd).split('-').map(Number);
            if (!y || !m || !d) return String(ymd);
            return new Intl.DateTimeFormat('en-NZ', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                timeZone: 'UTC',
            }).format(new Date(Date.UTC(y, m - 1, d)));
        };
        if (range.start === range.end) return fmt(range.start);
        if (range.start.slice(0, 7) === range.end.slice(0, 7)) {
            const d1 = parseInt(range.start.slice(8), 10);
            return `${d1}–${fmt(range.end)}`;
        }
        return `${fmt(range.start)} – ${fmt(range.end)}`;
    }

    function parseDayHeader(line) {
        const m = String(line || '').match(
            /DAY\s+\d+:\s+\w+\s+(\d{1,2})(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/i,
        );
        if (!m) return null;
        const month = MONTHS[m[2].toLowerCase()];
        if (month === undefined) return null;
        return new Date(parseInt(m[3], 10), month, parseInt(m[1], 10));
    }

    function parseDaysheetDateRange(text) {
        const dates = [];
        for (const line of String(text || '').split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!/^DAY\s+\d+:/i.test(trimmed)) continue;
            const d = parseDayHeader(trimmed);
            if (d) dates.push(d);
        }
        if (!dates.length) return null;
        dates.sort((a, b) => a.getTime() - b.getTime());
        return { start: ymdLocal(dates[0]), end: ymdLocal(dates[dates.length - 1]) };
    }

    function yearFromCode(code) {
        const m = String(code || '').match(/(20\d{2})$/);
        return m ? parseInt(m[1], 10) : null;
    }

    function parseRowitUrl(url) {
        const m = String(url || '').match(/\/altitude\/([a-z0-9_-]+)\/([a-z]+)\.csv/i);
        if (!m) return null;
        const file = m[2].toLowerCase();
        if (!CSV_FILES.has(file)) return null;
        return { code: normalizeRegattaCode(m[1]), file };
    }

    function buildCsvUrlCandidates(code, fileId) {
        const c = normalizeRegattaCode(code);
        if (global.AltitudeHdHub?.buildCsvUrlCandidates) {
            return global.AltitudeHdHub.buildCsvUrlCandidates(c, fileId);
        }
        return ROWIT_BASES.map((base) => `${base}/${c}/${fileId}.csv`);
    }

    function archiveLatestPath(code, fileId) {
        const c = normalizeRegattaCode(code);
        return `data/archives/${c}/latest/${fileId}.csv`;
    }

    function archiveDailyPath(code, fileId, date) {
        const c = normalizeRegattaCode(code);
        return `data/archives/${c}/daily/${date}/${fileId}.csv`;
    }

    function isCsvLike(text) {
        const t = String(text || '')
            .replace(/^\uFEFF/, '')
            .trim();
        if (t.length < 20 || !t.includes(',')) return false;
        if (/^<!doctype html/i.test(t) || /<html[\s>]/i.test(t)) return false;
        if (/nothing published/i.test(t)) return false;
        return /event|race|day |competitor|lane_/i.test(t);
    }

    async function loadManifest() {
        if (manifestCache) return manifestCache;
        if (!manifestPromise) {
            manifestPromise = fetch(MANIFEST_URL)
                .then((r) => (r.ok ? r.json() : { regattas: {} }))
                .catch(() => ({ regattas: {} }))
                .then((data) => {
                    manifestCache = data && typeof data === 'object' ? data : { regattas: {} };
                    return manifestCache;
                });
        }
        return manifestPromise;
    }

    async function loadRegattaConfig() {
        if (configCache) return configCache;
        if (!configPromise) {
            configPromise = fetch(CONFIG_URL)
                .then((r) => (r.ok ? r.json() : { regattas: [] }))
                .catch(() => ({ regattas: [] }))
                .then((data) => {
                    configCache = data && typeof data === 'object' ? data : { regattas: [] };
                    return configCache;
                });
        }
        return configPromise;
    }

    function mostRecentDailyDate(reg) {
        const days = Array.isArray(reg?.daily) ? [...reg.daily] : [];
        days.sort();
        return days.length ? days[days.length - 1] : null;
    }

    function resolvePhase(today, range, code) {
        if (range?.start && range?.end) {
            if (today > range.end) return 'past';
            if (today >= range.start && today <= range.end) return 'live-day';
            if (today < range.start) return 'before';
        }
        const yr = yearFromCode(code);
        if (yr != null) {
            const curYear = parseInt(todayYmd().slice(0, 4), 10);
            if (curYear > yr) return 'past';
            if (curYear < yr) return 'before';
        }
        return 'unknown';
    }

    /** On-air name for the title graphic: `title`, else `name`, else the code. */
    async function getRegattaDisplayName(code) {
        const c = normalizeRegattaCode(code);
        if (!c) return '';
        const config = await loadRegattaConfig();
        const entry = (config.regattas || []).find((r) => normalizeRegattaCode(r.code) === c);
        return String(entry?.title || entry?.name || '').trim();
    }
    async function isLiveCsvPollDay(code) {
        const schedule = await getRegattaSchedule(code);
        return schedule.phase === 'live-day' || schedule.phase === 'unknown';
    }

    /**
     * Whether to prefer RowIT live CSV (true) or local archive (false).
     * @param {string} code
     */
    async function getRegattaSchedule(code) {
        const c = normalizeRegattaCode(code);
        const cacheKey = `${c}:${todayYmd()}`;
        if (scheduleCache.has(cacheKey)) return scheduleCache.get(cacheKey);

        let range = null;
        let rangeSource = 'none';

        const config = await loadRegattaConfig();
        const entry = (config.regattas || []).find((r) => normalizeRegattaCode(r.code) === c);
        if (entry?.startDate && entry?.endDate) {
            range = { start: entry.startDate, end: entry.endDate };
            rangeSource = 'config';
        }

        if (!range) {
            try {
                const text = await fetchText(archiveLatestPath(c, 'daysheet'), { skipProxy: true });
                range = parseDaysheetDateRange(text);
                if (range) rangeSource = 'daysheet';
            } catch {
                /* no archived daysheet yet */
            }
        }

        if (!range) {
            try {
                const text = await fetchText(archiveLatestPath(c, 'competitors'), {
                    skipProxy: true,
                });
                range = parseDaysheetDateRange(text);
                if (range) rangeSource = 'competitors';
            } catch {
                /* no archived competitors yet */
            }
        }

        const today = todayYmd();
        const phase = resolvePhase(today, range, c);
        const preferLive = phase === 'live-day' || phase === 'before' || phase === 'unknown';

        const schedule = {
            code: c,
            today,
            range,
            rangeSource,
            phase,
            preferLive: phase === 'past' ? false : preferLive,
            sourceLabel:
                phase === 'past'
                    ? 'archive (past regatta)'
                    : phase === 'live-day'
                      ? 'RowIT live (regatta day)'
                      : phase === 'before'
                        ? 'RowIT live (pre-regatta)'
                        : 'RowIT live',
        };

        scheduleCache.set(cacheKey, schedule);
        return schedule;
    }

    async function fetchText(pathOrUrl, opts = {}) {
        const trimmed = String(pathOrUrl || '').trim();
        if (!trimmed) throw new Error('No URL');
        const isRowit = /rowit\.nz/i.test(trimmed);
        if (isRowit && !opts.skipProxy) {
            try {
                const res = await fetch(`/api/fetch-csv?url=${encodeURIComponent(trimmed)}`);
                if (res.ok) {
                    const text = await res.text();
                    if (isCsvLike(text)) return text;
                }
            } catch {
                /* direct */
            }
        }
        const res = await fetch(trimmed);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!isCsvLike(text)) throw new Error('Not a CSV');
        return text;
    }

    async function fetchArchiveCsv(code, fileId) {
        const c = normalizeRegattaCode(code);
        const manifest = await loadManifest();
        const reg = manifest.regattas?.[c];
        const tried = [];

        const latestRel = reg?.latest?.[fileId] || archiveLatestPath(c, fileId);
        tried.push(latestRel);
        try {
            return { text: await fetchText(latestRel, { skipProxy: true }), source: 'archive-latest', path: latestRel };
        } catch {
            /* next */
        }

        const day = mostRecentDailyDate(reg);
        if (day) {
            const dailyRel = archiveDailyPath(c, fileId, day);
            tried.push(dailyRel);
            try {
                return { text: await fetchText(dailyRel, { skipProxy: true }), source: 'archive-daily', path: dailyRel };
            } catch {
                /* fail */
            }
        }

        if (fileId === 'daysheet') {
            try {
                return await fetchArchiveCsv(c, 'competitors');
            } catch {
                /* continue */
            }
        }

        throw new Error(`No archive for ${c}/${fileId} (tried ${tried.join(', ')})`);
    }

    async function fetchLiveCsv(code, fileId) {
        const candidates = buildCsvUrlCandidates(code, fileId);
        let lastErr = null;
        for (const url of candidates) {
            try {
                const text = await fetchText(url);
                return { text, source: 'rowit-live', url };
            } catch (err) {
                lastErr = err;
            }
        }
        if (fileId === 'daysheet') {
            try {
                return await fetchLiveCsv(code, 'competitors');
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr || new Error(`RowIT unavailable for ${fileId}.csv`);
    }

    async function fetchWithFallback(primary, secondary, legacyPath) {
        let primaryErr = null;
        try {
            return await primary();
        } catch (err) {
            primaryErr = err;
        }
        try {
            return await secondary();
        } catch (secondaryErr) {
            if (legacyPath) {
                try {
                    const text = await fetchText(legacyPath, { skipProxy: true });
                    return { text, source: 'legacy-bundle' };
                } catch {
                    /* continue */
                }
            }
            const p = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
            const s = secondaryErr instanceof Error ? secondaryErr.message : String(secondaryErr);
            throw new Error(`${p}; fallback: ${s}`);
        }
    }

    /**
     * @param {string} code
     * @param {string} fileId - events | daysheet | results | competitors
     * @param {{ legacyPath?: string, preferLive?: boolean }} [options]
     */
    async function fetchRegattaCsv(code, fileId, options = {}) {
        const c = normalizeRegattaCode(code);
        const file = String(fileId || '').toLowerCase();
        const schedule = await getRegattaSchedule(c);
        const preferLive = options.preferLive != null ? options.preferLive : schedule.preferLive;

        const liveFn = () => fetchLiveCsv(c, file);
        const archiveFn = () => fetchArchiveCsv(c, file);

        const result = preferLive
            ? await fetchWithFallback(liveFn, archiveFn, options.legacyPath)
            : await fetchWithFallback(archiveFn, liveFn, options.legacyPath);

        return result.text != null ? result.text : result;
    }

    /** Fetch by full RowIT URL (hub schedule board). */
    async function fetchCsvUrl(url) {
        const parsed = parseRowitUrl(url);
        if (parsed) {
            return fetchRegattaCsv(parsed.code, parsed.file);
        }
        return fetchText(url);
    }

    global.RegattaCsvArchive = {
        MANIFEST_URL,
        CONFIG_URL,
        normalizeRegattaCode,
        parseRowitUrl,
        parseDaysheetDateRange,
        buildCsvUrlCandidates,
        archiveLatestPath,
        archiveDailyPath,
        loadManifest,
        loadRegattaConfig,
        getRegattaSchedule,
        isLiveCsvPollDay,
        getRegattaDisplayName,
        formatPollWindow,
        todayYmd,
        fetchRegattaCsv,
        fetchArchiveCsv,
        fetchCsvUrl,
        fetchText,
        isCsvLike,
    };
})(typeof window !== 'undefined' ? window : globalThis);
