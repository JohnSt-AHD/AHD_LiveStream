/**
 * Hub role views — Broadcast / Archive / Safety / CV and Drone / Setup.
 * Persists last role and honours ?view=broadcast|archive|safety|cv|setup.
 */
(function () {
    const VIEWS = ['broadcast', 'archive', 'safety', 'cv', 'setup'];
    const LS_KEY = 'altitudeHdHubView_v1';
    const EVENT_NAME = 'ahd-hub-view';

    function normalize(value) {
        const raw = String(value || '').toLowerCase().trim();
        if (raw === 'drone' || raw === 'cv-drone' || raw === 'cvdrone') return 'cv';
        if (raw === 'drive' || raw === 'videos' || raw === 'photos') return 'archive';
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

        closeInfoTips();

        document.querySelectorAll('[data-hub-view]').forEach((el) => {
            const on = el.getAttribute('data-hub-view') === next;
            el.classList.toggle('is-active', on);
            el.hidden = !on;
            el.setAttribute('aria-hidden', on ? 'false' : 'true');
        });

        document.querySelectorAll('.hub-role-btn[data-hub-role]').forEach((btn) => {
            const on = btn.getAttribute('data-hub-role') === next;
            btn.classList.toggle('is-active', on);
            if (btn.hasAttribute('aria-pressed')) {
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            }
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

        const scrollTo = options?.scrollTo;
        if (scrollTo) {
            const target = document.getElementById(scrollTo);
            if (target) {
                requestAnimationFrame(() => {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            }
        }
    }

    function closeInfoTips(except) {
        document.querySelectorAll('.info-tip-btn').forEach((btn) => {
            if (except && btn === except) return;
            const panel = document.getElementById(btn.getAttribute('aria-controls') || '');
            btn.classList.remove('is-open');
            btn.setAttribute('aria-expanded', 'false');
            if (panel) panel.hidden = true;
        });
    }

    function initInfoTips() {
        document.querySelectorAll('.info-tip-btn').forEach((btn) => {
            btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const panel = document.getElementById(btn.getAttribute('aria-controls') || '');
                if (!panel) return;
                const willOpen = panel.hidden;
                closeInfoTips(willOpen ? btn : null);
                panel.hidden = !willOpen;
                btn.classList.toggle('is-open', willOpen);
                btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            });
        });
        document.addEventListener('click', (ev) => {
            if (ev.target.closest('.info-tip-btn, .info-tip-panel')) return;
            closeInfoTips();
        });
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') closeInfoTips();
        });
    }

    function init() {
        const queryView = readQuery();
        const initial = queryView || readStored() || 'broadcast';
        initInfoTips();
        setView(initial, { persist: true, updateUrl: false });

        document.querySelectorAll('[data-hub-role]').forEach((btn) => {
            btn.addEventListener('click', (event) => {
                const view = btn.getAttribute('data-hub-role');
                const scrollTo = btn.getAttribute('data-hub-scroll');
                if (btn.tagName === 'A' && scrollTo) event.preventDefault();
                setView(view, {
                    persist: true,
                    updateUrl: Boolean(queryView || readQuery()),
                    scrollTo: scrollTo || undefined,
                });
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
