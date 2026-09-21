/**
 * Bake a looping CV timeline from an overhead race clip (no YOLO).
 * Detects bright elongated hulls, tracks them, and writes public/data/cv-demo/<id>.json.
 *
 *   node scripts/export-cv-clip.mjs --id nzuu26
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function arg(name, fallback) {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
}

const CLIP_ID = arg('id', 'nzuu26');
const VIDEO = arg('video', join(ROOT, 'public', 'assets', 'cv-demo', `${CLIP_ID}.mp4`));
const OUT_JSON = arg('out', join(ROOT, 'public', 'data', 'cv-demo', `${CLIP_ID}.json`));
const DEBUG_DIR = join(ROOT, 'probe-out', CLIP_ID);
const DW = 640;
const DH = 360;
const FPS = 5;
const REF_W = 1920;
const REF_H = 1080;
const SX = REF_W / DW;
const SY = REF_H / DH;
const EIGHT_M = 17.5;
const TARGET_BOATS = 3;
const DRAW = [
    { lane: 3, code: 'aubc', label: 'Auckland University Boat Club' },
    { lane: 4, code: 'canu', label: 'Canterbury University' },
    { lane: 5, code: 'otau', label: 'Otago University' },
];

function ffmpegFrames() {
    return new Promise((resolve, reject) => {
        const ff = spawn(
            'ffmpeg',
            [
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                VIDEO,
                '-an',
                '-vf',
                `fps=${FPS},scale=${DW}:${DH}:flags=bilinear`,
                '-f',
                'rawvideo',
                '-pix_fmt',
                'rgb24',
                'pipe:1',
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const frames = [];
        const stride = DW * DH * 3;
        let buf = Buffer.alloc(0);
        let err = '';
        ff.stderr.on('data', (c) => {
            err += c.toString();
        });
        ff.stdout.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            while (buf.length >= stride) {
                frames.push(Buffer.from(buf.subarray(0, stride)));
                buf = buf.subarray(stride);
            }
        });
        ff.on('error', reject);
        ff.on('close', (code) => {
            if (code !== 0) reject(new Error(err || `ffmpeg exit ${code}`));
            else resolve(frames);
        });
    });
}

function maskFrame(rgb, opts = {}) {
    const vis = new Uint8Array(DW * DH);
    const minY = opts.minY ?? 0;
    const maxY = opts.maxY ?? DH;
    const minYv = opts.minYv ?? 158;
    const minR = opts.minR ?? 128;
    for (let i = 0; i < DW * DH; i++) {
        const o = i * 3;
        const r = rgb[o];
        const g = rgb[o + 1];
        const b = rgb[o + 2];
        const x = i % DW;
        const y = (i / DW) | 0;
        if (y < minY || y > maxY) continue;
        if (x < 96 && y < 32) continue;
        if (g > r + 18 && g > b + 12) continue;
        const yv = (r * 3 + g + b) >> 2;
        if (yv < minYv || r < minR) continue;
        if (r - b > 55 && r - g > 40) continue;
        vis[i] = 1;
    }
    const dil = new Uint8Array(DW * DH);
    for (let y = 1; y < DH - 1; y++) {
        for (let x = 1; x < DW - 1; x++) {
            let n = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    n += vis[(y + dy) * DW + (x + dx)];
                }
            }
            dil[y * DW + x] = n >= 3 ? 1 : 0;
        }
    }
    return dil;
}

function components(mask, opts = {}) {
    const seen = new Uint8Array(DW * DH);
    const blobs = [];
    const qx = new Int32Array(DW * DH);
    const qy = new Int32Array(DW * DH);
    for (let y = 0; y < DH; y++) {
        for (let x = 0; x < DW; x++) {
            const s = y * DW + x;
            if (!mask[s] || seen[s]) continue;
            let qh = 0;
            let qt = 0;
            qx[qt] = x;
            qy[qt] = y;
            qt++;
            seen[s] = 1;
            let minX = x;
            let maxX = x;
            let minY = y;
            let maxY = y;
            let sumX = 0;
            let sumY = 0;
            let area = 0;
            while (qh < qt) {
                const cx = qx[qh];
                const cy = qy[qh];
                qh++;
                area++;
                sumX += cx;
                sumY += cy;
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;
                for (const [dx, dy] of [
                    [1, 0],
                    [-1, 0],
                    [0, 1],
                    [0, -1],
                ]) {
                    const nx = cx + dx;
                    const ny = cy + dy;
                    if (nx < 0 || ny < 0 || nx >= DW || ny >= DH) continue;
                    const ni = ny * DW + nx;
                    if (!mask[ni] || seen[ni]) continue;
                    seen[ni] = 1;
                    qx[qt] = nx;
                    qy[qt] = ny;
                    qt++;
                }
            }
            const w = maxX - minX + 1;
            const h = maxY - minY + 1;
            const long = Math.max(w, h);
            const short = Math.max(1, Math.min(w, h));
            const aspect = long / short;
            const minArea = opts.minArea ?? 55;
            const maxArea = opts.maxArea ?? 2800;
            const minLong = opts.minLong ?? 18;
            if (area < minArea || area > maxArea) continue;
            if (long < minLong) continue;
            if (opts.requireHorizontal && w < h * 0.9) continue;
            if (aspect < 1.35 && area < 220) continue;
            blobs.push({
                x: sumX / area,
                y: sumY / area,
                w,
                h,
                area,
                aspect,
                long,
            });
        }
    }
    blobs.sort((a, b) => b.area * Math.min(b.aspect, 4) - a.area * Math.min(a.aspect, 4));
    return blobs.slice(0, 6);
}

function pickBoats(blobs, opts = {}) {
    if (blobs.length <= TARGET_BOATS) return blobs;
    const ranked = [...blobs].sort((a, b) => {
        const ae = a.aspect * Math.sqrt(a.area);
        const be = b.aspect * Math.sqrt(b.area);
        const ap = opts.requireHorizontal && a.w >= a.h ? 1.25 : 1;
        const bp = opts.requireHorizontal && b.w >= b.h ? 1.25 : 1;
        return be * bp - ae * ap;
    });
    return ranked.slice(0, TARGET_BOATS).filter((b, i, arr) => {
        if (i < 2) return true;
        const score = (x) => x.aspect * Math.sqrt(x.area);
        return score(b) >= score(arr[1]) * 0.38 || score(b) >= score(arr[0]) * 0.28;
    });
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
            const rms = fit.rms + (slots.length - k) * 10;
            if (!best || rms < best.rms) {
                best = {
                    rms,
                    ang: fit.ang,
                    sc,
                    dc,
                    pairs: sComb.map((pi, n) => ({ pi, di: dUse[n], cost: fit.rms })),
                };
            }
        }
    }
    return best;
}

function viewHint(boats, current = 'away') {
    if (!boats || boats.length < 2) return current;
    const xs = boats.map((b) => b.x);
    const ys = boats.map((b) => b.y);
    const xr = Math.max(...xs) - Math.min(...xs);
    const yr = Math.max(...ys) - Math.min(...ys);
    const meanWH =
        boats.reduce((s, b) => s + (Number(b.w) || 1) / Math.max(1, Number(b.h) || 1), 0) / boats.length;
    const stacked = yr < 36 && xr > 48;
    const flatSide = yr < xr * 0.22 && xr > 80 && meanWH > 1.15;
    if (stacked || flatSide) return 'right';
    if (yr > 90 && yr > xr * 0.5) return 'away';
    return current;
}

function updateDir(state, hint) {
    if (hint === state.dir) {
        state.pending = null;
        state.n = 0;
        return state.dir;
    }
    if (state.pending !== hint) {
        state.pending = hint;
        state.n = 1;
        return state.dir;
    }
    state.n += 1;
    const need = hint === 'right' ? 10 : 20;
    if (state.n >= need) {
        state.dir = hint;
        state.pending = null;
        state.n = 0;
    }
    return state.dir;
}

function assignSlots(slots, dets, dt, transitioning) {
    for (const s of slots) {
        s.px = s.x + (s.vx || 0) * dt;
        s.py = s.y + (s.vy || 0) * dt;
    }
    const preds = slots.map((s) => ({ x: s.px, y: s.py }));
    const nearby = dets.length <= 4
        ? dets
        : dets
              .map((d) => ({
                  d,
                  c: Math.min(...preds.map((p) => Math.hypot(d.x - p.x, d.y - p.y))),
              }))
              .sort((a, b) => a.c - b.c)
              .slice(0, 4)
              .map((s) => s.d);
    if (!nearby.length) {
        for (const s of slots) {
            s.miss += 1;
            s.vx = (s.vx || 0) * 0.7;
            s.vy = (s.vy || 0) * 0.7;
        }
        return 0;
    }
    const fit = bestRigidAssign(preds, nearby);
    const rmsNeed = transitioning ? 62 : 38;
    const maxMiss = Math.max(0, ...slots.map((s) => s.miss || 0));
    const acceptFit = fit && nearby.length && (fit.rms <= rmsNeed || (transitioning && maxMiss >= 8));
    if (!acceptFit) {
        const sc = centroid(preds);
        const dc = nearby.length ? centroid(nearby) : sc;
        const cdx = dc.x - sc.x;
        const cdy = dc.y - sc.y;
        const motion = Math.hypot(cdx, cdy);
        for (const s of slots) {
            if (nearby.length && motion < 140) {
                s.x += cdx;
                s.y += cdy;
            } else {
                s.x += (s.vx || 0) * dt;
                s.y += (s.vy || 0) * dt;
            }
            s.vx = (s.vx || 0) * 0.82;
            s.vy = (s.vy || 0) * 0.82;
            s.miss += 1;
            s.x = Math.max(24, Math.min(DW - 24, s.x));
            s.y = Math.max(20, Math.min(DH - 20, s.y));
        }
        return motion;
    }
    const used = new Set();
    for (const { pi, di } of fit.pairs) {
        const s = slots[pi];
        const d = nearby[di];
        used.add(pi);
        const vx = (d.x - s.x) / Math.max(dt, 0.05);
        const vy = (d.y - s.y) / Math.max(dt, 0.05);
        s.vx = (s.vx || 0) * 0.35 + vx * 0.65;
        s.vy = (s.vy || 0) * 0.35 + vy * 0.65;
        s.x = d.x;
        s.y = d.y;
        s.w = d.w;
        s.h = d.h;
        s.long = d.long;
        s.miss = 0;
    }
    for (let i = 0; i < slots.length; i++) {
        if (used.has(i)) continue;
        const s = slots[i];
        s.miss += 1;
        s.x += (s.vx || 0) * dt + (fit.dc.x - fit.sc.x);
        s.y += (s.vy || 0) * dt + (fit.dc.y - fit.sc.y);
        s.vx = (s.vx || 0) * 0.82;
        s.vy = (s.vy || 0) * 0.82;
        s.x = Math.max(24, Math.min(DW - 24, s.x));
        s.y = Math.max(20, Math.min(DH - 20, s.y));
    }
    return Math.hypot(fit.dc.x - fit.sc.x, fit.dc.y - fit.sc.y);
}

function alongOf(b, dir) {
    return dir === 'right' ? b.x : -b.y;
}

function writePpm(path, rgb, boats) {
    const out = Buffer.from(rgb);
    for (const b of boats) {
        const x0 = Math.max(0, Math.round(b.x - b.w / 2));
        const y0 = Math.max(0, Math.round(b.y - b.h / 2));
        const x1 = Math.min(DW - 1, x0 + b.w);
        const y1 = Math.min(DH - 1, y0 + b.h);
        for (let x = x0; x <= x1; x++) {
            for (const y of [y0, y1]) {
                const o = (y * DW + x) * 3;
                out[o] = 255;
                out[o + 1] = 40;
                out[o + 2] = 40;
            }
        }
        for (let y = y0; y <= y1; y++) {
            for (const x of [x0, x1]) {
                const o = (y * DW + x) * 3;
                out[o] = 255;
                out[o + 1] = 40;
                out[o + 2] = 40;
            }
        }
    }
    writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${DW} ${DH}\n255\n`), out]));
}

function detectOpts(side, slots) {
    if (!side) return {};
    const live = (slots || []).filter((s) => (s.miss || 0) < 4 && s.y > 24 && s.y < DH - 24);
    const ys = live.map((s) => s.y);
    let minY = Math.round(DH * 0.3);
    let maxY = Math.round(DH * 0.68);
    if (ys.length >= 2) {
        const midY = ys.reduce((a, b) => a + b, 0) / ys.length;
        const tightMin = Math.max(minY, Math.round(midY - 80));
        const tightMax = Math.min(maxY, Math.round(midY + 80));
        if (tightMax - tightMin >= 40) {
            minY = tightMin;
            maxY = tightMax;
        }
    }
    return {
        minY,
        maxY,
        minYv: 124,
        minR: 96,
        minArea: 18,
        maxArea: 1100,
        minLong: 9,
        requireHorizontal: true,
    };
}

function detectBoats(rgb, opts) {
    return pickBoats(components(maskFrame(rgb, opts), opts), opts);
}

const framesRgb = await ffmpegFrames();
if (!framesRgb.length) throw new Error('no frames decoded');
const duration = framesRgb.length / FPS;
const debugAt = new Set([5, 40, 80, 100, 110, 120, 124].map((s) => Math.min(framesRgb.length - 1, Math.round(s * FPS))));

mkdirSync(DEBUG_DIR, { recursive: true });

let slots = null;
const dirState = { dir: 'away', pending: null, n: 0 };
const byLane = new Map(DRAW.map((d) => [d.lane, []]));
let prevDir = 'away';
const counts = {};

for (let i = 0; i < framesRgb.length; i++) {
    const t = i / FPS;
    const dt = i ? 1 / FPS : 1 / FPS;
    const overhead = detectBoats(framesRgb[i], {});
    const water = detectBoats(framesRgb[i], detectOpts(true, null));
    const waterRace = water.length >= TARGET_BOATS;
    let blobs = overhead;
    if (dirState.dir === 'right' && water.length >= 2) blobs = water;
    counts[blobs.length] = (counts[blobs.length] || 0) + 1;
    if (!slots && t <= 8 && blobs.length >= TARGET_BOATS) {
        const sorted = [...blobs].sort((a, b) => a.x - b.x);
        slots = DRAW.map((d, n) => ({
            lane: d.lane,
            x: sorted[n].x,
            y: sorted[n].y,
            vx: 0,
            vy: 0,
            w: sorted[n].w,
            h: sorted[n].h,
            long: sorted[n].long,
            miss: 0,
            chain: 1120,
        }));
    }
    if (!slots) continue;
    const hint =
        waterRace && t >= 98
            ? 'right'
            : viewHint(overhead.length >= 2 ? overhead : slots, dirState.dir);
    const dir = updateDir(dirState, hint);
    const transitioning = Boolean(dirState.pending) || dir !== prevDir;
    assignSlots(slots, blobs, dt, transitioning);
    if (debugAt.has(i)) {
        writePpm(join(DEBUG_DIR, `det-${String(Math.round(t)).padStart(3, '0')}.ppm`), framesRgb[i], blobs);
    }
    const longs = slots.map((s) => s.long || 28).sort((a, c) => a - c);
    const medLong = longs[Math.floor(longs.length / 2)] || 28;
    const mPerPx = EIGHT_M / Math.max(12, medLong);
    const alongs = slots.map((s) => alongOf(s, dir));
    const maxAlong = alongs.length ? Math.max(...alongs) : 0;
    const base = 1120 + t * 5.22;
    for (const s of slots) {
        let chain = Math.max(40, Math.min(2000, base - (maxAlong - alongOf(s, dir)) * mPerPx * SX));
        if (transitioning || dir !== prevDir) {
            chain = Math.max(40, Math.min(2000, s.chain + 5.22 * dt));
        }
        s.chain = chain;
        byLane.get(s.lane).push({
            t,
            x: Math.round(s.x * SX),
            y: Math.round(s.y * SY),
            chainage_m: chain,
            speed_mps: 5.22,
            dir,
            miss: s.miss,
        });
    }
    prevDir = dir;
}

if (!slots) throw new Error('could not lock starting lanes from overhead detections');

function median(arr) {
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)] || 0;
}

function smoothAllLanes(laneMap) {
    const series = DRAW.map((d) => laneMap.get(d.lane));
    const n = Math.min(...series.map((s) => s.length));
    for (let i = 1; i < n; i++) {
        const steps = series.map((s) => Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y));
        const med = median(steps);
        for (let li = 0; li < series.length; li++) {
            const cur = series[li][i];
            const prev = series[li][i - 1];
            if (cur.dir !== prev.dir) continue;
            if ((cur.miss || 0) > 2 || (steps[li] > med + 110 && steps[li] > 90)) {
                cur.x = prev.x;
                cur.y = prev.y;
            }
        }
    }
}

function smoothLane(samples) {
    if (samples.length < 3) return samples;
    const out = samples.map((s) => ({ ...s }));
    for (let i = 1; i < out.length; i++) {
        const tau = out[i].dir !== out[i - 1].dir ? 0.78 : 0.55;
        out[i].chainage_m = out[i - 1].chainage_m * 0.72 + out[i].chainage_m * 0.28;
        out[i].x = Math.round(out[i - 1].x * tau + out[i].x * (1 - tau));
        out[i].y = Math.round(out[i - 1].y * tau + out[i].y * (1 - tau));
        const dt = Math.max(0.05, out[i].t - out[i - 1].t);
        const rawSp = (out[i].chainage_m - out[i - 1].chainage_m) / dt;
        out[i].speed_mps = Math.max(3.6, Math.min(6.4, rawSp));
        if (out[i].chainage_m < out[i - 1].chainage_m) {
            out[i].chainage_m = out[i - 1].chainage_m + out[i].speed_mps * dt * 0.15;
        }
    }
    return out;
}

smoothAllLanes(byLane);
const lanes = {};
for (const [lane, samples] of byLane) {
    lanes[String(lane)] = smoothLane(samples);
}

const times = new Set();
for (const samples of Object.values(lanes)) {
    for (const s of samples) times.add(Number(s.t.toFixed(2)));
}
const ticks = [...times].sort((a, b) => a - b);

function atTime(samples, t) {
    if (!samples.length) return null;
    if (t <= samples[0].t) return samples[0];
    if (t >= samples[samples.length - 1].t) return samples[samples.length - 1];
    for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];
        if (t <= b.t) {
            const u = (t - a.t) / Math.max(0.001, b.t - a.t);
            return {
                t,
                x: Math.round(a.x + (b.x - a.x) * u),
                y: Math.round(a.y + (b.y - a.y) * u),
                chainage_m: a.chainage_m + (b.chainage_m - a.chainage_m) * u,
                speed_mps: a.speed_mps + (b.speed_mps - a.speed_mps) * u,
                dir: a.dir === b.dir ? a.dir : u < 0.5 ? a.dir : b.dir,
            };
        }
    }
    return samples[samples.length - 1];
}

const packed = [];
for (const t of ticks) {
    const boats = [];
    let dir = 'away';
    for (const d of DRAW) {
        const s = atTime(lanes[String(d.lane)] || [], t);
        if (!s) continue;
        dir = s.dir || dir;
        boats.push([
            d.lane,
            s.x,
            s.y,
            Math.round(s.chainage_m * 10) / 10,
            Math.round(s.speed_mps * 100) / 100,
        ]);
    }
    if (boats.length) packed.push({ t: Math.round(t * 100) / 100, dir, boats });
}

const payload = {
    id: CLIP_ID,
    video: `assets/cv-demo/${CLIP_ID}.mp4`,
    duration: Math.round(duration * 100) / 100,
    fps: FPS,
    refW: REF_W,
    refH: REF_H,
    venue: 'karapiro',
    event: 'U 8+',
    eventType: 'U 8+',
    race: 'Heat',
    raceNum: 1,
    draw: DRAW,
    frames: packed,
};

mkdirSync(dirname(OUT_JSON), { recursive: true });
writeFileSync(OUT_JSON, JSON.stringify(payload));
console.log(
    JSON.stringify(
        {
            framesIn: framesRgb.length,
            framesOut: packed.length,
            duration,
            counts,
            lastT: packed[packed.length - 1]?.t,
            json: OUT_JSON,
            bytes: Buffer.byteLength(JSON.stringify(payload)),
        },
        null,
        2,
    ),
);
