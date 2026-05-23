/**
 * Hub main page — Traccar / RNZ recorder toggle and refresh hooks.
 */
(function () {
    const ts = window.AltitudeHdTrackerSource;
    if (!ts) return;

    function statusEl() {
        return document.getElementById('hubTrackerSourceStatus');
    }

    function setStatus(text, ok) {
        const el = statusEl();
        if (!el) return;
        el.textContent = text;
        el.dataset.ok = ok ? '1' : '0';
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
    }

    function wireToggle() {
        const group = document.getElementById('hubTrackerSourceToggle');
        if (!group) return;

        group.querySelectorAll('[data-tracker-source]').forEach((btn) => {
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
