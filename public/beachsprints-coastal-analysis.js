/**
 * Standalone coastal sprint GPS analysis (timing lines + head-to-head).
 * Used by the regatta dashboard without loading the full map page.
 */
(function (global) {
    const LS_BEACH_BUOYS = 'bspCourseBuoys_v1';
    const TIMING_LINE_EXTENSION_M = 50;
    const RACE_MOVE_THRESHOLD_MS = 2;

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

    function loadCourseBuoys() {
        try {
            const raw = localStorage.getItem(LS_BEACH_BUOYS);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length) {
                    const byId = new Map(parsed.map((b) => [b.id, b]));
                    courseBuoys = DEFAULT_BEACH_BUOYS.map((def) => byId.get(def.id) || { ...def });
                    return;
                }
            }
        } catch {
            /* ignore */
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

    function analyzeDeviceTiming(points) {
        const sorted = sortRoutePoints(points);
        const lines = TIMING_LINES.map((def) => {
            const ep = extendTimingLineEndpoints(getTimingLineEndpoints(def));
            const crossings = ep ? findLineCrossings(sorted, ep.a, ep.b) : [];
            return { def, crossings };
        });
        const line1 = lines[0].crossings[0] || null;
        const line2 = lines[1].crossings[0] || null;
        const line3First = lines[2].crossings[0] || null;
        const line3Second = lines[2].crossings[1] || null;
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

    function findRaceWindow(sorted) {
        if (!sorted || sorted.length < 2) return null;
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
        return { startMs, endMs, timing };
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

    function analyzeCoastalRace(points, deviceName) {
        loadCourseBuoys();
        const sorted = sortRoutePoints(points);
        const raceWindow = findRaceWindow(sorted);
        if (!raceWindow) {
            return { valid: false, name: deviceName, reason: 'No race detected (never exceeded 2 m/s).' };
        }
        const { startMs, endMs, timing } = raceWindow;
        const totalMs = endMs - startMs;
        if (!Number.isFinite(totalMs) || totalMs <= 0) {
            return { valid: false, name: deviceName, reason: 'Race window too short to analyse.' };
        }
        return {
            valid: true,
            name: deviceName,
            startMs,
            endMs,
            totalMs,
            timing,
            phases: buildRacePhases(sorted, raceWindow),
            raceSpeed: speedStatsBetween(sorted, startMs, endMs),
            turnTimeMs: timing.turnTimeMs,
            points: sorted,
        };
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

    function getCourseBuoys() {
        loadCourseBuoys();
        return courseBuoys.map((b) => ({ ...b }));
    }

    loadCourseBuoys();

    global.BeachSprintsCoastal = {
        analyzeCoastalRace,
        compareRaceAnalyses,
        analyzeDeviceTiming,
        sortRoutePoints,
        positionTimeMs,
        formatDurationMs,
        formatGapMs,
        loadCourseBuoys,
        getCourseBuoys,
        RACE_PHASES,
        TIMING_LINES,
        DEFAULT_BEACH_BUOYS,
    };
})(typeof window !== 'undefined' ? window : globalThis);
