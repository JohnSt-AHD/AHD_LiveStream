/**
 * RowIT CSV fetch with local archive fallback (public/data/archives/{code}/).
 */
(function (global) {
    const MANIFEST_URL = 'data/regatta-archives.json';
    const ROWIT_BASES = [
        'https://l.rowit.nz/altitude',
        'https://rowit.nz/altitude',
    ];
    const CSV_FILES = new Set(['events', 'daysheet', 'results', 'competitors']);

    let manifestCache = null;
    let manifestPromise = null;

    function normalizeRegattaCode(raw) {
        return String(raw || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '');
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
        const t = String(text || '').trim();
        return t.length > 20 && t.includes(',') && !/nothing published/i.test(t);
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

    function mostRecentDailyDate(reg) {
        const days = Array.isArray(reg?.daily) ? [...reg.daily] : [];
        days.sort();
        return days.length ? days[days.length - 1] : null;
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
        throw lastErr || new Error(`RowIT unavailable for ${fileId}.csv`);
    }

    /**
     * @param {string} code
     * @param {string} fileId - events | daysheet | results | competitors
     * @param {{ legacyPath?: string }} [options]
     */
    async function fetchRegattaCsv(code, fileId, options = {}) {
        const c = normalizeRegattaCode(code);
        const file = String(fileId || '').toLowerCase();
        let liveErr = null;
        try {
            const live = await fetchLiveCsv(c, file);
            return live.text;
        } catch (err) {
            liveErr = err;
        }
        try {
            const archived = await fetchArchiveCsv(c, file);
            return archived.text;
        } catch (archiveErr) {
            if (options.legacyPath) {
                try {
                    const text = await fetchText(options.legacyPath, { skipProxy: true });
                    return text;
                } catch {
                    /* continue */
                }
            }
            const liveMsg = liveErr instanceof Error ? liveErr.message : String(liveErr);
            const archMsg = archiveErr instanceof Error ? archiveErr.message : String(archiveErr);
            throw new Error(`${file}.csv: live failed (${liveMsg}); archive failed (${archMsg})`);
        }
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
        normalizeRegattaCode,
        parseRowitUrl,
        buildCsvUrlCandidates,
        archiveLatestPath,
        archiveDailyPath,
        loadManifest,
        fetchRegattaCsv,
        fetchCsvUrl,
        fetchText,
        isCsvLike,
    };
})(typeof window !== 'undefined' ? window : globalThis);
