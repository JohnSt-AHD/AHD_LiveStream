/**
 * Loop a baked drone clip with synced CV snapshots for overlay tests.
 * URL: vmix-karapiro.html?clip=nzuu26&g=leader&autoplay=1
 */
(function (global) {
    const OUT_W = 1920;
    const OUT_H = 1080;

    let clipId = '';
    let data = null;
    let video = null;
    let ready = false;
    let loadPromise = null;
    let identLock = null;

    function params() {
        return new URLSearchParams(location.search);
    }

    function requestedClip() {
        return (params().get('clip') || params().get('cvclip') || '').trim().toLowerCase();
    }

    function active() {
        return Boolean(clipId && data && video);
    }

    function timeSec() {
        if (!data) return 0;
        const dur = Math.max(0.2, Number(data.duration) || (video?.duration || 1));
        const t = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
        const u = t % dur;
        return u < 0 ? u + dur : u;
    }

    function frameAt(tSec) {
        const frames = data?.frames || [];
        if (!frames.length) return null;
        const t = Math.max(0, Number(tSec) || 0);
        let lo = 0;
        let hi = frames.length - 1;
        if (t <= frames[0].t) return frames[0];
        if (t >= frames[hi].t) return frames[hi];
        while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (frames[mid].t <= t) lo = mid;
            else hi = mid;
        }
        const a = frames[lo];
        const b = frames[hi];
        const span = Math.max(0.001, b.t - a.t);
        const u = (t - a.t) / span;
        const byLane = new Map((b.boats || []).map((row) => [Number(row[0]), row]));
        return {
            t,
            dir: a.dir === b.dir ? a.dir : u < 0.5 ? a.dir : b.dir,
            boats: a.boats.map((row) => {
                const other = byLane.get(Number(row[0])) || row;
                const jump = Math.hypot((other[1] || 0) - (row[1] || 0), (other[2] || 0) - (row[2] || 0));
                const lerp = a.dir === b.dir && jump < 160;
                const pick = u < 0.5 ? row : other;
                return [
                    row[0],
                    lerp ? Math.round(row[1] + (other[1] - row[1]) * u) : pick[1],
                    lerp ? Math.round(row[2] + (other[2] - row[2]) * u) : pick[2],
                    lerp ? row[3] + (other[3] - row[3]) * u : pick[3],
                    u < 0.5 ? row[4] : other[4],
                ];
            }),
        };
    }

    function permute(arr) {
        if (arr.length <= 1) return [arr.slice()];
        const out = [];
        for (let i = 0; i < arr.length; i++) {
            for (const rest of permute(arr.slice(0, i).concat(arr.slice(i + 1)))) {
                out.push([arr[i], ...rest]);
            }
        }
        return out;
    }

    function combinations(arr, k) {
        const out = [];
        function rec(start, acc) {
            if (acc.length === k) {
                out.push(acc.slice());
                return;
            }
            for (let i = start; i < arr.length; i++) {
                acc.push(arr[i]);
                rec(i + 1, acc);
                acc.pop();
            }
        }
        rec(0, []);
        return out;
    }

    function centroid(pts) {
        const n = Math.max(1, pts.length);
        return {
            x: pts.reduce((s, p) => s + p.x, 0) / n,
            y: pts.reduce((s, p) => s + p.y, 0) / n,
        };
    }

    function rotationFit(from, to) {
        let dot = 0;
        let cross = 0;
        for (let i = 0; i < from.length; i++) {
            dot += from[i].x * to[i].x + from[i].y * to[i].y;
            cross += from[i].x * to[i].y - from[i].y * to[i].x;
        }
        const ang = Math.atan2(cross, dot);
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        let err = 0;
        for (let i = 0; i < from.length; i++) {
            const rx = c * from[i].x - s * from[i].y;
            const ry = s * from[i].x + c * from[i].y;
            err += (rx - to[i].x) ** 2 + (ry - to[i].y) ** 2;
        }
        return { ang, rms: Math.sqrt(err / Math.max(1, from.length)) };
    }

    function bestRigidAssign(slots, dets) {
        if (!slots.length || !dets.length) return null;
        const k = Math.min(slots.length, dets.length);
        const slotIdx = slots.map((_, i) => i);
        const detIdx = dets.map((_, i) => i);
        let best = null;
        for (const sComb of combinations(slotIdx, k)) {
            for (const dPerm of permute(detIdx)) {
                const dUse = dPerm.slice(0, k);
                const sPts = sComb.map((i) => slots[i]);
                const dPts = dUse.map((i) => dets[i]);
                const sc = centroid(sPts);
                const dc = centroid(dPts);
                const from = sPts.map((p) => ({ x: p.x - sc.x, y: p.y - sc.y }));
                const to = dPts.map((p) => ({ x: p.x - dc.x, y: p.y - dc.y }));
                const fit = rotationFit(from, to);
                const rms = fit.rms + (slots.length - k) * 18;
                if (!best || rms < best.rms) {
                    best = {
                        rms,
                        sc,
                        dc,
                        pairs: sComb.map((pi, n) => ({ pi, di: dUse[n] })),
                    };
                }
            }
        }
        return best;
    }

    function stabilizeFrame(frame, tSec) {
        if (!frame?.boats?.length) return frame;
        if (identLock && (tSec + 0.45 < identLock.t || tSec > identLock.t + 1.2)) identLock = null;
        const dets = frame.boats.map((row) => ({
            lane: Number(row[0]),
            x: Number(row[1]) || 0,
            y: Number(row[2]) || 0,
            chain: Number(row[3]) || 0,
            speed: Number(row[4]) || 0,
        }));
        if (!identLock) {
            identLock = {
                t: tSec,
                slots: dets.map((d) => ({
                    lane: d.lane,
                    x: d.x,
                    y: d.y,
                    vx: 0,
                    vy: 0,
                    chain: d.chain,
                    speed: d.speed,
                    miss: 0,
                })),
            };
            return frame;
        }
        const dt = Math.max(0.02, Math.min(0.4, tSec - identLock.t));
        const slots = identLock.slots;
        const preds = slots.map((s) => ({ x: s.x + s.vx * dt, y: s.y + s.vy * dt }));
        const fit = bestRigidAssign(preds, dets);
        const yr = Math.max(...dets.map((d) => d.y)) - Math.min(...dets.map((d) => d.y));
        const xr = Math.max(...dets.map((d) => d.x)) - Math.min(...dets.map((d) => d.x));
        const transitioning = frame.dir !== identLock.dir || (xr > 280 && yr < 160);
        const rmsNeed = transitioning ? 140 : 90;
        const maxMiss = Math.max(0, ...slots.map((s) => s.miss || 0));
        const acceptFit = fit && (fit.rms <= rmsNeed || (transitioning && maxMiss >= 8));
        if (!acceptFit) {
            const sc = centroid(preds);
            const dc = centroid(dets);
            const cdx = dc.x - sc.x;
            const cdy = dc.y - sc.y;
            const motion = Math.hypot(cdx, cdy);
            for (const s of slots) {
                if (motion < 280) {
                    s.x += cdx;
                    s.y += cdy;
                } else {
                    s.x += s.vx * dt;
                    s.y += s.vy * dt;
                }
                s.vx *= 0.85;
                s.vy *= 0.85;
                s.miss = (s.miss || 0) + 1;
                s.chain += s.speed * dt;
                s.x = Math.max(80, Math.min(1840, s.x));
                s.y = Math.max(60, Math.min(1020, s.y));
            }
        } else {
            const used = new Set();
            for (const { pi, di } of fit.pairs) {
                const s = slots[pi];
                const d = dets[di];
                used.add(pi);
                s.vx = s.vx * 0.4 + ((d.x - s.x) / dt) * 0.6;
                s.vy = s.vy * 0.4 + ((d.y - s.y) / dt) * 0.6;
                s.x = d.x;
                s.y = d.y;
                s.miss = 0;
                if (Math.abs(d.chain - s.chain) < 40) s.chain = d.chain;
                else s.chain += s.speed * dt;
                s.speed = d.speed;
            }
            for (let i = 0; i < slots.length; i++) {
                if (used.has(i)) continue;
                const s = slots[i];
                s.x += s.vx * dt + (fit.dc.x - fit.sc.x);
                s.y += s.vy * dt + (fit.dc.y - fit.sc.y);
                s.vx *= 0.85;
                s.vy *= 0.85;
                s.miss = (s.miss || 0) + 1;
                s.chain += s.speed * dt;
            }
        }
        identLock.t = tSec;
        identLock.dir = frame.dir;
        const byLane = new Map(slots.map((s) => [s.lane, s]));
        return {
            t: frame.t,
            dir: frame.dir,
            boats: frame.boats.map((row) => {
                const s = byLane.get(Number(row[0]));
                if (!s) return row;
                return [row[0], Math.round(s.x), Math.round(s.y), s.chain, s.speed];
            }),
        };
    }

    function drawRows() {
        return (data?.draw || []).map((d, i) => ({
            lane: Number(d.lane),
            code: d.code,
            label: d.label || d.code,
            shortLabel: String(d.code || '').toUpperCase(),
            slot: i,
        }));
    }

    function raceSnapshot(tSec) {
        if (!data) return null;
        const t = tSec == null ? timeSec() : tSec;
        const frame = stabilizeFrame(frameAt(t), t);
        const draw = drawRows();
        const byLane = new Map(draw.map((d) => [d.lane, d]));
        const boats = (frame?.boats || []).map((row, i) => {
            const lane = Number(row[0]);
            const meta = byLane.get(lane) || draw[i] || { lane, code: `L${lane}`, slot: i };
            return {
                lane,
                slot: meta.slot ?? i,
                code: meta.code,
                label: meta.label,
                name: meta.label,
                shortLabel: meta.shortLabel,
                chainage_m: Number(row[3]) || 0,
                speed_mps: Number(row[4]) || 0,
                speed_kmh: (Number(row[4]) || 0) * 3.6,
                detected: true,
                in_view: true,
                cv_status: 'green',
                locked: true,
                x: Number(row[1]) || 0,
                y: Number(row[2]) || 0,
                track_id: i + 1,
            };
        });
        const ranked = [...boats].sort((a, b) => b.chainage_m - a.chainage_m);
        const leader = ranked[0];
        const elapsed = Math.round(t * 1000);
        return {
            ok: true,
            sim: false,
            source: 'clip',
            clipId: data.id,
            streamId: data.id,
            event: data.event,
            eventType: data.eventType || data.event,
            race: data.race || 'Heat',
            raceNum: data.raceNum || 1,
            venue: data.venue || 'karapiro',
            race_phase: 'racing',
            leader_chainage_m: Math.round(leader?.chainage_m || 0),
            leader_slot: leader?.slot ?? 0,
            lane_count: 8,
            occupied_lanes: boats.map((b) => b.lane),
            draw_lanes: draw,
            boats,
            clock: { elapsed_ms: elapsed, loop_ms: Math.round((data.duration || 1) * 1000) },
            pose_age_ms: 40,
            stale: false,
            frame_w: data.refW || OUT_W,
            frame_h: data.refH || OUT_H,
            boat_direction: frame?.dir || 'away',
        };
    }

    function positionSnapshot(tSec) {
        const race = raceSnapshot(tSec);
        if (!race) return null;
        const ranked = [...(race.boats || [])].sort((a, b) => b.chainage_m - a.chainage_m);
        const leader = ranked[0] || { x: 960, y: 540 };
        return {
            streamId: race.streamId,
            x: Math.round(leader.x),
            y: Math.round(leader.y),
            frame: Math.round(timeSec() * (data.fps || 5)),
            auto: 1,
            venue: race.venue,
            boat_direction: race.boat_direction,
            refW: data.refW || OUT_W,
            refH: data.refH || OUT_H,
            boats: (race.boats || []).map((b) => ({
                slot: b.slot + 1,
                x: Math.round(b.x),
                y: Math.round(b.y),
                laneCoord: Math.round(b.y),
                conf: 0.9,
            })),
            race_boat_count: race.boats.length,
            updatedAt: Date.now(),
            stale: false,
        };
    }

    function patchFetchPosition() {
        const cv = global.AltitudeHdCvOverlay;
        if (!cv || cv._clipPatched) return;
        const orig = cv.fetchPosition;
        cv.fetchPosition = async function clipFetchPosition(forStreamId) {
            if (active()) return positionSnapshot();
            return orig.call(cv, forStreamId);
        };
        cv._clipPatched = true;
    }

    function stillGraphicRequested() {
        const g = (params().get('g') || '').toLowerCase();
        return g === 'cvstart' || g === 'i' || g === 'startlist';
    }

    function setStillMode(on) {
        const enabled = Boolean(on);
        document.body.classList.toggle('cv-clip-still', enabled);
        const vid = document.getElementById('cvClipVideo');
        if (!vid) return;
        if (enabled) {
            vid.pause();
        } else if (document.visibilityState === 'visible') {
            const p = vid.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        }
    }

    function mountVideo() {
        const bg = document.getElementById('vgBg');
        if (!bg || !data) return null;
        let el = document.getElementById('cvClipVideo');
        if (!el) {
            el = document.createElement('video');
            el.id = 'cvClipVideo';
            el.className = 'cv-clip-video';
            el.muted = true;
            el.loop = true;
            el.playsInline = true;
            el.autoplay = true;
            el.setAttribute('aria-hidden', 'true');
            bg.appendChild(el);
        }
        bg.classList.add('vg-bg--clip-loop', 'vg-bg--visible');
        document.body.classList.add('cv-clip-replay');
        el.src = data.video;
        const play = () => {
            const p = el.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        };
        el.addEventListener('canplay', play, { once: true });
        el.addEventListener('pause', () => {
            if (document.body.classList.contains('cv-clip-still')) return;
            if (document.visibilityState === 'visible') play();
        });
        play();
        setStillMode(stillGraphicRequested());
        return el;
    }

    async function load() {
        const id = requestedClip();
        if (!id) return null;
        if (loadPromise && clipId === id) return loadPromise;
        clipId = id;
        loadPromise = (async () => {
            const res = await fetch(`data/cv-demo/${encodeURIComponent(id)}.json`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`CV clip ${id} not found`);
            data = await res.json();
            identLock = null;
            video = mountVideo();
            patchFetchPosition();
            ready = true;
            return data;
        })().catch((err) => {
            console.warn(err);
            data = null;
            ready = false;
            return null;
        });
        return loadPromise;
    }

    function init() {
        if (!requestedClip()) return;
        load();
        patchFetchPosition();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.CvClipReplay = {
        requestedClip,
        active,
        ready: () => ready,
        load,
        timeSec,
        raceSnapshot,
        positionSnapshot,
        video: () => video,
        data: () => data,
        setStillMode,
    };
})(window);
