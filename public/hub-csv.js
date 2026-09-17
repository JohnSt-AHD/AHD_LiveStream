/**
 * RowIT CSV feeds — regatta code builds l.rowit.nz/altitude/{code}/ URLs.
 */
const LS_REGATTA_CODE = 'altitudeHdRegattaCode_v1';
const LS_CSV_URLS = 'altitudeHdCsvUrls_v1';
const LS_CSV_POLL = 'altitudeHdCsvPoll_v1';
const ROWIT_ALTITUDE_BASE = 'https://l.rowit.nz/altitude';
const ROWIT_ALTITUDE_BASES = [
    'https://l.rowit.nz/altitude',
    'https://rowit.nz/altitude',
];
const DEFAULT_REGATTA_CODE = 'nzmm2026';
const CSV_POLL_INTERVAL_MS = 60_000;

const CSV_FIELDS = [
    { id: 'events', label: 'Events' },
    { id: 'daysheet', label: 'Daysheet' },
    { id: 'results', label: 'Results' },
    { id: 'competitors', label: 'Competitors' },
];

function normalizeRegattaCode(raw) {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
}

function extractCodeFromUrl(url) {
    const m = String(url || '').match(/\/altitude\/([a-z0-9_-]+)\//i);
    return m ? normalizeRegattaCode(m[1]) : '';
}

function buildCsvUrl(code, fileId) {
    const c = normalizeRegattaCode(code);
    if (!c) return '';
    return `${ROWIT_ALTITUDE_BASE}/${c}/${fileId}.csv`;
}

/** Try l.rowit.nz first, then rowit.nz (some regattas e.g. cnzb2026 publish results there). */
function buildCsvUrlCandidates(code, fileId) {
    const c = normalizeRegattaCode(code);
    if (!c) return [];
    return ROWIT_ALTITUDE_BASES.map((base) => `${base}/${c}/${fileId}.csv`);
}

function urlsFromRegattaCode(code) {
    const values = {};
    CSV_FIELDS.forEach((f) => {
        values[f.id] = buildCsvUrl(code, f.id);
    });
    return values;
}

function loadRegattaCode() {
    try {
        const raw = localStorage.getItem(LS_REGATTA_CODE);
        if (raw) {
            const c = normalizeRegattaCode(raw);
            if (c && c !== 'mads2026') return c;
        }
    } catch {
        /* ignore */
    }
    try {
        const saved = JSON.parse(localStorage.getItem(LS_CSV_URLS) || '{}');
        if (saved && typeof saved === 'object') {
            for (const f of CSV_FIELDS) {
                const fromUrl = extractCodeFromUrl(saved[f.id]);
                if (fromUrl) return fromUrl;
            }
        }
    } catch {
        /* ignore */
    }
    return DEFAULT_REGATTA_CODE;
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

function localCsvPath(code, fileId) {
    const c = normalizeRegattaCode(code);
    const f = String(fileId || '').toLowerCase();
    if (!c || !f) return '';
    return `data/archives/${c}/latest/${f}.csv`;
}

function saveRegattaCode(code) {
    const c = normalizeRegattaCode(code);
    try {
        if (c) {
            localStorage.setItem(LS_REGATTA_CODE, c);
            localStorage.setItem(LS_CSV_URLS, JSON.stringify(urlsFromRegattaCode(c)));
        } else {
            localStorage.removeItem(LS_REGATTA_CODE);
            localStorage.removeItem(LS_CSV_URLS);
        }
    } catch {
        /* ignore */
    }
    return c;
}

function getRegattaCode() {
    const input = document.getElementById('hubRegattaCode');
    if (input && normalizeRegattaCode(input.value)) {
        return normalizeRegattaCode(input.value);
    }
    return loadRegattaCode() || DEFAULT_REGATTA_CODE;
}

function collectValues() {
    return urlsFromRegattaCode(getRegattaCode());
}

function getCsvUrl(id) {
    return collectValues()[id] || '';
}

function updateCsvTitle(code) {
    const title = document.getElementById('hub-csv-title');
    if (!title) return;
    const c = normalizeRegattaCode(code);
    title.textContent = c ? `RowIT CSV data (${c.toUpperCase()})` : 'RowIT CSV data';
}

function setStatus(row, state, message) {
    const icon = row.querySelector('.hub-csv-status');
    if (!icon) return;
    icon.classList.remove(
        'hub-csv-status--ok',
        'hub-csv-status--fail',
        'hub-csv-status--pending',
    );
    if (state === 'ok') {
        icon.classList.add('hub-csv-status--ok');
        icon.textContent = '✓';
        icon.title = message || 'Link OK';
    } else if (state === 'fail') {
        icon.classList.add('hub-csv-status--fail');
        icon.textContent = '✕';
        icon.title = message || 'Not reachable';
    } else {
        icon.classList.add('hub-csv-status--pending');
        icon.textContent = '…';
        icon.title = message || 'Checking…';
    }
}

async function checkCsvUrl(url) {
    const trimmed = (url || '').trim();
    if (!trimmed) {
        return { ok: false, error: 'Empty URL' };
    }
    try {
        const res = await fetch(
            `/api/check-csv?url=${encodeURIComponent(trimmed)}`,
        );
        const data = await res.json();
        if (data && typeof data.ok === 'boolean') return data;
    } catch {
        /* try direct */
    }
    try {
        const res = await fetch(trimmed, { method: 'GET', mode: 'cors' });
        const text = await res.text();
        return {
            ok: res.ok && isCsvLike(text),
            status: res.status,
            bytes: text.length,
        };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
    }
}

async function checkLocalCsv(code, fileId) {
    const path = localCsvPath(code, fileId);
    if (!path) return { ok: false };
    try {
        const res = await fetch(path);
        if (!res.ok) return { ok: false, status: res.status };
        const text = await res.text();
        return {
            ok: isCsvLike(text),
            status: res.status,
            bytes: text.length,
            local: true,
        };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
    }
}

async function checkRow(row) {
    const url = row.dataset.csvUrl;
    const fileId = row.dataset.csvId;
    const code = getRegattaCode();
    if (!url && !fileId) return;
    setStatus(row, 'pending', 'Checking…');
    const candidates = fileId ? buildCsvUrlCandidates(code, fileId) : [url];
    let last = { ok: false };
    for (const candidate of candidates.filter(Boolean)) {
        last = await checkCsvUrl(candidate);
        if (last.ok) {
            setStatus(row, 'ok', `OK (${last.bytes ?? 'CSV'} bytes)`);
            return last;
        }
    }
    const local = await checkLocalCsv(code, fileId);
    if (local.ok) {
        setStatus(row, 'ok', `Local copy (${local.bytes ?? 'CSV'} bytes)`);
        return local;
    }
    const unpublished =
        last.status === 404 ||
        last.status === 200 ||
        /not published|nothing published|HTTP 404/i.test(
            String(last.error || last.status || ''),
        );
    setStatus(
        row,
        'fail',
        unpublished
            ? 'Not published yet'
            : last.error || `HTTP ${last.status ?? 'error'}`,
    );
    return last;
}

function refreshCsvRows(code) {
    const c = saveRegattaCode(code);
    const urls = c ? urlsFromRegattaCode(c) : {};
    updateCsvTitle(c);

    const preview = document.getElementById('hubCsvBasePreview');
    if (preview) {
        preview.textContent = c
            ? `${ROWIT_ALTITUDE_BASE}/${c}/`
            : `${ROWIT_ALTITUDE_BASE}/…/`;
    }

    const list = document.getElementById('hubCsvList');
    if (!list) return;

    list.querySelectorAll('.hub-csv-row').forEach((row) => {
        const id = row.dataset.csvId;
        const urlEl = row.querySelector('.hub-csv-url');
        const status = row.querySelector('.hub-csv-status');
        const url = urls[id] || '';
        row.dataset.csvUrl = url;
        if (urlEl) {
            urlEl.textContent = c ? `${id}.csv` : 'Enter a regatta code';
            urlEl.title = url || 'Enter a regatta code to build CSV links';
        }
        if (!c && status) {
            status.classList.remove(
                'hub-csv-status--ok',
                'hub-csv-status--fail',
                'hub-csv-status--pending',
            );
            status.textContent = '–';
            status.title = 'Enter a regatta code';
        }
    });
}

function notifyUrlsChanged() {
    document.dispatchEvent(
        new CustomEvent('altitudehd:urls', { detail: collectValues() }),
    );
}

const ROWIT_CHANNEL = 'altitudehd-rowit';

function notifyRowitReload(detail) {
    document.dispatchEvent(new CustomEvent('altitudehd:rowit', { detail }));
    try {
        const ch = new BroadcastChannel(ROWIT_CHANNEL);
        ch.postMessage({ action: 'reload', ...detail, t: Date.now() });
        ch.close();
    } catch {
        /* ignore */
    }
}

function formatAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return 'just now';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    return `${Math.round(ms / 60_000)}m ago`;
}

async function refreshRowitStatus() {
    const el = document.getElementById('hubRowitCacheStatus');
    const code = getRegattaCode();
    if (!el) return;
    if (!code) {
        el.textContent = 'Enter a regatta code to download CSVs locally.';
        return;
    }
    try {
        const res = await fetch(`/api/rowit-cache?code=${encodeURIComponent(code)}`);
        if (!res.ok) {
            el.textContent = 'Local cache API not available — overlays still fetch RowIT live.';
            return;
        }
        const data = await res.json();
        const row = (data.codes || []).find((c) => c.code === code) || data.codes?.[0];
        if (!row) {
            el.textContent = `${code}: no local copies yet — will download on first overlay/schedule load.`;
            return;
        }
        const bits = row.files
            .filter((f) => f.cached)
            .map((f) => `${f.fileId} ${formatAge(f.ageMs)}`);
        el.textContent = bits.length
            ? `Local (${data.storage || 'disk'}): ${bits.join(' · ')}`
            : `${code}: waiting for first download.`;
    } catch {
        el.textContent = 'Could not read local RowIT cache status.';
    }
}

async function updateResultsNow() {
    const code = getRegattaCode();
    const buttons = ['hubResultsRefresh', 'hubResultsRefreshBoard']
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    if (!code) {
        const el = document.getElementById('hubRowitCacheStatus');
        if (el) el.textContent = 'Enter a regatta code first.';
        return;
    }
    buttons.forEach((b) => {
        b.disabled = true;
        b.dataset.label = b.textContent;
        b.textContent = 'Updating…';
    });
    try {
        const res = await fetch('/api/rowit-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'refresh',
                code,
                files: ['results', 'daysheet'],
                force: true,
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        notifyRowitReload({ code, files: data.files });
        await refreshRowitStatus();
        notifyUrlsChanged();
    } catch (err) {
        const el = document.getElementById('hubRowitCacheStatus');
        if (el) {
            el.textContent =
                'Results update failed: ' +
                (err instanceof Error ? err.message : 'unknown error');
        }
    } finally {
        buttons.forEach((b) => {
            b.disabled = false;
            if (b.dataset.label) b.textContent = b.dataset.label;
        });
    }
}

window.AltitudeHdHub = {
    CSV_FIELDS,
    DEFAULT_REGATTA_CODE,
    ROWIT_ALTITUDE_BASE,
    normalizeRegattaCode,
    buildCsvUrl,
    buildCsvUrlCandidates,
    ROWIT_ALTITUDE_BASES,
    urlsFromRegattaCode,
    getRegattaCode,
    getCsvUrls: collectValues,
    getCsvUrl,
    loadRegattaCode,
    updateResultsNow,
    isCsvLike,
    localCsvPath,
};

/* ── Auto-poll state ──────────────────────────────────────────────── */
let csvPollTimer = null;
const csvLastSuccess = {};

function formatTimestamp(date) {
    if (!date) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function updateTimestampEl(row, csvId) {
    let el = row.querySelector('.hub-csv-timestamp');
    if (!el) return;
    const ts = csvLastSuccess[csvId];
    el.textContent = ts ? formatTimestamp(ts) : '—';
    el.title = ts ? `Last successful check: ${ts.toISOString()}` : 'Not yet checked';
}

async function checkRowWithTimestamp(row) {
    const result = await checkRow(row);
    const csvId = row.dataset.csvId;
    if (result && result.ok) {
        csvLastSuccess[csvId] = new Date();
    }
    updateTimestampEl(row, csvId);
    return result;
}

async function csvPollWindowHint(code) {
    const archive = window.RegattaCsvArchive;
    if (!archive?.getRegattaSchedule) return '';
    try {
        const schedule = await archive.getRegattaSchedule(code);
        if (schedule.phase === 'live-day' || schedule.phase === 'unknown') return '';
        const windowLabel =
            archive.formatPollWindow?.(schedule.range) ||
            (schedule.range?.start && schedule.range?.end
                ? `${schedule.range.start} – ${schedule.range.end}`
                : '');
        return windowLabel ? ` — waiting until ${windowLabel}` : ' — waiting until race day';
    } catch {
        return '';
    }
}

async function pollAllCsvs() {
    const list = document.getElementById('hubCsvList');
    if (!list) return;
    const archive = window.RegattaCsvArchive;
    if (archive?.isLiveCsvPollDay) {
        const live = await archive.isLiveCsvPollDay(getRegattaCode());
        if (!live) {
            const label = document.getElementById('hubCsvPollLabel');
            if (label) {
                const hint = await csvPollWindowHint(getRegattaCode());
                label.textContent = `Auto-poll ON${hint}`;
            }
            return;
        }
    }
    for (const row of list.querySelectorAll('.hub-csv-row')) {
        await checkRowWithTimestamp(row);
    }
}

function loadPollSetting() {
    try {
        return localStorage.getItem(LS_CSV_POLL) === '1';
    } catch {
        return false;
    }
}

function savePollSetting(on) {
    try {
        localStorage.setItem(LS_CSV_POLL, on ? '1' : '0');
    } catch { /* ignore */ }
}

function startCsvPoll() {
    stopCsvPoll();
    pollAllCsvs();
    csvPollTimer = setInterval(pollAllCsvs, CSV_POLL_INTERVAL_MS);
}

function stopCsvPoll() {
    if (csvPollTimer) {
        clearInterval(csvPollTimer);
        csvPollTimer = null;
    }
}

async function syncPollToggle(toggle) {
    if (!toggle) return;
    const on = toggle.checked;
    savePollSetting(on);
    const label = document.getElementById('hubCsvPollLabel');
    if (label) {
        if (!on) {
            label.textContent = 'Auto-poll OFF';
        } else {
            const hint = await csvPollWindowHint(getRegattaCode());
            label.textContent = hint
                ? `Auto-poll ON${hint}`
                : `Auto-poll ON — checking every ${CSV_POLL_INTERVAL_MS / 1000}s`;
        }
    }
    if (on) {
        startCsvPoll();
    } else {
        stopCsvPoll();
    }
}

function initHubCsv() {
    const list = document.getElementById('hubCsvList');
    const codeInput = document.getElementById('hubRegattaCode');
    if (!list || list.dataset.bound === '1') return;
    list.dataset.bound = '1';

    const code = loadRegattaCode();
    if (codeInput) {
        codeInput.value = code;
    }

    const urls = urlsFromRegattaCode(code);
    updateCsvTitle(code);

    CSV_FIELDS.forEach((f) => {
        const li = document.createElement('li');
        li.className = 'hub-csv-row';
        li.dataset.csvId = f.id;
        li.dataset.csvUrl = urls[f.id];

        const label = document.createElement('label');
        label.className = 'hub-csv-label';
        label.textContent = f.label;

        const wrap = document.createElement('div');
        wrap.className = 'hub-csv-input-wrap';

        const status = document.createElement('span');
        status.className = 'hub-csv-status hub-csv-status--pending';
        status.setAttribute('aria-hidden', 'true');
        status.textContent = '…';

        const urlText = document.createElement('span');
        urlText.className = 'hub-csv-url';
        urlText.title = urls[f.id];
        urlText.textContent = `${f.id}.csv`;

        const timestamp = document.createElement('span');
        timestamp.className = 'hub-csv-timestamp';
        timestamp.textContent = '—';

        wrap.appendChild(status);
        wrap.appendChild(urlText);
        wrap.appendChild(timestamp);
        li.appendChild(label);
        li.appendChild(wrap);
        list.appendChild(li);
    });

    const applyCode = () => {
        const c = saveRegattaCode(codeInput ? codeInput.value : code);
        if (codeInput) codeInput.value = c;
        refreshCsvRows(c);
        notifyUrlsChanged();
        if (c) {
            fetch('/api/rowit-cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'watch', code: c }),
            }).catch(() => {});
            list.querySelectorAll('.hub-csv-row').forEach((row) => checkRowWithTimestamp(row));
            refreshRowitStatus();
        }
    };

    if (codeInput) {
        codeInput.addEventListener('change', applyCode);
        codeInput.addEventListener('blur', applyCode);
    }

    const checkAll = document.getElementById('hubCsvCheckAll');
    if (checkAll) {
        checkAll.addEventListener('click', async () => {
            applyCode();
            if (!normalizeRegattaCode(codeInput ? codeInput.value : '')) return;
            checkAll.disabled = true;
            for (const row of list.querySelectorAll('.hub-csv-row')) {
                await checkRowWithTimestamp(row);
            }
            checkAll.disabled = false;
            refreshRowitStatus();
        });
    }

    const pollToggle = document.getElementById('hubCsvPollToggle');
    if (pollToggle) {
        pollToggle.checked = loadPollSetting();
        pollToggle.addEventListener('change', () => syncPollToggle(pollToggle));
    }

    for (const id of ['hubResultsRefresh', 'hubResultsRefreshBoard']) {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', () => updateResultsNow());
    }

    refreshCsvRows(code);
    if (code) {
        list.querySelectorAll('.hub-csv-row').forEach((row) => checkRowWithTimestamp(row));
        fetch('/api/rowit-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'watch', code }),
        }).catch(() => {});
    }
    refreshRowitStatus();
    setInterval(refreshRowitStatus, 15000);
    notifyUrlsChanged();

    /* Start poll if saved as on */
    if (pollToggle && pollToggle.checked) {
        syncPollToggle(pollToggle);
    }
}

document.addEventListener('DOMContentLoaded', initHubCsv);
