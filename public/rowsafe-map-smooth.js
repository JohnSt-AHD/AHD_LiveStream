/**
 * Client-side display-only marker glide for RowSafe / safety-map.
 * Safety logic (boundary, on-water, alerts) must always use raw snapshot lat/lon.
 */
(function (global) {
    const TICK_MS = 100;
    /** Cover map poll interval (2s) plus brief fix-age lag without freezing between updates. */
    const MAX_EXTRAPOLATE_SEC = 6;
    const DISPLAY_BLEND_ALPHA = 0.2;
    const BIG_JUMP_M = 25;
    const HUGE_JUMP_M = 60;
    const MIN_SPEED_MPS = 0.25;
    const GPS_LIVE_SEC = 30;

    /** @type {Map<string|number, { lat: number, lon: number, displayLat?: number, displayLon?: number, fixMs: number, speedMps: number|null, courseDeg: number|null, online: boolean }>} */
    const tracks = new Map();
    /** @type {Set<(deviceId: string|number, lat: number, lon: number) => void>} */
    const listeners = new Set();
    let tickTimer = null;

    function toRad(d) {
        return (d * Math.PI) / 180;
    }

    function toDeg(r) {
        return (r * 180) / Math.PI;
    }

    function haversineM(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const φ1 = toRad(lat1);
        const φ2 = toRad(lat2);
        const Δφ = toRad(lat2 - lat1);
        const Δλ = toRad(lon2 - lon1);
        const a =
            Math.sin(Δφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
    }

    function bearingDeg(lat1, lon1, lat2, lon2) {
        const φ1 = toRad(lat1);
        const φ2 = toRad(lat2);
        const Δλ = toRad(lon2 - lon1);
        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x =
            Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }

    function destinationLatLon(lat, lon, courseDeg, distanceM) {
        if (distanceM <= 0) return [lat, lon];
        const R = 6371000;
        const δ = distanceM / R;
        const θ = toRad(courseDeg);
        const φ1 = toRad(lat);
        const λ1 = toRad(lon);
        const φ2 = Math.asin(
            Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
        );
        const λ2 =
            λ1 +
            Math.atan2(
                Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
                Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
            );
        return [toDeg(φ2), ((toDeg(λ2) + 540) % 360) - 180];
    }

    function fixMsFor(position) {
        if (!position) return Date.now();
        const t = new Date(position.fixTime || position.deviceTime || position.serverTime).getTime();
        return Number.isFinite(t) ? t : Date.now();
    }

    function resolveCourseDeg(position, prevLat, prevLon, lat, lon) {
        if (prevLat != null && prevLon != null) {
            const dist = haversineM(prevLat, prevLon, lat, lon);
            if (dist >= 4) return bearingDeg(prevLat, prevLon, lat, lon);
        }
        const compass = position?.attributes?.compass;
        if (typeof compass === 'number' && Number.isFinite(compass)) return compass;
        if (typeof position?.courseHeading === 'number' && Number.isFinite(position.courseHeading)) {
            return position.courseHeading;
        }
        if (typeof position?.course === 'number' && Number.isFinite(position.course)) {
            return position.course;
        }
        if (prevLat != null && prevLon != null) {
            return bearingDeg(prevLat, prevLon, lat, lon);
        }
        return null;
    }

    function smoothCourseDeg(nextDeg, prevDeg, distM) {
        if (nextDeg == null || !Number.isFinite(nextDeg)) return prevDeg ?? null;
        if (prevDeg == null || !Number.isFinite(prevDeg)) return nextDeg;
        let delta = ((nextDeg - prevDeg + 540) % 360) - 180;
        if (Math.abs(delta) > 90 && (distM == null || distM < 15)) return prevDeg;
        const blend = distM != null && distM >= 12 ? 0.55 : 0.3;
        return (prevDeg + delta * blend + 360) % 360;
    }

    function targetLatLng(state, nowMs = Date.now()) {
        const fixAgeSec = (nowMs - state.fixMs) / 1000;
        if (!state.online || fixAgeSec > GPS_LIVE_SEC) {
            return { lat: state.lat, lon: state.lon };
        }
        const stepSec = Math.min(Math.max(0, fixAgeSec), MAX_EXTRAPOLATE_SEC);
        const speed = state.speedMps;
        if (
            speed != null &&
            speed >= MIN_SPEED_MPS &&
            state.courseDeg != null &&
            Number.isFinite(state.courseDeg)
        ) {
            const [lat, lon] = destinationLatLon(
                state.lat,
                state.lon,
                state.courseDeg,
                speed * stepSec,
            );
            return { lat, lon };
        }
        return { lat: state.lat, lon: state.lon };
    }

    function advanceDisplay(state, nowMs = Date.now()) {
        const target = targetLatLng(state, nowMs);
        if (state.displayLat == null || state.displayLon == null) {
            state.displayLat = target.lat;
            state.displayLon = target.lon;
            return target;
        }
        const jumpM = haversineM(state.displayLat, state.displayLon, target.lat, target.lon);
        let alpha = DISPLAY_BLEND_ALPHA;
        if (jumpM > HUGE_JUMP_M) alpha = 0.06;
        else if (jumpM > BIG_JUMP_M) alpha = 0.1;
        state.displayLat += (target.lat - state.displayLat) * alpha;
        state.displayLon += (target.lon - state.displayLon) * alpha;
        return { lat: state.displayLat, lon: state.displayLon };
    }

    function resolveSpeedMps(position) {
        const CS = global.RowsafeCoachSpeed;
        if (CS && typeof CS.resolveCoachSpeedMps === 'function') {
            const resolved = CS.resolveCoachSpeedMps(position);
            if (resolved != null && Number.isFinite(resolved) && resolved >= MIN_SPEED_MPS) {
                return resolved;
            }
        }
        const attrs = position?.attributes || {};
        const display = attrs.displaySpeedMps ?? attrs.pathSpeedMps;
        if (display != null && Number.isFinite(display) && display >= MIN_SPEED_MPS) {
            return display;
        }
        if (typeof position?.speed === 'number' && Number.isFinite(position.speed) && position.speed >= MIN_SPEED_MPS) {
            return position.speed;
        }
        return null;
    }

    /**
     * @param {object[]} deviceList
     * @param {Record<string|number, object>} positionMap
     * @param {{ isOnline?: (pos: object) => boolean }} [opts]
     */
    function syncTracks(deviceList, positionMap, opts = {}) {
        const isOnline = typeof opts.isOnline === 'function' ? opts.isOnline : () => true;
        const seen = new Set();
        for (const device of deviceList || []) {
            if (!device || device.id == null) continue;
            const position = positionMap[device.id];
            if (
                !position ||
                typeof position.latitude !== 'number' ||
                typeof position.longitude !== 'number' ||
                Number.isNaN(position.latitude) ||
                Number.isNaN(position.longitude)
            ) {
                continue;
            }
            seen.add(device.id);
            const fixMs = fixMsFor(position);
            const lat = position.latitude;
            const lon = position.longitude;
            const prev = tracks.get(device.id);
            let speedMps = resolveSpeedMps(position);
            let courseDeg = resolveCourseDeg(position, prev?.lat, prev?.lon, lat, lon);
            let moveDist = prev ? haversineM(prev.lat, prev.lon, lat, lon) : null;

            if (prev && prev.fixMs !== fixMs) {
                const dt = (fixMs - prev.fixMs) / 1000;
                if (dt > 0.05) {
                    if (moveDist != null && moveDist > 0) {
                        if (speedMps == null) speedMps = moveDist / dt;
                        if (courseDeg == null) courseDeg = bearingDeg(prev.lat, prev.lon, lat, lon);
                    }
                }
            } else if (prev) {
                speedMps = prev.speedMps;
                courseDeg = prev.courseDeg;
            }
            courseDeg = smoothCourseDeg(courseDeg, prev?.courseDeg, moveDist);

            tracks.set(device.id, {
                lat,
                lon,
                displayLat: prev?.displayLat ?? lat,
                displayLon: prev?.displayLon ?? lon,
                fixMs,
                speedMps,
                courseDeg,
                online: isOnline(position),
            });
        }
        for (const id of tracks.keys()) {
            if (!seen.has(id)) tracks.delete(id);
        }
    }

    function displayLatLng(deviceId) {
        const state = tracks.get(deviceId);
        if (!state) return null;
        return advanceDisplay(state);
    }

    function startTick() {
        if (tickTimer) return;
        tickTimer = setInterval(() => {
            for (const [id] of tracks) {
                const pos = displayLatLng(id);
                if (!pos) continue;
                for (const fn of listeners) fn(id, pos.lat, pos.lon);
            }
        }, TICK_MS);
    }

    function stopTick() {
        if (tickTimer) clearInterval(tickTimer);
        tickTimer = null;
    }

    function onDisplayTick(cb) {
        listeners.add(cb);
        startTick();
        return () => {
            listeners.delete(cb);
            if (listeners.size === 0) stopTick();
        };
    }

    function clearTracks() {
        tracks.clear();
    }

    global.RowsafeMapSmooth = {
        MAX_EXTRAPOLATE_SEC,
        syncTracks,
        displayLatLng,
        onDisplayTick,
        startTick,
        stopTick,
        clearTracks,
    };
})(typeof window !== 'undefined' ? window : globalThis);
