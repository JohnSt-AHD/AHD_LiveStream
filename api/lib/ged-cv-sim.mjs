/**
 * Looping Karāpiro CV + drone sim for Ged overlays.
 * Boat speeds: World Cup 1 2026 M1x H1. Names stay WR; logos are random NZ clubs.
 * Drone follows ~50 m behind the leader on the Masters trial start/finish axis.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const START = { lat: -37.943356, lng: 175.556788 };
const FINISH = { lat: -37.929223, lng: 175.542716 };
const EARTH_R = 6371000;
const COURSE_M = 2000;
const LANE_M = 10;
const LANE_COUNT = 8;
const HOLD_START_MS = 10000;
const HOLD_FINISH_MS = 8000;
const DRONE_BEHIND_M = 50;
const DRONE_HEIGHT_M = 38;
const STREAM_ID = 'ged-sim';
const DEVICE_SN = '1581SIM00001';
const FRAME_W = 1920;
const FRAME_H = 1080;
const LOGO_POOL = [
    'welc', 'camc', 'aklc', 'hwbc', 'nshc', 'avnc',
    'sgec', 'whac', 'bpcc', 'petc', 'wesc', 'rotc',
];

const f0Lat = ((FINISH.lat - START.lat) * Math.PI) / 180;
const f0Lng = ((FINISH.lng - START.lng) * Math.PI) / 180;
const lat0r = (START.lat * Math.PI) / 180;
const fE = f0Lng * Math.cos(lat0r) * EARTH_R;
const fN = f0Lat * EARTH_R;
const axisLen = Math.hypot(fE, fN) || 1;
const ux = fE / axisLen;
const uy = fN / axisLen;
const scale = COURSE_M / axisLen;
const courseBearing = ((Math.atan2(fE, fN) * 180) / Math.PI + 360) % 360;

const WR = JSON.parse(
    readFileSync(join(ROOT, 'public', 'data', 'kri-sample-wrcp1-m1x-h1.json'), 'utf8'),
);
const LOOKUP = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'ahd-lookup.json'), 'utf8'));

function llAt(chainM, acrossM) {
    const chain = chainM / scale;
    const across = acrossM / scale;
    const e = chain * ux - across * uy;
    const n = chain * uy + across * ux;
    return {
        lat: START.lat + (n / EARTH_R) * (180 / Math.PI),
        lng: START.lng + (e / (EARTH_R * Math.cos(lat0r))) * (180 / Math.PI),
    };
}

function clubLogo(id) {
    const c = LOOKUP?.clubs?.[id];
    if (!c?.logo) return null;
    return `assets/school-logos/${encodeURIComponent(c.logo)}`;
}

function shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function tracesToTimeline(boats) {
    return boats.map((b) => {
        const pts = b.points || [];
        const timed = [];
        let t = 0;
        pts.forEach((p, i) => {
            if (i > 0) {
                const dd = Number(p.distance) - Number(pts[i - 1].distance);
                const v = Math.max(0.35, (Number(p.speed) + Number(pts[i - 1].speed)) / 2);
                t += dd / v;
            }
            timed.push({
                t,
                d: Number(p.distance) || 0,
                s: Number(p.speed) || 0,
            });
        });
        return { id: b.id, label: b.label || b.id, timed, tFinish: t };
    });
}

function interp(timed, tSec) {
    if (!timed.length) return { d: 0, s: 0 };
    if (tSec <= timed[0].t) return timed[0];
    const last = timed[timed.length - 1];
    if (tSec >= last.t) return last;
    for (let i = 1; i < timed.length; i++) {
        const a = timed[i - 1];
        const b = timed[i];
        if (tSec <= b.t) {
            const u = (tSec - a.t) / Math.max(0.001, b.t - a.t);
            return { d: a.d + (b.d - a.d) * u, s: a.s + (b.s - a.s) * u };
        }
    }
    return last;
}

// Nadir start still (8 pontoons, boats in 2–7) baked into 1920×1080.
const START_X = [0, 240, 446, 664, 863, 1069, 1275, 1476, 1676];
const START_Y = 450;

function startPixel(lane) {
    const n = Math.max(1, Math.min(8, Number(lane) || 1));
    return {
        x: START_X[n],
        y: START_Y,
    };
}

const timelines = tracesToTimeline(WR.boats || []);
const raceMs = Math.ceil(Math.max(...timelines.map((t) => t.tFinish), 360) * 1000);
const loopMs = HOLD_START_MS + raceMs + HOLD_FINISH_MS;
const t0 = Date.now();
const assigned = shuffle(LOGO_POOL).slice(0, timelines.length);
const crews = timelines.map((row, i) => {
    const clubId = assigned[i] || LOGO_POOL[i % LOGO_POOL.length];
    const lane = i + 2;
    return {
        ...row,
        lane,
        slot: i,
        clubId,
        logoUrl: clubLogo(clubId),
        across: -((LANE_COUNT * LANE_M) / 2) + (lane - 0.5) * LANE_M,
    };
});

const START_PNG = 'assets/vmix/karapiro-start.png';
const START_SVG = 'assets/vmix/karapiro-start.svg';

function startImage() {
    const file = START_PNG.split('?')[0];
    return existsSync(join(ROOT, 'public', file)) ? `${START_PNG}?v=2` : START_SVG;
}

function fmtSplit(ms) {
    const s = Math.max(0, Number(ms) || 0) / 1000;
    const m = Math.floor(s / 60);
    const rem = (s - m * 60).toFixed(2);
    return `${m}:${rem.padStart(5, '0')}`;
}

const splitMarks = [500, 1000, 1500, 2000];
const splitTimes = new Map();

function clockForLoop() {
    const pos = (Date.now() - t0) % loopMs;
    if (pos < HOLD_START_MS) {
        return { pos, phase: 'ready', elapsedMs: 0, racing: false };
    }
    if (pos >= HOLD_START_MS + raceMs) {
        return { pos, phase: 'finished', elapsedMs: raceMs, racing: false };
    }
    return {
        pos,
        phase: pos < HOLD_START_MS + 2500 ? 'started' : 'racing',
        elapsedMs: pos - HOLD_START_MS,
        racing: true,
    };
}

function markSplits(boats, elapsedMs) {
    const tSec = elapsedMs / 1000;
    for (const b of boats) {
        const key = `${b.lane}`;
        let rec = splitTimes.get(key);
        if (!rec) {
            rec = {};
            splitTimes.set(key, rec);
        }
        for (const mark of splitMarks) {
            if (rec[mark] != null) continue;
            if (b.chainage_m >= mark) rec[mark] = Math.round(elapsedMs);
        }
        if (tSec < 1) {
            for (const mark of splitMarks) delete rec[mark];
        }
    }
    const byMark = {};
    let active = null;
    for (const mark of splitMarks) {
        const rows = boats
            .map((b) => {
                const ms = splitTimes.get(String(b.lane))?.[mark];
                if (ms == null) return null;
                return { lane: b.lane, elapsed_ms: ms, place: 0 };
            })
            .filter(Boolean)
            .sort((a, b) => a.elapsed_ms - b.elapsed_ms)
            .map((row, i) => {
                const prevMark = splitMarks[splitMarks.indexOf(mark) - 1];
                const prevMs =
                    prevMark != null ? splitTimes.get(String(row.lane))?.[prevMark] : null;
                return {
                    ...row,
                    place: i + 1,
                    placing: i + 1,
                    time: fmtSplit(row.elapsed_ms),
                    section_time:
                        Number.isFinite(prevMs) ? fmtSplit(row.elapsed_ms - prevMs) : null,
                };
            });
        if (rows.length) {
            byMark[String(mark)] = rows;
            if (rows.length >= Math.min(3, boats.length)) active = mark;
        }
    }
    const justHit = splitMarks.find((m) =>
        boats.some((b) => {
            const ms = splitTimes.get(String(b.lane))?.[m];
            return ms != null && elapsedMs - ms < 8000;
        }),
    );
    return { active_mark: justHit || active, by_mark: byMark };
}

function speedSeries(elapsedMs) {
    const tSec = elapsedMs / 1000;
    return crews.map((c) => {
        const pts = [];
        for (const p of c.timed) {
            if (p.t > tSec + 0.05) break;
            pts.push([p.t, p.s, p.d]);
        }
        if (!pts.length) {
            const p0 = c.timed[0];
            pts.push([0, p0?.s || 0, p0?.d || 0]);
        }
        return { lane: c.lane, label: c.label, points: pts };
    });
}

export function snapshot() {
    const clock = clockForLoop();
    const tSec = clock.elapsedMs / 1000;
    const boats = crews.map((c) => {
        const sample = clock.phase === 'ready' ? { d: 8 + c.slot * 0.4, s: 0 } : interp(c.timed, tSec);
        const chain = Math.max(0, Math.min(COURSE_M, sample.d));
        const ll = llAt(chain, c.across);
        const pix = startPixel(c.lane);
        const yRace = Math.round(pix.y - Math.min(520, chain * 0.26));
        return {
            lane: c.lane,
            slot: c.slot,
            code: c.label,
            label: c.label,
            name: c.label,
            shortLabel: c.label,
            logoUrl: c.logoUrl,
            chainage_m: chain,
            across_m: c.across,
            lat: ll.lat,
            lon: ll.lng,
            speed_mps: clock.racing ? sample.s : 0,
            speed_kmh: clock.racing ? sample.s * 3.6 : 0,
            detected: true,
            in_view: true,
            from_draw: clock.phase === 'ready',
            cv_status: 'green',
            locked: true,
            x: pix.x,
            y: clock.phase === 'ready' ? pix.y : yRace,
            track_id: c.slot + 1,
        };
    });
    if (clock.phase === 'ready') splitTimes.clear();
    const splits = markSplits(boats, clock.elapsedMs);
    const ranked = [...boats].sort((a, b) => b.chainage_m - a.chainage_m);
    const leader = ranked[0];
    const leaderCh = leader?.chainage_m || 0;
    const droneChain = leaderCh - DRONE_BEHIND_M;
    const droneLl = llAt(droneChain, 0);
    const look = Math.atan2(-DRONE_HEIGHT_M, Math.max(18, leaderCh - droneChain));
    const gimbalPitch = clock.phase === 'ready' ? -28 : (look * 180) / Math.PI;
    const markLabel =
        leaderCh >= 1500 ? '1500m' : leaderCh >= 1000 ? '1000m' : leaderCh >= 500 ? '500m' : 'Start';

    return {
        ok: true,
        sim: true,
        streamId: STREAM_ID,
        event: WR.event,
        eventType: 'M 1X',
        race: '1 (A)',
        raceNum: 1,
        round: WR.round,
        venue: 'Lake Karāpiro',
        source: WR.source,
        race_phase: clock.phase,
        course_mark: markLabel,
        leader_chainage_m: Math.round(leaderCh),
        leader_slot: leader?.slot ?? 0,
        lane_count: LANE_COUNT,
        occupied_lanes: boats.map((b) => b.lane),
        draw_lanes: boats.map((b) => ({
            lane: b.lane,
            code: b.code,
            label: b.label,
            shortLabel: b.shortLabel,
            logoUrl: b.logoUrl,
        })),
        start_lineup: {
            image: startImage(),
            refW: FRAME_W,
            refH: FRAME_H,
            lanes: Object.fromEntries(boats.map((b) => [String(b.lane), { x: b.x, y: startPixel(b.lane).y }])),
        },
        boats,
        splits,
        speed_series: speedSeries(clock.elapsedMs),
        clock: { elapsed_ms: clock.elapsedMs, loop_ms: loopMs },
        drone: {
            deviceSn: DEVICE_SN,
            source: 'osd',
            latitude: droneLl.lat,
            longitude: droneLl.lng,
            height: DRONE_HEIGHT_M,
            elevation: DRONE_HEIGHT_M,
            attitudeHead: courseBearing,
            attitudePitch: -8,
            attitudeRoll: 0,
            horizontalSpeed: clock.racing ? 5.2 : 0.4,
            gimbal: { pitch: gimbalPitch, yaw: 0, roll: 0 },
            zoom: 1,
            receivedAt: Date.now(),
            cameras: [{ zoom_factor: 1 }],
        },
        pose_age_ms: 40,
        stale: false,
        frame_w: FRAME_W,
        frame_h: FRAME_H,
        start_image: startImage(),
    };
}

export function droneTelemetry() {
    const snap = snapshot();
    const d = snap.drone;
    return {
        sim: true,
        deviceSn: d.deviceSn,
        source: 'osd',
        ageMs: 40,
        stale: false,
        latitude: d.latitude,
        longitude: d.longitude,
        height: d.height,
        elevation: d.elevation,
        attitudeHead: d.attitudeHead,
        attitudePitch: d.attitudePitch,
        attitudeRoll: d.attitudeRoll,
        horizontalSpeed: d.horizontalSpeed,
        verticalSpeed: 0,
        gimbal: d.gimbal,
        cameras: d.cameras,
        receivedAt: d.receivedAt,
        timestamp: Date.now(),
    };
}

export function simCvPosition() {
    const snap = snapshot();
    const boats = (snap.boats || []).map((b) => ({
        slot: b.slot + 1,
        x: b.x,
        y: b.y,
        laneCoord: b.y,
        conf: 0.92,
    }));
    const leader = boats[0] || { x: 960, y: 540 };
    return {
        sim: true,
        streamId: STREAM_ID,
        x: leader.x,
        y: leader.y,
        frame: 0,
        auto: 1,
        venue: 'karapiro',
        boat_direction: 'away',
        refW: FRAME_W,
        refH: FRAME_H,
        boats,
        race_boat_count: boats.length,
        updatedAt: Date.now(),
    };
}

export const SIM_STREAM_ID = STREAM_ID;
export const SIM_LOOP_MS = loopMs;
