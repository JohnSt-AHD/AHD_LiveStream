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

    let inflight = null;
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

        inflight = (async () => {
            try {
                const res = await fetch(snapshotUrl());
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
                const detail = {
                    ok: false,
                    status: 0,
                    data: {},
                    error: err.message || 'Network error',
                };
                emit(detail);
                return detail;
            } finally {
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
