const KV_STOPPED = 'rnz:stoppedState';
const KV_LAST_WARN_IDS = 'rnz:lastWarningIds';
const KV_NOTIFY_EMAILS = 'rnz:notifyEmails';
const KV_ALERT_MESSAGE = 'rnz:alertMessage';

const DEFAULT_ALERT_MESSAGE =
    'New RowSafe safety warning(s) detected outside the Rowing NZ boundary.';

function normalizeEmail(email) {
    return String(email || '')
        .trim()
        .toLowerCase();
}

export function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function normalizeEmailList(list) {
    const out = [];
    const seen = new Set();
    for (const raw of list || []) {
        const e = normalizeEmail(raw);
        if (!isValidEmail(e) || seen.has(e)) continue;
        seen.add(e);
        out.push(e);
    }
    return out.sort();
}

async function kv() {
    try {
        const { kv: store } = await import('@vercel/kv');
        return store;
    } catch {
        return null;
    }
}

export async function kvAvailable() {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return false;
    const store = await kv();
    if (!store) return false;
    try {
        await store.get('rnz:ping');
        return true;
    } catch {
        return false;
    }
}

export async function loadNotifyEmailList() {
    const envEmails = normalizeEmailList(
        (process.env.WARNING_NOTIFY_EMAILS || '').split(/[,;\s]+/).filter(Boolean),
    );
    const store = await kv();
    if (!store) {
        return { emails: envEmails, editable: false, source: 'env' };
    }
    try {
        const data = await store.get(KV_NOTIFY_EMAILS);
        if (Array.isArray(data)) {
            return {
                emails: normalizeEmailList(data),
                editable: true,
                source: 'kv',
            };
        }
        return { emails: envEmails, editable: true, source: 'kv' };
    } catch {
        return { emails: envEmails, editable: false, source: 'env' };
    }
}

export async function saveNotifyEmailList(emails) {
    const store = await kv();
    if (!store) {
        throw new Error('Vercel KV is required to save the recipient list. Add KV to this project in Vercel.');
    }
    const normalized = normalizeEmailList(emails);
    await store.set(KV_NOTIFY_EMAILS, normalized);
    return normalized;
}

export async function loadAlertMessage() {
    const store = await kv();
    if (!store) return DEFAULT_ALERT_MESSAGE;
    try {
        const data = await store.get(KV_ALERT_MESSAGE);
        if (typeof data === 'string' && data.trim()) return data.trim();
    } catch {
        /* ignore */
    }
    return DEFAULT_ALERT_MESSAGE;
}

export async function saveAlertMessage(message) {
    const store = await kv();
    if (!store) {
        throw new Error('Vercel KV is required to save the alert message.');
    }
    const text = String(message || '').trim();
    if (!text) {
        throw new Error('Message cannot be empty.');
    }
    if (text.length > 2000) {
        throw new Error('Message is too long (max 2000 characters).');
    }
    await store.set(KV_ALERT_MESSAGE, text);
    return text;
}

export async function loadStoppedState() {
    const store = await kv();
    if (!store) return {};
    try {
        const data = await store.get(KV_STOPPED);
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}

export async function saveStoppedState(state) {
    const store = await kv();
    if (!store) return false;
    try {
        await store.set(KV_STOPPED, state);
        return true;
    } catch {
        return false;
    }
}

export async function loadLastWarningIds() {
    const store = await kv();
    if (!store) return [];
    try {
        const data = await store.get(KV_LAST_WARN_IDS);
        return Array.isArray(data) ? data.map(String) : [];
    } catch {
        return [];
    }
}

export async function saveLastWarningIds(ids) {
    const store = await kv();
    if (!store) return false;
    try {
        await store.set(KV_LAST_WARN_IDS, ids);
        return true;
    } catch {
        return false;
    }
}

export function warningIdsFromList(warnings) {
    return warnings.map((w) => String(w.deviceId)).sort();
}

export function filterNewWarnings(warnings, previousIds) {
    const prev = new Set(previousIds);
    return warnings.filter((w) => !prev.has(String(w.deviceId)));
}
