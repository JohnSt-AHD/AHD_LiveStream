/**
 * RowIT CSV feeds — regatta code builds l.rowit.nz/altitude/{code}/ URLs.
 */
const LS_REGATTA_CODE = 'altitudeHdRegattaCode_v1';
const LS_CSV_URLS = 'altitudeHdCsvUrls_v1';
const ROWIT_ALTITUDE_BASE = 'https://l.rowit.nz/altitude';
const DEFAULT_REGATTA_CODE = 'mads2026';

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
    const c = normalizeRegattaCode(code) || DEFAULT_REGATTA_CODE;
    return `${ROWIT_ALTITUDE_BASE}/${c}/${fileId}.csv`;
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
            if (c) return c;
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

function saveRegattaCode(code) {
    const c = normalizeRegattaCode(code) || DEFAULT_REGATTA_CODE;
    try {
        localStorage.setItem(LS_REGATTA_CODE, c);
        localStorage.setItem(LS_CSV_URLS, JSON.stringify(urlsFromRegattaCode(c)));
    } catch {
        /* ignore */
    }
    return c;
}

function getRegattaCode() {
    const input = document.getElementById('hubRegattaCode');
    if (input) {
        const v = normalizeRegattaCode(input.value);
        if (v) return v;
    }
    return loadRegattaCode();
}

function collectValues() {
    return urlsFromRegattaCode(getRegattaCode());
}

function getCsvUrl(id) {
    return collectValues()[id] || buildCsvUrl(DEFAULT_REGATTA_CODE, id);
}

function updateCsvTitle(code) {
    const title = document.getElementById('hub-csv-title');
    if (!title) return;
    const c = normalizeRegattaCode(code) || DEFAULT_REGATTA_CODE;
    title.textContent = `RowIT CSV data (${c.toUpperCase()})`;
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
            ok: res.ok && text.length > 0 && text.includes(','),
            status: res.status,
        };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
    }
}

async function checkRow(row) {
    const url = row.dataset.csvUrl;
    if (!url) return;
    setStatus(row, 'pending', 'Checking…');
    const result = await checkCsvUrl(url);
    if (result.ok) {
        setStatus(row, 'ok', `OK (${result.bytes ?? 'CSV'} bytes)`);
    } else {
        setStatus(
            row,
            'fail',
            result.error || `HTTP ${result.status ?? 'error'}`,
        );
    }
    return result;
}

function refreshCsvRows(code) {
    const c = saveRegattaCode(code);
    const urls = urlsFromRegattaCode(c);
    updateCsvTitle(c);

    const preview = document.getElementById('hubCsvBasePreview');
    if (preview) {
        preview.textContent = `${ROWIT_ALTITUDE_BASE}/${c}/`;
    }

    const list = document.getElementById('hubCsvList');
    if (!list) return;

    list.querySelectorAll('.hub-csv-row').forEach((row) => {
        const id = row.dataset.csvId;
        const urlEl = row.querySelector('.hub-csv-url');
        const url = urls[id];
        if (url) {
            row.dataset.csvUrl = url;
            if (urlEl) urlEl.textContent = url.replace(`${ROWIT_ALTITUDE_BASE}/${c}/`, '');
        }
    });
}

function notifyUrlsChanged() {
    document.dispatchEvent(
        new CustomEvent('altitudehd:urls', { detail: collectValues() }),
    );
}

window.AltitudeHdHub = {
    CSV_FIELDS,
    DEFAULT_REGATTA_CODE,
    ROWIT_ALTITUDE_BASE,
    normalizeRegattaCode,
    buildCsvUrl,
    urlsFromRegattaCode,
    getRegattaCode,
    getCsvUrls: collectValues,
    getCsvUrl,
    loadRegattaCode,
};

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

        wrap.appendChild(status);
        wrap.appendChild(urlText);
        li.appendChild(label);
        li.appendChild(wrap);
        list.appendChild(li);
    });

    const applyCode = () => {
        const c = saveRegattaCode(codeInput ? codeInput.value : code);
        if (codeInput) codeInput.value = c;
        refreshCsvRows(c);
        notifyUrlsChanged();
        list.querySelectorAll('.hub-csv-row').forEach((row) => checkRow(row));
    };

    if (codeInput) {
        codeInput.addEventListener('change', applyCode);
        codeInput.addEventListener('blur', applyCode);
    }

    const checkAll = document.getElementById('hubCsvCheckAll');
    if (checkAll) {
        checkAll.addEventListener('click', async () => {
            applyCode();
            checkAll.disabled = true;
            for (const row of list.querySelectorAll('.hub-csv-row')) {
                await checkRow(row);
            }
            checkAll.disabled = false;
        });
    }

    refreshCsvRows(code);
    list.querySelectorAll('.hub-csv-row').forEach((row) => checkRow(row));
    notifyUrlsChanged();
}

document.addEventListener('DOMContentLoaded', initHubCsv);
