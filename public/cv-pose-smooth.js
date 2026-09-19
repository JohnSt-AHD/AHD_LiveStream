/**
 * Interpolate Cloud OSD pose (~0.5 Hz) for overlay / monitor graphics.
 * Chase window defaults to 2 s so lane/course motion matches typical OSD spacing
 * and the ~2 s vMix video delay. Setup server stays a raw passthrough.
 *
 * createPoseSmoother({ intervalMs, minIntervalMs, maxIntervalMs, maxExtrapolateMs })
 */
(function (global) {
    const DEFAULT_INTERVAL_MS = 2000;
    const MIN_INTERVAL_MS = 1500;
    const MAX_INTERVAL_MS = 2500;
    const MAX_EXTRAPOLATE_MS = 400;

    function lerp(a, b, t) {
        if (!Number.isFinite(a)) return b;
        if (!Number.isFinite(b)) return a;
        return a + (b - a) * t;
    }

    function angleLerp(a, b, t) {
        if (!Number.isFinite(a)) return b;
        if (!Number.isFinite(b)) return a;
        const delta = ((b - a + 540) % 360) - 180;
        return (a + delta * t + 360) % 360;
    }

    function clonePose(row) {
        if (!row) return null;
        return {
            ...row,
            gimbal: { ...(row.gimbal || {}) },
        };
    }

    function zoomBlend(prev, target, t) {
        if (!Number.isFinite(prev)) return target;
        if (!Number.isFinite(target)) return prev;
        const lo = Math.min(Math.abs(prev), Math.abs(target));
        const hi = Math.max(Math.abs(prev), Math.abs(target));
        if (lo > 1e-6 && hi / lo >= 1.35) return target;
        if (Math.abs(target - prev) >= 1.5) return target;
        return lerp(prev, target, t);
    }

    function smoothPose(prev, target, t) {
        if (!target) return clonePose(prev);
        if (!prev) return clonePose(target);
        const pg = prev.gimbal || {};
        const tg = target.gimbal || {};
        return {
            ...target,
            latitude: lerp(prev.latitude, target.latitude, t),
            longitude: lerp(prev.longitude, target.longitude, t),
            height: lerp(prev.height, target.height, t),
            attitudeHead: angleLerp(prev.attitudeHead, target.attitudeHead, t),
            attitudePitch: lerp(prev.attitudePitch, target.attitudePitch, t),
            attitudeRoll: lerp(prev.attitudeRoll, target.attitudeRoll, t),
            horizontalSpeed: lerp(prev.horizontalSpeed || 0, target.horizontalSpeed || 0, t),
            gimbal: {
                pitch: lerp(pg.pitch, tg.pitch, t),
                yaw: angleLerp(pg.yaw || 0, tg.yaw || 0, t),
                roll: lerp(pg.roll || 0, tg.roll || 0, t),
            },
            zoom: zoomBlend(prev.zoom, target.zoom, t),
        };
    }

    function createPoseSmoother(opts) {
        const o = opts && typeof opts === "object" ? opts : {};
        const defaultInterval = Number(o.intervalMs) > 0 ? Number(o.intervalMs) : DEFAULT_INTERVAL_MS;
        const minInterval = Number(o.minIntervalMs) > 0 ? Number(o.minIntervalMs) : MIN_INTERVAL_MS;
        const maxInterval = Number(o.maxIntervalMs) > 0 ? Number(o.maxIntervalMs) : MAX_INTERVAL_MS;
        const maxExtrapolate =
            Number(o.maxExtrapolateMs) >= 0 ? Number(o.maxExtrapolateMs) : MAX_EXTRAPOLATE_MS;

        let from = null;
        let to = null;
        let segT0 = 0;
        let intervalMs = defaultInterval;
        let displayed = null;
        let lastRecv = null;

        function push(sample, now) {
            if (!sample) return;
            const recv = Number(sample.receivedAt) || 0;
            if (recv === lastRecv) return;
            if (lastRecv != null && recv > lastRecv) {
                const dt = recv - lastRecv;
                if (dt >= 400) {
                    intervalMs = Math.min(maxInterval, Math.max(minInterval, dt));
                }
            } else {
                intervalMs = defaultInterval;
            }
            from = displayed ? clonePose(displayed) : clonePose(sample);
            to = clonePose(sample);
            segT0 = now != null ? now : performance.now();
            lastRecv = recv;
        }

        function sample(now) {
            if (!to) return null;
            const tNow = now != null ? now : performance.now();
            const interval = Math.max(minInterval, intervalMs);
            let t = (tNow - segT0) / interval;
            const maxT = 1 + maxExtrapolate / interval;
            if (t < 0) t = 0;
            else if (t > maxT) t = maxT;
            const posed = smoothPose(from || to, to, t);
            if (posed) {
                posed.receivedAt = to.receivedAt;
                posed.ageMs = to.ageMs;
                posed.stale = to.stale;
            }
            displayed = posed;
            return posed;
        }

        return { push, sample };
    }

    global.CvPoseSmooth = {
        lerp,
        angleLerp,
        smoothPose,
        createPoseSmoother,
        DEFAULT_INTERVAL_MS,
    };
})(window);
