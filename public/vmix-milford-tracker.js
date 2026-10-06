/**
 * Milford race tracker (g) — barge GPS pace + 0–2000 m orange-dot progress.
 * Live: CrewSight/Traccar snapshot via tracker-source. Preview: ?sample=1 demo run.
 * Orange: race elapsed. White plate: /500 m pace.
 */
(function (global) {
    const COURSE_M_DEFAULT = 2000;
    const POLL_MS = 800;
    const VG_LS_SPEED = 'altitudeHdSpeedVmix_v1';
    /** On-air pace shown in sample preview. */
    const DEMO_PACE_SEC_PER_500 = 103.2;
    /** Sample travel time 0→2000 m so the orange dot is visible. */
    const DEMO_TRAVEL_MS = 22000;

    let rootEl = null;
    let pollTimer = null;
    let demoRaf = null;
    let elapsedRaf = null;
    let demoStartedAt = 0;
    let raceStartedAt = 0;
    let lastPaceText = '—';
    let lastMetres = 0;

    function params() {
        return new URLSearchParams(location.search);
    }

    function useSample() {
        const p = params();
        if (p.get('sample') === '1' || p.get('sample') === 'true') return true;
        if (p.get('live') === '1') return false;
        if (p.get('deviceId')) return false;
        return p.get('preview') === '1';
    }

    function courseLength() {
        const n = Number(params().get('course') || COURSE_M_DEFAULT);
        return Number.isFinite(n) && n > 0 ? n : COURSE_M_DEFAULT;
    }

    function storedSpeedCfg() {
        try {
            return JSON.parse(localStorage.getItem(VG_LS_SPEED) || '{}');
        } catch {
            return {};
        }
    }

    function deviceId() {
        const q = parseInt(params().get('deviceId'), 10);
        if (Number.isFinite(q) && q >= 1) return q;
        const s = storedSpeedCfg();
        const n = parseInt(s.deviceId, 10);
        return Number.isFinite(n) && n >= 1 ? n : null;
    }

    function resolveRaceStartMs() {
        const p = params();
        const raw = p.get('t0') || p.get('raceStart');
        if (raw) {
            const asNum = Number(raw);
            if (Number.isFinite(asNum) && asNum > 1e11) return asNum;
            if (Number.isFinite(asNum) && asNum > 1e9 && asNum < 1e11) return asNum * 1000;
            const parsed = Date.parse(raw);
            if (Number.isFinite(parsed)) return parsed;
        }
        const s = storedSpeedCfg();
        const stored = Number(s.raceStartMs || s.t0);
        if (Number.isFinite(stored) && stored > 0) return stored;
        return Date.now();
    }

    function routeEnds() {
        const p = params();
        const s = storedSpeedCfg();
        const keys = ['rsLat', 'rsLng', 'reLat', 'reLng'];
        const out = {};
        for (const k of keys) {
            const n = parseFloat(p.get(k) ?? s[k]);
            if (!Number.isFinite(n)) return null;
            out[k] = n;
        }
        return out;
    }

    function formatElapsed(ms) {
        const t = Math.max(0, Number(ms) || 0);
        const totalSec = t / 1000;
        const m = Math.floor(totalSec / 60);
        const s = totalSec - m * 60;
        const whole = Math.floor(s);
        const tenth = Math.floor((s - whole) * 10);
        return `${m}:${String(whole).padStart(2, '0')}.${tenth}`;
    }

    function formatSplit500FromMps(speedMps) {
        if (!Number.isFinite(speedMps) || speedMps < 0.01) return '—';
        let sec = 500 / speedMps;
        if (sec > 7200) return '—';
        sec = Math.round(sec * 10) / 10;
        let minutes = Math.floor(sec / 60);
        let sRem = Math.round((sec - minutes * 60) * 10) / 10;
        if (sRem >= 59.95) {
            minutes += 1;
            sRem = 0;
        }
        const intS = Math.floor(sRem + 1e-9);
        let tenth = Math.round((sRem - intS) * 10);
        if (tenth === 10) {
            const ns = intS + 1;
            if (ns >= 60) return `${minutes + 1}:00.0`;
            return `${minutes}:${String(ns).padStart(2, '0')}.0`;
        }
        return `${minutes}:${String(intS).padStart(2, '0')}.${tenth}`;
    }

    function formatSplit500FromSec(sec) {
        if (!Number.isFinite(sec) || sec <= 0) return '—';
        return formatSplit500FromMps(500 / sec);
    }

    function segmentProgressT(dLat, dLng, sLat, sLng, eLat, eLng) {
        const R = 6371000;
        const cosS = Math.cos((sLat * Math.PI) / 180);
        const mPerDegLat = (R * Math.PI) / 180;
        const mPerDegLng = (R * Math.PI) / 180;
        const dx = (dLng - sLng) * mPerDegLng * cosS;
        const dy = (dLat - sLat) * mPerDegLat;
        const vx = (eLng - sLng) * mPerDegLng * cosS;
        const vy = (eLat - sLat) * mPerDegLat;
        const vv = vx * vx + vy * vy;
        if (vv < 4) return 0;
        const t = (dx * vx + dy * vy) / vv;
        return Math.max(0, Math.min(1, t));
    }

    function paint({ paceText, elapsedText, metres, courseM }) {
        if (!rootEl) return;
        const pace = rootEl.querySelector('.mf-tracker-pace-value');
        if (pace) pace.textContent = paceText || '—';
        const elapsed = rootEl.querySelector('.mf-tracker-elapsed-value');
        if (elapsed) elapsed.textContent = elapsedText || '0:00.0';
        const course = courseM || courseLength();
        const t = Math.max(0, Math.min(1, Number(metres) / course));
        rootEl.style.setProperty('--mf-tracker-t', String(t));
        const dot = rootEl.querySelector('.mf-tracker-dot');
        if (dot) dot.hidden = false;
    }

    function demoTick(now) {
        if (!rootEl) return;
        if (!demoStartedAt) demoStartedAt = now;
        const elapsed = now - demoStartedAt;
        const course = courseLength();
        const metres = Math.min(course, (elapsed / DEMO_TRAVEL_MS) * course);
        paint({
            paceText: formatSplit500FromSec(DEMO_PACE_SEC_PER_500),
            elapsedText: formatElapsed(elapsed),
            metres,
            courseM: course,
        });
        if (metres < course) demoRaf = requestAnimationFrame(demoTick);
        else {
            paint({
                paceText: formatSplit500FromSec(DEMO_PACE_SEC_PER_500),
                elapsedText: formatElapsed(DEMO_TRAVEL_MS),
                metres: course,
                courseM: course,
            });
        }
    }

    function startDemo() {
        stopDemo();
        demoStartedAt = 0;
        demoRaf = requestAnimationFrame(demoTick);
    }

    function stopDemo() {
        if (demoRaf) cancelAnimationFrame(demoRaf);
        demoRaf = null;
        demoStartedAt = 0;
    }

    function paintLiveClock() {
        if (!rootEl || useSample()) return;
        paint({
            paceText: lastPaceText,
            elapsedText: formatElapsed(Date.now() - raceStartedAt),
            metres: lastMetres,
            courseM: courseLength(),
        });
        elapsedRaf = requestAnimationFrame(paintLiveClock);
    }

    function startLiveClock() {
        stopLiveClock();
        elapsedRaf = requestAnimationFrame(paintLiveClock);
    }

    function stopLiveClock() {
        if (elapsedRaf) cancelAnimationFrame(elapsedRaf);
        elapsedRaf = null;
    }

    async function liveTick() {
        const id = deviceId();
        if (!id) {
            lastPaceText = '—';
            lastMetres = 0;
            return;
        }
        try {
            const ts = global.AltitudeHdTrackerSource;
            const snap = ts
                ? await ts.fetchSnapshot({ direct: true })
                : {
                      ok: false,
                      data: {},
                  };
            const data = snap?.data || {};
            const positions = Array.isArray(data.positions) ? data.positions : [];
            const pos = positions.find((p) => Number(p.deviceId) === id);
            const course = courseLength();
            let metres = 0;
            const route = routeEnds();
            if (
                route &&
                pos &&
                Number.isFinite(pos.latitude) &&
                Number.isFinite(pos.longitude)
            ) {
                metres =
                    segmentProgressT(
                        pos.latitude,
                        pos.longitude,
                        route.rsLat,
                        route.rsLng,
                        route.reLat,
                        route.reLng,
                    ) * course;
            }
            lastPaceText = formatSplit500FromMps(Number(pos?.speed));
            lastMetres = metres;
        } catch {
            lastPaceText = '—';
            lastMetres = 0;
        }
    }

    function mount(root) {
        stop();
        rootEl = root;
        raceStartedAt = resolveRaceStartMs();
        lastPaceText = '—';
        lastMetres = 0;
        if (useSample()) startDemo();
        else {
            liveTick();
            pollTimer = setInterval(liveTick, POLL_MS);
            startLiveClock();
        }
    }

    function stop() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        stopDemo();
        stopLiveClock();
        rootEl = null;
        raceStartedAt = 0;
    }

    function restartDemo() {
        if (!rootEl || !useSample()) return;
        startDemo();
    }

    global.VmixMilfordTracker = {
        mount,
        stop,
        restartDemo,
        useSample,
        paint,
    };
})(window);
