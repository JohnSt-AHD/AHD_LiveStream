/**
 * CV & Drone telemetry status — polls local servers and updates links.
 */
(function () {
    const LS_CV_URL = 'altitudeHdCvServerUrl_v1';
    const LS_DRONE_URL = 'altitudeHdDroneServerUrl_v1';
    const POLL_MS = 10_000;

    function load(key, fallback) {
        try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
    }
    function save(key, val) {
        try { localStorage.setItem(key, val); } catch { /* ignore */ }
    }

    function setDot(el, ok) {
        if (!el) return;
        el.classList.toggle('hub-cv-dot--ok', ok === true);
        el.classList.toggle('hub-cv-dot--fail', ok === false);
        el.classList.toggle('hub-cv-dot--pending', ok === null);
    }

    async function checkServer(baseUrl, statusEl, dotEl) {
        if (!statusEl) return;
        setDot(dotEl, null);
        statusEl.textContent = 'checking…';
        try {
            const url = baseUrl.replace(/\/+$/, '');
            const res = await fetch(url + '/health', {
                signal: AbortSignal.timeout(4000),
                mode: 'cors',
            });
            if (res.ok) {
                setDot(dotEl, true);
                statusEl.textContent = 'online';
            } else {
                setDot(dotEl, false);
                statusEl.textContent = `HTTP ${res.status}`;
            }
        } catch {
            setDot(dotEl, false);
            statusEl.textContent = 'offline';
        }
    }

    function updateLinks(cvUrl, droneUrl) {
        const cv = cvUrl.replace(/\/+$/, '');
        const drone = droneUrl.replace(/\/+$/, '');
        const map = {
            hubCvHubLink: cv + '/cv-hub.html',
            hubCvAnalysisLink: cv + '/cv-analysis.html',
            hubDroneMonitorLink: cv + '/cv-drone-monitor.html',
            hubDroneCourseOverlayLink: cv + '/cv-drone-course-overlay.html',
            hubDroneTelemetryLink: drone + '/monitor',
        };
        for (const [id, href] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (el) el.href = href;
        }
    }

    function init() {
        const cvInput = document.getElementById('hubCvServerUrl');
        const droneInput = document.getElementById('hubDroneServerUrl');
        if (!cvInput || !droneInput) return;

        cvInput.value = load(LS_CV_URL, 'http://127.0.0.1:8790');
        droneInput.value = load(LS_DRONE_URL, 'http://127.0.0.1:5050');

        const cvDot = document.getElementById('hubCvServerDot');
        const cvStatus = document.getElementById('hubCvServerStatus');
        const droneDot = document.getElementById('hubDroneServerDot');
        const droneStatus = document.getElementById('hubDroneServerStatus');

        function refresh() {
            const cv = cvInput.value.trim() || 'http://127.0.0.1:8790';
            const drone = droneInput.value.trim() || 'http://127.0.0.1:5050';
            save(LS_CV_URL, cv);
            save(LS_DRONE_URL, drone);
            updateLinks(cv, drone);
            checkServer(cv, cvStatus, cvDot);
            checkServer(drone, droneStatus, droneDot);
        }

        cvInput.addEventListener('change', refresh);
        droneInput.addEventListener('change', refresh);
        cvInput.addEventListener('blur', refresh);
        droneInput.addEventListener('blur', refresh);

        refresh();
        setInterval(refresh, POLL_MS);
    }

    document.addEventListener('DOMContentLoaded', init);
})();
