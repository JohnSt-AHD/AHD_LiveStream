/**
 * Standalone coastal sprint GPS analysis (timing lines + head-to-head).
 * Used by the regatta dashboard without loading the full map page.
 */
(function (global) {
    const LS_BEACH_BUOYS = 'bspCourseBuoys_v1';
    const TIMING_LINE_EXTENSION_M = 50;
    const RACE_MOVE_THRESHOLD_MS = 2;

    /** World Rowing Appendix 23 — gate spacing from water edge (metres). */
    const WR_COURSE_SPEC = {
        gateOffsetsM: [85, 170, 250],
        totalWaterM: 250,
        defaultLaneHalfWidthM: 9,
        /** Shift top buoys slightly landward so GPS traces pass around them (metres). */
        topBuoyLandwardM: 3,
        /** Do not shift the beach gate further offshore than this (metres). */
        maxBeachGateShorewardM: 30,
        /** WR beach run: start/finish line to boat at water (10–50 m; default 25). */
        beachRunDistM: 25,
        /** Tide/surf line landward of boat stop (metres toward beach). */
        tideLineFromBoatM: 10,
        /** Run flags landward of tide line (metres on sand). */
        runFlagLandwardOfTideM: 4,
        /** Typical runner speed on sand for time labels (m/s). */
        runnerSprintMps: 7.5,
        /** Water return leg before beach run (approx. metres, for time split). */
        waterReturnBeforeBeachM: 80,
        /** Detect launch when speed crosses above this (km/h). */
        raceAccelFromKmh: 7,
        /** Detect launch when speed reaches ~this (km/h). */
        raceAccelToKmh: 20,
        /** Padding before launch accel / after stop decel (ms). */
        raceSectionPadMs: 5000,
        /** Approximate GPS start gate width (metres), perpendicular to course. */
        startGateWidthM: 10,
        /** Expected boat-on-water duration bounds (ms). */
        raceMinMs: 90000,
        raceMaxMs: 300000,
        /** End trim: boat must return within this radius of launch (metres). */
        returnToLaunchRadiusM: 55,
        /** Minimum track distance between 1st and 2nd top-gate crossings (metres). */
        minTurnPathM: 2,
        /** Place approx. start gate this far beachward of the beachmost marker (metres). */
        startGateBeachwardOfMarkersM: 1,
    };

    const DEFAULT_BEACH_BUOYS = [
        { id: 'buoy_L1', label: 'L1', lat: -36.5922, lng: 174.7027 },
        { id: 'buoy_L2', label: 'L2', lat: -36.592, lng: 174.7035 },
        { id: 'buoy_L3', label: 'L3', lat: -36.5918, lng: 174.7045 },
        { id: 'buoy_R1', label: 'R1', lat: -36.5919, lng: 174.7026 },
        { id: 'buoy_R2', label: 'R2', lat: -36.5917, lng: 174.7035 },
        { id: 'buoy_R3', label: 'R3', lat: -36.5914, lng: 174.7043 },
    ];

    const TIMING_LINES = [
        { id: 'line1', label: 'L1 – R1', buoyA: 'L1', buoyB: 'R1' },
        { id: 'line2', label: 'L2 – R2', buoyA: 'L2', buoyB: 'R2' },
        { id: 'line3', label: 'R3 – L3', buoyA: 'R3', buoyB: 'L3' },
    ];

    const RACE_PHASES = [
        { id: 'launch', label: 'Start → B1', hint: 'Start → L1–R1 gate', from: 'start', to: 'line1' },
        { id: 'slalom1', label: 'B1 → B2', hint: 'L1–R1 → L2–R2', from: 'line1', to: 'line2' },
        { id: 'toTop', label: 'B2 → B3', hint: 'L2–R2 → R3–L3 (1st cross)', from: 'line2', to: 'line3First' },
        { id: 'turn', label: 'Turn @ B3', hint: 'Around top buoy L3', from: 'line3First', to: 'line3Second', needsTurn: true },
        { id: 'return', label: 'B3 → Finish', hint: 'R3–L3 → beach', from: 'line3Second', to: 'end' },
    ];

    let courseBuoys = [];

    const LS_BEACH_BUOYS_MAP = 'altitudeHdBeachSprintsBuoys_v1';

    function loadCourseBuoys() {
        const keys = [LS_BEACH_BUOYS, LS_BEACH_BUOYS_MAP];
        for (const key of keys) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length) {
                    const byId = new Map(parsed.map((b) => [b.id, b]));
                    courseBuoys = DEFAULT_BEACH_BUOYS.map((def) => byId.get(def.id) || { ...def });
                    return;
                }
            } catch {
                /* ignore */
            }
        }
        courseBuoys = DEFAULT_BEACH_BUOYS.map((b) => ({ ...b }));
    }

    function positionTimeMs(p) {
        const t = p.fixTime || p.deviceTime;
        if (!t) return NaN;
        const ms = new Date(t).getTime();
        return Number.isFinite(ms) ? ms : NaN;
    }

    function sortRoutePoints(points) {
        return [...(points || [])].sort((a, b) => positionTimeMs(a) - positionTimeMs(b));
    }

    function latLngToLocalMeters(lat, lng, refLat, refLng) {
        const cos = Math.cos((refLat * Math.PI) / 180);
        return {
            x: (lng - refLng) * 111320 * cos,
            y: (lat - refLat) * 110540,
        };
    }

    function localMetersToLatLng(x, y, refLat, refLng) {
        const cos = Math.cos((refLat * Math.PI) / 180);
        return {
            lat: refLat + y / 110540,
            lng: refLng + x / (111320 * cos),
        };
    }

    function getBuoyByLabel(label) {
        return courseBuoys.find((b) => b.label === label) || null;
    }

    function getTimingLineEndpoints(lineDef) {
        const a = getBuoyByLabel(lineDef.buoyA);
        const b = getBuoyByLabel(lineDef.buoyB);
        if (!a || !b) return null;
        return { a: { lat: a.lat, lng: a.lng }, b: { lat: b.lat, lng: b.lng } };
    }

    function extendTimingLineEndpoints(ep, extensionM = TIMING_LINE_EXTENSION_M) {
        if (!ep || extensionM <= 0) return ep;
        const refLat = (ep.a.lat + ep.b.lat) / 2;
        const refLng = (ep.a.lng + ep.b.lng) / 2;
        const am = latLngToLocalMeters(ep.a.lat, ep.a.lng, refLat, refLng);
        const bm = latLngToLocalMeters(ep.b.lat, ep.b.lng, refLat, refLng);
        const dx = bm.x - am.x;
        const dy = bm.y - am.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return ep;
        const ux = dx / len;
        const uy = dy / len;
        return {
            a: localMetersToLatLng(am.x - ux * extensionM, am.y - uy * extensionM, refLat, refLng),
            b: localMetersToLatLng(bm.x + ux * extensionM, bm.y + uy * extensionM, refLat, refLng),
        };
    }

    function segmentIntersectsLine(p0, p1, lineA, lineB) {
        const refLat = (lineA.lat + lineB.lat + p0.lat + p1.lat) / 4;
        const refLng = (lineA.lng + lineB.lng + p0.lng + p1.lng) / 4;
        const s0 = latLngToLocalMeters(p0.lat, p0.lng, refLat, refLng);
        const s1 = latLngToLocalMeters(p1.lat, p1.lng, refLat, refLng);
        const l0 = latLngToLocalMeters(lineA.lat, lineA.lng, refLat, refLng);
        const l1 = latLngToLocalMeters(lineB.lat, lineB.lng, refLat, refLng);
        const denom = (s0.x - s1.x) * (l0.y - l1.y) - (s0.y - s1.y) * (l0.x - l1.x);
        if (Math.abs(denom) < 1e-9) return null;
        const t = ((s0.x - l0.x) * (l0.y - l1.y) - (s0.y - l0.y) * (l0.x - l1.x)) / denom;
        const u = -((s0.x - s1.x) * (s0.y - l0.y) - (s0.y - s1.y) * (s0.x - l0.x)) / denom;
        if (t < 0 || t > 1 || u < 0 || u > 1) return null;
        return t;
    }

    function findLineCrossings(sortedPoints, lineA, lineB) {
        const crossings = [];
        if (!sortedPoints || sortedPoints.length < 2) return crossings;
        for (let i = 1; i < sortedPoints.length; i++) {
            const p0 = sortedPoints[i - 1];
            const p1 = sortedPoints[i];
            const t0 = positionTimeMs(p0);
            const t1 = positionTimeMs(p1);
            if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
            const frac = segmentIntersectsLine(
                { lat: p0.latitude, lng: p0.longitude },
                { lat: p1.latitude, lng: p1.longitude },
                lineA,
                lineB,
            );
            if (frac == null) continue;
            const timeMs = t0 + frac * (t1 - t0);
            const prev = crossings[crossings.length - 1];
            if (prev && Math.abs(prev.timeMs - timeMs) < 400) continue;
            crossings.push({ timeMs, index: crossings.length + 1 });
        }
        return crossings;
    }

    function pathDistanceAlongTrack(sorted, t0, t1) {
        if (!sorted?.length || !Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0;
        const refLat = sorted[0].latitude;
        const refLng = sorted[0].longitude;
        let dist = 0;
        for (let i = 1; i < sorted.length; i++) {
            const ta = positionTimeMs(sorted[i - 1]);
            const tb = positionTimeMs(sorted[i]);
            if (tb <= t0) continue;
            if (ta >= t1) break;
            const a = latLngToLocalMeters(sorted[i - 1].latitude, sorted[i - 1].longitude, refLat, refLng);
            const b = latLngToLocalMeters(sorted[i].latitude, sorted[i].longitude, refLat, refLng);
            dist += Math.hypot(b.x - a.x, b.y - a.y);
        }
        return dist;
    }

    function pickTopTurnCrossings(sorted, crossings) {
        const minPathM = WR_COURSE_SPEC.minTurnPathM;
        if (!crossings?.length) return { first: null, second: null };
        const first = crossings[0];
        let second = null;
        for (let i = 1; i < crossings.length; i++) {
            const c = crossings[i];
            if (c.timeMs <= first.timeMs + 400) continue;
            const pathM = pathDistanceAlongTrack(sorted, first.timeMs, c.timeMs);
            if (pathM >= minPathM) {
                second = c;
                break;
            }
        }
        return { first, second };
    }

    function analyzeDeviceTiming(points) {
        const sorted = sortRoutePoints(points);
        const lines = TIMING_LINES.map((def) => {
            const ep = extendTimingLineEndpoints(getTimingLineEndpoints(def));
            const crossings = ep ? findLineCrossings(sorted, ep.a, ep.b) : [];
            return { def, crossings };
        });
        const line1 = lines[0].crossings[0] || null;
        const line2 = lines[1].crossings[0] || null;
        const topTurn = pickTopTurnCrossings(sorted, lines[2].crossings);
        const line3First = topTurn.first;
        const line3Second = topTurn.second;
        return {
            line1,
            line2,
            line3First,
            line3Second,
            turnTimeMs:
                line3First && line3Second ? line3Second.timeMs - line3First.timeMs : null,
            raceStartMs: line1 ? line1.timeMs : null,
        };
    }

    function pointSpeedMps(p) {
        const s = typeof p.speed === 'number' && !Number.isNaN(p.speed) ? p.speed : 0;
        return Math.max(0, s);
    }

    function speedStatsBetween(sorted, t0, t1) {
        if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) {
            return { avgMps: null, maxMps: null, avgKmh: null, maxKmh: null };
        }
        const speeds = [];
        for (const p of sorted) {
            const t = positionTimeMs(p);
            if (t < t0 || t > t1) continue;
            speeds.push(pointSpeedMps(p));
        }
        if (!speeds.length) return { avgMps: null, maxMps: null, avgKmh: null, maxKmh: null };
        const avgMps = speeds.reduce((a, b) => a + b, 0) / speeds.length;
        const maxMps = Math.max(...speeds);
        return { avgMps, maxMps, avgKmh: avgMps * 3.6, maxKmh: maxMps * 3.6 };
    }

    function checkpointTimeMs(timing, key, raceWindow) {
        if (key === 'start') return raceWindow.startMs;
        if (key === 'end') return raceWindow.endMs;
        if (key === 'line1') return timing.line1?.timeMs ?? null;
        if (key === 'line2') return timing.line2?.timeMs ?? null;
        if (key === 'line3First') return timing.line3First?.timeMs ?? null;
        if (key === 'line3Second') return timing.line3Second?.timeMs ?? null;
        return null;
    }

    function kmhToMps(kmh) {
        return kmh / 3.6;
    }

    function interpCrossingTimeMs(sorted, i, s0, s1, threshold) {
        const t0 = positionTimeMs(sorted[i - 1]);
        const t1 = positionTimeMs(sorted[i]);
        if (!Number.isFinite(t0) || !Number.isFinite(t1) || s1 === s0) return t1;
        const frac = (threshold - s0) / (s1 - s0);
        return t0 + Math.min(1, Math.max(0, frac)) * (t1 - t0);
    }

    function interpolatePointAtTime(sorted, timeMs) {
        if (!sorted?.length || !Number.isFinite(timeMs)) return null;
        if (timeMs <= positionTimeMs(sorted[0])) return sorted[0];
        if (timeMs >= positionTimeMs(sorted[sorted.length - 1])) return sorted[sorted.length - 1];
        for (let i = 1; i < sorted.length; i++) {
            const t0 = positionTimeMs(sorted[i - 1]);
            const t1 = positionTimeMs(sorted[i]);
            if (timeMs < t0 || timeMs > t1) continue;
            const frac = t1 === t0 ? 0 : (timeMs - t0) / (t1 - t0);
            const a = sorted[i - 1];
            const b = sorted[i];
            return {
                latitude: a.latitude + (b.latitude - a.latitude) * frac,
                longitude: a.longitude + (b.longitude - a.longitude) * frac,
                speed: pointSpeedMps(a) + (pointSpeedMps(b) - pointSpeedMps(a)) * frac,
                fixTime: a.fixTime,
                deviceTime: a.deviceTime,
            };
        }
        return null;
    }

    function localMetersAtTime(sorted, timeMs) {
        const pt = interpolatePointAtTime(sorted, timeMs);
        if (!pt) return null;
        const refLat = sorted[0].latitude;
        const refLng = sorted[0].longitude;
        return latLngToLocalMeters(pt.latitude, pt.longitude, refLat, refLng);
    }

    function distanceMetersBetweenTimes(sorted, tA, tB) {
        const a = localMetersAtTime(sorted, tA);
        const b = localMetersAtTime(sorted, tB);
        if (!a || !b) return Infinity;
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    function detectDecelNearLaunch(sorted, accelMs, launchM, opts) {
        const lowMps = opts.lowMps;
        const midMps = opts.midMps;
        const returnRadiusM = opts.returnRadiusM;
        const minEndMs = opts.minEndMs;
        const maxEndMs = opts.maxEndMs;
        const afterMs = opts.afterMs;
        const refLat = sorted[0].latitude;
        const refLng = sorted[0].longitude;

        function nearLaunch(t) {
            const m = localMetersAtTime(sorted, t);
            if (!m) return false;
            return Math.hypot(m.x - launchM.x, m.y - launchM.y) <= returnRadiusM;
        }

        let decelMs = null;
        for (let i = sorted.length - 1; i >= 1; i--) {
            const t1 = positionTimeMs(sorted[i]);
            if (t1 < afterMs || t1 < minEndMs) continue;
            if (t1 > maxEndMs) continue;
            if (!nearLaunch(t1)) continue;
            const s0 = pointSpeedMps(sorted[i - 1]);
            const s1 = pointSpeedMps(sorted[i]);
            if (s0 >= midMps && s1 < lowMps) {
                const cand = interpCrossingTimeMs(sorted, i, s0, s1, lowMps);
                if (cand >= afterMs && cand >= minEndMs && cand <= maxEndMs && nearLaunch(cand)) {
                    decelMs = cand;
                    break;
                }
            }
        }

        if (!Number.isFinite(decelMs)) {
            for (let i = sorted.length - 1; i >= 0; i--) {
                const t = positionTimeMs(sorted[i]);
                if (t < afterMs || t < minEndMs || t > maxEndMs) continue;
                if (!nearLaunch(t)) continue;
                if (pointSpeedMps(sorted[i]) < lowMps) {
                    decelMs = t;
                    break;
                }
            }
        }

        if (!Number.isFinite(decelMs)) {
            let bestT = null;
            let bestD = Infinity;
            for (let i = sorted.length - 1; i >= 0; i--) {
                const t = positionTimeMs(sorted[i]);
                if (t < afterMs || t < minEndMs || t > maxEndMs) continue;
                const m = latLngToLocalMeters(
                    sorted[i].latitude,
                    sorted[i].longitude,
                    refLat,
                    refLng,
                );
                const d = Math.hypot(m.x - launchM.x, m.y - launchM.y);
                if (d <= returnRadiusM && d < bestD) {
                    bestD = d;
                    bestT = t;
                }
            }
            decelMs = bestT;
        }

        return decelMs;
    }

    function detectBoatRacingSection(points, options) {
        const sorted = sortRoutePoints(points);
        if (sorted.length < 4) return null;

        const lowMps = kmhToMps(WR_COURSE_SPEC.raceAccelFromKmh);
        const highMps = kmhToMps(WR_COURSE_SPEC.raceAccelToKmh);
        const midMps = (lowMps + highMps) / 2;
        const padMs = WR_COURSE_SPEC.raceSectionPadMs;
        const raceMinMs = WR_COURSE_SPEC.raceMinMs;
        const raceMaxMs = WR_COURSE_SPEC.raceMaxMs;
        const returnRadiusM = WR_COURSE_SPEC.returnToLaunchRadiusM;

        let accelMs = null;
        for (let i = 1; i < sorted.length; i++) {
            const s0 = pointSpeedMps(sorted[i - 1]);
            const s1 = pointSpeedMps(sorted[i]);
            if (s0 < lowMps && s1 >= midMps) {
                accelMs = interpCrossingTimeMs(sorted, i, s0, s1, midMps);
                break;
            }
        }
        if (!Number.isFinite(accelMs)) {
            for (let i = 0; i < sorted.length; i++) {
                if (pointSpeedMps(sorted[i]) >= highMps * 0.88) {
                    accelMs = positionTimeMs(sorted[i]);
                    break;
                }
            }
        }
        if (!Number.isFinite(accelMs)) return null;

        const launchM = localMetersAtTime(sorted, accelMs);
        if (!launchM) return null;

        const timing = options?.useTimingLines !== false ? analyzeDeviceTiming(sorted) : null;
        let afterMs = accelMs + raceMinMs * 0.5;
        if (timing?.line3Second?.timeMs) {
            afterMs = Math.max(afterMs, timing.line3Second.timeMs);
        } else if (timing?.line3First?.timeMs) {
            afterMs = Math.max(afterMs, timing.line3First.timeMs + 8000);
        } else {
            let maxD = 0;
            let maxT = accelMs;
            for (const p of sorted) {
                const t = positionTimeMs(p);
                if (t < accelMs) continue;
                const m = latLngToLocalMeters(p.latitude, p.longitude, sorted[0].latitude, sorted[0].longitude);
                const d = Math.hypot(m.x - launchM.x, m.y - launchM.y);
                if (d > maxD) {
                    maxD = d;
                    maxT = t;
                }
            }
            afterMs = Math.max(afterMs, maxT + 10000);
        }

        const minEndMs = accelMs + raceMinMs;
        const maxEndMs = accelMs + raceMaxMs;

        let decelMs = detectDecelNearLaunch(sorted, accelMs, launchM, {
            lowMps,
            midMps,
            returnRadiusM,
            minEndMs,
            maxEndMs,
            afterMs,
        });

        if (Number.isFinite(decelMs) && decelMs - accelMs > raceMaxMs) {
            decelMs = accelMs + raceMaxMs;
        }

        const firstT = positionTimeMs(sorted[0]);
        const lastT = positionTimeMs(sorted[sorted.length - 1]);
        const boatStartMs = Math.max(firstT, accelMs - padMs);
        const boatEndMs = Number.isFinite(decelMs)
            ? Math.min(lastT, decelMs + padMs)
            : Math.min(lastT, maxEndMs + padMs);
        const gpsEndMs = Number.isFinite(decelMs) ? decelMs : Math.min(lastT, maxEndMs);

        return {
            accelMs,
            decelMs,
            boatStartMs,
            boatEndMs,
            gpsRaceStartMs: accelMs,
            gpsRaceEndMs: gpsEndMs,
            boatWaterMs: gpsEndMs - accelMs,
            launchLat: interpolatePointAtTime(sorted, accelMs)?.latitude,
            launchLng: interpolatePointAtTime(sorted, accelMs)?.longitude,
        };
    }

    function trimToBoatRacingSection(points, options) {
        const sorted = sortRoutePoints(points);
        const section = detectBoatRacingSection(sorted, options);
        if (!section) {
            return { points: sorted, section: null };
        }
        const trimmed = sorted.filter((p) => {
            const t = positionTimeMs(p);
            return t >= section.boatStartMs && t <= section.boatEndMs;
        });
        return { points: trimmed, section };
    }

    function findRaceWindow(sorted, section) {
        if (!sorted || sorted.length < 2) return null;
        const sec = section || detectBoatRacingSection(sorted);
        if (sec) {
            const timing = analyzeDeviceTiming(sorted);
            return {
                startMs: sec.gpsRaceStartMs,
                endMs: sec.gpsRaceEndMs,
                timing,
                section: sec,
            };
        }
        let startMs = null;
        let startIdx = -1;
        for (let i = 0; i < sorted.length; i++) {
            if (pointSpeedMps(sorted[i]) >= RACE_MOVE_THRESHOLD_MS) {
                startMs = positionTimeMs(sorted[i]);
                startIdx = i;
                break;
            }
        }
        if (!Number.isFinite(startMs)) return null;
        const timing = analyzeDeviceTiming(sorted);
        const afterTopMs =
            timing.line3Second?.timeMs ?? timing.line3First?.timeMs ?? timing.line2?.timeMs ?? startMs;
        let endMs = null;
        for (let i = 0; i < sorted.length; i++) {
            const t = positionTimeMs(sorted[i]);
            if (t < afterTopMs) continue;
            if (pointSpeedMps(sorted[i]) < RACE_MOVE_THRESHOLD_MS) {
                endMs = t;
                break;
            }
        }
        if (!Number.isFinite(endMs)) {
            for (let i = sorted.length - 1; i >= startIdx; i--) {
                if (pointSpeedMps(sorted[i]) < RACE_MOVE_THRESHOLD_MS) {
                    endMs = positionTimeMs(sorted[i]);
                    break;
                }
            }
        }
        if (!Number.isFinite(endMs)) endMs = positionTimeMs(sorted[sorted.length - 1]);
        return { startMs, endMs, timing, section: null };
    }

    function buildRacePhases(sorted, raceWindow) {
        const { timing } = raceWindow;
        return RACE_PHASES.map((phase) => {
            if (phase.needsTurn && !timing.line3Second) {
                return { ...phase, durationMs: null, speed: null, skipped: true };
            }
            let t0 = checkpointTimeMs(timing, phase.from, raceWindow);
            let t1 = checkpointTimeMs(timing, phase.to, raceWindow);
            if (phase.id === 'return' && !Number.isFinite(t0) && timing.line3First) {
                t0 = timing.line3First.timeMs;
            }
            if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
                return { ...phase, durationMs: null, speed: null, skipped: false };
            }
            return {
                ...phase,
                durationMs: t1 - t0,
                speed: speedStatsBetween(sorted, t0, t1),
                skipped: false,
            };
        });
    }

    function withCourseBuoys(buoys, fn) {
        const prev = courseBuoys;
        if (buoys?.length) {
            courseBuoys = buoys.map((b) => ({ ...b }));
        } else {
            loadCourseBuoys();
        }
        try {
            return fn();
        } finally {
            courseBuoys = prev;
        }
    }

    function inferCourseBuoysFromGps(traceInputs) {
        const traces = (traceInputs || [])
            .map((tr, idx) => ({
                lane: tr.lane,
                idx,
                sorted: sortRoutePoints(tr.points),
            }))
            .filter((tr) => tr.sorted.length >= 15);
        if (!traces.length) {
            return { ok: false, reason: 'Need at least 15 GPS points on a trace to fit buoys.' };
        }

        let refLat = 0;
        let refLng = 0;
        let n = 0;
        for (const tr of traces) {
            for (const p of tr.sorted) {
                refLat += p.latitude;
                refLng += p.longitude;
                n++;
            }
        }
        refLat /= n;
        refLng /= n;

        const paths = traces.map((tr) => ({
            lane: tr.lane,
            idx: tr.idx,
            pts: tr.sorted.map((p) => {
                const m = latLngToLocalMeters(p.latitude, p.longitude, refLat, refLng);
                return {
                    x: m.x,
                    y: m.y,
                    lat: p.latitude,
                    lng: p.longitude,
                    t: positionTimeMs(p),
                    speed: pointSpeedMps(p),
                };
            }),
        }));

        const allTimes = paths
            .flatMap((p) => p.pts.map((pt) => pt.t))
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
        if (allTimes.length < 2) {
            return { ok: false, reason: 'GPS timestamps missing on trace.' };
        }

        const tRaceStart = allTimes[0];
        const tRaceEnd = allTimes[allTimes.length - 1];
        const tStartWindow = tRaceStart + (tRaceEnd - tRaceStart) * 0.12;
        const startPts = paths.flatMap((p) => p.pts.filter((pt) => pt.t <= tStartWindow));
        if (!startPts.length) {
            return { ok: false, reason: 'Could not locate the beach start on the trace.' };
        }

        const beachX = startPts.reduce((s, p) => s + p.x, 0) / startPts.length;
        const beachY = startPts.reduce((s, p) => s + p.y, 0) / startPts.length;

        const dists = paths
            .flatMap((p) => p.pts.map((pt) => Math.hypot(pt.x - beachX, pt.y - beachY)))
            .sort((a, b) => a - b);
        const topDist = dists[Math.floor(dists.length * 0.94)] || dists[dists.length - 1] || 200;

        let topX = beachX;
        let topY = beachY + topDist;
        outer: for (const p of paths) {
            for (const pt of p.pts) {
                const d = Math.hypot(pt.x - beachX, pt.y - beachY);
                if (d >= topDist * 0.9) {
                    topX = pt.x;
                    topY = pt.y;
                    break outer;
                }
            }
        }

        let ux = 0;
        let uy = 0;
        let px = 0;
        let py = 0;

        function setAxisFromTop(tx, ty) {
            const axisLen = Math.hypot(tx - beachX, ty - beachY);
            if (axisLen < 40) return false;
            ux = (tx - beachX) / axisLen;
            uy = (ty - beachY) / axisLen;
            px = -uy;
            py = ux;
            return true;
        }

        if (!setAxisFromTop(topX, topY)) {
            return { ok: false, reason: 'Trace too short to fit a full beach sprint course.' };
        }

        function projectXY(x, y) {
            const dx = x - beachX;
            const dy = y - beachY;
            return { s: dx * ux + dy * uy, t: dx * px + dy * py };
        }

        function findPathTurn(path) {
            const projected = path.pts.map((pt) => ({
                pt,
                pr: projectXY(pt.x, pt.y),
            }));
            if (!projected.length) return null;

            let peakIdx = 0;
            let peakS = projected[0].pr.s;
            for (let i = 1; i < projected.length; i++) {
                if (projected[i].pr.s > peakS) {
                    peakS = projected[i].pr.s;
                    peakIdx = i;
                }
            }

            const lo = Math.max(0, peakIdx - 12);
            const hi = Math.min(projected.length - 1, peakIdx + 12);
            let best = projected[peakIdx];
            let bestScore = -Infinity;
            for (let i = lo; i <= hi; i++) {
                const p = projected[i];
                const prev = projected[i - 1];
                const next = projected[i + 1];
                let curvature = 0;
                if (prev && next) {
                    const v1x = p.pt.x - prev.pt.x;
                    const v1y = p.pt.y - prev.pt.y;
                    const v2x = next.pt.x - p.pt.x;
                    const v2y = next.pt.y - p.pt.y;
                    const l1 = Math.hypot(v1x, v1y) || 1;
                    const l2 = Math.hypot(v2x, v2y) || 1;
                    const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
                    curvature = 1 - Math.max(-1, Math.min(1, dot));
                }
                const score = p.pr.s + curvature * 8;
                if (score > bestScore) {
                    bestScore = score;
                    best = p;
                }
            }

            return {
                ...best.pt,
                x: best.pt.x,
                y: best.pt.y,
                s: best.pr.s,
                t: best.pr.t,
            };
        }

        let turns = paths.map((p) => findPathTurn(p)).filter(Boolean);

        if (turns.length) {
            topX = turns.reduce((s, p) => s + p.x, 0) / turns.length;
            topY = turns.reduce((s, p) => s + p.y, 0) / turns.length;
            if (!setAxisFromTop(topX, topY)) {
                return { ok: false, reason: 'Trace too short to fit a full beach sprint course.' };
            }
            turns = paths.map((p) => findPathTurn(p)).filter(Boolean);
        }

        if (!turns.length) {
            return { ok: false, reason: 'Could not locate the top turn on the GPS trace.' };
        }

        const allS = paths.flatMap((p) => p.pts.map((pt) => projectXY(pt.x, pt.y).s));
        const minS = Math.min(...allS);
        const turnS = Math.min(...turns.map((t) => t.s));
        const outboundM = Math.max(60, turnS - minS);
        const scale =
            outboundM >= WR_COURSE_SPEC.totalWaterM - 15
                ? 1
                : Math.max(0.55, outboundM / WR_COURSE_SPEC.totalWaterM);

        let waterEdgeS = turnS - WR_COURSE_SPEC.totalWaterM * scale;
        const tMid = tRaceStart + (tRaceEnd - tRaceStart) * 0.55;
        let beachActivityS = Infinity;
        for (const p of paths) {
            for (const pt of p.pts) {
                if (pt.t > tMid) continue;
                if (pt.speed < RACE_MOVE_THRESHOLD_MS) continue;
                const { s } = projectXY(pt.x, pt.y);
                if (s < beachActivityS) beachActivityS = s;
            }
        }
        if (!Number.isFinite(beachActivityS)) beachActivityS = minS;
        const maxShore = WR_COURSE_SPEC.maxBeachGateShorewardM;
        if (waterEdgeS < beachActivityS - maxShore) {
            waterEdgeS = beachActivityS - maxShore;
        }

        const gateS = [
            waterEdgeS + WR_COURSE_SPEC.gateOffsetsM[0] * scale,
            waterEdgeS + WR_COURSE_SPEC.gateOffsetsM[1] * scale,
            turnS,
        ];

        const landward = WR_COURSE_SPEC.topBuoyLandwardM;

        function topBuoyLatLng(pt) {
            const x = pt.x - ux * landward;
            const y = pt.y - uy * landward;
            return localMetersToLatLng(x, y, refLat, refLng);
        }

        function sampleAtGate(path, targetS) {
            const pathTurn = findPathTurn(path);
            const outboundLimit = pathTurn?.s ?? turnS;
            let best = null;
            let bestErr = Infinity;
            for (const pt of path.pts) {
                if (pathTurn?.t != null && pt.t > pathTurn.t + 400) continue;
                const pr = projectXY(pt.x, pt.y);
                if (pr.s > outboundLimit + 8) continue;
                if (pt.speed != null && pt.speed < 1) continue;
                const err = Math.abs(pr.s - targetS);
                if (err < bestErr) {
                    bestErr = err;
                    best = { ...pt, sideT: pr.t, err };
                }
            }
            return best;
        }

        const gateSamples = gateS.map((gs) => paths.map((p) => sampleAtGate(p, gs)));

        let leftIdx = 0;
        let rightIdx = paths.length > 1 ? 1 : 0;
        if (paths.length >= 2) {
            const t0 = turns[0]?.t ?? 0;
            const t1 = turns[1]?.t ?? 0;
            if (t0 > t1) {
                leftIdx = 1;
                rightIdx = 0;
            }
        }

        const halfW = WR_COURSE_SPEC.defaultLaneHalfWidthM;

        function buoyPosition(gateIdx, side) {
            if (gateIdx === 2) {
                if (paths.length >= 2) {
                    const trIdx = side === 'L' ? leftIdx : rightIdx;
                    const turn = turns[trIdx];
                    if (turn) return topBuoyLatLng(turn);
                }
                const center = turns[0];
                if (!center) return null;
                const sign = side === 'L' ? -1 : 1;
                const x = center.x + px * halfW * sign;
                const y = center.y + py * halfW * sign;
                return topBuoyLatLng({ x, y });
            }
            const samples = gateSamples[gateIdx];
            if (paths.length >= 2) {
                const trIdx = side === 'L' ? leftIdx : rightIdx;
                const hit = samples[trIdx];
                if (hit && hit.err < 50) return { lat: hit.lat, lng: hit.lng };
            }
            const center = samples[0];
            if (!center) return null;
            const sign = side === 'L' ? -1 : 1;
            const x = center.x + px * halfW * sign;
            const y = center.y + py * halfW * sign;
            return localMetersToLatLng(x, y, refLat, refLng);
        }

        const labelByGate = [
            { L: 'L1', R: 'R1' },
            { L: 'L2', R: 'R2' },
            { L: 'L3', R: 'R3' },
        ];
        const buoys = [];
        for (let gi = 0; gi < 3; gi++) {
            for (const side of ['L', 'R']) {
                const label = labelByGate[gi][side];
                const def = DEFAULT_BEACH_BUOYS.find((b) => b.label === label);
                const pos = buoyPosition(gi, side);
                if (!def || !pos) continue;
                buoys.push({ id: def.id, label, lat: pos.lat, lng: pos.lng });
            }
        }
        if (buoys.length < 6) {
            return { ok: false, reason: 'Could not place all six buoys along the GPS trace.' };
        }

        const b12Err =
            gateSamples
                .slice(0, 2)
                .flat()
                .reduce((s, g) => s + (g?.err ?? 50), 0) /
            Math.max(1, gateSamples.slice(0, 2).flat().filter(Boolean).length);
        const confidence = b12Err < 28 && scale > 0.85 ? 'high' : 'low';

        return {
            ok: true,
            buoys,
            confidence,
            scale,
            outboundM,
            note:
                confidence === 'high'
                    ? `L3/R3 on GPS turn (${landward} m landward so traces pass around); B1–B2 on trace, WR spacing scaled ${Math.round(scale * 100)}%.`
                    : `L3/R3 on GPS turn; B1–B2 scaled to ${Math.round(scale * 100)}% of WR spacing — check map.`,
        };
    }

    function analyzeCoastalRace(points, deviceName, options) {
        return withCourseBuoys(options?.buoys, () => {
        const trimmed = trimToBoatRacingSection(points, { useTimingLines: true });
        const sorted = trimmed.points;
        const section = trimmed.section;
        if (!section || sorted.length < 8) {
            return {
                valid: false,
                name: deviceName,
                reason: 'No boat racing section detected (7→20 km/h launch / stop not found).',
            };
        }
        const raceWindow = findRaceWindow(sorted, section);
        if (!raceWindow) {
            return { valid: false, name: deviceName, reason: 'Could not analyse boat racing window.' };
        }
        const { startMs, endMs, timing } = raceWindow;
        const totalMs = endMs - startMs;
        if (!Number.isFinite(totalMs) || totalMs <= 0) {
            return { valid: false, name: deviceName, reason: 'Race window too short to analyse.' };
        }
        const officialTimeMs = options?.officialTimeMs;
        let runTiming = null;
        if (Number.isFinite(officialTimeMs) && officialTimeMs > totalMs) {
            const runTotalMs = officialTimeMs - totalMs;
            const half = runTotalMs / 2;
            runTiming = {
                fromCsv: true,
                officialTimeMs,
                boatWaterMs: totalMs,
                runTotalMs,
                runOutMs: half,
                runInMs: half,
            };
        }
        return {
            valid: true,
            name: deviceName,
            startMs,
            endMs,
            totalMs,
            timing,
            section,
            runTiming,
            officialTimeMs: Number.isFinite(officialTimeMs) ? officialTimeMs : null,
            phases: buildRacePhases(sorted, raceWindow),
            raceSpeed: speedStatsBetween(sorted, startMs, endMs),
            turnTimeMs: timing.turnTimeMs,
            points: sorted,
        };
        });
    }

    function formatDurationMs(ms) {
        if (!Number.isFinite(ms)) return '—';
        const abs = Math.abs(ms);
        const sign = ms < 0 ? '−' : '';
        if (abs < 60000) return `${sign}${(abs / 1000).toFixed(2)}s`;
        const m = Math.floor(abs / 60000);
        const s = (abs % 60000) / 1000;
        return `${sign}${m}:${s.toFixed(1).padStart(4, '0')}`;
    }

    function formatGapMs(gapMs) {
        if (!Number.isFinite(gapMs)) return '—';
        const abs = Math.abs(gapMs);
        const sign = gapMs > 0 ? '+' : gapMs < 0 ? '−' : '';
        if (abs < 60000) return `${sign}${(abs / 1000).toFixed(2)}s`;
        const m = Math.floor(abs / 60000);
        const s = (abs % 60000) / 1000;
        return `${sign}${m}:${s.toFixed(1).padStart(4, '0')}`;
    }

    function compareRaceAnalyses(a, b) {
        if (!a?.valid || !b?.valid) {
            const parts = [];
            if (!a?.valid) parts.push(`${a?.name || 'Boat A'}: ${a?.reason || 'invalid'}`);
            if (!b?.valid) parts.push(`${b?.name || 'Boat B'}: ${b?.reason || 'invalid'}`);
            return { valid: false, reason: parts.join(' · ') };
        }
        const phaseCompare = RACE_PHASES.map((def) => {
            const pa = a.phases.find((p) => p.id === def.id);
            const pb = b.phases.find((p) => p.id === def.id);
            const durA = pa?.durationMs;
            const durB = pb?.durationMs;
            let leader = null;
            let gap = null;
            if (Number.isFinite(durA) && Number.isFinite(durB)) {
                gap = durB - durA;
                leader = Math.abs(gap) < 30 ? 'tie' : gap > 0 ? 'a' : 'b';
            }
            return { def, pa, pb, gap, leader };
        });
        const totalGap = b.totalMs - a.totalMs;
        const totalLeader = Math.abs(totalGap) < 50 ? 'tie' : totalGap > 0 ? 'a' : 'b';
        let sectionsWonA = 0;
        let sectionsWonB = 0;
        phaseCompare.forEach((p) => {
            if (p.leader === 'a') sectionsWonA++;
            else if (p.leader === 'b') sectionsWonB++;
        });
        return {
            valid: true,
            a,
            b,
            phaseCompare,
            totalGap,
            totalLeader,
            sectionsWonA,
            sectionsWonB,
        };
    }

    function getCourseBuoys(options) {
        if (options?.buoys?.length) {
            return options.buoys.map((b) => ({ ...b }));
        }
        loadCourseBuoys();
        return courseBuoys.map((b) => ({ ...b }));
    }

    function buoyByLabel(buoys, label) {
        return (buoys || []).find((b) => b.label === label) || null;
    }

    function midpointLatLng(a, b) {
        return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    }

    function courseFrameFromBuoys(buoys) {
        const l1 = buoyByLabel(buoys, 'L1');
        const r1 = buoyByLabel(buoys, 'R1');
        const l3 = buoyByLabel(buoys, 'L3');
        const r3 = buoyByLabel(buoys, 'R3');
        if (!l1 || !r1 || !l3 || !r3) return null;

        const refLat = (l1.lat + r1.lat + l3.lat + r3.lat) / 4;
        const refLng = (l1.lng + r1.lng + l3.lng + r3.lng) / 4;
        const g1 = midpointLatLng(l1, r1);
        const g3 = midpointLatLng(l3, r3);
        const m1 = latLngToLocalMeters(g1.lat, g1.lng, refLat, refLng);
        const m3 = latLngToLocalMeters(g3.lat, g3.lng, refLat, refLng);
        const l1m = latLngToLocalMeters(l1.lat, l1.lng, refLat, refLng);
        const r1m = latLngToLocalMeters(r1.lat, r1.lng, refLat, refLng);

        const dx = m3.x - m1.x;
        const dy = m3.y - m1.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const px = -uy;
        const py = ux;

        const laneHalfSpan = Math.max(8, Math.hypot(r1m.x - l1m.x, r1m.y - l1m.y) / 2);
        const waterX = m1.x - ux * WR_COURSE_SPEC.gateOffsetsM[0];
        const waterY = m1.y - uy * WR_COURSE_SPEC.gateOffsetsM[0];

        return {
            refLat,
            refLng,
            ux,
            uy,
            px,
            py,
            g1m: m1,
            water: { x: waterX, y: waterY },
            laneHalfSpan,
        };
    }

    function xyToLatLng(x, y, frame) {
        return localMetersToLatLng(x, y, frame.refLat, frame.refLng);
    }

    function crossLineEndpoints(frame, centerX, centerY, halfSpanM) {
        return {
            a: xyToLatLng(centerX - frame.px * halfSpanM, centerY - frame.py * halfSpanM, frame),
            b: xyToLatLng(centerX + frame.px * halfSpanM, centerY + frame.py * halfSpanM, frame),
        };
    }

    function landwardXY(x, y, frame, distM) {
        return { x: x - frame.ux * distM, y: y - frame.uy * distM };
    }

    function medianOf(nums) {
        if (!nums.length) return NaN;
        const s = [...nums].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }

    /** Boat stop/start at surf line from GPS (stationary points near beach). */
    function estimateBoatBeachPositions(athletes, frame) {
        const stops = [];
        for (const ath of athletes || []) {
            if (!ath.analysis?.valid || !ath.points?.length) continue;
            const sorted = sortRoutePoints(ath.points);
            const t1 = ath.analysis.timing?.line1?.timeMs;
            const t3 =
                ath.analysis.timing?.line3Second?.timeMs ??
                ath.analysis.timing?.line3First?.timeMs;
            for (const p of sorted) {
                const t = positionTimeMs(p);
                if (!Number.isFinite(t)) continue;
                if (pointSpeedMps(p) > 2.2) continue;
                const m = latLngToLocalMeters(p.latitude, p.longitude, frame.refLat, frame.refLng);
                const cross =
                    (m.x - frame.g1m.x) * frame.px + (m.y - frame.g1m.y) * frame.py;
                const nearOut = t1 != null && t <= t1 + 8000;
                const nearIn = t3 != null && t >= t3 - 5000;
                if (nearOut || nearIn) {
                    stops.push({ x: m.x, y: m.y, cross, lane: ath.lane });
                }
            }
        }

        const fallbackLeft = {
            x: frame.water.x + frame.px * frame.laneHalfSpan,
            y: frame.water.y + frame.py * frame.laneHalfSpan,
        };
        const fallbackRight = {
            x: frame.water.x - frame.px * frame.laneHalfSpan,
            y: frame.water.y - frame.py * frame.laneHalfSpan,
        };
        if (stops.length < 2) {
            return {
                fromGps: false,
                left: fallbackLeft,
                right: fallbackRight,
                center: frame.water,
            };
        }

        const leftPts = stops.filter((s) => s.lane === 1 || (s.lane == null && s.cross < 0));
        const rightPts = stops.filter((s) => s.lane === 2 || (s.lane == null && s.cross >= 0));
        const pick = (arr, fb) =>
            arr.length
                ? {
                      x: medianOf(arr.map((s) => s.x)),
                      y: medianOf(arr.map((s) => s.y)),
                  }
                : fb;

        return {
            fromGps: true,
            left: pick(leftPts, fallbackLeft),
            right: pick(rightPts, fallbackRight),
            center: {
                x: medianOf(stops.map((s) => s.x)),
                y: medianOf(stops.map((s) => s.y)),
            },
        };
    }

    function estimateBeachRunTimes(analysis, officialTimeMs) {
        if (analysis?.runTiming?.fromCsv) {
            return {
                outMs: analysis.runTiming.runOutMs,
                inMs: analysis.runTiming.runInMs,
                fromCsv: true,
            };
        }
        const csvMs = officialTimeMs ?? analysis?.officialTimeMs;
        const boatMs = analysis?.totalMs;
        if (Number.isFinite(csvMs) && Number.isFinite(boatMs) && csvMs > boatMs) {
            const runTotalMs = csvMs - boatMs;
            const half = runTotalMs / 2;
            return { outMs: half, inMs: half, fromCsv: true };
        }
        const launch = analysis?.phases?.find((p) => p.id === 'launch');
        const ret = analysis?.phases?.find((p) => p.id === 'return');
        const b = WR_COURSE_SPEC.beachRunDistM;
        const wOut = WR_COURSE_SPEC.gateOffsetsM[0];
        const wIn = WR_COURSE_SPEC.waterReturnBeforeBeachM;
        let outMs = null;
        let inMs = null;
        if (launch?.durationMs != null && launch.durationMs > 0) {
            outMs = launch.durationMs * (b / (b + wOut));
        }
        if (ret?.durationMs != null && ret.durationMs > 0) {
            inMs = ret.durationMs * (b / (b + wIn));
        }
        return { outMs, inMs, fromCsv: false };
    }

    function landwardProjectionM(frame, x, y) {
        return x * -frame.ux + y * -frame.uy;
    }

    function buildApproxStartGate(buoys, athletes) {
        const frame = courseFrameFromBuoys(buoys);
        if (!frame) return null;

        const launchMs = [];
        for (const ath of athletes || []) {
            if (!ath.section?.accelMs || !ath.points?.length) continue;
            const sorted = sortRoutePoints(ath.points);
            const pt = interpolatePointAtTime(sorted, ath.section.accelMs);
            if (!pt) continue;
            const m = latLngToLocalMeters(pt.latitude, pt.longitude, frame.refLat, frame.refLng);
            launchMs.push(m);
        }
        if (!launchMs.length) return null;

        let maxLand = -Infinity;
        for (const b of buoys || []) {
            const m = latLngToLocalMeters(b.lat, b.lng, frame.refLat, frame.refLng);
            maxLand = Math.max(maxLand, landwardProjectionM(frame, m.x, m.y));
        }
        for (const m of launchMs) {
            maxLand = Math.max(maxLand, landwardProjectionM(frame, m.x, m.y));
        }

        const alongU =
            launchMs.reduce((s, m) => s + (m.x * frame.ux + m.y * frame.uy), 0) / launchMs.length;
        const gateLand =
            maxLand + (WR_COURSE_SPEC.startGateBeachwardOfMarkersM || 1);
        const cx = (alongU - gateLand) * frame.ux;
        const cy = (alongU - gateLand) * frame.uy;
        const halfW = WR_COURSE_SPEC.startGateWidthM / 2;
        return {
            ...crossLineEndpoints(frame, cx, cy, halfW),
            center: xyToLatLng(cx, cy, frame),
        };
    }

    function buildBeachRunOverlay({ buoys, athletes }) {
        const frame = courseFrameFromBuoys(buoys);
        if (!frame) {
            return { ok: false, reason: 'Need six course buoys to draw beach run layout.' };
        }

        const approxStartGate = buildApproxStartGate(buoys, athletes);
        const boats = estimateBoatBeachPositions(athletes, frame);
        const tideOff = WR_COURSE_SPEC.tideLineFromBoatM;
        const flagOff = WR_COURSE_SPEC.runFlagLandwardOfTideM;
        const beachRun = WR_COURSE_SPEC.beachRunDistM;
        const span = frame.laneHalfSpan + 16;

        const tideCenter = landwardXY(boats.center.x, boats.center.y, frame, tideOff);
        const tideLine = crossLineEndpoints(frame, tideCenter.x, tideCenter.y, span + 8);

        const startLand = Math.max(8, beachRun - tideOff);
        const startCenter = landwardXY(tideCenter.x, tideCenter.y, frame, startLand);
        const startFinishGate = crossLineEndpoints(frame, startCenter.x, startCenter.y, span + 12);
        const startFinishPt = xyToLatLng(startCenter.x, startCenter.y, frame);

        function tidePointAtBoat(boatXY) {
            return landwardXY(boatXY.x, boatXY.y, frame, tideOff);
        }

        function flagPointOnBeach(boatXY) {
            const onTide = tidePointAtBoat(boatXY);
            return landwardXY(onTide.x, onTide.y, frame, flagOff);
        }

        const flagLxy = flagPointOnBeach(boats.left);
        const flagRxy = flagPointOnBeach(boats.right);
        const boatL = xyToLatLng(boats.left.x, boats.left.y, frame);
        const boatR = xyToLatLng(boats.right.x, boats.right.y, frame);
        const flagL = xyToLatLng(flagLxy.x, flagLxy.y, frame);
        const flagR = xyToLatLng(flagRxy.x, flagRxy.y, frame);

        const runFlags = [
            { side: 'L', lane: 1, label: 'Run flag L', lat: flagL.lat, lng: flagL.lng },
            { side: 'R', lane: 2, label: 'Run flag R', lat: flagR.lat, lng: flagR.lng },
        ];

        const boatStops = [
            { side: 'L', lane: 1, label: 'Boat L', lat: boatL.lat, lng: boatL.lng },
            { side: 'R', lane: 2, label: 'Boat R', lat: boatR.lat, lng: boatR.lng },
        ];

        const runnerPaths = [];
        const sortedAth = [...(athletes || [])].filter((a) => a.analysis?.valid);
        sortedAth.sort((a, b) => (a.lane || 99) - (b.lane || 99));
        let runFromCsv = false;

        for (const ath of sortedAth) {
            const side =
                ath.lane === 1 || ath.side === 'L'
                    ? 'L'
                    : ath.lane === 2 || ath.side === 'R'
                      ? 'R'
                      : sortedAth.indexOf(ath) === 0
                        ? 'L'
                        : 'R';
            const flag = side === 'L' ? flagL : flagR;
            const boat = side === 'L' ? boatL : boatR;
            const times = estimateBeachRunTimes(ath.analysis, ath.officialTimeMs);
            const estOut =
                times.outMs != null
                    ? times.outMs
                    : (beachRun / WR_COURSE_SPEC.runnerSprintMps) * 1000;
            const estIn =
                times.inMs != null ? times.inMs : (beachRun / WR_COURSE_SPEC.runnerSprintMps) * 1000;
            if (times.fromCsv) runFromCsv = true;

            runnerPaths.push({
                name: ath.label || ath.analysis.name,
                lane: ath.lane,
                side,
                runOut: {
                    latlngs: [
                        [startFinishPt.lat, startFinishPt.lng],
                        [flag.lat, flag.lng],
                        [boat.lat, boat.lng],
                    ],
                    estMs: estOut,
                },
                runIn: {
                    latlngs: [
                        [boat.lat, boat.lng],
                        [flag.lat, flag.lng],
                        [startFinishPt.lat, startFinishPt.lng],
                    ],
                    estMs: estIn,
                },
            });
        }

        return {
            ok: true,
            tideLine,
            startFinishGate,
            approxStartGate,
            runFlags,
            boatStops,
            startFinishPt,
            runnerPaths,
            runLabelSuffix: runFromCsv ? ' (from results CSV)' : ' (est.)',
            note: boats.fromGps
                ? `WR beach layout; run times from results CSV minus GPS boat time. Approx. start gate at GPS launch (7→20 km/h).`
                : `WR beach layout from B1 gate; run times from CSV when available.`,
        };
    }

    loadCourseBuoys();

    global.BeachSprintsCoastal = {
        analyzeCoastalRace,
        compareRaceAnalyses,
        analyzeDeviceTiming,
        inferCourseBuoysFromGps,
        detectBoatRacingSection,
        trimToBoatRacingSection,
        buildBeachRunOverlay,
        sortRoutePoints,
        positionTimeMs,
        formatDurationMs,
        formatGapMs,
        loadCourseBuoys,
        getCourseBuoys,
        withCourseBuoys,
        RACE_PHASES,
        TIMING_LINES,
        WR_COURSE_SPEC,
        DEFAULT_BEACH_BUOYS,
    };
})(typeof window !== 'undefined' ? window : globalThis);
