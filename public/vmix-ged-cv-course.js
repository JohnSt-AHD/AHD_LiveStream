(function () {
    const START = { lat: -37.943356, lng: 175.556788 };
    const FINISH = { lat: -37.929223, lng: 175.542716 };
    const EARTH_R = 6371000;
    const LANE_COUNT = 10;
    const LANE_M = 10;
    const COURSE_M = 2000;

    const params = new URLSearchParams(location.search);
    // Graphics PC hosts this page; live race/OSD come from the CV laptop.
    const laptop = (
        params.get("cvLaptop") ||
        params.get("laptop") ||
        "http://127.0.0.1:8790"
    ).replace(/\/$/, "");
    const telemetryUrl =
        params.get("telemetry") || `${laptop}/api/drone-telemetry`;
    // `race=` alone is the daysheet race label override — not the JSON URL.
    const raceUrl = params.get("raceUrl") || `${laptop}/api/race`;
    const configUrl = `${laptop}/api/config`;
    const forcePlan = params.get("view") === "plan";
    // Ged default: course + crew tags + leader line across the course.
    const layers = {
        course: true,
        lanes: true,
        order: false,
        leaderLine: true,
        progLine: false,
        speed: false,
        hud: true,
    };
    let latestDraw = null;
    let raceOverride = params.get("race") || "";
    let smoothLeaderCh = null;
    let smoothProgCh = null;
    let lastLineSmoothMs = 0;
    const LINE_SMOOTH_TAU_S = 2;
    const BOAT_LEN = 12.5;

    let hfovDeg = 73;
    let pitchOffset = 0;
    let preferSnPrefix = "1581";
    let lastPose = null;
    let latestRace = null;
    const poseSmoother = window.CvPoseSmooth?.createPoseSmoother?.() || null;

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

    function pickOsdAircraft(payload) {
        const rows = Array.isArray(payload)
            ? payload
            : payload && typeof payload === "object"
              ? [payload]
              : [];
        const pref = preferSnPrefix || "1581";
        return (
            rows.find(
                (r) =>
                    String(r?.source || "").toLowerCase() === "osd" &&
                    String(r?.deviceSn || "").startsWith(pref),
            ) ||
            rows.find((r) => String(r?.source || "").toLowerCase() === "osd") ||
            pickAircraft(rows)
        );
    }

    function telemetryFetchUrl() {
        const u = telemetryUrl.replace(/\/$/, "");
        // Setup server proxy already fetches /all upstream — do not append /all here.
        if (u.includes("/api/drone-telemetry")) return u;
        if (u.endsWith("/drone-telemetry") && !u.endsWith("/all")) return `${u}/all`;
        return u;
    }

    function normalizePose(tel) {
        if (!tel) return null;
        const lat = Number(tel.latitude);
        const lon = Number(tel.longitude);
        const elev = Number(tel.elevation);
        const heightRaw = Number(tel.height);
        const pad = Number.isFinite(Number(window.__takeoffAboveWaterM))
            ? Number(window.__takeoffAboveWaterM)
            : 0;
        // Prefer takeoff-relative elevation (+ pad→lake) over ellipsoid height.
        let height =
            Number.isFinite(elev) && elev > 2
                ? elev + (pad > 0 ? pad : 0)
                : heightRaw;
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(height)) {
            return null;
        }
        const g = tel.gimbal || {};
        const head = Number(tel.attitudeHead) || 0;
        const zoomRaw = Number(tel.zoom || tel.cameras?.[0]?.zoom_factor);
        return {
            latitude: lat,
            longitude: lon,
            height,
            attitudeHead: head,
            attitudePitch: Number(tel.attitudePitch),
            attitudeRoll: Number(tel.attitudeRoll),
            horizontalSpeed: Number(tel.horizontalSpeed) || 0,
            gimbal: {
                pitch: Number.isFinite(Number(g.pitch)) ? Number(g.pitch) : -90,
                // Match map georef: ignore Cloud absolute yaw (biased vs attitudeHead).
                yaw: 0,
                roll: Number.isFinite(Number(g.roll)) ? Number(g.roll) : 0,
            },
            zoom: Number.isFinite(zoomRaw) && zoomRaw >= 1 && zoomRaw <= 30 ? zoomRaw : 1,
            receivedAt: Number(tel.receivedAt) || 0,
            deviceSn: tel.deviceSn,
            source: tel.source,
        };
    }

    function ingestPose(tel) {
        const pose = normalizePose(tel);
        if (!pose) return lastPose;
        if (poseSmoother) {
            poseSmoother.push(pose);
            const sampled = poseSmoother.sample();
            if (sampled) lastPose = sampled;
        } else {
            lastPose = pose;
        }
        return lastPose;
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
        const rows = Array.isArray(payload)
            ? payload
            : payload && typeof payload === "object"
              ? [payload]
              : [];
        const pref = preferSnPrefix || "1581";
        return (
            rows.find((r) => String(r.deviceSn || "").startsWith(pref)) ||
            rows.find((r) => String(r.deviceSn || "").startsWith("1581")) ||
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

        if (layers.course) {
            ctx.strokeStyle = "rgba(245,240,228,0.22)";
            ctx.lineWidth = 2;
            for (let lane = 1; lane <= LANE_COUNT; lane += 1) {
                const a = -halfW + (lane - 0.5) * LANE_M;
                hits += strokePoly(ctx, sampleLine(0, a, COURSE_M, a, 48, projectFn));
            }
            ctx.strokeStyle = "rgba(46,125,224,0.95)";
            ctx.lineWidth = 5;
            hits += strokePoly(ctx, sampleLine(0, -halfW, COURSE_M, -halfW, 48, projectFn));
            hits += strokePoly(ctx, sampleLine(0, halfW, COURSE_M, halfW, 48, projectFn));
            ctx.strokeStyle = "#f5f0e4";
            ctx.lineWidth = 6;
            hits += strokePoly(ctx, sampleLine(0, -halfW, 0, halfW, 16, projectFn));
            ctx.strokeStyle = "#e5484d";
            hits += strokePoly(ctx, sampleLine(COURSE_M, -halfW, COURSE_M, halfW, 16, projectFn));
            ctx.setLineDash([10, 8]);
            ctx.strokeStyle = "rgba(217,231,248,0.45)";
            ctx.lineWidth = 3;
            [500, 1000, 1500].forEach((m) => {
                hits += strokePoly(ctx, sampleLine(m, -halfW, m, halfW, 16, projectFn));
            });
            ctx.setLineDash([]);
        }

        if (layers.leaderLine && Number.isFinite(smoothLeaderCh)) {
            ctx.strokeStyle = "rgba(46, 125, 224, 0.95)";
            ctx.lineWidth = 7;
            hits += strokePoly(ctx, sampleLine(smoothLeaderCh, -halfW, smoothLeaderCh, halfW, 20, projectFn));
        }
        if (layers.progLine && Number.isFinite(smoothProgCh)) {
            ctx.setLineDash([18, 10]);
            ctx.strokeStyle = "rgba(138, 150, 165, 0.95)";
            ctx.lineWidth = 6;
            hits += strokePoly(ctx, sampleLine(smoothProgCh, -halfW, smoothProgCh, halfW, 20, projectFn));
            ctx.setLineDash([]);
        }

        (race && race.boats ? race.boats : []).forEach((b) => {
            if (!Number.isFinite(b.lat)) return;
            const xy = projectFn(b.lat, b.lng || b.lon);
            if (!xy) return;
            ctx.beginPath();
            ctx.fillStyle = b.slot === race.leader_slot ? "#2e7de0" : "rgba(245,240,228,0.85)";
            ctx.arc(xy.x, xy.y, b.slot === race.leader_slot ? 9 : 6, 0, Math.PI * 2);
            ctx.fill();
            if (Number.isFinite(b.pred_lat)) {
                const pxy = projectFn(b.pred_lat, b.pred_lon);
                if (pxy) {
                    ctx.beginPath();
                    ctx.strokeStyle = "rgba(46,125,224,0.7)";
                    ctx.lineWidth = 2;
                    ctx.arc(pxy.x, pxy.y, 7, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        });
        return hits;
    }

    function ema(prev, next, a) {
        if (!Number.isFinite(next)) return prev;
        if (!Number.isFinite(prev)) return next;
        return prev + (next - prev) * a;
    }

    function emaTau(prev, next, tauS, dtS) {
        if (!Number.isFinite(next)) return prev;
        if (!Number.isFinite(prev)) return next;
        const tau = Math.max(0.05, tauS || LINE_SMOOTH_TAU_S);
        const dt = Math.max(0.001, Math.min(0.25, dtS || 1 / 60));
        const a = 1 - Math.exp(-dt / tau);
        return prev + (next - prev) * a;
    }

    function applyUrlLayers() {
        const g = (params.get("g") || params.get("graphic") || "").toLowerCase();
        const show = (params.get("show") || "").toLowerCase();
        if (g === "o" || g === "c") {
            layers.lanes = false;
            layers.order = false;
            layers.leaderLine = false;
            layers.progLine = false;
        } else if (g === "d") layers.lanes = true;
        else if (g === "k") layers.order = true;
        else if (g === "l" || g === "w") layers.leaderLine = true;
        else if (g === "q") layers.progLine = true;
        else if (g === "s") layers.speed = true;
        else if (g === "u") layers.course = true;
        show.split(/[+,]/).forEach((token) => {
            const t = token.trim();
            if (t === "d") layers.lanes = true;
            if (t === "k") layers.order = true;
            if (t === "l" || t === "w") layers.leaderLine = true;
            if (t === "q") layers.progLine = true;
            if (t === "s") layers.speed = true;
            if (t === "u") layers.course = true;
        });
        syncLayerDom();
    }

    function syncLayerDom() {
        const cards = document.getElementById("laneCards");
        const order = document.getElementById("orderPanel");
        const hud = document.getElementById("hud");
        const hint = document.getElementById("keysHint");
        if (cards) cards.hidden = !layers.lanes;
        if (order) order.hidden = !layers.order;
        if (hud) hud.hidden = !layers.hud;
        if (hint) {
            hint.hidden = params.get("keys") !== "1";
            hint.textContent =
                "Ged · d tags · l leader line · k order · q progression · o out · c course only";
        }
    }

    function firstVisibleLaneXy(lane, projectFn) {
        const a = -halfW + (lane - 0.5) * LANE_M;
        for (let ch = 40; ch <= 480; ch += 40) {
            const ll = llAt(ch, a);
            const xy = projectFn(ll.lat, ll.lng);
            if (xy && xy.x > 50 && xy.x < 1870 && xy.y > 90 && xy.y < 980) return xy;
        }
        return null;
    }

    function updateLaneCards(merged, pose, canvas) {
        const root = document.getElementById("laneCards");
        if (!root) return;
        if (!layers.lanes || !pose) {
            root.innerHTML = "";
            return;
        }
        const projectFn = (lat, lng) => worldToPixel(lat, lng, pose, canvas.width, canvas.height);
        const leaderLane = merged?.leader?.lane;
        const byLane = new Map((merged?.rows || []).map((r) => [Number(r.lane), r]));
        root.innerHTML = "";
        for (let lane = 1; lane <= LANE_COUNT; lane += 1) {
            const row = byLane.get(lane);
            let xy = null;
            if (row && Number.isFinite(row.lat)) {
                xy = projectFn(row.lat, row.lon || row.lng);
            }
            if (!xy) xy = firstVisibleLaneXy(lane, projectFn);
            if (!xy) continue;
            const card = document.createElement("div");
            const isLeader = leaderLane === lane;
            const stale = row?.cvStatus === "amber" || row?.cvStatus === "pred";
            card.className =
                "lane-card" +
                (isLeader ? " lane-card--leader" : "") +
                (stale ? " lane-card--stale" : "");
            card.style.left = `${xy.x}px`;
            card.style.top = `${xy.y}px`;
            const logo = row?.logoUrl
                ? `<img class="lane-card__logo" src="${row.logoUrl}" alt="">`
                : '<span class="lane-card__logo lane-card__logo--empty" aria-hidden="true"></span>';
            const badge = isLeader ? '<span class="lane-card__badge">Leader</span>' : "";
            const name = escapeHtml(row?.label || row?.shortLabel || `Lane ${lane}`);
            const code = escapeHtml(row?.shortLabel || `L${lane}`);
            const chain = Number.isFinite(row?.chainage_m)
                ? `${Math.round(row.chainage_m)} m`
                : "";
            const meta = [code, `Ln ${lane}`, chain].filter(Boolean).join(" · ");
            card.innerHTML =
                badge +
                `<div class="lane-card__body">${logo}` +
                `<div class="lane-card__copy">` +
                `<span class="lane-card__name">${name}</span>` +
                `<span class="lane-card__meta">${meta}</span>` +
                `</div></div>`;
            root.appendChild(card);
        }
    }

    function escapeHtml(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function updateOrderPanel(merged) {
        const list = document.getElementById("orderList");
        const toGo = document.getElementById("orderToGo");
        const meta = document.getElementById("orderMeta");
        if (!list || !layers.order) return;
        const ranked = merged?.ranked || [];
        const leaderCh = merged?.leader?.chainage_m;
        if (toGo) {
            toGo.textContent = Number.isFinite(leaderCh)
                ? `${Math.max(0, Math.round(COURSE_M - leaderCh)).toLocaleString("en-NZ")} m to go`
                : "waiting CV";
        }
        if (meta) {
            meta.textContent = [
                merged?.eventType,
                merged?.round,
                merged?.isFinal ? "" : merged?.progression,
            ]
                .filter(Boolean)
                .join(" · ");
        }
        const rankOf = new Map(ranked.map((r, i) => [r.lane, i + 1]));
        list.innerHTML = ranked
            .map((row) => {
                const d = Number.isFinite(leaderCh) && Number.isFinite(row.chainage_m)
                    ? leaderCh - row.chainage_m
                    : null;
                let gap = "—";
                if (d != null) {
                    if (d < 0.4) gap = "LDR";
                    else if (d / BOAT_LEN >= 0.8) gap = `+${(d / BOAT_LEN).toFixed(1)} L`;
                    else gap = `+${d.toFixed(0)} m`;
                }
                const logo = row.logoUrl
                    ? `<img class="kri-live-tracking__logo" src="${row.logoUrl}" alt="">`
                    : `<span class="kri-live-tracking__logo"></span>`;
                const rank = rankOf.get(row.lane) || "—";
                const lead = rank === 1 ? " kri-live-tracking__row--lead" : "";
                const warn = row.cvStatus === "amber" ? " kri-live-tracking__row--warn" : "";
                const pred = row.cvStatus === "pred" ? " kri-live-tracking__row--pred" : "";
                const view =
                    row.cvStatus === "pred" || row.coast_mode === "out_of_view"
                        ? "out"
                        : row.cvStatus === "amber"
                          ? "stale"
                          : row.pickup || (row.detected ? (row.in_view ? "cam" : "out") : "off");
                return (
                    `<div class="kri-live-tracking__row${lead}${warn}${pred}">` +
                    `<span class="kri-live-tracking__rank">${rank}</span>` +
                    logo +
                    `<span class="kri-live-tracking__name">${row.shortLabel || row.label || `L${row.lane}`}</span>` +
                    `<span class="kri-live-tracking__gap">${gap}</span>` +
                    `<span class="kri-live-tracking__view">${view}</span>` +
                    `</div>`
                );
            })
            .join("");
            if (!ranked.length) {
            list.innerHTML =
                '<div class="kri-live-tracking__row">No live / predicted crews</div>';
        }
    }

    function updateSmoothedLines(merged) {
        const now = performance.now();
        const dtS = lastLineSmoothMs ? (now - lastLineSmoothMs) / 1000 : 1 / 60;
        lastLineSmoothMs = now;
        const leaderCh = merged?.leader?.chainage_m;
        smoothLeaderCh = emaTau(smoothLeaderCh, leaderCh, LINE_SMOOTH_TAU_S, dtS);
        if (merged?.isFinal) {
            smoothProgCh = null;
            return;
        }
        const n = Math.max(1, Number(merged?.qualifyCount) || 3);
        const cutoff = merged?.ranked?.[n - 1];
        const nextProg =
            Number.isFinite(cutoff?.chainage_m) &&
            Number.isFinite(leaderCh) &&
            Math.abs(leaderCh - cutoff.chainage_m) > 2
                ? cutoff.chainage_m
                : null;
        smoothProgCh = emaTau(smoothProgCh, nextProg, LINE_SMOOTH_TAU_S, dtS);
    }

    function mergedState(race) {
        if (window.CvOverlayDraw) return CvOverlayDraw.mergeRaceAndDraw(race, latestDraw);
        return { rows: [], ranked: race?.boats || [], leader: (race?.boats || [])[0] };
    }

    function paintSpeedGraph(ctx, race) {
        if (!layers.speed || !window.CvOverlayDraw?.drawSpeedGraph) return;
        const series = (race?.speed_series || []).map((row) => ({
            ...row,
            color: CvOverlayDraw.laneColor(row.lane),
        }));
        const elapsed = Number(race?.clock?.elapsed_ms || 0) / 1000;
        CvOverlayDraw.drawSpeedGraph(
            ctx,
            { x: 48, y: 620, w: 760, h: 400 },
            series,
            elapsed,
            { title: "Speed vs time", caption: "CV · metres per second from race start" },
        );
    }

    function draw(pose, race) {
        const canvas = document.getElementById("course");
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const hud = document.getElementById("hud");
        const merged = mergedState(race);
        updateSmoothedLines(merged);

        if (forcePlan) {
            hud.textContent = "Plan view (?view=plan)";
            paintSpeedGraph(ctx, race);
            return;
        }
        if (!pose || !Number.isFinite(pose.latitude) || !Number.isFinite(pose.height)) {
            hud.textContent = "Camera view · waiting for drone GPS";
            updateLaneCards(merged, null, canvas);
            updateOrderPanel(merged);
            paintSpeedGraph(ctx, race);
            return;
        }

        const rel = courseInFront(pose);
        const km = (rel.dist / 1000).toFixed(2);
        const pitch = Number(pose.gimbal?.pitch);
        if (!rel.inFront) {
            hud.textContent =
                `Camera view · course ${km} km away, ${Math.round(rel.diff)}° off heading — not drawn`;
            updateLaneCards(merged, null, canvas);
            updateOrderPanel(merged);
            paintSpeedGraph(ctx, race);
            return;
        }

        let hits = 0;
        if (layers.course || layers.leaderLine || layers.progLine) {
            hits = drawCamera(ctx, canvas, pose, race);
        }
        updateLaneCards(merged, pose, canvas);
        updateOrderPanel(merged);
        paintSpeedGraph(ctx, race);
        const zoom = Number(pose.zoom) || 1;
        const zoomWarn = zoom > 1.5;
        if (hud) hud.classList.toggle("hud--warn", zoomWarn);
        const zoomTxt = zoomWarn
            ? ` · zoom ${zoom.toFixed(0)}× — zoom out to 1× for full course`
            : zoom > 1.05
              ? ` · zoom ${zoom.toFixed(1)}×`
              : "";
        if (!hits && layers.course) {
            const pitchHint =
                Number.isFinite(pitch) && pitch > -45
                    ? ` · gimbal ${pitch.toFixed(0)}° (need ~-90° nadir — tilt camera down)`
                    : "";
            hud.textContent =
                `Camera view · course ${km} km ahead but outside the lens${pitchHint}${zoomTxt}`;
            return;
        }
        const mark = race && race.ok ? ` · ${race.course_mark || ""} ${race.leader_chainage_m ?? ""}m` : "";
        const drawLabel = latestDraw?.race
            ? ` · ${latestDraw.regatta} R${latestDraw.race}${latestDraw.eventType ? " " + latestDraw.eventType : ""}`
            : "";
        const clock = race?.clock
            ? ` · ${CvOverlayDraw?.formatClock?.(race.clock.elapsed_ms) || ""}`
            : "";
        hud.textContent =
            `Ged · ${km} km${mark}${drawLabel}${clock} · pitch ${Number.isFinite(pitch) ? pitch.toFixed(0) : "?"}°${zoomTxt}`;
    }

    function tick() {
        if (poseSmoother) {
            const sampled = poseSmoother.sample();
            if (sampled) lastPose = sampled;
        }
        draw(lastPose, latestRace);
        requestAnimationFrame(tick);
    }

    async function loadDraw() {
        try {
            const res = await fetch(configUrl);
            if (!res.ok) return;
            const cfg = await res.json();
            const d = cfg.drone || {};
            const cloud = cfg.cloud || {};
            if (Number.isFinite(Number(d.hfov_deg))) hfovDeg = Number(d.hfov_deg);
            if (Number.isFinite(Number(d.pitch_offset_deg))) pitchOffset = Number(d.pitch_offset_deg);
            if (d.prefer_sn_prefix) preferSnPrefix = String(d.prefer_sn_prefix);
            if (Number.isFinite(Number(d.takeoff_above_water_m))) {
                window.__takeoffAboveWaterM = Number(d.takeoff_above_water_m);
            }
            if (window.CvOverlayDraw) {
                latestDraw = await CvOverlayDraw.loadDraw({
                    regatta: params.get("regatta") || cloud.regatta,
                    race: raceOverride || params.get("race") || cloud.live_race,
                });
                if (latestDraw?.race) raceOverride = latestDraw.race;
            }
        } catch (_) {}
    }

    async function poll() {
        let tel = null;
        try {
            const res = await fetch(telemetryFetchUrl());
            if (res.ok) tel = pickOsdAircraft(await res.json());
        } catch (_) {}
        try {
            const res = await fetch(raceUrl);
            if (res.ok) latestRace = await res.json();
        } catch (_) {}
        ingestPose(tel);
    }

    function onKey(e) {
        if (e.repeat || e.target.closest?.("input, textarea, select")) return;
        const key = e.key.toLowerCase();
        if (key === "d") layers.lanes = !layers.lanes;
        else if (key === "k") layers.order = !layers.order;
        else if (key === "l" || key === "w") layers.leaderLine = !layers.leaderLine;
        else if (key === "q") layers.progLine = !layers.progLine;
        else if (key === "s") layers.speed = !layers.speed;
        else if (key === "u") layers.course = !layers.course;
        else if (key === "o") {
            layers.lanes = false;
            layers.order = false;
            layers.leaderLine = false;
            layers.progLine = false;
            layers.speed = false;
        } else if (key === "c") {
            layers.lanes = false;
            layers.order = false;
            layers.leaderLine = false;
            layers.progLine = false;
            layers.speed = false;
            layers.course = true;
        } else {
            return;
        }
        e.preventDefault();
        syncLayerDom();
    }

    applyUrlLayers();
    document.addEventListener("keydown", onKey);
    loadDraw().then(() => {
        poll();
        setInterval(poll, 250);
        setInterval(loadDraw, 30000);
        requestAnimationFrame(tick);
    });
})();
