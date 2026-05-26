/**
 * KRI safety map demo — eight boats (A1–A8) on the rowing course.
 */
(function (global) {
    const LS_DEMO = 'kriSafetyDemoEnabled_v1';
    const BOAT_COUNT = 8;
    const SPEED_MIN_MPS = 3;
    const SPEED_MAX_MPS = 10;
    const HOLD_MS = 10_000;
    const DEVICE_ID_BASE = 9001;
    const DEVICE_ID_SAFETY = 9009;
    const DEVICE_ID_X1 = 9010;
    const X1_LAT = -(37 + 55 / 60 + 32.5 / 3600);
    const X1_LNG = 175 + 32 / 60 + 24.5 / 3600;
    const FOLLOW_LANE = 4;
    const SAFETY_FOLLOW_BEHIND_M = 40;

    const PHASE = {
        START_HOLD: 'start_hold',
        RACING: 'racing',
        FINISH_HOLD: 'finish_hold',
        RETURNING: 'returning',
    };

    let enabled = loadEnabled();
    let geofences = [];
    let phase = PHASE.START_HOLD;
    let phaseStartedAt = 0;
    /** @type {number[]} */
    let laneSpeedMps = [];
    /** @type {number[]} */
    let laneRaceDistanceM = [];
    /** @type {Array<{ departAt: number, distanceM: number, totalM: number, done: boolean, lane: number }>} */
    let returnLegs = [];
    let lastNow = 0;

    function buildLaneSpeeds() {
        const speeds = [];
        for (let lane = 1; lane <= BOAT_COUNT; lane += 1) {
            const t = BOAT_COUNT > 1 ? (lane - 1) / (BOAT_COUNT - 1) : 0;
            speeds.push(SPEED_MIN_MPS + t * (SPEED_MAX_MPS - SPEED_MIN_MPS));
        }
        return speeds;
    }

    function laneSpeed(lane) {
        return laneSpeedMps[lane - 1] ?? SPEED_MIN_MPS;
    }

    function laneDistance(lane) {
        return laneRaceDistanceM[lane - 1] ?? 0;
    }

    function loadEnabled() {
        try {
            const raw = global.localStorage.getItem(LS_DEMO);
            if (raw === null) return true;
            return raw === '1' || raw === 'true';
        } catch {
            return true;
        }
    }

    function saveEnabled(value) {
        try {
            global.localStorage.setItem(LS_DEMO, value ? '1' : '0');
        } catch {
            /* ignore */
        }
    }

    function courseApi() {
        return global.KriRowingCourseOverlay;
    }

    function parseGeofenceRing(areaStr) {
        if (!areaStr || typeof areaStr !== 'string') return null;
        const t = areaStr.trim();
        if (!t.startsWith('POLYGON')) return null;
        const inner = t.replace(/^POLYGON\s*\(\(/i, '').replace(/\)\)\s*$/, '');
        const ring = inner
            .split(',')
            .map((pair) => {
                const [lng, lat] = pair.trim().split(/\s+/).map(Number);
                return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
            })
            .filter(Boolean);
        return ring.length >= 3 ? ring : null;
    }

    function parseGeofenceCentroid(areaStr) {
        const ring = parseGeofenceRing(areaStr);
        if (ring) {
            let lat = 0;
            let lng = 0;
            for (const p of ring) {
                lat += p.lat;
                lng += p.lng;
            }
            return { lat: lat / ring.length, lng: lng / ring.length };
        }
        if (!areaStr || typeof areaStr !== 'string') return null;
        const t = areaStr.trim();
        if (t.startsWith('CIRCLE')) {
            const m = t.match(/CIRCLE\s*\(\s*([-\d.]+)\s+([-\d.]+)/i);
            if (m) return { lat: Number(m[2]), lng: Number(m[1]) };
        }
        return null;
    }

    function polygonBBoxCenter(ring) {
        let minLat = Infinity;
        let maxLat = -Infinity;
        let minLng = Infinity;
        let maxLng = -Infinity;
        for (const p of ring) {
            minLat = Math.min(minLat, p.lat);
            maxLat = Math.max(maxLat, p.lat);
            minLng = Math.min(minLng, p.lng);
            maxLng = Math.max(maxLng, p.lng);
        }
        if (!Number.isFinite(minLat)) return null;
        return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
    }

    function geofenceCentroidByName(matchFn) {
        for (const g of geofences || []) {
            if (!matchFn(String(g?.name || ''))) continue;
            const ring = parseGeofenceRing(g.area);
            if (ring) {
                const box = polygonBBoxCenter(ring);
                if (box) return box;
            }
            const c = parseGeofenceCentroid(g.area);
            if (c) return c;
        }
        return null;
    }

    function damCenter() {
        const isDamName = (name) => {
            const n = name.toLowerCase();
            return n.includes('dam') && !n.includes('weed');
        };
        let center = geofenceCentroidByName(isDamName);
        if (!center) {
            center = geofenceCentroidByName((name) => name.toLowerCase().includes('dam'));
        }
        return center;
    }

    function warmupCenter(frame) {
        const c = geofenceCentroidByName((name) => {
            const n = name.toLowerCase();
            return (n.includes('warm up') || n.includes('warmup')) && n.includes('zone');
        });
        if (c) return c;
        const geo = courseApi()?.geo;
        if (geo?.destination) {
            return geo.destination(frame.start.lat, frame.start.lng, frame.bearing + 180, 420);
        }
        return { ...frame.start };
    }

    function buildReturnPath(frame, lane) {
        const api = courseApi();
        if (!api?.lanePointAtDistance) return null;
        const finish = api.lanePointAtDistance(frame, lane, frame.lengthM);
        const start = api.lanePointAtDistance(frame, lane, 0);
        const warmBase = warmupCenter(frame);
        const geo = api.geo;
        const warm = geo.offsetPerpendicular(
            warmBase.lat,
            warmBase.lng,
            frame.bearing,
            geo.laneCenterOffsetM(lane),
        );
        const leg1 = geo.haversineM(finish.lat, finish.lng, warm.lat, warm.lng);
        const leg2 = geo.haversineM(warm.lat, warm.lng, start.lat, start.lng);
        return { finish, warm, start, totalM: leg1 + leg2, leg1 };
    }

    function pointOnReturn(path, distanceM) {
        const geo = courseApi()?.geo;
        if (!path || !geo?.destination || !geo?.bearingDeg || !geo?.haversineM) {
            return path?.start || { lat: 0, lng: 0 };
        }
        const d = Math.max(0, Math.min(path.totalM, distanceM));
        if (d <= path.leg1) {
            const brg = geo.bearingDeg(path.finish.lat, path.finish.lng, path.warm.lat, path.warm.lng);
            return geo.destination(path.finish.lat, path.finish.lng, brg, d);
        }
        const d2 = d - path.leg1;
        const brg = geo.bearingDeg(path.warm.lat, path.warm.lng, path.start.lat, path.start.lng);
        return geo.destination(path.warm.lat, path.warm.lng, brg, d2);
    }

    function clearDemoCapsizeAcks() {
        try {
            const raw = global.localStorage.getItem('altitudeHdCapsizeAck_v1');
            if (!raw) return;
            const ack = JSON.parse(raw);
            delete ack[`${DEVICE_ID_X1}:alarm`];
            delete ack[`${DEVICE_ID_X1}:stop`];
            global.localStorage.setItem('altitudeHdCapsizeAck_v1', JSON.stringify(ack));
        } catch {
            /* ignore */
        }
    }

    function resetSimulation() {
        phase = PHASE.START_HOLD;
        phaseStartedAt = performance.now();
        laneSpeedMps = buildLaneSpeeds();
        laneRaceDistanceM = new Array(BOAT_COUNT).fill(0);
        returnLegs = [];
        lastNow = phaseStartedAt;
        clearDemoCapsizeAcks();
    }

    function beginReturnPhase(now) {
        phase = PHASE.RETURNING;
        phaseStartedAt = now;
        returnLegs = [];
        const frame = courseApi()?.buildCourseFrame?.();
        if (!frame) return;
        for (let lane = 1; lane <= BOAT_COUNT; lane += 1) {
            const path = buildReturnPath(frame, lane);
            returnLegs.push({
                lane,
                path,
                departAt: now,
                distanceM: 0,
                totalM: path?.totalM || 0,
                done: false,
            });
        }
    }

    function tick(now) {
        if (!enabled) return;
        const api = courseApi();
        if (!api?.buildCourseFrame || !api.lanePointAtDistance) return;

        const frame = api.buildCourseFrame();
        if (!Number.isFinite(lastNow) || lastNow <= 0) lastNow = now;
        const dt = Math.min(0.5, Math.max(0, (now - lastNow) / 1000));
        lastNow = now;

        const elapsedPhase = now - phaseStartedAt;

        if (phase === PHASE.START_HOLD) {
            laneRaceDistanceM = new Array(BOAT_COUNT).fill(0);
            if (elapsedPhase >= HOLD_MS) {
                phase = PHASE.RACING;
                phaseStartedAt = now;
            }
        } else if (phase === PHASE.RACING) {
            let allFinished = true;
            for (let lane = 1; lane <= BOAT_COUNT; lane += 1) {
                const idx = lane - 1;
                laneRaceDistanceM[idx] = Math.min(
                    frame.lengthM,
                    laneRaceDistanceM[idx] + laneSpeedMps[idx] * dt,
                );
                if (laneRaceDistanceM[idx] < frame.lengthM - 0.5) {
                    allFinished = false;
                }
            }
            if (allFinished) {
                for (let i = 0; i < BOAT_COUNT; i += 1) {
                    laneRaceDistanceM[i] = frame.lengthM;
                }
                phase = PHASE.FINISH_HOLD;
                phaseStartedAt = now;
                clearDemoCapsizeAcks();
            }
        } else if (phase === PHASE.FINISH_HOLD) {
            for (let i = 0; i < BOAT_COUNT; i += 1) {
                laneRaceDistanceM[i] = frame.lengthM;
            }
            if (elapsedPhase >= HOLD_MS) {
                beginReturnPhase(now);
            }
        } else if (phase === PHASE.RETURNING) {
            let allDone = returnLegs.length === BOAT_COUNT;
            for (const leg of returnLegs) {
                if (leg.done) continue;
                allDone = false;
                if (now < leg.departAt) continue;
                const spd = laneSpeed(leg.lane);
                leg.distanceM = Math.min(leg.totalM, leg.distanceM + spd * dt);
                if (leg.distanceM >= leg.totalM - 0.5) {
                    leg.distanceM = leg.totalM;
                    leg.done = true;
                }
            }
            if (returnLegs.length === BOAT_COUNT && returnLegs.every((l) => l.done)) {
                phase = PHASE.START_HOLD;
                phaseStartedAt = now;
                laneRaceDistanceM = new Array(BOAT_COUNT).fill(0);
                returnLegs = [];
            }
        }
    }

    function boatPosition(lane) {
        const api = courseApi();
        const frame = api?.buildCourseFrame?.();
        if (!frame || !api.lanePointAtDistance) {
            return { lat: -37.936, lng: 175.427, speed: 0 };
        }

        if (phase === PHASE.RACING || phase === PHASE.FINISH_HOLD) {
            const d = laneDistance(lane);
            const pt = api.lanePointAtDistance(frame, lane, d);
            const speed = phase === PHASE.RACING ? laneSpeed(lane) : 0;
            return { lat: pt.lat, lng: pt.lng, speed };
        }

        if (phase === PHASE.START_HOLD) {
            const pt = api.lanePointAtDistance(frame, lane, 0);
            return { lat: pt.lat, lng: pt.lng, speed: 0 };
        }

        const leg = returnLegs.find((l) => l.lane === lane);
        if (!leg || !leg.path) {
            const pt = api.lanePointAtDistance(frame, lane, 0);
            return { lat: pt.lat, lng: pt.lng, speed: 0 };
        }
        if (lastNow < leg.departAt) {
            const pt = api.lanePointAtDistance(frame, lane, frame.lengthM);
            return { lat: pt.lat, lng: pt.lng, speed: 0 };
        }
        if (leg.done) {
            const pt = api.lanePointAtDistance(frame, lane, 0);
            return { lat: pt.lat, lng: pt.lng, speed: 0 };
        }
        const pt = pointOnReturn(leg.path, leg.distanceM);
        return { lat: pt.lat, lng: pt.lng, speed: laneSpeed(lane) };
    }

    function safetyBoatPosition() {
        const api = courseApi();
        const frame = api?.buildCourseFrame?.();
        if (!frame || !api.lanePointAtDistance) {
            return { lat: -37.936, lng: 175.427, speed: 0 };
        }

        if (phase === PHASE.RACING || phase === PHASE.FINISH_HOLD) {
            const d = Math.max(0, laneDistance(FOLLOW_LANE) - SAFETY_FOLLOW_BEHIND_M);
            const pt = api.lanePointAtDistance(frame, FOLLOW_LANE, d);
            const speed = phase === PHASE.RACING ? laneSpeed(FOLLOW_LANE) : 0;
            return { lat: pt.lat, lng: pt.lng, speed };
        }

        if (phase === PHASE.START_HOLD) {
            const pt = api.lanePointAtDistance(frame, FOLLOW_LANE, 0);
            return { lat: pt.lat, lng: pt.lng, speed: 0 };
        }

        const leg = returnLegs.find((l) => l.lane === FOLLOW_LANE);
        if (!leg || !leg.path) {
            const pt = api.lanePointAtDistance(frame, FOLLOW_LANE, 0);
            return { lat: pt.lat, lng: pt.lng, speed: 0 };
        }
        if (lastNow < leg.departAt) {
            const d = Math.max(0, frame.lengthM - SAFETY_FOLLOW_BEHIND_M);
            const pt = api.lanePointAtDistance(frame, FOLLOW_LANE, d);
            return { lat: pt.lat, lng: pt.lng, speed: 0 };
        }
        if (leg.done) {
            const pt = api.lanePointAtDistance(frame, FOLLOW_LANE, 0);
            return { lat: pt.lat, lng: pt.lng, speed: 0 };
        }
        const d = Math.max(0, leg.distanceM - SAFETY_FOLLOW_BEHIND_M);
        const pt = pointOnReturn(leg.path, d);
        return { lat: pt.lat, lng: pt.lng, speed: laneSpeed(FOLLOW_LANE) };
    }

    function x1Position() {
        return { lat: X1_LAT, lng: X1_LNG, speed: 0 };
    }

    function isFinishHoldPhase() {
        return phase === PHASE.FINISH_HOLD;
    }

    function getSnapshot() {
        const nowIso = new Date().toISOString();
        const panel = global.KriSafetyRegattaPanel;
        const devices = [];
        const positions = {};

        for (let lane = 1; lane <= BOAT_COUNT; lane += 1) {
            const id = DEVICE_ID_BASE + lane - 1;
            const name = `A${lane}`;
            const assignment = panel?.getLaneAssignment?.(lane);
            devices.push({
                id,
                name,
                groupId: null,
                demoCrew: assignment?.crew || '',
                demoClubName: assignment?.clubName || '',
                demoLogoUrl: assignment?.logoUrl || null,
            });
            const pos = boatPosition(lane);
            positions[id] = {
                deviceId: id,
                latitude: pos.lat,
                longitude: pos.lng,
                speed: pos.speed,
                fixTime: nowIso,
                address: assignment?.crew
                    ? `Demo · lane ${lane} · ${assignment.crew}`
                    : `Demo · lane ${lane}`,
            };
        }

        const safetyPos = safetyBoatPosition();
        devices.push({
            id: DEVICE_ID_SAFETY,
            name: 'Safety boat',
            groupId: null,
            demoMarkerFill: '#22c55e',
            demoMarkerStroke: '#15803d',
        });
        positions[DEVICE_ID_SAFETY] = {
            deviceId: DEVICE_ID_SAFETY,
            latitude: safetyPos.lat,
            longitude: safetyPos.lng,
            speed: safetyPos.speed,
            fixTime: nowIso,
            address: 'Demo · following A4',
        };

        const x1Pos = x1Position();
        const x1Capsize = isFinishHoldPhase();
        devices.push({
            id: DEVICE_ID_X1,
            name: 'X1',
            groupId: null,
            demoBoundaryWarning: true,
            demoMarkerFill: x1Capsize ? '#fecaca' : '#f97316',
            demoMarkerStroke: x1Capsize ? '#b91c1c' : '#c2410c',
        });
        positions[DEVICE_ID_X1] = {
            deviceId: DEVICE_ID_X1,
            latitude: x1Pos.lat,
            longitude: x1Pos.lng,
            speed: 0,
            fixTime: nowIso,
            address: 'Demo · dam zone',
            attributes: x1Capsize ? { alarm: 'capsize' } : undefined,
        };

        return { devices, positions, phase };
    }

    function setGeofences(list) {
        geofences = Array.isArray(list) ? list : [];
    }

    function setEnabled(value) {
        enabled = !!value;
        saveEnabled(enabled);
        resetSimulation();
        global.dispatchEvent(new CustomEvent('kri-demo-changed', { detail: { enabled } }));
    }

    function isEnabled() {
        return enabled;
    }

    function wireToggle() {
        const input = document.getElementById('kriDemoToggle');
        if (!input || input.dataset.bound === '1') return;
        input.dataset.bound = '1';
        input.checked = enabled;
        input.addEventListener('change', () => {
            setEnabled(input.checked);
        });
    }

    function init() {
        wireToggle();
        resetSimulation();
    }

    global.KriSafetyDemo = {
        init,
        isEnabled,
        setEnabled,
        setGeofences,
        tick,
        reset: resetSimulation,
        getSnapshot,
        SPEED_MIN_MPS,
        SPEED_MAX_MPS,
        DEVICE_ID_SAFETY,
        DEVICE_ID_X1,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
