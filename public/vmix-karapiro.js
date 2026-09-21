/**
 * Karāpiro / Ged overlay renderers — RowIT data, Ged layouts.
 * Loaded after vmix-graphics.js on vmix-karapiro.html only.
 */
(function () {
    const cutoutCache = new Map();
    const cutoutInflight = new Map();
    const TRANSPARENT_PX =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const FIRST_NAMES = [
        'Tom', 'Sam', 'Jack', 'Liam', 'Ollie', 'Finn', 'George', 'Harry', 'Ben', 'Max',
        'Kahu', 'Nikau', 'Josh', 'Luke', 'Ella', 'Sophie', 'Grace', 'Ruby', 'Amelia', 'Zoe',
        'Aroha', 'Maia', 'Isla', 'Charlotte', 'Hannah', 'Lucy',
    ];
    const LAST_NAMES = [
        'Walker', 'Thompson', 'Kirk', 'Ngata', 'Harris', 'Bennett', 'Clarke', 'Murray',
        'Parata', 'Wilson', "MacDonald", "O'Brien", 'Stewart', 'Rangi', 'Hughes', 'Campbell',
        'Drysdale', 'Twigg', 'Bond', 'Sullivan', 'Mackintosh', 'Henare',
    ];
    const OWN = {
        title: 1, lower: 1, draw: 1, results: 1, schedule: 1, leader: 1,
        drill: 1, suits: 1, suitstrip: 1, lowersuits: 1, brand: 1,
        next: 1, prev: 1, tracker: 1, speed: 1, speedchart: 1,
        livetracking: 1, livetrack: 1,
        cvleader: 1, cvdraw: 1, coursescroll: 1, course: 1,
        cvcourse: 1, cvsplits: 1, splits: 1,
        cvstart: 1, startlist: 1,
        cvpositions: 1, positions: 1,
        cvfollow: 1, cvboattags: 1,
    };
    const CANON = {
        speed: 'speedchart',
        livetrack: 'livetracking',
        course: 'cvcourse',
        coursescroll: 'cvcourse',
        splits: 'cvsplits',
        startlist: 'cvstart',
        positions: 'cvpositions',
    };
    const GED_KEYS = {
        '1': 'title', '2': 'lower', '3': 'draw', '4': 'results', '5': 'leader',
        '6': 'cvleader', '7': 'cvdraw', '8': 'cvcourse', '9': 'schedule',
        '0': 'tracker', q: 'speedchart', w: 'livetracking', e: 'weather',
        y: 'cvsplits', i: 'cvstart', j: 'cvpositions',
        x: 'cvfollow', h: 'cvboattags',
        s: 'suits', a: 'suitstrip', f: 'lowersuits', b: 'brand',
    };
    const LAYER_CLASS = {
        title: 'vg-layer--title',
        lower: 'vg-layer--lower',
        draw: 'vg-layer--draw',
        results: 'vg-layer--results',
        schedule: 'vg-layer--schedule',
        leader: 'vg-layer--leader',
        drill: 'vg-layer--drill',
        suits: 'vg-layer--suits',
        suitstrip: 'vg-layer--suitstrip',
        lowersuits: 'vg-layer--lowersuits',
        brand: 'vg-layer--brand',
        next: 'vg-layer--next',
        prev: 'vg-layer--prev',
        tracker: 'vg-layer--tracker',
        speedchart: 'vg-layer--speedchart',
        livetracking: 'vg-layer--livetracking',
        weather: 'vg-layer--weather',
        cvleader: 'vg-layer--cvleader',
        cvdraw: 'vg-layer--cvdraw',
        coursescroll: 'vg-layer--cvcourse',
        cvcourse: 'vg-layer--cvcourse',
        cvsplits: 'vg-layer--cvsplits',
        cvstart: 'vg-layer--cvstart',
        cvpositions: 'vg-layer--cvpositions',
        cvfollow: 'vg-layer--cvfollow',
        cvboattags: 'vg-layer--cvboattags',
    };
    const OPS = [
        ['1', 'Title', 'title'],
        ['2', 'Lower 3rd', 'lower'],
        ['D', 'Drill-down', 'drill'],
        ['S', 'Rowsuits', 'suits'],
        ['A', 'Suit strip', 'suitstrip'],
        ['F', 'L3 + suits', 'lowersuits'],
        ['3', 'Draw', 'draw'],
        ['4', 'Results', 'results'],
        ['5', 'Leader', 'leader'],
        ['6', 'CV leader', 'cvleader'],
        ['X', 'CV follow', 'cvfollow'],
        ['H', 'CV boat tags', 'cvboattags'],
        ['7', 'CV draw', 'cvdraw'],
        ['8', 'CV course', 'cvcourse'],
        ['Y', 'CV splits', 'cvsplits'],
        ['I', 'CV start list', 'cvstart'],
        ['J', 'CV positions', 'cvpositions'],
        ['9', 'Schedule', 'schedule'],
        ['0', 'Tracker', 'tracker'],
        ['Q', 'Speed', 'speedchart'],
        ['W', 'Live track', 'livetracking'],
        ['E', 'Weather', 'weather'],
        ['N', 'Next', 'next'],
        ['P', 'Prev', 'prev'],
        ['B', 'Brand', 'brand'],
    ];

    const RECORD_FILES = [
        'data/karapiro-premier-fastest.csv',
        'data/karapiro-u18-fastest.csv',
    ];

    const START_TAG_LIFT_PX = 200;
    const CV_BOX_PX = 96;
    const CV_BOX_HALF = CV_BOX_PX / 2;
    const CV_TAG_GAP_PX = 10;
    const START_STILL_SRC = 'assets/vmix/karapiro-start.png?v=2';
    const START_STILL_XY = {
        1: { x: 240, y: 450 },
        2: { x: 446, y: 450 },
        3: { x: 664, y: 450 },
        4: { x: 863, y: 450 },
        5: { x: 1069, y: 450 },
        6: { x: 1275, y: 450 },
        7: { x: 1476, y: 450 },
        8: { x: 1676, y: 450 },
    };

    function isLiveVmix() {
        return new URLSearchParams(location.search).get('live') === '1';
    }

    /** Start list always uses the pontoon still in preview. On-air (`live=1`) stays over camera. */
    function startStillTestSrc() {
        if (isLiveVmix()) return '';
        const g = canon(vgPlayback.graphic);
        if (g === 'cvstart') return START_STILL_SRC;
        if (isLiveCvFeed()) return '';
        return String(state.cvRace?.start_image || START_STILL_SRC).trim();
    }

    function syncClipBackground(g) {
        window.CvClipReplay?.setStillMode?.(canon(g || vgPlayback.graphic) === 'cvstart');
    }

    function startStillLaneXy(lane) {
        const lineup = state.cvRace?.start_lineup?.lanes?.[String(lane)];
        if (lineup && Number.isFinite(Number(lineup.x))) {
            return { x: Number(lineup.x), y: Number(lineup.y) };
        }
        return START_STILL_XY[Number(lane)] || null;
    }

    function cvFrameSize() {
        const snap = state.cvRace;
        return {
            fw: Math.max(1, Number(snap?.frame_w) || 1920),
            fh: Math.max(1, Number(snap?.frame_h) || 1080),
        };
    }

    function boatDirection() {
        const d = String(state.cvRace?.boat_direction || '').toLowerCase();
        const next = d === 'right' || d === 'left' ? d : 'away';
        const hold = state.dirHold;
        if (!hold.dir) hold.dir = next;
        if (next === hold.dir) {
            hold.since = 0;
            return hold.dir;
        }
        const now = performance.now();
        if (!hold.since) hold.since = now;
        if (now - hold.since >= 900) {
            hold.dir = next;
            hold.since = 0;
        }
        return hold.dir;
    }

    function boatScreenXy(src) {
        const x = Number(src?.x);
        const y = Number(src?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (x <= 0 && y <= 0) return null;
        const { fw, fh } = cvFrameSize();
        return { x: (x / fw) * 1920, y: (y / fh) * 1080 };
    }

    function cvBoatRaw(lane) {
        return (state.cvRace?.boats || []).find((b) => Number(b.lane) === Number(lane)) || null;
    }

    function emaPoint(prev, x, y, now, tauMs) {
        if (!prev) return { x, y, t: now };
        const dt = Math.max(8, Math.min(48, now - (prev.t || now)));
        const a = 1 - Math.exp(-dt / Math.max(80, tauMs));
        return {
            x: prev.x + (x - prev.x) * a,
            y: prev.y + (y - prev.y) * a,
            t: now,
        };
    }

    function pullClipRace() {
        if (!window.CvClipReplay?.active()) return false;
        const snap = window.CvClipReplay.raceSnapshot();
        if (!snap) return false;
        const prevMs = Number(state.cvRace?.clock?.elapsed_ms);
        const nextMs = Number(snap.clock?.elapsed_ms);
        if (
            Number.isFinite(prevMs) &&
            Number.isFinite(nextMs) &&
            (nextMs + 600 < prevMs || nextMs > prevMs + 1500)
        ) {
            state.boatSmooth.clear();
            state.boatTel.clear();
            state.speedHist.clear();
            state.followPos = null;
            state.followBoat = null;
            state.leadLane = null;
            state.viewBlend = null;
            state.dirHold = { dir: 'away', since: 0 };
        }
        state.cvSource = 'clip';
        state.cvRace = snap;
        mixAllTelemetry();
        return true;
    }

    function smoothCvScreen() {
        const now = performance.now();
        const raw = [];
        for (const b of state.cvRace?.boats || []) {
            const xy = boatScreenXy(b);
            if (!xy) continue;
            raw.push({ lane: Number(b.lane), x: xy.x, y: xy.y });
        }
        const stepOf = (r) => {
            const prev = state.boatSmooth.get(r.lane);
            if (!prev) return 0;
            return Math.hypot(r.x - prev.x, r.y - prev.y);
        };
        const tracked = raw.filter((r) => state.boatSmooth.has(r.lane));
        const cam = tracked.length
            ? Math.min(...tracked.map(stepOf))
            : 0;
        for (const r of raw) {
            const prev = state.boatSmooth.get(r.lane);
            if (!prev) {
                state.boatSmooth.set(r.lane, {
                    x: r.x,
                    y: r.y,
                    rawX: r.x,
                    rawY: r.y,
                    t: now,
                    rejectSince: 0,
                });
                continue;
            }
            const step = stepOf(r);
            const isOutlier = step > Math.max(80, cam + 70);
            let tx = r.x;
            let ty = r.y;
            let rawX = r.x;
            let rawY = r.y;
            let rejectSince = 0;
            if (isOutlier) {
                const since = prev.rejectSince || now;
                if (now - since < 550) {
                    tx = prev.x;
                    ty = prev.y;
                    rawX = prev.rawX;
                    rawY = prev.rawY;
                    rejectSince = since;
                }
            }
            const next = emaPoint(prev, tx, ty, now, isOutlier ? 420 : 300);
            state.boatSmooth.set(r.lane, { ...next, rawX, rawY, rejectSince });
        }
    }

    function boatScreenSmoothed(lane) {
        const s = state.boatSmooth.get(Number(lane));
        if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) return { x: s.x, y: s.y };
        return boatScreenXy(cvBoatRaw(lane));
    }

    function cvBoxesOn() {
        return new URLSearchParams(location.search).get('boxes') === '1';
    }

    function paintCvDebugBoxes() {
        if (!cvBoxesOn()) {
            document.getElementById('kpCvBoxes')?.remove();
            return;
        }
        let layer = document.getElementById('kpCvBoxes');
        if (!layer) {
            layer = el('div', 'kp-cvboxes');
            layer.id = 'kpCvBoxes';
            document.querySelector('.vg-stage')?.appendChild(layer);
        }
        const g = canon(vgPlayback.graphic);
        const pts = [];
        if (g === 'cvstart' && startStillTestSrc()) {
            boatsNow(currentRace()).forEach((club) => {
                const xy = startStillLaneXy(club.lane);
                if (xy) pts.push({ lane: club.lane, x: xy.x, y: xy.y, lift: true });
            });
        } else {
            (state.cvRace?.boats || []).forEach((b) => {
                const xy = boatScreenSmoothed(b.lane);
                if (xy) pts.push({ lane: b.lane, x: xy.x, y: xy.y, lift: false });
            });
        }
        const sig = pts.map((p) => `${p.lane}:${p.x.toFixed(0)},${p.y.toFixed(0)},${p.lift ? 1 : 0}`).join('|');
        if (layer.dataset.sig === sig) return;
        layer.dataset.sig = sig;
        layer.replaceChildren();
        pts.forEach((p) => {
            const box = el('div', 'kp-cvbox');
            box.style.left = `${p.x.toFixed(1)}px`;
            box.style.top = `${p.y.toFixed(1)}px`;
            box.appendChild(el('i', 'kp-cvbox-x'));
            box.appendChild(el('i', 'kp-cvbox-y'));
            box.appendChild(el('span', 'kp-cvbox-lab', `CV box L${p.lane}`));
            if (p.lift) {
                const lift = el('i', 'kp-cvbox-lift');
                lift.style.height = `${START_TAG_LIFT_PX}px`;
                box.appendChild(lift);
            }
            layer.appendChild(box);
        });
    }

    function mixAllTelemetry() {
        const now = performance.now();
        for (const b of state.cvRace?.boats || []) {
            const lane = Number(b.lane);
            const m = Number(b.chainage_m);
            const sp = Number(b.speed_mps);
            if (!Number.isFinite(lane)) continue;
            const prev = state.boatTel.get(lane);
            if (!prev) {
                state.boatTel.set(lane, {
                    m: Number.isFinite(m) ? m : 0,
                    sp: Number.isFinite(sp) ? sp : 0,
                    t: now,
                });
                continue;
            }
            const dt = Math.max(8, Math.min(48, now - (prev.t || now)));
            let tm = Number.isFinite(m) ? m : prev.m;
            let tsp = Number.isFinite(sp) ? sp : prev.sp;
            if (Number.isFinite(m) && Math.abs(m - prev.m) > 35) tm = prev.m;
            if (Number.isFinite(sp) && Math.abs(sp - prev.sp) > 1.15) tsp = prev.sp;
            const am = 1 - Math.exp(-dt / 420);
            const as = 1 - Math.exp(-dt / 580);
            state.boatTel.set(lane, {
                m: prev.m + (tm - prev.m) * am,
                sp: prev.sp + (tsp - prev.sp) * as,
                t: now,
            });
        }
    }

    function boatTel(lane) {
        return state.boatTel.get(Number(lane)) || null;
    }

    function mixFollow(px, py) {
        state.followPos = emaPoint(state.followPos, px, py, performance.now(), 280);
        return state.followPos;
    }

    function mixFollowBoat(xy) {
        if (!xy) return null;
        state.followBoat = emaPoint(state.followBoat, xy.x, xy.y, performance.now(), 220);
        return { x: state.followBoat.x, y: state.followBoat.y };
    }
    const LS_CV_URL = 'altitudeHdCvServerUrl_v1';
    const DEFAULT_CV = 'http://127.0.0.1:8790';
    const COURSE_M = 2000;

    const state = {
        t: 0,
        drillLane: null,
        brand: false,
        ctrlOpen: true,
        motionTimer: null,
        stringTimer: null,
        stringTok: 0,
        dHeld: false,
        dCombo: false,
        flakes: [],
        records: new Map(),
        recordsPromise: null,
        cvRace: null,
        cvPoll: 0,
        cvBusy: false,
        cvPhase: '',
        chHold: new Map(),
        speedHist: new Map(),
        simGraphicFp: '',
        cvSource: '',
        liveFailUntil: 0,
        followPos: null,
        followBoat: null,
        followSide: { left: false, down: false },
        boatSmooth: new Map(),
        boatTel: new Map(),
        leadLane: null,
        dirHold: { dir: 'away', since: 0 },
        viewBlend: null,
        cvPaintRaf: 0,
    };

    function el(tag, className, text) {
        return vgEl(tag, className, text);
    }

    function canon(g) {
        return CANON[g] || g;
    }

    function festive() {
        return vgKpFestive();
    }

    function bar(extra) {
        const b = el('div', `kp-bar${festive() ? ' kp-bar--festive' : ''}${extra ? ` ${extra}` : ''}`);
        return b;
    }

    function liveBadge() {
        const s = el('span', isLiveCvFeed() ? 'kp-live' : 'kp-live kp-live--sim');
        s.appendChild(el('span', 'kp-live-dot'));
        s.appendChild(document.createTextNode(isLiveCvFeed() ? 'Live CV' : 'Sim'));
        return s;
    }

    function cvFrameUrl(page, extra) {
        const origin = cvLaptopOrigin() || DEFAULT_CV;
        const u = new URL(page, location.href);
        u.searchParams.set('cvLaptop', origin);
        u.searchParams.set('live', '1');
        if (new URLSearchParams(location.search).get('sim') === '1') {
            u.searchParams.set('sim', '1');
        }
        if (extra && typeof extra === 'object') {
            Object.entries(extra).forEach(([k, v]) => {
                if (v == null || v === '') return;
                u.searchParams.set(k, String(v));
            });
        }
        const race = vgGetRaceParam?.();
        if (race) u.searchParams.set('race', String(race));
        return u.pathname + u.search;
    }

    function mountCvFrame(layer, page, className, extra) {
        const wrap = el('div', className || 'kp-cvframe');
        const frame = document.createElement('iframe');
        frame.className = 'kp-cvframe__iframe';
        frame.title = 'CV overlay';
        frame.setAttribute('allow', 'autoplay');
        frame.src = cvFrameUrl(page, extra);
        wrap.appendChild(frame);
        if (!cvOrigin()) {
            wrap.appendChild(
                el('p', 'kp-cvframe__warn', 'No CV laptop URL — set ?cvLaptop= or hub CV server'),
            );
        }
        layer.appendChild(wrap);
    }

    function chip(text, extra) {
        return el('span', extra ? `kp-chip ${extra}` : 'kp-chip', text);
    }

    function laneEntries(race) {
        return (race?.lanes || []).filter((l) => l.code);
    }

    function isPaper(r, g, b, a) {
        if (a < 40) return true;
        return r > 250 && g > 250 && b > 250;
    }

    function sourceSize(src) {
        return {
            width: src.naturalWidth || src.width,
            height: src.naturalHeight || src.height,
        };
    }

    function cropSinglet(src) {
        const { width, height } = sourceSize(src);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(src, 0, 0);
        const { data } = ctx.getImageData(0, 0, width, height);
        const occ = new Array(height).fill(0);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                if (!isPaper(data[i], data[i + 1], data[i + 2], data[i + 3])) occ[y]++;
            }
        }
        const minRow = Math.max(1, Math.round(width * 0.002));
        const runs = [];
        let y = 0;
        while (y < height) {
            while (y < height && occ[y] < minRow) y++;
            const start = y;
            while (y < height && occ[y] >= minRow) y++;
            if (y > start) runs.push({ start, end: y });
        }
        let yLimit = height;
        const last = runs[runs.length - 1];
        if (runs.length >= 2 && last.start > height * 0.5) yLimit = last.start;
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;
        for (let row = 0; row < yLimit; row++) {
            for (let x = 0; x < width; x++) {
                const i = (row * width + x) * 4;
                if (isPaper(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (row < minY) minY = row;
                if (row > maxY) maxY = row;
            }
        }
        if (maxX < minX || maxY < minY) throw new Error('No garment');
        const pad = 2;
        minX = Math.max(0, minX - pad);
        minY = Math.max(0, minY - pad);
        maxX = Math.min(width - 1, maxX + pad);
        maxY = Math.min(height - 1, maxY + pad);
        const cw = maxX - minX + 1;
        const ch = maxY - minY + 1;
        const out = document.createElement('canvas');
        out.width = cw;
        out.height = ch;
        out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
        return out;
    }

    function dilateMask(src, w, h, r) {
        const out = new Uint8Array(src);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!src[y * w + x]) continue;
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                        out[ny * w + nx] = 1;
                    }
                }
            }
        }
        return out;
    }

    function erodeMask(src, w, h, r) {
        const out = new Uint8Array(src);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!src[y * w + x]) continue;
                let keep = 1;
                for (let dy = -r; dy <= r && keep; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !src[ny * w + nx]) {
                            keep = 0;
                            break;
                        }
                    }
                }
                if (!keep) out[y * w + x] = 0;
            }
        }
        return out;
    }

    function punchPaper(src) {
        const w = src.width;
        const h = src.height;
        const n = w * h;
        const ctx = src.getContext('2d', { willReadFrequently: true });
        const img = ctx.getImageData(0, 0, w, h);
        const data = img.data;
        const wall = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            const p = i * 4;
            if (!isPaper(data[p], data[p + 1], data[p + 2], data[p + 3])) wall[i] = 1;
        }
        const sealed = erodeMask(dilateMask(wall, w, h, 1), w, h, 1);
        const outside = new Uint8Array(n);
        const stack = [];
        const tryPush = (x, y) => {
            if (x < 0 || y < 0 || x >= w || y >= h) return;
            const i = y * w + x;
            if (outside[i] || sealed[i]) return;
            const p = i * 4;
            if (!isPaper(data[p], data[p + 1], data[p + 2], data[p + 3])) return;
            outside[i] = 1;
            stack.push(i);
        };
        for (let x = 0; x < w; x++) {
            tryPush(x, 0);
            tryPush(x, h - 1);
        }
        for (let y = 0; y < h; y++) {
            tryPush(0, y);
            tryPush(w - 1, y);
        }
        while (stack.length) {
            const i = stack.pop();
            const x = i % w;
            const yy = (i / w) | 0;
            tryPush(x - 1, yy);
            tryPush(x + 1, yy);
            tryPush(x, yy - 1);
            tryPush(x, yy + 1);
        }
        for (let i = 0; i < n; i++) {
            if (outside[i]) data[i * 4 + 3] = 0;
        }
        const neighbor = (x, y) => {
            if (x < 0 || y < 0 || x >= w || y >= h) return true;
            return data[(y * w + x) * 4 + 3] < 16;
        };
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const p = (y * w + x) * 4;
                if (data[p + 3] < 16) continue;
                if (!isPaper(data[p], data[p + 1], data[p + 2], data[p + 3])) continue;
                if (neighbor(x - 1, y) || neighbor(x + 1, y) || neighbor(x, y - 1) || neighbor(x, y + 1)) {
                    data[p + 3] = 0;
                }
            }
        }
        ctx.putImageData(img, 0, 0);
        return src;
    }

    function trimAlpha(src) {
        const w = src.width;
        const h = src.height;
        const ctx = src.getContext('2d', { willReadFrequently: true });
        const { data } = ctx.getImageData(0, 0, w, h);
        let minX = w;
        let minY = h;
        let maxX = 0;
        let maxY = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (data[(y * w + x) * 4 + 3] < 16) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < minX) return src;
        const out = document.createElement('canvas');
        out.width = maxX - minX + 1;
        out.height = maxY - minY + 1;
        out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
        return out;
    }

    function cutOriginal(src) {
        const copy = document.createElement('canvas');
        copy.width = src.width;
        copy.height = src.height;
        copy.getContext('2d').drawImage(src, 0, 0);
        return trimAlpha(punchPaper(copy));
    }

    function loadLogoImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('missing'));
            img.src = url;
        });
    }

    function paintCutout(url, dataUrl) {
        document.querySelectorAll('img.kp-crew-logo').forEach((img) => {
            if (img.dataset.rowitLogo === url) img.src = dataUrl;
        });
    }

    function requestCutout(url) {
        if (cutoutCache.has(url)) return Promise.resolve(cutoutCache.get(url));
        if (cutoutInflight.has(url)) return cutoutInflight.get(url);
        const job = loadLogoImage(url)
            .then((img) => cutOriginal(cropSinglet(img)).toDataURL('image/png'))
            .then((dataUrl) => {
                cutoutCache.set(url, dataUrl);
                paintCutout(url, dataUrl);
                return dataUrl;
            })
            .catch(() => {
                cutoutCache.set(url, url);
                paintCutout(url, url);
                return url;
            })
            .finally(() => {
                cutoutInflight.delete(url);
            });
        cutoutInflight.set(url, job);
        return job;
    }

    function clubOf(code) {
        const parsed = vgParseClubCode(code);
        const info = vgClubInfo(parsed.id, vgState.lookup);
        const abbr = vgKpAbbr(code);
        return { ...info, abbr, id: parsed.id };
    }

    function crewLogo(club, extraClass) {
        const cls = extraClass ? `kp-crew-logo ${extraClass}` : 'kp-crew-logo';
        if (!club?.logoUrl) return el('span', `${cls} kp-crew-logo--empty`);
        const img = document.createElement('img');
        img.className = cls;
        img.alt = club.name || '';
        img.dataset.rowitLogo = club.logoUrl;
        const cached = cutoutCache.get(club.logoUrl);
        if (cached) {
            img.src = cached;
        } else {
            img.src = TRANSPARENT_PX;
            requestCutout(club.logoUrl);
        }
        return img;
    }

    function logoSvg(size, opacity, hat) {
        const wrap = el('div', 'kp-logo');
        const h = Math.round(size * 1.26);
        wrap.innerHTML =
            `<svg viewBox="0 0 100 126" width="${size}" height="${h}" aria-hidden="true" style="opacity:${opacity ?? 1}">` +
            ['#4a97ee', '#2e7de0', '#1b5cb4', '#12325e']
                .map((c, r) => {
                    const y = r * 26;
                    return (
                        `<path d="M2 ${4 + y} L38 ${40 + y} L74 ${4 + y}" stroke="${c}" stroke-width="9" fill="none"/>` +
                        `<path d="M26 ${4 + y} L62 ${40 + y} L98 ${4 + y}" stroke="${c}" stroke-width="9" fill="none"/>`
                    );
                })
                .join('') +
            '</svg>';
        if (hat) {
            const hatEl = document.createElement('div');
            hatEl.innerHTML =
                `<svg class="kp-hat" viewBox="0 0 60 42" width="${size * 0.56}" height="${size * 0.39}" ` +
                `style="top:${-size * 0.17}px;left:${size * 0.52}px;transform:rotate(14deg)">` +
                `<path d="M8 32 C14 12 30 5 48 9 L44 30 Z" fill="#e5484d"/>` +
                `<circle cx="50" cy="8" r="6" fill="#f5f0e4"/>` +
                `<rect x="4" y="29" width="44" height="9" rx="4.5" fill="#f5f0e4"/>` +
                `</svg>`;
            wrap.appendChild(hatEl.firstChild);
        }
        return wrap;
    }

    function sponsorBits(size) {
        const src = vgKriRandomSponsorUrl();
        return { src, name: src ? 'Race sponsor' : 'Karāpiro Rowing' };
    }

    function appendSponsor(parent, className, imgClass) {
        const box = el('div', className);
        const copy = el('div', 'kp-lower-sponsor-copy');
        copy.appendChild(el('span', 'kp-sponsor-label', 'Race sponsor'));
        const bits = sponsorBits();
        copy.appendChild(el('span', 'kp-sponsor-name', bits.name));
        box.appendChild(copy);
        if (bits.src) {
            const img = document.createElement('img');
            img.src = bits.src;
            img.alt = '';
            box.appendChild(img);
        }
        parent.appendChild(box);
        return box;
    }

    function eventName(race) {
        return vgExpandEventName(race?.eventType, vgState.lookup) || race?.eventType || '';
    }

    function normEventKey(raw) {
        return String(raw || '')
            .replace(/\sO1[456]\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();
    }

    function swapSchoolGender(key) {
        if (/^B\s/.test(key)) return `M${key.slice(1)}`;
        if (/^G\s/.test(key)) return `W${key.slice(1)}`;
        if (/^M\s/.test(key)) return `B${key.slice(1)}`;
        if (/^W\s/.test(key)) return `G${key.slice(1)}`;
        return key;
    }

    function mixedAlias(key) {
        if (/^M\/W\s/.test(key)) return `MX${key.slice(3)}`;
        if (/^MX\s/.test(key)) return `M/W${key.slice(2)}`;
        return key;
    }

    function candidateKeys(eventType) {
        const base = normEventKey(eventType);
        const keys = new Set();
        const add = (k) => {
            if (!k) return;
            keys.add(k);
            keys.add(swapSchoolGender(k));
            keys.add(mixedAlias(k));
            keys.add(swapSchoolGender(mixedAlias(k)));
        };
        add(base);
        if (/4X-$/.test(base)) add(base.replace(/4X-$/, '4X'));
        else if (/4X$/.test(base)) add(base.replace(/4X$/, '4X-'));
        return [...keys];
    }

    function rememberRecord(event, rec) {
        for (const k of candidateKeys(event)) {
            if (k && !state.records.has(k)) state.records.set(k, rec);
        }
    }

    function ingestRecords(text) {
        const lines = String(text || '').split(/\r?\n/);
        if (!lines.length) return;
        const header = vgParseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
        const idx = (name) => header.indexOf(name);
        const iEvent = idx('event');
        const iTime = idx('time');
        if (iEvent < 0 || iTime < 0) return;
        const iCrew = idx('crew');
        const iAthletes = idx('athlete_names');
        const iYear = idx('year');
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const cols = vgParseCsvLine(line);
            const event = (cols[iEvent] || '').trim();
            const time = (cols[iTime] || '').trim();
            if (!event || !time) continue;
            rememberRecord(event, {
                event,
                time,
                crew: iCrew >= 0 ? (cols[iCrew] || '').trim() : '',
                athletes: iAthletes >= 0 ? (cols[iAthletes] || '').trim() : '',
                year: iYear >= 0 ? (cols[iYear] || '').trim() : '',
            });
        }
    }

    function loadRecords() {
        if (state.recordsPromise) return state.recordsPromise;
        state.recordsPromise = (async () => {
            try {
                const texts = await Promise.all(
                    RECORD_FILES.map((url) =>
                        fetch(url)
                            .then((r) => (r.ok ? r.text() : ''))
                            .catch(() => ''),
                    ),
                );
                state.records = new Map();
                for (const t of texts) ingestRecords(t);
            } catch {
                state.records = new Map();
            }
            const g = canon(vgPlayback.graphic);
            if ((g === 'draw' || g === 'results') && vgPlayback.state !== 'idle') {
                vgRefreshHoldContent();
            }
        })();
        return state.recordsPromise;
    }

    function findRecord(eventType) {
        if (!eventType || !state.records.size) return null;
        for (const k of candidateKeys(eventType)) {
            const rec = state.records.get(k);
            if (rec) return rec;
        }
        return null;
    }

    function formatRecordTime(raw) {
        const s = String(raw || '').trim();
        const m = s.match(/^0?(\d+):(\d{2}(?:\.\d+)?)$/);
        return m ? `${Number(m[1])}:${m[2]}` : s;
    }

    function recordWho(rec) {
        const is1x = /\b1X\b/.test(normEventKey(rec.event));
        let who = '';
        if (is1x && rec.athletes) who = rec.athletes.split(',')[0].trim();
        if (!who) who = String(rec.crew || '').replace(/\s+\d+$/, '').trim();
        return who;
    }

    function appendBoardFoot(board, race) {
        const foot = el('div', 'kp-board-foot');
        const n = laneEntries(race).length;
        foot.appendChild(
            el('span', 'kp-board-foot-copy', `Lake Karāpiro · 2000m${n ? ` · ${n} lanes` : ''}`),
        );
        const rec = findRecord(race?.eventType);
        if (rec) {
            const pill = el('span', 'kp-board-record');
            pill.appendChild(el('span', 'kp-board-record-lab', 'Course record'));
            pill.appendChild(el('span', 'kp-board-record-time', formatRecordTime(rec.time)));
            const who = [recordWho(rec), rec.year].filter(Boolean).join(' · ');
            if (who) pill.appendChild(el('span', 'kp-board-record-who', who));
            foot.appendChild(pill);
        }
        appendSponsor(foot, 'kp-board-sponsor');
        board.appendChild(foot);
    }

    function dayLabel(race) {
        const r = race || vgState.races[0];
        return r ? vgFormatDayLabel(r.dayLabel) : '';
    }

    function lowerSub(race) {
        const parts = [
            vgFormatRoundLabel(race.round, race.division),
            vgFormatScheduleTime(race.startAt),
            race.progression,
        ].filter(Boolean);
        return parts.join(' · ') || 'Lake Karāpiro · 2000m';
    }

    function boatClass(race) {
        const ev = `${race?.eventType || ''} ${eventName(race)}`;
        if (/eight|octuple|8\+|8x/i.test(ev)) return { n: 8, cox: true };
        if (/quad|4x/i.test(ev)) return { n: 4, cox: /4x\+|cox/i.test(ev) };
        if (/four|4\+|4-/i.test(ev)) return { n: 4, cox: /4\+|cox/i.test(ev) };
        if (/pair|double|2x|2-/i.test(ev)) return { n: 2, cox: false };
        if (/single|1x/i.test(ev)) return { n: 1, cox: false };
        return { n: 8, cox: true };
    }

    function seatLabels(n) {
        if (n === 8) return ['BOW', 'SEAT 2', 'SEAT 3', 'SEAT 4', 'SEAT 5', 'SEAT 6', 'SEAT 7', 'STROKE'];
        if (n === 4) return ['BOW', 'SEAT 2', 'SEAT 3', 'STROKE'];
        if (n === 2) return ['BOW', 'STROKE'];
        return ['1'];
    }

    function splitNames(raw) {
        return String(raw || '')
            .split(/\s*(?:,|;|\/|\n| {2,})\s*/)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    function fakeName(raceNo, lane, i) {
        const f = FIRST_NAMES[(raceNo * 7 + lane * 11 + i * 5) % FIRST_NAMES.length];
        const l = LAST_NAMES[(raceNo * 13 + lane * 3 + i * 7) % LAST_NAMES.length];
        return `${f} ${l}`;
    }

    function crewFor(race, laneNum) {
        const lanes = laneEntries(race);
        const lane = lanes.find((l) => l.lane === laneNum) || lanes[0];
        if (!lane) return { club: '—', seats: [] };
        const club = clubOf(lane.code);
        const { n, cox } = boatClass(race);
        const labels = seatLabels(n);
        const perCrew = n + (cox ? 1 : 0);
        const filled = lanes;
        const idx = filled.findIndex((l) => l.lane === lane.lane);
        const allNames = splitNames(vgCompetitorNames(race, lane));
        let parsed = allNames;
        if (idx >= 0 && perCrew > 0 && allNames.length >= filled.length * perCrew) {
            parsed = allNames.slice(idx * perCrew, (idx + 1) * perCrew);
        } else if (allNames.length === perCrew) {
            parsed = allNames;
        }
        const seats = labels.map((seat, i) => ({
            seat,
            name: parsed[i] || fakeName(race.raceNum || 0, laneNum, i),
        }));
        if (cox) {
            seats.push({
                seat: 'COX',
                name: parsed[labels.length] || fakeName(race.raceNum || 0, laneNum, 17),
            });
        }
        return { club: club.name, logoUrl: club.logoUrl, seats, lane: lane.lane };
    }

    function resultRows(race) {
        const result = vgState.results.get(race.raceNum);
        if (result?.placings?.length) {
            const first = result.placings[0];
            return result.placings.map((p, i) => {
                const club = clubOf(p.competitor);
                const lane = laneEntries(race).find((l) => {
                    const a = vgParseClubCode(l.code);
                    const b = vgParseClubCode(p.competitor);
                    return a.id && a.id === b.id;
                });
                return {
                    rank: p.place || i + 1,
                    lane: lane?.lane || '',
                    club: club.name,
                    logoUrl: club.logoUrl,
                    abbr: club.abbr,
                    time: p.time || '',
                    margin: i === 0 ? '' : '',
                    first: i === 0,
                };
            });
        }
        return laneEntries(race).map((l, i) => {
            const club = clubOf(l.code);
            return {
                rank: i + 1,
                lane: l.lane,
                club: club.name,
                logoUrl: club.logoUrl,
                abbr: club.abbr,
                time: '',
                margin: '',
                first: i === 0,
            };
        });
    }

    function neighbour(delta) {
        const races = vgState.races;
        if (!races.length) return null;
        const cur = vgFindRace(vgGetRaceParam()) || races[0];
        const idx = races.findIndex((r) => r.race === cur.race);
        const i = idx < 0 ? 0 : idx;
        return races[(i + delta + races.length) % races.length];
    }

    function fmtClock(s) {
        const m = Math.floor(s / 60);
        return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
    }

    function simRaceStub() {
        const s = state.cvRace;
        if (!s?.sim) return null;
        return {
            race: String(s.raceNum || 1),
            raceNum: s.raceNum || 1,
            eventType: s.eventType || s.event || 'M 1X',
            event: s.event || s.eventType || 'M 1X',
            lanes: (s.boats || []).map((b) => ({
                lane: b.lane,
                code: b.code || b.label,
            })),
        };
    }

    function clipRaceStub() {
        const s = state.cvRace;
        if (!s || s.source !== 'clip') return null;
        const lanes = (s.draw_lanes || s.boats || []).map((b) => ({
            lane: Number(b.lane),
            code: b.code || b.label,
        }));
        return {
            race: String(s.raceNum || 1),
            raceNum: s.raceNum || 1,
            eventType: s.eventType || s.event || 'U 8+',
            event: s.event || s.eventType || 'U 8+',
            lanes,
        };
    }

    function currentRace() {
        return clipRaceStub() || vgFindRace(vgGetRaceParam()) || simRaceStub();
    }

    function simCrewFp() {
        const race = currentRace();
        const lanes = laneEntries(race)
            .map((l) => `${l.lane}:${l.code}`)
            .join('|');
        return `${state.cvSource || ''}|${race?.race || ''}|${lanes}`;
    }

    function remountSimGraphic() {
        const g = canon(vgPlayback.graphic);
        if (!g || vgPlayback.state === 'idle') return;
        const fp = simCrewFp();
        if (fp === state.simGraphicFp) {
            if (g === 'cvstart') paintCvStartPositions();
            if (g === 'cvfollow') paintCvFollow();
            if (g === 'cvboattags') paintCvBoatTags();
            if (g === 'speedchart') {
                paintSpeedChart(document.querySelector('.kp-speed canvas'), boatsNow(currentRace()));
            }
            return;
        }
        const layer = document.getElementById('vgLayer');
        const fn = RENDER[g];
        if (!layer || !fn) return;
        state.simGraphicFp = fp;
        layer.replaceChildren();
        fn(layer, currentRace());
    }

    function simFallbackEnabled() {
        const q = new URLSearchParams(location.search);
        return q.get('sim') !== '0';
    }

    function cvLaptopOrigin() {
        const q = new URLSearchParams(location.search);
        if (q.get('cv') === '0') return '';
        const fromUrl = (q.get('cvLaptop') || q.get('laptop') || '').replace(/\/+$/, '');
        if (fromUrl) return fromUrl;
        try {
            const stored = localStorage.getItem(LS_CV_URL);
            if (stored) return stored.replace(/\/+$/, '');
        } catch {
            /* ignore */
        }
        return DEFAULT_CV;
    }

    function cvOrigin() {
        if (state.cvSource === 'live') return cvLaptopOrigin();
        if (simFallbackEnabled()) return location.origin.replace(/\/+$/, '');
        return cvLaptopOrigin();
    }

    function isLiveCvFeed() {
        return state.cvSource === 'live' || (cvLive() && state.cvRace?.sim !== true);
    }

    function isLiveCvRace(data) {
        if (window.CvOverlayDraw?.isLiveCvSnapshot) return CvOverlayDraw.isLiveCvSnapshot(data);
        if (!data || typeof data !== 'object' || data.sim === true) return false;
        return (
            data.ok === true ||
            (Array.isArray(data.boats) && data.boats.length > 0) ||
            (Array.isArray(data.draw_lanes) && data.draw_lanes.length > 0) ||
            (Array.isArray(data.occupied_lanes) && data.occupied_lanes.length > 0) ||
            Number.isFinite(Number(data.leader_chainage_m)) ||
            Boolean(data.race_phase)
        );
    }

    function liveRaceUsable(data) {
        if (!isLiveCvRace(data) || data.sim === true) return false;
        const boats = Array.isArray(data.boats) ? data.boats : [];
        if (boats.some((b) => Number.isFinite(Number(b.chainage_m)) && Number(b.chainage_m) > 1)) {
            return true;
        }
        const series = Array.isArray(data.speed_series) ? data.speed_series : [];
        return series.some((row) => (row?.points || []).length >= 2);
    }

    async function fetchCvRace(origin, timeoutMs) {
        if (!origin) return null;
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), timeoutMs || 600);
        try {
            const res = await fetch(`${origin}/api/race`, {
                cache: 'no-store',
                signal: ac.signal,
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data && typeof data === 'object' ? data : null;
        } catch {
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    function cvLive() {
        return Boolean(
            state.cvRace &&
                (state.cvRace.boats || []).some((b) => Number.isFinite(Number(b.chainage_m))),
        );
    }

    function raceClockText() {
        const ms = Number(state.cvRace?.clock?.elapsed_ms);
        if (cvLive() && Number.isFinite(ms) && ms >= 0) return fmtClock(ms / 1000);
        return fmtClock(Math.min(state.t % 450, 385));
    }

    async function pollCv() {
        if (state.cvBusy) return;
        state.cvBusy = true;
        try {
            if (window.CvClipReplay?.active()) {
                if (pullClipRace()) {
                    recordSpeedSamples(state.cvRace);
                    remountSimGraphic();
                }
                return;
            }
            const liveBase = cvLaptopOrigin();
            const simOn = simFallbackEnabled();
            const now = Date.now();
            let live = null;
            if (liveBase && now >= (state.liveFailUntil || 0)) {
                live = await fetchCvRace(liveBase, 400);
                if (!liveRaceUsable(live)) {
                    live = null;
                    state.liveFailUntil = Date.now() + 5000;
                }
            }
            if (live) {
                state.cvSource = 'live';
                state.cvRace = live;
                mixAllTelemetry();
                recordSpeedSamples(live);
                remountSimGraphic();
                return;
            }
            if (simOn) {
                const sim = await fetchCvRace(location.origin.replace(/\/+$/, ''), 800);
                state.cvSource = sim ? 'sim' : '';
                state.cvRace = sim;
                if (sim) {
                    mixAllTelemetry();
                    recordSpeedSamples(sim);
                }
                remountSimGraphic();
                return;
            }
            state.cvSource = '';
            state.cvRace = null;
        } finally {
            state.cvBusy = false;
        }
    }

    function recordSpeedSamples(snap) {
        const phase = String(snap?.race_phase || '');
        if (phase && phase !== state.cvPhase) {
            if (phase === 'ready' || phase === 'racing' || phase === 'started') {
                state.speedHist.clear();
            }
            state.cvPhase = phase;
        }
        for (const b of snap?.boats || []) {
            const lane = Number(b.lane);
            const tel = boatTel(lane);
            const m = Number.isFinite(tel?.m) ? tel.m : Number(b.chainage_m);
            const sp = Number.isFinite(tel?.sp) ? tel.sp : Number(b.speed_mps);
            if (!Number.isFinite(lane) || !Number.isFinite(m) || !Number.isFinite(sp)) continue;
            const prev = state.speedHist.get(lane) || [];
            const last = prev[prev.length - 1];
            if (last && Math.abs(last.m - m) < 0.8 && Math.abs(last.sp - sp) < 0.04) continue;
            if (last && Math.abs(last.sp - sp) > 1.2) continue;
            prev.push({ m, sp });
            // Keep ~10 m buckets across the full 2 km so the chart spans the race.
            const buckets = new Map();
            for (const p of prev) {
                const key = Math.round(p.m / 10) * 10;
                buckets.set(key, p);
            }
            state.speedHist.set(
                lane,
                [...buckets.values()].sort((a, b) => a.m - b.m).slice(-220),
            );
        }
    }

    function simBoats(race) {
        const lanes = laneEntries(race);
        const tt = state.t % 450;
        return lanes.map((l, i) => {
            const off = (((i * 7) % 13) - 6) * 1.1;
            const dur = 372 + off;
            const m = Math.max(
                0,
                Math.min(COURSE_M, COURSE_M * Math.min(1, tt / dur) + 6 * Math.sin(tt / 9 + i * 2.1)),
            );
            const club = clubOf(l.code);
            return { ...club, lane: l.lane, m, dur, live: false };
        });
    }

    function boatsNow(race) {
        const lanes = laneEntries(race);
        const cvBoats = Array.isArray(state.cvRace?.boats) ? state.cvRace.boats : [];
        const byLane = new Map(cvBoats.map((b) => [Number(b.lane), b]));
        const mapCvOnly = (b) => ({
            name: b.label || b.name || '',
            logoUrl: b.logoUrl || null,
            abbr: b.shortLabel || b.code || '',
            id: String(b.code || '').toLowerCase(),
            lane: Number(b.lane),
            m: Number(b.chainage_m) || 0,
            dur: 372,
            live: true,
            speed: Number(b.speed_mps),
            cvStatus: b.cv_status || 'green',
            detected: true,
            coasting: false,
            stable: true,
            x: Number(b.x),
            y: Number(b.y),
        });
        if (!lanes.length) {
            if (cvBoats.length) return cvBoats.map(mapCvOnly);
            return [];
        }
        if (!cvBoats.length && !cvLive()) return simBoats(race);
        return lanes.map((l) => {
            const club = clubOf(l.code);
            const cv = byLane.get(Number(l.lane));
            const tel = boatTel(l.lane);
            const ch = Number.isFinite(tel?.m) ? tel.m : Number(cv?.chainage_m);
            if (Number.isFinite(ch)) state.chHold.set(l.lane, ch);
            const held = state.chHold.get(l.lane);
            const m = Number.isFinite(held)
                ? Math.max(0, Math.min(COURSE_M, held))
                : Number.isFinite(ch)
                  ? Math.max(0, Math.min(COURSE_M, ch))
                  : 0;
            const status = String(cv?.cv_status || '');
            const detected = cv ? cv.detected !== false && !cv.coasting : false;
            const stable =
                Number.isFinite(ch) &&
                detected &&
                (status === 'green' || status === '' || status === 'ok' || state.cvRace?.sim === true);
            return {
                ...club,
                lane: l.lane,
                m,
                dur: 372,
                live: Number.isFinite(ch),
                speed: Number.isFinite(tel?.sp) ? tel.sp : Number(cv?.speed_mps),
                cvStatus: status,
                detected: Boolean(detected),
                coasting: Boolean(cv?.coasting),
                stable,
                x: Number(cv?.x),
                y: Number(cv?.y),
            };
        });
    }

    const BOAT_LEN = 12.5;

    function stableBoatsRanked(race) {
        const boats = boatsNow(race).filter((b) => {
            if (cvLive()) return b.stable && Number.isFinite(b.m);
            return Number.isFinite(b.m);
        });
        return [...boats].sort((a, b) => b.m - a.m);
    }

    function gapFromLeader(leadM, boatM) {
        if (!Number.isFinite(leadM) || !Number.isFinite(boatM)) return '—';
        const d = leadM - boatM;
        if (d < 0.4) return 'LDR';
        if (d / BOAT_LEN >= 0.8) return `+${(d / BOAT_LEN).toFixed(1)} L`;
        return `+${d.toFixed(0)} m`;
    }

    function leadOf(race) {
        const boats = [...boatsNow(race)].sort((a, b) => b.m - a.m);
        const top = boats[0];
        const heldLane = state.leadLane;
        if (heldLane != null && top) {
            const held = boats.find((b) => b.lane === heldLane);
            if (held && held.lane !== top.lane && top.m - held.m < 8) {
                const rest = boats.filter((b) => b.lane !== heldLane);
                return { lead: held, second: rest[0], boats };
            }
        }
        if (top) state.leadLane = top.lane;
        return { lead: boats[0], second: boats[1], boats };
    }

    function renderTitle(layer, race) {
        const root = el('div', 'kp-title');
        const card = el('div', 'kp-title-card');
        card.appendChild(bar('kp-bar--lg'));
        const inner = el('div', 'kp-title-inner');
        inner.appendChild(logoSvg(130, 1, festive()));
        inner.appendChild(el('div', 'kp-title-kicker', 'Karāpiro Rowing'));
        inner.appendChild(
            el('h1', 'kp-title-word', festive() ? 'Christmas Regatta' : (vgRegattaTitle() || 'Lake Karāpiro')),
        );
        const meta = el('div', 'kp-title-meta');
        const bits = ['Lake Karāpiro', dayLabel(race), '2000m'].filter(Boolean);
        bits.forEach((b, i) => {
            if (i) meta.appendChild(el('span', 'kp-dot', '·'));
            meta.appendChild(el('span', '', b));
        });
        inner.appendChild(meta);
        const live = el('div', 'kp-title-live-row');
        live.appendChild(liveBadge());
        live.appendChild(
            el(
                'span',
                'kp-title-live-copy',
                festive() ? 'Merry Christmas from Lake Karāpiro' : 'Live from Lake Karāpiro',
            ),
        );
        inner.appendChild(live);
        card.appendChild(inner);
        card.appendChild(bar('kp-bar--lg'));
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderLowerInner(race) {
        const wrap = el('div', 'kp-lower-card');
        wrap.appendChild(bar('kp-bar--sm'));
        const body = el('div', 'kp-lower-body');
        body.appendChild(el('div', 'kp-chip kp-chip--lg', vgKpRaceChip(race)));
        const copy = el('div', 'kp-lower-copy');
        const ev = el('h2', 'kp-lower-event', eventName(race));
        ev.dataset.vgLayout = 'lower-event';
        copy.appendChild(ev);
        copy.appendChild(el('p', 'kp-lower-sub', lowerSub(race)));
        body.appendChild(copy);
        appendSponsor(body, 'kp-lower-sponsor');
        wrap.appendChild(body);
        return wrap;
    }

    function renderLower(layer, race) {
        const root = el('div', 'kp-lower');
        root.dataset.vgLayout = 'lower';
        root.appendChild(renderLowerInner(race));
        layer.appendChild(root);
    }

    function renderBoardHead(board, race, metaText) {
        const head = el('div', 'kp-board-head');
        head.appendChild(chip(vgKpRaceChip(race)));
        head.appendChild(el('span', 'kp-board-title', eventName(race)));
        head.appendChild(el('span', 'kp-board-meta', metaText));
        board.appendChild(head);
        return head;
    }

    function renderDraw(layer, race) {
        const wrap = el('div', 'kp-board-wrap kp-board-wrap--draw');
        const board = el('div', 'kp-board');
        renderBoardHead(board, race, `Draw · ${vgFormatScheduleTime(race.startAt)}`);
        const rows = el('div', 'kp-rows');
        laneEntries(race).forEach((lane, i) => {
            const club = clubOf(lane.code);
            const row = el('div', 'kp-row');
            row.style.animationDelay = `${0.25 + i * 0.14}s`;
            row.appendChild(el('span', 'kp-lane', String(lane.lane)));
            row.appendChild(crewLogo(club));
            const name = el('span', 'kp-row-club', club.name);
            name.dataset.vgLayoutTarget = 'draw-crew';
            row.appendChild(name);
            row.appendChild(el('span', 'kp-row-abbr', club.abbr));
            rows.appendChild(row);
        });
        board.appendChild(rows);
        appendBoardFoot(board, race);
        wrap.appendChild(board);
        layer.appendChild(wrap);
    }

    function renderResults(layer, race) {
        const wrap = el('div', 'kp-board-wrap kp-board-wrap--results');
        const board = el('div', 'kp-board');
        const result = vgState.results.get(race.raceNum);
        renderBoardHead(board, race, result?.status ? `Result · ${result.status}` : 'Result · Official');
        const rows = el('div', 'kp-rows');
        const list = resultRows(race);
        if (!list.length) {
            rows.appendChild(el('div', 'kp-row kp-empty', 'Results not available'));
        } else {
            list.forEach((p, i) => {
                const row = el('div', `kp-row kp-row--results${p.first ? ' kp-row--first' : ''}`);
                row.style.animationDelay = `${0.25 + i * 0.14}s`;
                row.appendChild(el('span', `kp-lane${p.first ? '' : ' kp-lane--rest'}`, String(p.rank)));
                row.appendChild(el('span', 'kp-row-llane', p.lane ? `L${p.lane}` : ''));
                row.appendChild(crewLogo(p));
                const name = el('span', 'kp-row-club', p.club);
                name.dataset.vgLayoutTarget = 'results-crew';
                row.appendChild(name);
                row.appendChild(el('span', 'kp-row-time', p.time));
                row.appendChild(el('span', 'kp-row-margin', p.margin));
                rows.appendChild(row);
            });
        }
        board.appendChild(rows);
        appendBoardFoot(board, race);
        wrap.appendChild(board);
        layer.appendChild(wrap);
    }

    function renderSchedule(layer, raceParam) {
        const wrap = el('div', 'kp-board-wrap kp-board-wrap--schedule');
        const board = el('div', 'kp-board');
        const head = el('div', 'kp-board-head');
        head.appendChild(el('span', 'kp-board-title', 'Race schedule'));
        const day = dayLabel(vgFindRace(raceParam) || vgState.races[0]);
        head.appendChild(el('span', 'kp-board-meta', day ? `${day} · Lake Karāpiro` : 'Lake Karāpiro'));
        board.appendChild(head);
        const { current, upcoming } = vgGetUpcomingRaces(raceParam, 10);
        const rows = el('div', 'kp-rows');
        const all = upcoming.length ? upcoming : vgState.races.slice(0, 10);
        if (!all.length) {
            rows.appendChild(el('div', 'kp-row kp-empty', 'No races on daysheet'));
        } else {
            const curIdx = current ? all.findIndex((r) => r.race === current.race) : 0;
            all.forEach((row, i) => {
                const li = el('div', 'kp-row kp-row--schedule');
                li.style.animationDelay = `${0.2 + i * 0.1}s`;
                let chipText = '';
                let chipClass = 'kp-sched-chip';
                if (current && row.race === current.race) {
                    li.classList.add('kp-row--current');
                    chipText = 'On water';
                    chipClass += ' kp-sched-chip--now';
                } else if (curIdx >= 0 && i === curIdx + 1) {
                    chipText = 'Up next';
                    chipClass += ' kp-sched-chip--next';
                } else if (curIdx >= 0 && i < curIdx) {
                    li.classList.add('kp-row--raced');
                    chipText = 'Raced';
                    chipClass += ' kp-sched-chip--raced';
                }
                li.appendChild(el('span', 'kp-sched-time', vgFormatScheduleTime(row.startAt)));
                li.appendChild(el('span', 'kp-sched-race', vgKpRaceChip(row)));
                li.appendChild(el('span', 'kp-sched-event', eventName(row)));
                li.appendChild(el('span', chipClass, chipText));
                rows.appendChild(li);
            });
        }
        board.appendChild(rows);
        wrap.appendChild(board);
        layer.appendChild(wrap);
    }

    function renderLeader(layer, race, laneNum) {
        const { lead, second } = leadOf(race);
        let club = lead;
        let lane = lead?.lane;
        if (laneNum) {
            const entry = vgFindDrawLane(race, laneNum);
            if (entry) {
                club = { ...clubOf(entry.code), lane: laneNum, m: lead?.m || 0 };
                lane = laneNum;
            }
        }
        if (!club) return;
        const root = el('div', 'kp-bug');
        root.dataset.vgLayout = 'leader-wrap';
        const card = el('div', 'kp-bug-card');
        card.appendChild(bar('kp-bar--sm'));
        const body = el('div', 'kp-bug-body');
        body.appendChild(liveBadge());
        body.appendChild(chip('Leader'));
        body.appendChild(crewLogo(club, 'kp-crew-logo--bug'));
        const name = el('span', 'kp-bug-name vg-leader-crew', club.name);
        name.dataset.vgLayout = 'leader-crew';
        body.appendChild(name);
        body.appendChild(el('span', 'kp-bug-lane', `Lane ${lane}`));
        body.appendChild(el('span', 'kp-bug-rule'));
        const dist = Math.round((club.m || 0) / 10) * 10;
        body.appendChild(el('span', 'kp-bug-dist', `${dist}m`));
        if (second && lead) {
            const d = lead.m - second.m;
            const gap = cvLive()
                ? d < 0.4
                    ? 'LDR'
                    : `+${d.toFixed(0)}m`
                : `+${(d / 5.35).toFixed(1)}s`;
            body.appendChild(el('span', 'kp-bug-gap', gap));
        }
        card.appendChild(body);
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderNext(layer) {
        const nxt = neighbour(1);
        if (!nxt) return;
        const root = el('div', 'kp-bug');
        const card = el('div', 'kp-bug-card');
        card.appendChild(bar('kp-bar--sm'));
        const body = el('div', 'kp-bug-body');
        body.appendChild(chip('Next race'));
        body.appendChild(el('span', 'kp-bug-no', vgKpRaceChip(nxt)));
        body.appendChild(el('span', 'kp-bug-name', eventName(nxt)));
        body.appendChild(el('span', 'kp-bug-rule'));
        body.appendChild(el('span', 'kp-bug-time', vgFormatScheduleTime(nxt.startAt)));
        card.appendChild(body);
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderPrev(layer) {
        const prv = neighbour(-1);
        if (!prv) return;
        const rows = resultRows(prv);
        const win = rows[0];
        const root = el('div', 'kp-bug');
        const card = el('div', 'kp-bug-card');
        card.appendChild(bar('kp-bar--sm'));
        const body = el('div', 'kp-bug-body');
        body.appendChild(chip('Previous race', 'kp-bug-chip--prev'));
        body.appendChild(el('span', 'kp-bug-no', vgKpRaceChip(prv)));
        body.appendChild(el('span', 'kp-bug-name', eventName(prv)));
        body.appendChild(el('span', 'kp-bug-rule'));
        const res = win?.time ? `1st ${win.club} · ${win.time}` : win ? `1st ${win.club}` : 'Awaiting result';
        body.appendChild(el('span', 'kp-bug-result', res));
        card.appendChild(body);
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderDrill(layer, race) {
        const { lead } = leadOf(race);
        const lane = state.drillLane || lead?.lane || laneEntries(race)[0]?.lane || 1;
        const crew = crewFor(race, lane);
        const root = el('div', 'kp-drill');
        const card = el('div', 'kp-drill-card');
        card.appendChild(bar('kp-bar--sm'));
        const body = el('div', 'kp-drill-body');
        const head = el('div', 'kp-drill-head');
        head.appendChild(chip('Crew'));
        head.appendChild(crewLogo(crew, 'kp-crew-logo--bug'));
        head.appendChild(el('span', 'kp-drill-club', crew.club));
        head.appendChild(el('span', 'kp-drill-lane', `Lane ${crew.lane}`));
        body.appendChild(head);
        const seats = el('div', 'kp-seats');
        crew.seats.forEach((s, i) => {
            const cell = el('div', 'kp-seat');
            cell.style.animationDelay = `${0.1 + i * 0.06}s`;
            cell.appendChild(el('span', 'kp-seat-lab', s.seat));
            cell.appendChild(el('span', 'kp-seat-name', s.name));
            seats.appendChild(cell);
        });
        body.appendChild(seats);
        card.appendChild(body);
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderSuits(layer, race) {
        const wrap = el('div', 'kp-board-wrap kp-board-wrap--suits');
        const board = el('div', 'kp-board');
        const n = laneEntries(race).length;
        renderBoardHead(board, race, n ? `Lanes 1–${n}` : 'Lanes');
        const grid = el('div', 'kp-suits-grid');
        if (n && n !== 8) grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
        laneEntries(race).forEach((lane, i) => {
            const club = clubOf(lane.code);
            const card = el('div', 'kp-suit-card');
            card.style.animationDelay = `${0.08 + i * 0.06}s`;
            card.appendChild(crewLogo(club, 'kp-crew-logo--suit'));
            card.appendChild(el('span', 'kp-suit-lane', `Lane ${lane.lane}`));
            card.appendChild(el('span', 'kp-suit-club', club.name));
            grid.appendChild(card);
        });
        board.appendChild(grid);
        wrap.appendChild(board);
        layer.appendChild(wrap);
    }

    function suitStripBody(race) {
        const body = el('div', 'kp-suitstrip-body');
        laneEntries(race).forEach((lane, i) => {
            const club = clubOf(lane.code);
            const cell = el('div', 'kp-suit-cell');
            cell.style.animationDelay = `${0.1 + i * 0.05}s`;
            cell.appendChild(crewLogo(club, 'kp-crew-logo--strip'));
            cell.appendChild(el('span', 'kp-suit-lane', `Lane ${lane.lane}`));
            cell.appendChild(el('span', 'kp-suit-abbr', club.abbr));
            body.appendChild(cell);
        });
        return body;
    }

    function renderSuitStrip(layer, race) {
        const root = el('div', 'kp-suitstrip');
        const card = el('div', 'kp-suitstrip-card');
        card.appendChild(bar('kp-bar--sm'));
        card.appendChild(suitStripBody(race));
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderLowerSuits(layer, race) {
        const root = el('div', 'kp-lowersuits');
        const card = el('div', 'kp-lower-card');
        card.appendChild(bar());
        const body = el('div', 'kp-lower-body');
        body.appendChild(el('div', 'kp-chip kp-chip--lg', vgKpRaceChip(race)));
        const copy = el('div', 'kp-lower-copy');
        copy.appendChild(el('h2', 'kp-lower-event', eventName(race)));
        copy.appendChild(el('p', 'kp-lower-sub', lowerSub(race)));
        body.appendChild(copy);
        card.appendChild(body);
        card.appendChild(suitStripBody(race));
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderBrand(layer) {
        const root = el('div', 'kp-brand');
        const row = el('div', 'kp-brand-row');
        row.appendChild(logoSvg(40));
        const copy = el('div', '');
        copy.appendChild(el('div', 'kp-brand-title', 'Karāpiro Rowing'));
        copy.appendChild(
            el('div', 'kp-brand-sub', festive() ? 'Christmas Regatta' : 'Lake Karāpiro'),
        );
        row.appendChild(copy);
        root.appendChild(row);
        const sp = el('div', 'kp-brand-sponsor');
        const bits = sponsorBits();
        if (bits.src) {
            const img = document.createElement('img');
            img.src = bits.src;
            img.alt = '';
            sp.appendChild(img);
        }
        const sc = el('div', 'kp-lower-sponsor-copy');
        sc.style.alignItems = 'flex-start';
        sc.appendChild(el('span', 'kp-sponsor-label', 'Race sponsor'));
        sc.appendChild(el('span', 'kp-sponsor-name', bits.name));
        sp.appendChild(sc);
        root.appendChild(sp);
        layer.appendChild(root);
    }

    function renderCvLeader(layer, race) {
        const { lead } = leadOf(race);
        const root = el('div', 'kp-cvleader');
        const card = el('div', 'kp-cvleader-card');
        card.appendChild(el('span', 'kp-cvleader-lab', 'Leader'));
        if (lead) card.appendChild(crewLogo(lead, 'kp-crew-logo--bug'));
        card.appendChild(
            el('span', 'kp-cvleader-val vg-leader-crew', lead ? `L${lead.lane} ${lead.abbr}` : '—'),
        );
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderCvDraw(layer, race) {
        const boats = boatsNow(race);
        const ranked = [...boats].sort((a, b) => b.m - a.m);
        const root = el('div', 'kp-cvdraw');
        root.appendChild(
            el('div', 'kp-cvdraw-head', `${cvLive() ? 'Order' : 'Draw'} · ${vgKpRaceChip(race)}`),
        );
        const list = el('div', 'kp-cvdraw-list');
        boats.forEach((club) => {
            const rank = ranked.findIndex((b) => b.lane === club.lane);
            const row = el('div', `kp-cvdraw-row${rank === 0 && cvLive() ? ' kp-row--first' : ''}`);
            row.dataset.lane = String(club.lane);
            row.style.order = String(rank < 0 ? 99 : rank);
            row.appendChild(el('span', 'kp-lane', String(club.lane)));
            row.appendChild(crewLogo(club, 'kp-crew-logo--cv'));
            row.appendChild(el('span', 'kp-row-abbr', club.abbr));
            const metres = el('span', 'kp-cvdraw-m', cvLive() ? `${Math.round(club.m)}m` : '');
            row.appendChild(metres);
            list.appendChild(row);
        });
        root.appendChild(list);
        layer.appendChild(root);
    }

    function renderTracker(layer, race) {
        const boats = boatsNow(race);
        const root = el('div', 'kp-tracker');
        root.dataset.kpLive = 'tracker';
        const head = el('div', 'kp-tracker-head');
        head.appendChild(liveBadge());
        head.appendChild(
            document.createTextNode(`Race tracker · ${vgKpRaceChip(race)} · ${eventName(race)}`),
        );
        head.appendChild(el('span', 'kp-tracker-clock', raceClockText()));
        root.appendChild(head);
        const marks = el('div', 'kp-track-marks');
        ['500M', '1000M', '1500M'].forEach((m) => marks.appendChild(el('span', '', m)));
        root.appendChild(marks);
        const leadM = Math.max(...boats.map((b) => b.m), 1);
        boats.forEach((b) => {
            const row = el('div', 'kp-track-row');
            row.appendChild(el('span', 'kp-lane', String(b.lane)));
            row.appendChild(crewLogo(b, 'kp-crew-logo--cv'));
            row.appendChild(el('span', 'kp-suit-abbr', b.abbr));
            const barWrap = el('div', 'kp-track-bar');
            const fill = el('div', b.m === leadM ? 'kp-track-fill kp-track-fill--lead' : 'kp-track-fill');
            fill.style.width = `${(b.m / 20).toFixed(1)}%`;
            barWrap.appendChild(fill);
            row.appendChild(barWrap);
            row.appendChild(el('span', 'kp-track-m', `${Math.round(b.m)}m`));
            root.appendChild(row);
        });
        layer.appendChild(root);
    }

    function speedCols() {
        return festive()
            ? ['#4aa3ff', '#f4f7fb', '#e5484d', '#f5c542', '#22c55e', '#f97316', '#c4b5fd', '#22d3ee']
            : ['#4aa3ff', '#f4f7fb', '#f5c542', '#22c55e', '#f97316', '#c4b5fd', '#22d3ee', '#fb7185'];
    }

    const SPEED_Y_MIN = 3.5;
    const SPEED_Y_MAX = 6;

    function speedXy(m, sp) {
        const x = 52 + (Math.max(0, Math.min(COURSE_M, Number(m) || 0)) / COURSE_M) * 508;
        const t = (Math.max(SPEED_Y_MIN, Math.min(SPEED_Y_MAX, Number(sp) || SPEED_Y_MIN)) - SPEED_Y_MIN) /
            (SPEED_Y_MAX - SPEED_Y_MIN);
        return { x, y: 228 - t * 198 };
    }

    function parseSpeedPoints(row) {
        const fromSeries = [];
        for (const p of row?.points || []) {
            let m;
            let sp;
            let t;
            if (Array.isArray(p)) {
                t = Number(p[0]);
                sp = Number(p[1]);
                m = Number.isFinite(Number(p[2])) ? Number(p[2]) : null;
            } else if (p && typeof p === 'object') {
                t = Number(p.t);
                sp = Number(p.s ?? p.sp ?? p.speed);
                m = Number(p.d ?? p.m ?? p.distance);
            }
            if (!Number.isFinite(sp)) continue;
            fromSeries.push({
                t: Number.isFinite(t) ? t : null,
                m: Number.isFinite(m) ? m : null,
                sp,
            });
        }
        const xs = fromSeries.map((p) => (p.m != null ? p.m : p.t)).filter((v) => Number.isFinite(v));
        const deltas = [];
        for (let i = 1; i < xs.length; i += 1) deltas.push(xs[i] - xs[i - 1]);
        deltas.sort((a, b) => a - b);
        const med = deltas[Math.floor(deltas.length / 2)] || 0;
        const firstColIsDistance = med >= 15 && med <= 120 && (xs[xs.length - 1] || 0) >= 40;
        if (fromSeries.some((p) => p.m == null)) {
            if (firstColIsDistance) {
                fromSeries.forEach((p) => {
                    if (p.m == null && p.t != null) p.m = p.t;
                });
            } else if (fromSeries.some((p) => p.t != null)) {
                let d = 0;
                let prevT = fromSeries[0]?.t || 0;
                fromSeries.forEach((p) => {
                    if (p.m != null) {
                        d = p.m;
                        if (p.t != null) prevT = p.t;
                        return;
                    }
                    if (p.t != null) {
                        d += Math.max(0, p.sp) * Math.max(0, p.t - prevT);
                        prevT = p.t;
                        p.m = d;
                    }
                });
            }
        }
        return fromSeries.filter((p) => Number.isFinite(p.m) && Number.isFinite(p.sp));
    }

    function speedPointList(boat, index, usedRows) {
        const series = Array.isArray(state.cvRace?.speed_series) ? state.cvRace.speed_series : [];
        let row = series.find((r) => Number(r.lane) === Number(boat.lane) && !usedRows.has(r));
        if (!row) row = series.find((r) => !usedRows.has(r));
        if (row) usedRows.add(row);
        const fromSeries = row ? parseSpeedPoints(row) : [];
        const fromHist = (state.speedHist.get(Number(boat.lane)) || []).filter(
            (p) => Number.isFinite(p.m) && Number.isFinite(p.sp),
        );
        const byM = new Map();
        for (const p of fromSeries.concat(fromHist)) {
            if (!Number.isFinite(p.m) || !Number.isFinite(p.sp)) continue;
            byM.set(Math.round(p.m), { m: p.m, sp: p.sp });
        }
        if (Number.isFinite(boat.m) && Number.isFinite(boat.speed) && boat.speed > 0.2) {
            byM.set(Math.round(boat.m), { m: boat.m, sp: boat.speed });
        }
        const pts = [...byM.values()].sort((a, b) => a.m - b.m);
        if (pts.length === 1) {
            pts.unshift({ m: 0, sp: pts[0].sp });
            if (pts[1].m < 8) pts.push({ m: Math.max(8, pts[1].m + 8), sp: pts[1].sp });
        }
        return pts;
    }

    function speedCrews(boats) {
        const list = [...(boats || [])].sort((a, b) => Number(a.lane) - Number(b.lane));
        if (list.length) return list;
        const series = Array.isArray(state.cvRace?.speed_series) ? state.cvRace.speed_series : [];
        return series.map((row, i) => ({
            lane: Number(row.lane) || i + 1,
            abbr: row.label || row.code || `L${row.lane || i + 1}`,
            name: row.label || '',
            m: NaN,
            speed: NaN,
        }));
    }

    function speedLines(boats) {
        const cols = speedCols();
        const usedRows = new Set();
        return speedCrews(boats).map((b, k) => {
            const hist = speedPointList(b, k, usedRows);
            return {
                hist,
                col: cols[k % cols.length],
                abbr: b.abbr || b.name || `L${b.lane}`,
                lane: b.lane,
                last: hist[hist.length - 1] || null,
            };
        });
    }

    function paintSpeedChart(canvas, boats) {
        if (!canvas || typeof canvas.getContext !== 'function') return;
        const w = 700;
        const h = 260;
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const cols = speedCols();
        const lines = speedLines(boats);
        ctx.clearRect(0, 0, w, h);
        ctx.font = '12px "JetBrains Mono", ui-monospace, monospace';
        ctx.textBaseline = 'middle';
        [
            [30, '6.0'],
            [109, '5.0'],
            [188, '4.0'],
            [228, '3.5'],
        ].forEach(([y, lab]) => {
            ctx.strokeStyle = 'rgba(245,240,228,0.16)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(52, y);
            ctx.lineTo(660, y);
            ctx.stroke();
            ctx.fillStyle = '#9aa6b4';
            ctx.fillText(lab, 10, y);
        });
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#9aa6b4';
        ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
        [
            [52, '0'],
            [179, '500'],
            [306, '1000'],
            [433, '1500'],
            [548, '2000M'],
        ].forEach(([x, lab]) => ctx.fillText(lab, x, 252));
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        lines.forEach((l) => {
            if (l.hist.length >= 2) {
                ctx.beginPath();
                l.hist.forEach((p, i) => {
                    const xy = speedXy(p.m, p.sp);
                    if (i === 0) ctx.moveTo(xy.x, xy.y);
                    else ctx.lineTo(xy.x, xy.y);
                });
                ctx.strokeStyle = l.col;
                ctx.lineWidth = 3.2;
                ctx.stroke();
            }
            if (l.last) {
                const xy = speedXy(l.last.m, l.last.sp);
                ctx.beginPath();
                ctx.arc(xy.x, xy.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = l.col;
                ctx.fill();
                ctx.lineWidth = 1.4;
                ctx.strokeStyle = 'rgba(13,17,23,0.9)';
                ctx.stroke();
            }
        });
        const legend = canvas.parentElement?.querySelector('.kp-speed-legend');
        if (legend) {
            legend.innerHTML = '';
            lines.forEach((l, i) => {
                const s = el('span', '', l.abbr);
                s.style.color = cols[i];
                legend.appendChild(s);
            });
        }
    }

    function renderSpeed(layer, race) {
        const boats = boatsNow(race);
        const root = el('div', 'kp-speed');
        const head = el('div', 'kp-speed-head');
        head.appendChild(liveBadge());
        head.appendChild(
            el(
                'span',
                'kp-speed-title',
                `${vgKpRaceChip(race)} · ${isLiveCvFeed() ? 'Boat speed · m/s · CV' : 'Boat speed · m/s · sim'}`,
            ),
        );
        head.appendChild(el('span', 'kp-tracker-clock', raceClockText()));
        root.appendChild(head);
        const canvas = document.createElement('canvas');
        canvas.className = 'kp-speed-canvas';
        canvas.width = 700;
        canvas.height = 260;
        root.appendChild(canvas);
        root.appendChild(el('div', 'kp-speed-legend'));
        paintSpeedChart(canvas, boats);
        layer.appendChild(root);
    }

    function renderLiveTrack(layer, race) {
        const boats = boatsNow(race);
        const root = el('div', 'kp-livetrack');
        const head = el('div', 'kp-live-head');
        head.appendChild(liveBadge());
        head.appendChild(el('span', '', `${vgKpRaceChip(race)} · ${eventName(race)} — live tracking`));
        head.appendChild(el('span', 'kp-tracker-clock', raceClockText()));
        root.appendChild(head);
        const course = el('div', 'kp-live-course');
        const grid = el('div', 'kp-live-grid');
        ['START', '500M', '1000M', '1500M', 'FINISH'].forEach((lab, i) => {
            const m = el('div', 'kp-live-mark');
            m.style.left = `${i * 25}%`;
            if (i === 4) m.style.background = festive() ? 'rgba(229,72,77,0.8)' : 'rgba(46,125,224,0.8)';
            m.appendChild(el('span', i === 4 ? 'kp-finish' : '', lab));
            grid.appendChild(m);
        });
        course.appendChild(grid);
        const leadM = Math.max(...boats.map((b) => b.m), 1);
        boats.forEach((b, i) => {
            const lab = el('span', 'kp-live-lab', `${b.lane}`);
            lab.style.top = `${28 + i * 22}px`;
            lab.style.color = b.m === leadM ? 'var(--alt-sky)' : 'var(--alt-grey-500)';
            course.appendChild(lab);
            const lane = el('div', 'kp-live-lane');
            lane.style.top = `${28 + i * 22}px`;
            lane.style.left = '48px';
            lane.style.right = '48px';
            const dot = el('div', b.m === leadM ? 'kp-live-dot-boat kp-live-dot-boat--lead' : 'kp-live-dot-boat');
            dot.style.left = `${(b.m / 20).toFixed(2)}%`;
            lane.appendChild(dot);
            const ab = el('span', 'kp-suit-abbr', b.abbr);
            ab.style.position = 'absolute';
            ab.style.right = '-44px';
            ab.style.top = '0';
            lane.appendChild(ab);
            course.appendChild(lane);
        });
        root.appendChild(course);
        layer.appendChild(root);
    }

    function renderCvCourse(layer) {
        mountCvFrame(layer, 'vmix-ged-cv-course.html', 'kp-cvframe kp-cvframe--course');
    }

    function renderCvSplits(layer) {
        mountCvFrame(layer, 'vmix-ged-cv-splits.html', 'kp-cvframe kp-cvframe--splits');
    }

    function renderCvStart(layer, race) {
        const root = el('div', 'kp-cvstart');
        const head = el('div', 'kp-cvstart-head');
        head.appendChild(liveBadge());
        const simCrews = state.cvRace?.sim ? boatsNow(race) : null;
        head.appendChild(
            el(
                'span',
                'kp-cvstart-title',
                race
                    ? `Start list · ${vgKpRaceChip(race)} · ${eventName(race)}`
                    : 'Start list · waiting daysheet',
            ),
        );
        head.appendChild(el('span', 'kp-cvstart-hint', 'CV lane tags'));
        root.appendChild(head);
        const stage = el('div', 'kp-cvstart-stage');
        stage.id = 'kpCvStartStage';
        const still = startStillTestSrc();
        if (still) {
            stage.classList.add('has-start-still');
            const pic = document.createElement('img');
            pic.className = 'kp-cvstart-still';
            pic.src = still;
            pic.alt = '';
            stage.appendChild(pic);
        }
        const lanes = simCrews?.length
            ? simCrews.map((b) => ({
                  lane: b.lane,
                  code: b.abbr,
                  name: b.name,
                  logoUrl: b.logoUrl,
                  abbr: b.abbr,
              }))
            : (race ? laneEntries(race) : []).map((lane) => {
                  const club = clubOf(lane.code);
                  return {
                      lane: lane.lane,
                      code: lane.code,
                      name: club.name || club.abbr,
                      logoUrl: club.logoUrl,
                      abbr: club.abbr,
                  };
              });
        lanes.forEach((lane, i) => {
            const club = {
                name: lane.name,
                abbr: lane.abbr,
                logoUrl: lane.logoUrl,
            };
            const card = el('div', 'kp-cvstart-card is-waiting');
            card.dataset.lane = String(lane.lane);
            card.dataset.idx = String(i);
            const laneNum = el('span', 'kp-cvstart-lane', String(lane.lane));
            const copy = el('div', 'kp-cvstart-copy');
            copy.appendChild(
                el('span', 'kp-cvstart-name', club.name || club.abbr || lane.code || `Lane ${lane.lane}`),
            );
            copy.appendChild(el('span', 'kp-cvstart-abbr', club.abbr || `L${lane.lane}`));
            card.appendChild(crewLogo(club, 'kp-crew-logo--cvstart'));
            card.appendChild(laneNum);
            card.appendChild(copy);
            stage.appendChild(card);
        });
        if (!lanes.length) {
            stage.appendChild(el('p', 'kp-cvstart-empty', 'No crews on daysheet for this race'));
        }
        root.appendChild(stage);
        layer.appendChild(root);
        paintCvStartPositions();
    }

    function renderCvPositions(layer, race) {
        const root = el('div', 'kp-cvpos');
        root.id = 'kpCvPos';
        const panel = el('div', 'kp-cvpos__panel');
        const head = el('div', 'kp-cvpos__head');
        const titleRow = el('div', 'kp-cvpos__title-row');
        titleRow.appendChild(liveBadge());
        titleRow.appendChild(el('h2', 'kp-cvpos__title', 'CV positions'));
        titleRow.appendChild(el('span', 'kp-cvpos__clock kp-tracker-clock', raceClockText()));
        head.appendChild(titleRow);
        head.appendChild(
            el(
                'p',
                'kp-cvpos__meta',
                race ? `${vgKpRaceChip(race)} · ${eventName(race)}` : 'Waiting daysheet',
            ),
        );
        head.appendChild(el('p', 'kp-cvpos__togo', '—'));
        panel.appendChild(head);
        panel.appendChild(el('div', 'kp-cvpos__list'));
        root.appendChild(panel);
        layer.appendChild(root);
        paintCvPositions(race);
    }

    function paintCvPositions(race) {
        const root = document.getElementById('kpCvPos');
        if (!root) return;
        const r = race || vgFindRace(vgGetRaceParam());
        const list = root.querySelector('.kp-cvpos__list');
        const toGo = root.querySelector('.kp-cvpos__togo');
        const clock = root.querySelector('.kp-cvpos__clock');
        const badgeHost = root.querySelector('.kp-cvpos__title-row');
        if (clock) clock.textContent = raceClockText();
        if (badgeHost) {
            const old = badgeHost.querySelector('.kp-live');
            const next = liveBadge();
            if (old && old.className === next.className && old.textContent === next.textContent) {
                /* keep */
            } else if (old) {
                old.replaceWith(next);
            }
        }
        const ranked = r ? stableBoatsRanked(r) : [];
        const leadM = ranked[0]?.m;
        if (toGo) {
            if (Number.isFinite(leadM)) {
                const left = Math.max(0, Math.round(COURSE_M - leadM));
                toGo.textContent = `${left.toLocaleString('en-NZ')} m to go`;
            } else {
                toGo.textContent = cvLive() ? 'Waiting stable CV' : 'Sim · no leader yet';
            }
        }
        if (!list) return;
        const sig = ranked.map((b) => b.lane).join(',');
        if (list.dataset.sig === sig && list.children.length === ranked.length) {
            ranked.forEach((b, i) => {
                const row = list.children[i];
                if (!row) return;
                row.classList.toggle('kp-cvpos__row--lead', i === 0);
                const rank = row.querySelector('.kp-cvpos__rank');
                const gap = row.querySelector('.kp-cvpos__gap');
                if (rank) rank.textContent = String(i + 1);
                if (gap) gap.textContent = gapFromLeader(leadM, b.m);
            });
            return;
        }
        list.dataset.sig = sig;
        list.replaceChildren();
        if (!ranked.length) {
            list.appendChild(
                el(
                    'div',
                    'kp-cvpos__empty',
                    cvLive() ? 'No stable CV crews yet' : 'Waiting CV link',
                ),
            );
            return;
        }
        ranked.forEach((b, i) => {
            const row = el('div', i === 0 ? 'kp-cvpos__row kp-cvpos__row--lead' : 'kp-cvpos__row');
            row.dataset.lane = String(b.lane);
            row.appendChild(el('span', 'kp-cvpos__rank', String(i + 1)));
            row.appendChild(crewLogo(b, 'kp-crew-logo--cvpos'));
            row.appendChild(el('span', 'kp-cvpos__lane', String(b.lane)));
            const copy = el('div', 'kp-cvpos__copy');
            copy.appendChild(el('span', 'kp-cvpos__name', b.name || b.abbr || `Lane ${b.lane}`));
            copy.appendChild(el('span', 'kp-cvpos__abbr', b.abbr || `L${b.lane}`));
            row.appendChild(copy);
            row.appendChild(el('span', 'kp-cvpos__gap', gapFromLeader(leadM, b.m)));
            list.appendChild(row);
        });
    }

    function paintCvStartPositions() {
        const stage = document.getElementById('kpCvStartStage');
        if (!stage) return;
        const snap = state.cvRace;
        const fw = Math.max(1, Number(snap?.frame_w) || 1920);
        const fh = Math.max(1, Number(snap?.frame_h) || 1080);
        const byLane = new Map(
            (snap?.boats || [])
                .filter((b) => Number.isFinite(Number(b.lane)))
                .map((b) => [Number(b.lane), b]),
        );
        const cards = [...stage.querySelectorAll('.kp-cvstart-card')];
        const n = Math.max(1, cards.length);
        cards.forEach((card, i) => {
            const lane = Number(card.dataset.lane);
            const b = byLane.get(lane);
            const stillXy = startStillTestSrc() ? startStillLaneXy(lane) : null;
            const x = Number(stillXy?.x ?? b?.x);
            const y = Number(stillXy?.y ?? b?.y);
            const onStill = Boolean(stillXy);
            const live =
                Number.isFinite(x) &&
                Number.isFinite(y) &&
                (x > 0 || y > 0) &&
                (onStill || b?.detected !== false);
            if (live) {
                const px = (x / fw) * 1920;
                const py = (y / fh) * 1080 - START_TAG_LIFT_PX;
                card.style.left = `${px.toFixed(1)}px`;
                card.style.top = `${py.toFixed(1)}px`;
                card.classList.remove('is-waiting');
                card.classList.toggle('is-stale', b?.coasting || b?.cv_status === 'amber');
            } else {
                // Waiting CV: fan tags across the lower third by draw order.
                const t = (i + 0.5) / n;
                card.style.left = `${(120 + t * 1680).toFixed(1)}px`;
                card.style.top = '820px';
                card.classList.add('is-waiting');
                card.classList.remove('is-stale');
            }
        });
        const head = stage.parentElement?.querySelector('.kp-cvstart-hint');
        if (head) {
            const liveN = cards.filter((c) => !c.classList.contains('is-waiting')).length;
            head.textContent = startStillTestSrc()
                ? 'Test still · tags on start pontoons'
                : cvLive()
                  ? `${liveN}/${cards.length} on camera`
                  : 'Waiting CV · tags park until boats are seen';
        }
    }

    function svgEl(tag, attrs) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, String(v)));
        return node;
    }

    function followConnectorPoints(ax, ay, bx, by, cardW, cardH) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const px = -uy;
        const py = ux;
        const thin = 1.5;
        const thick = 14;
        // KRI: fat end continues past the wrap origin so it reads as going behind the panel.
        const extend = Math.max(32, Math.min((cardW || 180) * 0.45, (cardH || 100) * 0.55, 80));
        const ex = bx + ux * extend;
        const ey = by + uy * extend;
        return [
            [ax + px * thin, ay + py * thin],
            [ax - px * thin, ay - py * thin],
            [ex - px * thick, ey - py * thick],
            [ex + px * thick, ey + py * thick],
        ]
            .map((pt) => pt.map((n) => n.toFixed(1)).join(','))
            .join(' ');
    }

    function renderCvFollow(layer, race) {
        state.followPos = null;
        const { lead } = leadOf(race);
        const root = el('div', 'kp-cvfollow');
        root.id = 'kpCvFollow';
        const svg = svgEl('svg', {
            class: 'kp-cvfollow-svg',
            viewBox: '0 0 1920 1080',
            preserveAspectRatio: 'none',
        });
        svg.appendChild(svgEl('polygon', { class: 'kp-cvfollow-connector', points: '' }));
        root.appendChild(svg);
        const wrap = el('div', 'kp-cvfollow-cardwrap');
        const card = el('div', 'kp-cvfollow-card');
        card.appendChild(bar('kp-bar--sm'));
        const body = el('div', 'kp-bug-body kp-cvfollow-body');
        body.appendChild(chip('Leader'));
        if (lead) body.appendChild(crewLogo(lead, 'kp-crew-logo--bug'));
        body.appendChild(el('span', 'kp-bug-name kp-cvfollow-name', lead?.abbr || lead?.name || '—'));
        body.appendChild(el('span', 'kp-bug-lane kp-cvfollow-lane', lead ? `Lane ${lead.lane}` : ''));
        body.appendChild(el('span', 'kp-bug-rule'));
        body.appendChild(
            el('span', 'kp-bug-dist', lead ? `${Math.round((lead.m || 0) / 10) * 10}m` : ''),
        );
        body.appendChild(el('span', 'kp-bug-gap', ''));
        card.appendChild(body);
        wrap.appendChild(card);
        root.appendChild(wrap);
        layer.appendChild(root);
        paintCvFollow();
    }

    function paintCvFollow() {
        const root = document.getElementById('kpCvFollow');
        if (!root) return;
        const race = currentRace();
        const { lead, second } = leadOf(race);
        const wrap = root.querySelector('.kp-cvfollow-cardwrap');
        const card = root.querySelector('.kp-cvfollow-card');
        const connector = root.querySelector('.kp-cvfollow-connector');
        const name = root.querySelector('.kp-cvfollow-name');
        const laneEl = root.querySelector('.kp-cvfollow-lane');
        const dist = root.querySelector('.kp-bug-dist');
        const gap = root.querySelector('.kp-bug-gap');
        if (name && lead) name.textContent = lead.abbr || lead.name || '—';
        if (laneEl && lead) laneEl.textContent = `Lane ${lead.lane}`;
        if (dist && lead) dist.textContent = `${Math.round((lead.m || 0) / 10) * 10}m`;
        if (gap && lead && second) {
            const d = lead.m - second.m;
            gap.textContent = cvLive()
                ? d < 0.4
                    ? 'LDR'
                    : `+${d.toFixed(0)}m`
                : `+${(d / 5.35).toFixed(1)}s`;
        } else if (gap) {
            gap.textContent = '';
        }
        const xy = mixFollowBoat(lead ? boatScreenSmoothed(lead.lane) : null);
        if (!xy || !lead) {
            root.classList.add('is-waiting');
            if (wrap) wrap.style.transform = 'translate(1600px, 200px) translate(-100%, -100%)';
            if (connector) connector.setAttribute('points', '');
            return;
        }
        root.classList.remove('is-waiting');
        const cardW = card?.offsetWidth || 280;
        const cardH = card?.offsetHeight || 72;
        const distPx = Math.max(80, cardH * 2) * 0.75;
        const side = state.followSide || { left: false, down: false };
        const overflowRight = xy.x + CV_BOX_HALF + distPx * Math.SQRT1_2 + cardW;
        const overflowTop = xy.y - CV_BOX_HALF - distPx * Math.SQRT1_2 - cardH;
        if (side.left) {
            if (overflowRight < 1800) side.left = false;
        } else if (overflowRight > 1880) {
            side.left = true;
        }
        if (side.down) {
            if (overflowTop > 48) side.down = false;
        } else if (overflowTop < 24) {
            side.down = true;
        }
        state.followSide = side;
        const ax = xy.x + (side.left ? -CV_BOX_HALF : CV_BOX_HALF);
        const ay = xy.y + (side.down ? CV_BOX_HALF : -CV_BOX_HALF);
        const pos = mixFollow(
            ax + distPx * (side.left ? -Math.SQRT1_2 : Math.SQRT1_2),
            ay + distPx * (side.down ? Math.SQRT1_2 : -Math.SQRT1_2),
        );
        if (wrap) {
            const ox = side.left ? '-100%' : '0';
            const oy = side.down ? '0' : '-100%';
            wrap.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px) translate(${ox}, ${oy})`;
        }
        if (connector) {
            connector.setAttribute(
                'points',
                followConnectorPoints(ax, ay, pos.x, pos.y, cardW, cardH),
            );
        }
    }

    function renderCvBoatTags(layer, race) {
        const root = el('div', 'kp-boattags');
        root.id = 'kpCvBoatTags';
        boatsNow(race).forEach((club, i) => {
            const tag = el('div', 'kp-boattag is-waiting');
            tag.dataset.lane = String(club.lane);
            tag.style.animationDelay = `${0.06 + i * 0.04}s`;
            tag.appendChild(crewLogo(club, 'kp-crew-logo--strip'));
            tag.appendChild(el('span', 'kp-suit-lane', `L${club.lane}`));
            tag.appendChild(el('span', 'kp-suit-abbr', club.abbr || `L${club.lane}`));
            root.appendChild(tag);
        });
        if (!root.childElementCount) {
            root.appendChild(el('p', 'kp-cvstart-empty', 'Waiting draw / CV boats'));
        }
        layer.appendChild(root);
        paintCvBoatTags();
    }

    function viewSideBlend() {
        const pts = [];
        for (const b of state.cvRace?.boats || []) {
            const xy = boatScreenSmoothed(Number(b.lane));
            if (xy) pts.push(xy);
        }
        let raw = 0;
        if (pts.length >= 2) {
            const ys = pts.map((p) => p.y);
            const xs = pts.map((p) => p.x);
            const yr = Math.max(...ys) - Math.min(...ys);
            const xr = Math.max(...xs) - Math.min(...xs);
            if (yr < 140 || (xr > 280 && yr < xr * 0.28)) raw = 1;
        } else if (boatDirection() !== 'away') {
            raw = 1;
        }
        if (state.viewBlend == null) state.viewBlend = raw;
        else state.viewBlend += (raw - state.viewBlend) * 0.07;
        return state.viewBlend;
    }

    function paintCvBoatTags() {
        const root = document.getElementById('kpCvBoatTags');
        if (!root) return;
        const race = currentRace();
        const boats = boatsNow(race);
        const leadLane = leadOf(race).lead?.lane;
        const blend = viewSideBlend();
        const rot = '0deg';
        const tags = [...root.querySelectorAll('.kp-boattag')];
        const n = Math.max(1, tags.length);
        tags.forEach((tag, i) => {
            const lane = Number(tag.dataset.lane);
            const club = boats.find((b) => b.lane === lane);
            const xy = boatScreenSmoothed(lane);
            tag.classList.toggle('kp-boattag--lead', Number(leadLane) === lane);
            tag.style.setProperty('--kp-tag-rot', rot);
            const abbr = tag.querySelector('.kp-suit-abbr');
            if (abbr && club) abbr.textContent = club.abbr || `L${lane}`;
            if (xy) {
                const tw = tag.offsetWidth || 52;
                const th = tag.offsetHeight || 70;
                const dx = (CV_BOX_HALF + tw / 2 + CV_TAG_GAP_PX) * (1 - blend);
                const dy = -(CV_BOX_HALF + th / 2 + CV_TAG_GAP_PX) * blend;
                tag.style.left = `${(xy.x + dx).toFixed(1)}px`;
                tag.style.top = `${(xy.y + dy).toFixed(1)}px`;
                tag.classList.remove('is-waiting');
                tag.classList.toggle('is-stale', club?.coasting || club?.cvStatus === 'amber');
            } else {
                const t = (i + 0.5) / n;
                tag.style.left = `${(140 + t * 1640).toFixed(1)}px`;
                tag.style.top = '820px';
                tag.classList.add('is-waiting');
                tag.classList.remove('is-stale');
            }
        });
    }

    function renderCourse(layer) {
        // Legacy decorative course — redirect to live CV drone course.
        renderCvCourse(layer);
    }

    const RENDER = {
        title: renderTitle,
        lower: renderLower,
        draw: renderDraw,
        results: renderResults,
        schedule: (layer) => renderSchedule(layer, vgGetRaceParam()),
        leader: (layer, race) =>
            renderLeader(layer, race, cvLive() ? null : (vgLeaderLane ?? vgGetLeaderLane())),
        drill: renderDrill,
        suits: renderSuits,
        suitstrip: renderSuitStrip,
        lowersuits: renderLowerSuits,
        brand: renderBrand,
        next: (layer) => renderNext(layer),
        prev: (layer) => renderPrev(layer),
        tracker: renderTracker,
        speedchart: renderSpeed,
        livetracking: renderLiveTrack,
        cvleader: renderCvLeader,
        cvdraw: renderCvDraw,
        coursescroll: renderCvCourse,
        cvcourse: renderCvCourse,
        cvsplits: renderCvSplits,
        cvstart: renderCvStart,
        cvpositions: renderCvPositions,
        cvfollow: renderCvFollow,
        cvboattags: renderCvBoatTags,
    };

    function render(layer, graphic, race) {
        const g = canon(graphic);
        vgSetLayerGraphicClass(layer, LAYER_CLASS[g] || 'vg-layer--title');
        const fn = RENDER[g];
        if (!fn) return false;
        const r = currentRace() || race;
        if (
            !r &&
            g !== 'title' &&
            g !== 'schedule' &&
            g !== 'weather' &&
            g !== 'brand' &&
            g !== 'cvcourse' &&
            g !== 'cvsplits' &&
            g !== 'coursescroll' &&
            g !== 'cvstart' &&
            g !== 'cvdraw' &&
            g !== 'cvpositions' &&
            g !== 'cvfollow' &&
            g !== 'cvboattags' &&
            g !== 'speedchart' &&
            g !== 'tracker' &&
            g !== 'livetracking'
        ) {
            return false;
        }
        fn(layer, r);
        syncClipBackground(g);
        paintOps();
        return true;
    }

    function ensureSnow() {
        let snow = document.getElementById('vgKpSnow');
        if (!festive()) {
            snow?.remove();
            return;
        }
        if (!snow) {
            snow = el('div', 'kp-snow');
            snow.id = 'vgKpSnow';
            document.querySelector('.vg-stage')?.appendChild(snow);
        }
        if (!state.flakes.length) {
            for (let i = 0; i < 70; i++) {
                state.flakes.push({
                    l: Math.random() * 100,
                    s: 2.5 + Math.random() * 4.5,
                    d: 7 + Math.random() * 9,
                    del: -Math.random() * 16,
                    o: 0.25 + Math.random() * 0.55,
                });
            }
        }
        snow.replaceChildren();
        state.flakes.forEach((f) => {
            const d = el('div', 'kp-flake');
            d.style.left = `${f.l}%`;
            d.style.width = `${f.s}px`;
            d.style.height = `${f.s}px`;
            d.style.opacity = String(f.o);
            d.style.animationDuration = `${f.d.toFixed(1)}s`;
            d.style.animationDelay = `${f.del.toFixed(1)}s`;
            snow.appendChild(d);
        });
    }

    function ensureBrandLayer() {
        let brand = document.getElementById('vgKpBrand');
        if (!brand) {
            brand = el('div', '');
            brand.id = 'vgKpBrand';
            brand.style.position = 'absolute';
            brand.style.inset = '0';
            brand.style.pointerEvents = 'none';
            brand.style.zIndex = '14';
            document.querySelector('.vg-stage')?.appendChild(brand);
        }
        brand.replaceChildren();
        if (state.brand) renderBrand(brand);
        paintOps();
    }

    function toggleBrand() {
        state.brand = !state.brand;
        ensureBrandLayer();
    }

    function showGraphic(g) {
        if (g === 'brand') {
            toggleBrand();
            return;
        }
        if (vgPlayback.state !== 'idle') vgTriggerClear();
        vgTriggerIn(g);
    }

    function setDrill(lane) {
        state.drillLane = lane;
        if (vgPlayback.graphic === 'drill' && vgPlayback.state !== 'idle') {
            const layer = vgGetLayerEl();
            if (layer) {
                layer.replaceChildren();
                renderDrill(layer, vgFindRace(vgGetRaceParam()));
            }
            paintOps();
            return;
        }
        vgTriggerIn('drill');
    }

    function playString(name) {
        stopString();
        const strings = {
            l3: [
                { g: 'lower', hold: 4500 },
                { g: 'drill', hold: 6000 },
                { g: 'suitstrip', hold: 6000 },
            ],
            drawstr: [
                { g: 'draw', hold: 8000 },
                { g: 'cvdraw', hold: 0 },
            ],
            resultstr: [
                { g: 'results', hold: 10000 },
                { g: 'next', hold: 0 },
            ],
        };
        const seq = strings[name];
        if (!seq) return;
        const tok = ++state.stringTok;
        let i = 0;
        const step = () => {
            if (state.stringTok !== tok) return;
            const s = seq[i];
            showGraphic(s.g);
            i += 1;
            if (i < seq.length && s.hold) {
                state.stringTimer = setTimeout(step, s.hold);
            }
        };
        step();
    }

    function stopString() {
        state.stringTok += 1;
        if (state.stringTimer) {
            clearTimeout(state.stringTimer);
            state.stringTimer = null;
        }
    }

    function paintOps() {
        const ops = document.getElementById('vgKpOps');
        if (!ops) return;
        ops.querySelectorAll('[data-kp-g]').forEach((btn) => {
            const g = btn.getAttribute('data-kp-g');
            const on = g === 'brand' ? state.brand : vgPlayback.graphic === g && vgPlayback.state !== 'idle';
            btn.classList.toggle('is-on', on);
        });
        ops.querySelectorAll('[data-kp-lane]').forEach((btn) => {
            const lane = +btn.getAttribute('data-kp-lane');
            btn.classList.toggle('is-on', vgPlayback.graphic === 'drill' && state.drillLane === lane);
        });
        const race = vgFindRace(vgGetRaceParam());
        const lab = ops.querySelector('[data-kp-race]');
        if (lab && race) lab.textContent = `${vgKpRaceChip(race)} · ${eventName(race)}`;
    }

    function buildOps() {
        if (new URLSearchParams(location.search).get('live') === '1') {
            document.body.dataset.vmixLive = '1';
            return;
        }
        if (!document.documentElement.classList.contains('vg-preview')) return;
        const hint = document.querySelector('.vg-preview-hint');
        if (hint) hint.hidden = true;
        const root = el('div', 'kp-ops');
        root.id = 'vgKpOps';
        const min = el('button', 'kp-ops-min', '— Hide keys');
        min.addEventListener('click', (e) => {
            e.stopPropagation();
            state.ctrlOpen = !state.ctrlOpen;
            root.querySelectorAll('.kp-ops-row').forEach((r) => {
                r.hidden = !state.ctrlOpen;
            });
            min.textContent = state.ctrlOpen ? '— Hide keys' : '+ Show keys';
        });
        root.appendChild(min);
        const row = el('div', 'kp-ops-row');
        OPS.forEach(([k, label, g]) => {
            const b = el('button', '', `${k} · ${label}`);
            b.dataset.kpG = g;
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                stopString();
                if (g === 'brand') toggleBrand();
                else if (vgPlayback.graphic === g && vgPlayback.state !== 'idle') vgTriggerOut();
                else showGraphic(g);
            });
            row.appendChild(b);
        });
        const clr = el('button', 'kp-ops-clear', 'C · Clear');
        clr.addEventListener('click', (e) => {
            e.stopPropagation();
            stopString();
            vgTriggerClear();
            paintOps();
        });
        row.appendChild(clr);
        root.appendChild(row);
        const row2 = el('div', 'kp-ops-row');
        row2.appendChild(el('span', 'kp-sponsor-label', 'Drill lane'));
        for (let i = 1; i <= 8; i++) {
            const b = el('button', '', String(i));
            b.dataset.kpLane = String(i);
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                stopString();
                setDrill(i);
            });
            row2.appendChild(b);
        }
        row2.appendChild(el('span', 'kp-sponsor-label', 'hold D + 1–8'));
        ;[
            ['L3 → drill → suits', 'l3'],
            ['Draw → CV draw + L3', 'drawstr'],
            ['Results → next race', 'resultstr'],
        ].forEach(([label, name]) => {
            const b = el('button', '', `▸ ${label}`);
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                playString(name);
            });
            row2.appendChild(b);
        });
        root.appendChild(row2);
        const row3 = el('div', 'kp-ops-row');
        const prev = el('button', '', '‹');
        prev.addEventListener('click', (e) => {
            e.stopPropagation();
            vgStepLiveRace(-1);
            paintOps();
        });
        const next = el('button', '', '›');
        next.addEventListener('click', (e) => {
            e.stopPropagation();
            vgStepLiveRace(1);
            paintOps();
        });
        const lab = el('span', '', '');
        lab.dataset.kpRace = '1';
        lab.style.minWidth = '230px';
        lab.style.textAlign = 'center';
        lab.style.color = '#f5f0e4';
        lab.style.fontFamily = 'var(--font-mono)';
        lab.style.fontSize = '12px';
        row3.appendChild(prev);
        row3.appendChild(lab);
        row3.appendChild(next);
        row3.appendChild(el('span', 'kp-sponsor-label', 'vMix: ?g=title,lower · ?live=1 hides keys · ?festive=1 Christmas'));
        root.appendChild(row3);
        document.querySelector('.vg-stage')?.appendChild(root);
        paintOps();
    }

    function onKey(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        const k = e.key.toLowerCase();
        const preview = document.documentElement.classList.contains('vg-preview');
        if (k === 'd') {
            if (!e.repeat) {
                state.dHeld = true;
                state.dCombo = false;
            }
            if (preview) {
                e.preventDefault();
                return true;
            }
            return false;
        }
        if (state.dHeld && /^[1-8]$/.test(k)) {
            state.dCombo = true;
            e.preventDefault();
            setDrill(+k);
            return true;
        }
        if (GED_KEYS[k] && preview) {
            e.preventDefault();
            stopString();
            const g = GED_KEYS[k];
            if (g === 'brand') toggleBrand();
            else if (vgPlayback.graphic === g && vgPlayback.state !== 'idle') vgTriggerOut();
            else showGraphic(g);
            return true;
        }
        return false;
    }

    function onKeyUp(e) {
        if (e.key.toLowerCase() !== 'd') return;
        const combo = state.dCombo;
        state.dHeld = false;
        state.dCombo = false;
        if (!combo && document.documentElement.classList.contains('vg-preview')) {
            stopString();
            if (vgPlayback.graphic === 'drill' && vgPlayback.state !== 'idle') vgTriggerOut();
            else showGraphic('drill');
        }
    }

    function tick() {
        state.t += 0.1;
        pullClipRace();
        const g = canon(vgPlayback.graphic);
        syncClipBackground(vgPlayback.state === 'idle' ? '' : g);
        if (!g || vgPlayback.state === 'idle') return;
        const race = currentRace();
        if (!race) return;
        const boats = boatsNow(race);
        const leadM = Math.max(...boats.map((b) => b.m), 1);
        const clock = raceClockText();
        document.querySelectorAll('.kp-tracker-clock').forEach((n) => {
            n.textContent = clock;
        });
        if (g === 'tracker') {
            document.querySelectorAll('.kp-track-row').forEach((row, i) => {
                const b = boats[i];
                if (!b) return;
                const fill = row.querySelector('.kp-track-fill');
                const m = row.querySelector('.kp-track-m');
                if (fill) {
                    fill.style.width = `${(b.m / 20).toFixed(1)}%`;
                    fill.classList.toggle('kp-track-fill--lead', b.m === leadM);
                }
                if (m) m.textContent = `${Math.round(b.m)}m`;
            });
        }
        if (g === 'livetracking') {
            document.querySelectorAll('.kp-live-dot-boat').forEach((dot, i) => {
                const b = boats[i];
                if (!b) return;
                dot.style.left = `${(b.m / 20).toFixed(2)}%`;
                dot.classList.toggle('kp-live-dot-boat--lead', b.m === leadM);
            });
            document.querySelectorAll('.kp-live-lab').forEach((lab, i) => {
                const b = boats[i];
                if (!b) return;
                lab.style.color = b.m === leadM ? 'var(--alt-sky)' : 'var(--alt-grey-500)';
            });
        }
        if (g === 'leader') {
            const { lead, second } = leadOf(race);
            const dist = document.querySelector('.kp-bug-dist');
            const gap = document.querySelector('.kp-bug-gap');
            const name = document.querySelector('.kp-bug-name');
            const laneEl = document.querySelector('.kp-bug-lane');
            if (dist && lead) dist.textContent = `${Math.round(lead.m / 10) * 10}m`;
            if (name && lead) name.textContent = lead.name || lead.abbr || '';
            if (laneEl && lead) laneEl.textContent = `Lane ${lead.lane}`;
            if (gap && lead && second) {
                const d = lead.m - second.m;
                gap.textContent = cvLive()
                    ? d < 0.4
                        ? 'LDR'
                        : `+${d.toFixed(0)}m`
                    : `+${(d / 5.35).toFixed(1)}s`;
            }
        }
        if (g === 'cvleader') {
            const { lead } = leadOf(race);
            const val = document.querySelector('.kp-cvleader-val');
            if (val && lead) val.textContent = `L${lead.lane} ${lead.abbr}`;
        }
        if (g === 'cvdraw') {
            const ranked = [...boats].sort((a, b) => b.m - a.m);
            const head = document.querySelector('.kp-cvdraw-head');
            if (head) head.textContent = `${cvLive() ? 'Order' : 'Draw'} · ${vgKpRaceChip(race)}`;
            document.querySelectorAll('.kp-cvdraw-row').forEach((row) => {
                const lane = Number(row.dataset.lane);
                const b = boats.find((x) => x.lane === lane);
                const rank = ranked.findIndex((x) => x.lane === lane);
                row.style.order = String(rank < 0 ? 99 : rank);
                row.classList.toggle('kp-row--first', cvLive() && rank === 0);
                const mEl = row.querySelector('.kp-cvdraw-m');
                if (mEl) mEl.textContent = cvLive() && b ? `${Math.round(b.m)}m` : '';
            });
        }
        if (g === 'speedchart') {
            paintSpeedChart(document.querySelector('.kp-speed canvas'), boats);
        }
        if (g === 'cvstart') {
            paintCvStartPositions();
        }
        if (g === 'cvpositions') {
            paintCvPositions(race);
        }
    }

    function cvPaintFrame() {
        state.cvPaintRaf = requestAnimationFrame(cvPaintFrame);
        pullClipRace();
        smoothCvScreen();
        const g = canon(vgPlayback.graphic);
        if (!g || vgPlayback.state === 'idle') return;
        if (g === 'cvfollow') paintCvFollow();
        if (g === 'cvboattags') paintCvBoatTags();
        if (g === 'cvstart') paintCvStartPositions();
        paintCvDebugBoxes();
    }

    function init() {
        ensureSnow();
        loadRecords();
        const q = new URLSearchParams(location.search);
        const g = (q.get('g') || '').toLowerCase();
        if (!g && q.get('live') !== '1') {
            state.brand = true;
            ensureBrandLayer();
        }
        buildOps();
        window.addEventListener('keyup', onKeyUp);
        if (!state.motionTimer) state.motionTimer = setInterval(tick, 100);
        if (!state.cvPaintRaf) state.cvPaintRaf = requestAnimationFrame(cvPaintFrame);
        pollCv();
        setInterval(pollCv, 200);
        document.addEventListener('altitudehd:liverace', () => {
            state.chHold.clear();
            state.speedHist.clear();
            state.boatSmooth.clear();
            state.boatTel.clear();
            state.followPos = null;
            state.followBoat = null;
            state.leadLane = null;
            state.viewBlend = null;
            state.dirHold = { dir: 'away', since: 0 };
            state.simGraphicFp = '';
            paintOps();
        });
    }

    window.VmixKarapiro = {
        owns(graphic) {
            return !!OWN[canon(graphic)];
        },
        render,
        init,
        onKey,
        paintOps,
        canon,
    };
})();
