/**
 * Shared Traccar snapshot fetch — coalesces concurrent requests and broadcasts one result per page.
 */
(function (global) {
    const EVENT_NAME = 'altitudehd:traccar-snapshot';

    function snapshotUrl() {
        const ts = global.AltitudeHdTrackerSource;
        const source = ts ? ts.getSource() : 'traccar';
        return `/api/traccar?action=snapshot&source=${encodeURIComponent(source)}`;
    }

    const SNAPSHOT_TIMEOUT_MS = 25000;

    let inflight = null;
    /** @type {AbortController | null} */
    let inflightAbort = null;
    let lastDetail = null;

    function emit(detail) {
        lastDetail = detail;
        global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
    }

    /**
     * @returns {Promise<{ ok: boolean, status: number, data: object, error: string|null }>}
     */
    async function fetchSnapshot(options = {}) {
        if (inflight && !options.force) {
            return inflight;
        }

        if (inflight && options.force && inflightAbort) {
            inflightAbort.abort();
        }

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        inflightAbort = controller;

        inflight = (async () => {
            const timeoutId = controller
                ? setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS)
                : null;
            try {
                const res = await fetch(snapshotUrl(), controller ? { signal: controller.signal } : undefined);
                const data = await res.json().catch(() => ({}));
                const detail = {
                    ok: res.ok,
                    status: res.status,
                    data,
                    error: res.ok ? null : data.error || `Request failed (${res.status})`,
                };
                emit(detail);
                return detail;
            } catch (err) {
                const timedOut = err && err.name === 'AbortError';
                const detail = {
                    ok: false,
                    status: 0,
                    data: {},
                    error: timedOut
                        ? `Snapshot timed out after ${Math.round(SNAPSHOT_TIMEOUT_MS / 1000)}s`
                        : err.message || 'Network error',
                };
                emit(detail);
                return detail;
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
                if (inflightAbort === controller) inflightAbort = null;
                inflight = null;
            }
        })();

        return inflight;
    }

    function getLastSnapshot() {
        return lastDetail;
    }

    global.AltitudeHdTraccarSnapshot = {
        fetchSnapshot,
        getLastSnapshot,
        EVENT_NAME,
    };
})(typeof window !== 'undefined' ? window : globalThis);
