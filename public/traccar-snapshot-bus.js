/**
 * Shared Traccar snapshot fetch — coalesces concurrent requests and broadcasts one result per page.
 * Supports full snapshot (devices + positions + geofences) and lite positions-only polls.
 */
(function (global) {
    const EVENT_NAME = 'altitudehd:traccar-snapshot';
    const POSITIONS_EVENT_NAME = 'altitudehd:traccar-positions';
    const SNAPSHOT_TIMEOUT_MS = 25000;

    function buildUrl(action, extra = {}) {
        const ts = global.AltitudeHdTrackerSource;
        const source = ts ? ts.getSource() : 'traccar';
        const params = new URLSearchParams({ action, source });
        for (const [key, value] of Object.entries(extra)) {
            if (value != null && value !== '') params.set(key, String(value));
        }
        return `/api/traccar?${params.toString()}`;
    }

    /** @type {Promise<any> | null} */
    let inflightSnapshot = null;
    /** @type {AbortController | null} */
    let inflightSnapshotAbort = null;
    /** @type {Promise<any> | null} */
    let inflightPositions = null;
    /** @type {AbortController | null} */
    let inflightPositionsAbort = null;
    let lastSnapshotDetail = null;
    let lastPositionsDetail = null;

    function emitSnapshot(detail) {
        lastSnapshotDetail = detail;
        global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
    }

    function emitPositions(detail) {
        lastPositionsDetail = detail;
        global.dispatchEvent(new CustomEvent(POSITIONS_EVENT_NAME, { detail }));
        if (detail?.ok) {
            emitSnapshot({ ...detail, data: { ...detail.data, lite: true } });
        }
    }

    async function runFetch(url, inflightKey, abortKey, emitFn, options = {}) {
        const inflight = inflightKey === 'snapshot' ? inflightSnapshot : inflightPositions;
        const inflightAbort = abortKey === 'snapshot' ? inflightSnapshotAbort : inflightPositionsAbort;

        if (inflight && !options.force) {
            return inflight;
        }

        if (inflight && options.force && inflightAbort) {
            inflightAbort.abort();
        }

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (abortKey === 'snapshot') inflightSnapshotAbort = controller;
        else inflightPositionsAbort = controller;

        const promise = (async () => {
            const timeoutId = controller
                ? setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS)
                : null;
            try {
                const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
                const data = await res.json().catch(() => ({}));
                const detail = {
                    ok: res.ok,
                    status: res.status,
                    data,
                    error: res.ok ? null : data.error || `Request failed (${res.status})`,
                };
                emitFn(detail);
                return detail;
            } catch (err) {
                const timedOut = err && err.name === 'AbortError';
                const detail = {
                    ok: false,
                    status: 0,
                    data: {},
                    error: timedOut
                        ? `Request timed out after ${Math.round(SNAPSHOT_TIMEOUT_MS / 1000)}s`
                        : err.message || 'Network error',
                };
                emitFn(detail);
                return detail;
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
                if (abortKey === 'snapshot') {
                    if (inflightSnapshotAbort === controller) inflightSnapshotAbort = null;
                    inflightSnapshot = null;
                } else {
                    if (inflightPositionsAbort === controller) inflightPositionsAbort = null;
                    inflightPositions = null;
                }
            }
        })();

        if (inflightKey === 'snapshot') inflightSnapshot = promise;
        else inflightPositions = promise;
        return promise;
    }

    /**
     * Full snapshot — devices, positions, geofences, groups.
     * @returns {Promise<{ ok: boolean, status: number, data: object, error: string|null }>}
     */
    async function fetchSnapshot(options = {}) {
        const extra = {};
        if (options.refreshGeofences) extra.refreshGeofences = '1';
        return runFetch(buildUrl('snapshot', extra), 'snapshot', 'snapshot', emitSnapshot, options);
    }

    /**
     * Lite poll — devices and positions only (no Traccar geofence fetch on server).
     */
    async function fetchPositions(options = {}) {
        return runFetch(buildUrl('positions'), 'positions', 'positions', emitPositions, options);
    }

    function getLastSnapshot() {
        return lastSnapshotDetail;
    }

    function getLastPositions() {
        return lastPositionsDetail;
    }

    global.AltitudeHdTraccarSnapshot = {
        fetchSnapshot,
        fetchPositions,
        getLastSnapshot,
        getLastPositions,
        EVENT_NAME,
        POSITIONS_EVENT_NAME,
    };
})(typeof window !== 'undefined' ? window : globalThis);
