const KV_STOPPED = 'rnz:stoppedState';
const KV_LAST_WARN_IDS = 'rnz:lastWarningIds';

async function kv() {
    try {
        const { kv: store } = await import('@vercel/kv');
        return store;
    } catch {
        return null;
    }
}

export async function kvAvailable() {
    const store = await kv();
    if (!store) return false;
    try {
        await store.get('rnz:ping');
        return true;
    } catch {
        return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
    }
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
