/**
 * Hub role views — Broadcast / Safety / CV and Drone / Setup.
 * Persists last role and honours ?view=broadcast|safety|cv|setup.
 */
(function () {
    const VIEWS = ['broadcast', 'safety', 'cv', 'setup'];
    const LS_KEY = 'altitudeHdHubView_v1';
    const EVENT_NAME = 'ahd-hub-view';

    function normalize(value) {
        const raw = String(value || '').toLowerCase().trim();
        if (raw === 'drone' || raw === 'cv-drone' || raw === 'cvdrone') return 'cv';
        return VIEWS.includes(raw) ? raw : null;
    }

    function readQuery() {
        try {
            return normalize(new URLSearchParams(location.search).get('view'));
        } catch {
            return null;
        }
    }

    function readStored() {
        try {
            return normalize(localStorage.getItem(LS_KEY));
        } catch {
            return null;
        }
    }

    function store(view) {
        try {
            localStorage.setItem(LS_KEY, view);
        } catch {
            /* ignore */
        }
    }

    function setView(view, options) {
        const persist = options?.persist !== false;
        const updateUrl = Boolean(options?.updateUrl);
        const next = normalize(view) || 'broadcast';

        document.querySelectorAll('[data-hub-view]').forEach((el) => {
            const on = el.getAttribute('data-hub-view') === next;
            el.classList.toggle('is-active', on);
            el.hidden = !on;
            el.setAttribute('aria-hidden', on ? 'false' : 'true');
        });

        document.querySelectorAll('.hub-role-btn[data-hub-role]').forEach((btn) => {
            const on = btn.getAttribute('data-hub-role') === next;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });

        document.body.dataset.hubCurrentView = next;

        if (persist) store(next);

        if (updateUrl) {
            try {
                const url = new URL(location.href);
                url.searchParams.set('view', next);
                history.replaceState(null, '', url);
            } catch {
                /* ignore */
            }
        }

        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { view: next } }));
    }

    function init() {
        const queryView = readQuery();
        const initial = queryView || readStored() || 'broadcast';
        setView(initial, { persist: true, updateUrl: false });

        document.querySelectorAll('.hub-role-btn[data-hub-role]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const view = btn.getAttribute('data-hub-role');
                setView(view, { persist: true, updateUrl: Boolean(queryView || readQuery()) });
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
