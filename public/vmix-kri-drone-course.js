(function () {
    const START = { lat: -37.943356, lng: 175.556788 };
    const FINISH = { lat: -37.929223, lng: 175.542716 };
    const EARTH_R = 6371000;
    const LANE_COUNT = 8;
    const LANE_M = 12.5;
    const COURSE_M = 2000;

    const params = new URLSearchParams(location.search);
    const laptop = (params.get("cvLaptop") || params.get("laptop") || "").replace(/\/$/, "");
    const telemetryUrl =
        params.get("telemetry") ||
        (laptop ? `${laptop}/api/drone-telemetry` : "http://127.0.0.1:5050/api/drone-telemetry");
    const raceUrl = params.get("race") || (laptop ? `${laptop}/api/race` : "");
    const configUrl = laptop ? `${laptop}/api/config` : "";
    const forcePlan = params.get("view") === "plan";

    let hfovDeg = 73;
    let pitchOffset = 0;
    let lastPose = null;
    let latestRace = null;
    let displayPose = null;
    let sampleA = null;
    let sampleB = null;
    let lastFrameMs = 0;
    const POSE_TAU_S = 0.4;
    const EXTRAPOLATE_S = 1.2;

    function toEnu(lat, lng, lat0, lon0) {
        const lat0r = (lat0 * Math.PI) / 180;
        return {
            e: (((lng - lon0) * Math.PI) / 180) * Math.cos(lat0r) * EARTH_R,
            n: (((lat - lat0) * Math.PI) / 180) * EARTH_R,
        };
    }

    const f0 = toEnu(FINISH.lat, FINISH.lng, START.lat, START.lng);
    const axisLen = Math.hypot(f0.e, f0.n) || 1;
    const ux = f0.e / axisLen;
    const uy = f0.n / axisLen;
    const halfW = (LANE_COUNT * LANE_M) / 2;
    const scale = COURSE_M / axisLen;

    function llAt(chainM, acrossM) {
        const chain = chainM / scale;
        const across = acrossM / scale;
        const e = chain * ux - across * uy;
        const n = chain * uy + across * ux;
        const lat0r = (START.lat * Math.PI) / 180;
        return {
            lat: START.lat + (n / EARTH_R) * (180 / Math.PI),
            lng: START.lng + (e / (EARTH_R * Math.cos(lat0r))) * (180 / Math.PI),
        };
    }

    function haversineM(aLat, aLng, bLat, bLng) {
        const p1 = (aLat * Math.PI) / 180;
        const p2 = (bLat * Math.PI) / 180;
        const dφ = p2 - p1;
        const dλ = ((bLng - aLng) * Math.PI) / 180;
        const h =
            Math.sin(dφ / 2) ** 2 +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dλ / 2) ** 2;
        return 2 * EARTH_R * Math.asin(Math.sqrt(h));
    }

    function bearingDeg(aLat, aLng, bLat, bLng) {
        const φ1 = (aLat * Math.PI) / 180;
        const φ2 = (bLat * Math.PI) / 180;
        const Δλ = ((bLng - aLng) * Math.PI) / 180;
        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }

    function angleDiff(a, b) {
        let d = ((a - b + 540) % 360) - 180;
        return d;
    }

    function mergePose(tel) {
        if (!tel) return lastPose;
        const lat = Number(tel.latitude);
        const lon = Number(tel.longitude);
        const height = Number(tel.height);
        const prev = lastPose || {};
        const g = tel.gimbal || {};
        const pg = prev.gimbal || {};
        const zoomRaw = Number(tel.zoom || tel.cameras?.[0]?.zoom_factor);
        const pose = {
            latitude: Number.isFinite(lat) && Math.abs(lat) > 1e-6 ? lat : prev.latitude,
            longitude: Number.isFinite(lon) && Math.abs(lon) > 1e-6 ? lon : prev.longitude,
            height: Number.isFinite(height) && height > 2 ? height : prev.height,
            attitudeHead: Number.isFinite(Number(tel.attitudeHead))
                ? Number(tel.attitudeHead)
                : prev.attitudeHead,
            gimbal: {
                pitch: Number.isFinite(Number(g.pitch)) ? Number(g.pitch) : pg.pitch,
                yaw: 0,
                roll: Number.isFinite(Number(g.roll)) ? Number(g.roll) : pg.roll || 0,
            },
            zoom: Number.isFinite(zoomRaw) && zoomRaw >= 1 && zoomRaw <= 3 ? zoomRaw : 1,
        };
        if (Number.isFinite(pose.latitude) && Number.isFinite(pose.height)) {
            pose.t = performance.now();
            lastPose = pose;
            if (
                !sampleB ||
                haversineM(sampleB.latitude, sampleB.longitude, pose.latitude, pose.longitude) > 0.4 ||
                Math.abs(angleDiff(pose.attitudeHead, sampleB.attitudeHead)) > 0.2 ||
                Math.abs((pose.height || 0) - (sampleB.height || 0)) > 0.15
            ) {
                sampleA = sampleB;
                sampleB = pose;
            }
        }
        return lastPose;
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function lerpAngle(a, b, t) {
        return a + angleDiff(b, a) * t;
    }

    function predictedPose(now) {
        const cur = sampleB || lastPose;
        if (!cur) return null;
        if (!sampleA || !sampleB || sampleB.t === sampleA.t) {
            return { ...cur, gimbal: { ...(cur.gimbal || {}) } };
        }
        const dt = Math.max(0.05, (sampleB.t - sampleA.t) / 1000);
        const ahead = Math.min(EXTRAPOLATE_S, Math.max(0, (now - sampleB.t) / 1000));
        const k = ahead / dt;
        return {
            latitude: sampleB.latitude + (sampleB.latitude - sampleA.latitude) * k,
            longitude: sampleB.longitude + (sampleB.longitude - sampleA.longitude) * k,
            height: Math.max(2, sampleB.height + (sampleB.height - sampleA.height) * k),
            attitudeHead: lerpAngle(sampleA.attitudeHead, sampleB.attitudeHead, 1 + k),
            gimbal: {
                pitch: lerp(sampleA.gimbal?.pitch || 0, sampleB.gimbal?.pitch || 0, 1 + k),
                yaw: 0,
                roll: lerp(sampleA.gimbal?.roll || 0, sampleB.gimbal?.roll || 0, 1 + k),
            },
            zoom: cur.zoom,
        };
    }

    function stepDisplayPose(now) {
        const target = predictedPose(now);
        if (!target) return null;
        const dt = lastFrameMs ? Math.min(0.05, (now - lastFrameMs) / 1000) : 0.016;
        lastFrameMs = now;
        const a = 1 - Math.exp(-dt / POSE_TAU_S);
        if (!displayPose) {
            displayPose = { ...target, gimbal: { ...target.gimbal } };
            return displayPose;
        }
        displayPose = {
            latitude: lerp(displayPose.latitude, target.latitude, a),
            longitude: lerp(displayPose.longitude, target.longitude, a),
            height: lerp(displayPose.height, target.height, a),
            attitudeHead: lerpAngle(displayPose.attitudeHead || 0, target.attitudeHead || 0, a),
            gimbal: {
                pitch: lerp(displayPose.gimbal?.pitch || 0, target.gimbal?.pitch || 0, a),
                yaw: 0,
                roll: lerp(displayPose.gimbal?.roll || 0, target.gimbal?.roll || 0, a),
            },
            zoom: target.zoom,
        };
        return displayPose;
    }

    /** Match cv_georef.ll_to_pixel — hide behind-camera and off-frustum points. */
    function worldToPixel(lat, lng, pose, width, height) {
        const alt = Number(pose.height);
        if (!Number.isFinite(alt) || alt < 1.5) return null;
        const p = toEnu(lat, lng, pose.latitude, pose.longitude);
        const psi = ((Number(pose.attitudeHead) || 0) * Math.PI) / 180;
        const c = Math.cos(psi);
        const s = Math.sin(psi);
        let fwd = p.n * c + p.e * s;
        let right = -p.n * s + p.e * c;
        let down = alt;

        const roll = ((Number(pose.gimbal?.roll) || 0) * Math.PI) / 180;
        const pitch = (((Number(pose.gimbal?.pitch) || 0) + pitchOffset) * Math.PI) / 180;
        const cr = Math.cos(roll);
        const sr = Math.sin(roll);
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        let nr = right * cr + down * sr;
        let nd = -right * sr + down * cr;
        right = nr;
        down = nd;
        const nf = fwd * cp - down * sp;
        nd = fwd * sp + down * cp;
        fwd = nf;
        down = nd;

        if (fwd <= 8) return null;
        const zoom = Math.max(1, Number(pose.zoom) || 1);
        const hfov = ((hfovDeg / zoom) * Math.PI) / 180;
        const fx = width / 2 / Math.tan(hfov / 2);
        const x = width / 2 + fx * (right / fwd);
        const y = height / 2 + fx * (down / fwd);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (Math.abs(x - width / 2) > width * 0.85) return null;
        if (Math.abs(y - height / 2) > height * 0.85) return null;
        return { x, y, z: fwd };
    }

    function pickAircraft(payload) {
        const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
        return (
            rows.find((r) => String(r.deviceSn || "").startsWith("1581")) ||
            rows[0] ||
            null
        );
    }

    function strokePoly(ctx, pts) {
        if (pts.length < 2) return 0;
        ctx.beginPath();
        let started = false;
        let drawn = 0;
        for (const p of pts) {
            if (!p) {
                started = false;
                continue;
            }
            if (!started) {
                ctx.moveTo(p.x, p.y);
                started = true;
            } else {
                ctx.lineTo(p.x, p.y);
                drawn += 1;
            }
        }
        ctx.stroke();
        return drawn;
    }

    function sampleLine(chain0, across0, chain1, across1, n, projectFn) {
        const pts = [];
        for (let i = 0; i <= n; i += 1) {
            const t = i / n;
            const ll = llAt(chain0 + (chain1 - chain0) * t, across0 + (across1 - across0) * t);
            pts.push(projectFn(ll.lat, ll.lng));
        }
        return pts;
    }

    function courseInFront(pose) {
        const mid = llAt(COURSE_M / 2, 0);
        const brg = bearingDeg(pose.latitude, pose.longitude, mid.lat, mid.lng);
        const head = ((Number(pose.attitudeHead) || 0) + 360) % 360;
        const diff = Math.abs(angleDiff(brg, head));
        const dist = haversineM(pose.latitude, pose.longitude, mid.lat, mid.lng);
        return { brg, head, diff, dist, inFront: diff < 80 };
    }

    function drawCamera(ctx, canvas, pose, race) {
        const W = canvas.width;
        const H = canvas.height;
        const projectFn = (lat, lng) => worldToPixel(lat, lng, pose, W, H);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        let hits = 0;

        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 2;
        for (let lane = 1; lane <= LANE_COUNT; lane += 1) {
            const a = -halfW + (lane - 0.5) * LANE_M;
            hits += strokePoly(ctx, sampleLine(0, a, COURSE_M, a, 48, projectFn));
        }
        ctx.strokeStyle = "rgba(96,165,250,0.95)";
        ctx.lineWidth = 5;
        hits += strokePoly(ctx, sampleLine(0, -halfW, COURSE_M, -halfW, 48, projectFn));
        hits += strokePoly(ctx, sampleLine(0, halfW, COURSE_M, halfW, 48, projectFn));
        ctx.strokeStyle = "#4ade80";
        ctx.lineWidth = 6;
        hits += strokePoly(ctx, sampleLine(0, -halfW, 0, halfW, 16, projectFn));
        ctx.strokeStyle = "#f87171";
        hits += strokePoly(ctx, sampleLine(COURSE_M, -halfW, COURSE_M, halfW, 16, projectFn));
        ctx.setLineDash([10, 8]);
        ctx.strokeStyle = "rgba(125,211,252,0.9)";
        ctx.lineWidth = 3;
        [500, 1000, 1500].forEach((m) => {
            hits += strokePoly(ctx, sampleLine(m, -halfW, m, halfW, 16, projectFn));
        });
        ctx.setLineDash([]);

        (race && race.boats ? race.boats : []).forEach((b) => {
            if (!Number.isFinite(b.lat)) return;
            const xy = projectFn(b.lat, b.lng || b.lon);
            if (!xy) return;
            ctx.beginPath();
            ctx.fillStyle = b.slot === race.leader_slot ? "#fbbf24" : "#38bdf8";
            ctx.arc(xy.x, xy.y, b.slot === race.leader_slot ? 9 : 6, 0, Math.PI * 2);
            ctx.fill();
        });
        return hits;
    }

    function draw(pose, race) {
        const canvas = document.getElementById("course");
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const hud = document.getElementById("hud");

        if (forcePlan) {
            hud.textContent = "Plan view (?view=plan)";
            return;
        }
        if (!pose || !Number.isFinite(pose.latitude) || !Number.isFinite(pose.height)) {
            hud.textContent = "Camera view · waiting for drone GPS";
            return;
        }

        const rel = courseInFront(pose);
        const km = (rel.dist / 1000).toFixed(2);
        const pitch = Number(pose.gimbal?.pitch);
        if (!rel.inFront) {
            hud.textContent =
                `Camera view · course ${km} km away, ${Math.round(rel.diff)}° off heading — not drawn`;
            return;
        }

        const hits = drawCamera(ctx, canvas, pose, race);
        if (!hits) {
            hud.textContent = `Camera view · course ${km} km ahead but outside the lens`;
            return;
        }
        const mark = race && race.ok ? ` · ${race.course_mark || ""} ${race.leader_chainage_m ?? ""}m` : "";
        hud.textContent =
            `Camera view · ${km} km${mark} · pitch ${Number.isFinite(pitch) ? pitch.toFixed(0) : "?"}°`;
    }

    function tick(now) {
        const pose = stepDisplayPose(now);
        draw(pose, latestRace);
        requestAnimationFrame(tick);
    }

    async function loadConfig() {
        if (!configUrl) return;
        try {
            const res = await fetch(configUrl);
            if (!res.ok) return;
            const cfg = await res.json();
            const d = cfg.drone || {};
            if (Number.isFinite(Number(d.hfov_deg))) hfovDeg = Number(d.hfov_deg);
            if (Number.isFinite(Number(d.pitch_offset_deg))) pitchOffset = Number(d.pitch_offset_deg);
        } catch (_) {}
    }

    async function poll() {
        let tel = null;
        try {
            const res = await fetch(telemetryUrl);
            if (res.ok) tel = pickAircraft(await res.json());
        } catch (_) {}
        if (raceUrl) {
            try {
                const res = await fetch(raceUrl);
                if (res.ok) latestRace = await res.json();
            } catch (_) {}
        }
        mergePose(tel);
    }

    loadConfig().then(() => {
        poll();
        setInterval(poll, 400);
        requestAnimationFrame(tick);
    });
})();
