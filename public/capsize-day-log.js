/**
 * NZ-day log of active / acknowledged / cleared capsize alerts.
 * Same store + fields as CrewSight Manager (`crewsight_capsize_day_log_v1`).
 */
(function (global) {
    const LS_KEY = 'crewsight_capsize_day_log_v1';

    function nzDayKey(ms) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Pacific/Auckland',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date(ms || Date.now()));
    }

    function loadStore() {
        const today = nzDayKey();
        try {
            const raw = global.localStorage.getItem(LS_KEY);
            if (!raw) return { day: today, events: [] };
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.day !== today || !Array.isArray(parsed.events)) {
                return { day: today, events: [] };
            }
            return parsed;
        } catch {
            return { day: today, events: [] };
        }
    }

    function saveStore(store) {
        try {
            global.localStorage.setItem(LS_KEY, JSON.stringify(store));
        } catch {
            /* ignore quota */
        }
    }

    function list() {
        return loadStore()
            .events.slice()
            .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    }

    function upsertActive(input) {
        const store = loadStore();
        const deviceId = String(input.deviceId || '').trim();
        if (!deviceId) return null;
        const existing = store.events.find((e) => e.deviceId === deviceId && e.status === 'active');
        const recentAck = store.events.find(
            (e) =>
                e.deviceId === deviceId &&
                e.status !== 'active' &&
                e.ackedAt != null &&
                Date.now() - e.ackedAt < 60_000,
        );
        if (recentAck) return recentAck;
        if (existing) {
            if (input.name) existing.name = input.name;
            if (input.lat != null && Number.isFinite(input.lat)) existing.lat = input.lat;
            if (input.lon != null && Number.isFinite(input.lon)) existing.lon = input.lon;
            saveStore(store);
            return existing;
        }
        const entry = {
            id: `${deviceId}-${Date.now()}`,
            deviceId,
            name: input.name || deviceId,
            lat: input.lat != null && Number.isFinite(input.lat) ? input.lat : null,
            lon: input.lon != null && Number.isFinite(input.lon) ? input.lon : null,
            startedAt: Date.now(),
            status: 'active',
        };
        store.events.unshift(entry);
        saveStore(store);
        return entry;
    }

    function acknowledge(deviceIds, ackedBy, source) {
        const store = loadStore();
        const now = Date.now();
        const ids = deviceIds ? new Set(deviceIds.map((id) => String(id))) : null;
        for (const e of store.events) {
            if (e.status !== 'active') continue;
            if (ids && !ids.has(e.deviceId)) continue;
            e.status = 'acknowledged';
            e.ackedAt = now;
            e.ackedBy = ackedBy || 'RowSafe';
            e.ackSource = source || 'rowsafe';
        }
        saveStore(store);
    }

    function markMissingCleared(stillActiveIds) {
        const store = loadStore();
        const live = new Set((stillActiveIds || []).map((id) => String(id)));
        let changed = false;
        for (const e of store.events) {
            if (e.status !== 'active') continue;
            if (live.has(e.deviceId)) continue;
            e.status = 'cleared';
            e.ackedAt = Date.now();
            e.ackedBy = 'RowSafe or another Manager';
            e.ackSource = 'remote';
            changed = true;
        }
        if (changed) saveStore(store);
    }

    function replaceFromServer(events) {
        if (!Array.isArray(events)) return;
        const today = nzDayKey();
        const local = loadStore();
        const serverIds = new Set(events.map((e) => e.id));
        const serverDevices = new Set(events.map((e) => e.deviceId));
        const keepLocal = local.events.filter((e) => {
            if (serverIds.has(e.id) || serverDevices.has(e.deviceId)) return false;
            return e.status === 'active' && Date.now() - e.startedAt < 30_000;
        });
        saveStore({ day: today, events: events.concat(keepLocal) });
    }

    async function fetchShared() {
        const ts = global.AltitudeHdTrackerSource;
        const url = ts?.buildTraccarUrl
            ? ts.buildTraccarUrl({ action: 'capsize-day-log' })
            : '/api/traccar?action=capsize-day-log&source=rowing';
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
        try {
            const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Capsize log ${res.status}`);
            return Array.isArray(data.events) ? data.events : [];
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function formatNzTime(ms) {
        return new Intl.DateTimeFormat('en-NZ', {
            timeZone: 'Pacific/Auckland',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(new Date(ms));
    }

    function formatAckLine(e) {
        if (e.status === 'acknowledged') {
            const when = e.ackedAt ? formatNzTime(e.ackedAt) : '';
            const who = e.ackedBy || (e.ackSource === 'rowsafe' ? 'RowSafe' : 'CrewSight Manager');
            const via =
                e.ackSource === 'rowsafe' ? ' (RowSafe)' : e.ackSource === 'manager' ? ' (Manager)' : '';
            return `Acknowledged ${when} by ${who}${via}`.replace(/\s+/g, ' ').trim();
        }
        if (e.status === 'cleared') {
            return `Cleared ${e.ackedAt ? formatNzTime(e.ackedAt) : ''} · ${e.ackedBy || 'RowSafe or another Manager'}`
                .replace(/\s+/g, ' ')
                .trim();
        }
        return 'Active — not acknowledged';
    }

    function escapeHtml(value) {
        if (value == null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderList(container) {
        if (!container) return;
        const entries = list();
        if (!entries.length) {
            container.innerHTML = '<li class="rnz-capsize-log__empty">No capsizes today</li>';
            return;
        }
        container.innerHTML = entries
            .map((e) => {
                const loc =
                    e.lat != null && e.lon != null
                        ? `${Number(e.lat).toFixed(4)}, ${Number(e.lon).toFixed(4)}`
                        : 'No GPS';
                const ack = formatAckLine(e);
                return (
                    `<li class="rnz-capsize-log__item rnz-capsize-log__item--${escapeHtml(e.status)}">` +
                    `<strong>${escapeHtml(e.name)}</strong>` +
                    `<span>${escapeHtml(formatNzTime(e.startedAt))} · ${escapeHtml(loc)}</span>` +
                    `<span>${escapeHtml(ack)}</span>` +
                    `</li>`
                );
            })
            .join('');
    }

    global.CrewSightCapsizeDayLog = {
        list,
        upsertActive,
        acknowledge,
        markMissingCleared,
        replaceFromServer,
        fetchShared,
        formatNzTime,
        formatAckLine,
        renderList,
    };
})(typeof window !== 'undefined' ? window : globalThis);
