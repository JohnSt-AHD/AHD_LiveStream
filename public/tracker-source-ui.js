/**
 * Wire Traccar / RNZ·KRI recorder toggle on hub and map pages.
 */
(function () {
    const ts = window.AltitudeHdTrackerSource;
    if (!ts) return;

    function statusEls() {
        return document.querySelectorAll('.tracker-source-status, #hubTrackerSourceStatus');
    }

    function setStatus(text, ok) {
        statusEls().forEach((el) => {
            el.textContent = text;
            el.dataset.ok = ok ? '1' : '0';
        });
    }

    function syncButtons() {
        const current = ts.getSource();
        document.querySelectorAll('[data-tracker-source]').forEach((btn) => {
            const active = btn.getAttribute('data-tracker-source') === current;
            btn.classList.toggle('hub-tracker-btn--active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        setStatus(`Using ${ts.label(current)} for live map and history.`, true);
    }

    async function refreshMaps() {
        const bus = window.AltitudeHdTraccarSnapshot;
        if (bus) {
            try {
                const result = await bus.fetchSnapshot({ force: true });
                if (!result.ok) {
                    setStatus(result.error || 'Snapshot failed', false);
                }
            } catch (err) {
                setStatus(err.message || 'Snapshot failed', false);
            }
        }
        if (typeof window.hubStatsRefresh === 'function') {
            window.hubStatsRefresh();
        }
        if (typeof window.hubFleetRefresh === 'function') {
            window.hubFleetRefresh();
        }
        if (typeof window.trackerSourcePageRefresh === 'function') {
            window.trackerSourcePageRefresh();
        }
    }

    function wireToggle() {
        document.querySelectorAll('[data-tracker-source]').forEach((btn) => {
            if (btn.dataset.trackerSourceWired === '1') return;
            btn.dataset.trackerSourceWired = '1';
            btn.addEventListener('click', () => {
                const next = btn.getAttribute('data-tracker-source');
                if (!next || next === ts.getSource()) return;
                ts.setSource(next);
                syncButtons();
                refreshMaps();
            });
        });
        syncButtons();
    }

    window.addEventListener(ts.EVENT_NAME, syncButtons);
    document.addEventListener('DOMContentLoaded', wireToggle);
})();
