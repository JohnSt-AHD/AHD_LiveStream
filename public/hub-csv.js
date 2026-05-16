/**
 * RowIT CSV URL fields on Altitude HD hub — validate via /api/check-csv, persist in localStorage.
 */
const LS_CSV_URLS = 'altitudeHdCsvUrls_v1';

const CSV_FIELDS = [
    {
        id: 'events',
        label: 'Events',
        default: 'https://l.rowit.nz/altitude/mads2026/events.csv',
    },
    {
        id: 'daysheet',
        label: 'Daysheet',
        default: 'https://l.rowit.nz/altitude/mads2026/daysheet.csv',
    },
    {
        id: 'results',
        label: 'Results',
        default: 'https://l.rowit.nz/altitude/mads2026/results.csv',
    },
    {
        id: 'competitors',
        label: 'Competitors',
        default: 'https://l.rowit.nz/altitude/mads2026/competitors.csv',
    },
];

function loadSavedUrls() {
    try {
        const raw = localStorage.getItem(LS_CSV_URLS);
        if (!raw) return {};
        const o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : {};
    } catch {
        return {};
    }
}

function saveUrls(values) {
    try {
        localStorage.setItem(LS_CSV_URLS, JSON.stringify(values));
    } catch {
        /* ignore */
    }
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
    const input = row.querySelector('input[type="url"]');
    if (!input) return;
    setStatus(row, 'pending', 'Checking…');
    const result = await checkCsvUrl(input.value);
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

function collectValues() {
    const values = {};
    CSV_FIELDS.forEach((f) => {
        const input = document.getElementById(`hubCsv_${f.id}`);
        if (input) values[f.id] = input.value.trim();
    });
    return values;
}

function getCsvUrl(id) {
    const values = collectValues();
    if (values[id]) return values[id];
    const field = CSV_FIELDS.find((f) => f.id === id);
    return field ? field.default : '';
}

function notifyUrlsChanged() {
    document.dispatchEvent(
        new CustomEvent('altitudehd:urls', { detail: collectValues() }),
    );
}

window.AltitudeHdHub = {
    CSV_FIELDS,
    getCsvUrls: collectValues,
    getCsvUrl,
    loadSavedUrls,
};

function initHubCsv() {
    const list = document.getElementById('hubCsvList');
    if (!list || list.dataset.bound === '1') return;
    list.dataset.bound = '1';

    const saved = loadSavedUrls();

    CSV_FIELDS.forEach((f) => {
        const li = document.createElement('li');
        li.className = 'hub-csv-row';
        li.dataset.csvId = f.id;
        const value = saved[f.id] || f.default;
        li.innerHTML =
            `<label class="hub-csv-label" for="hubCsv_${f.id}">${f.label}</label>` +
            `<div class="hub-csv-input-wrap">` +
            `<span class="hub-csv-status hub-csv-status--pending" aria-hidden="true">…</span>` +
            `<input type="url" id="hubCsv_${f.id}" class="hub-csv-input" ` +
            `value="${value.replace(/"/g, '&quot;')}" ` +
            `placeholder="${f.default.replace(/"/g, '&quot;')}" ` +
            `autocomplete="off" spellcheck="false">` +
            `</div>`;
        list.appendChild(li);
    });

    list.querySelectorAll('.hub-csv-row').forEach((row) => {
        const input = row.querySelector('input');
        input.addEventListener('change', () => {
            saveUrls(collectValues());
            notifyUrlsChanged();
            checkRow(row);
        });
        input.addEventListener('blur', () => checkRow(row));
    });

    const checkAll = document.getElementById('hubCsvCheckAll');
    if (checkAll) {
        checkAll.addEventListener('click', async () => {
            checkAll.disabled = true;
            for (const row of list.querySelectorAll('.hub-csv-row')) {
                await checkRow(row);
            }
            saveUrls(collectValues());
            notifyUrlsChanged();
            checkAll.disabled = false;
        });
    }

    list.querySelectorAll('.hub-csv-row').forEach((row) => checkRow(row));
    notifyUrlsChanged();
}

document.addEventListener('DOMContentLoaded', initHubCsv);
