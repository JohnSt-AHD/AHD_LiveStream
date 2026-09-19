/**
 * Load current-race draw (lanes, clubs, logos) from the Vercel overlay project.
 */
(function (global) {
    const ORIGIN =
        (global.CvOverlayUrls && global.CvOverlayUrls.graphicsOrigin
            ? global.CvOverlayUrls.graphicsOrigin()
            : "http://127.0.0.1:3000");
    const MONTHS = {
        january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
        april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
        august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9,
        november: 10, nov: 10, december: 11, dec: 11,
    };

    function parseCsvLine(line) {
        const out = [];
        let cur = "";
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQ) {
                if (c === '"' && line[i + 1] === '"') {
                    cur += '"';
                    i += 1;
                } else if (c === '"') inQ = false;
                else cur += c;
            } else if (c === '"') inQ = true;
            else if (c === ",") {
                out.push(cur);
                cur = "";
            } else cur += c;
        }
        out.push(cur);
        return out;
    }

    function parseRaceLabel(raw) {
        const s = String(raw || "").trim();
        const withLetter = s.match(/^(\d+)\s*\(([A-Za-z])\)\s*$/);
        if (withLetter) {
            return {
                raceNum: parseInt(withLetter[1], 10),
                label: `${withLetter[1]} (${withLetter[2].toUpperCase()})`,
            };
        }
        const plain = s.match(/^(\d+)$/);
        if (plain) return { raceNum: parseInt(plain[1], 10), label: plain[1] };
        return { raceNum: null, label: s };
    }

    function isCrewCell(raw) {
        const t = String(raw || "").trim();
        if (!t || t === "-" || /^-+\s*$/.test(t)) return false;
        if (/cancelled/i.test(t)) return false;
        return true;
    }

    function parseLanes(cols, headerCols) {
        if (headerCols?.length) {
            const lanes = [];
            for (let i = 0; i < headerCols.length; i++) {
                const h = (headerCols[i] || "").trim().toLowerCase();
                const m = h.match(/^lane[_\s-]?(\d+)$/);
                if (!m) continue;
                const code = (cols[i] || "").trim();
                if (!isCrewCell(code)) continue;
                lanes.push({ lane: parseInt(m[1], 10), code });
            }
            lanes.sort((a, b) => a.lane - b.lane);
            if (lanes.length) return lanes;
        }
        const lanes = [];
        for (let lane = 1; lane <= 10; lane++) {
            const idx = 5 + lane;
            if (idx >= cols.length - 1) break;
            const code = (cols[idx] || "").trim();
            lanes.push({ lane, code: isCrewCell(code) ? code : null });
        }
        let lastUsed = 0;
        for (const l of lanes) if (l.code) lastUsed = l.lane;
        return lastUsed ? lanes.filter((l) => l.lane <= lastUsed) : lanes;
    }

    function progressionFromRow(cols, headerCols) {
        if (headerCols?.length) {
            const idx = headerCols.findIndex((h) => /progression/i.test(String(h || "")));
            if (idx >= 0) return String(cols[idx] || "").trim();
        }
        return String(cols[cols.length - 1] || "").trim();
    }

    function parseQualifyCount(text) {
        const s = String(text || "");
        const rangeDots = s.match(/1\s*\.\.\s*(\d+)/);
        if (rangeDots) return Math.max(1, Math.min(10, parseInt(rangeDots[1], 10)));
        const range = s.match(/1\s*[-–to,]+\s*(\d+)/i);
        if (range) return Math.max(1, Math.min(10, parseInt(range[1], 10)));
        const top = s.match(/\b(?:top|first|fastest)\s*(\d+)/i);
        if (top) return Math.max(1, Math.min(10, parseInt(top[1], 10)));
        if (/1st\b/i.test(s) && !/\d\s*[-–]/.test(s)) return 1;
        if (/^1=/.test(s)) return 1;
        return 3;
    }

    function isFinalRound(round, eventType, progression) {
        const r = `${round || ""} ${eventType || ""}`.toLowerCase();
        if (/\bfinals?\b/.test(r)) return true;
        if (/\b[a-f]\s*final\b/.test(r)) return true;
        if (/^(fa|fb|fc|fd|fe|ff)$/i.test(String(round || "").trim())) return true;
        if (/\b(heat|repechage|\brep\b|semi|quarter|qtr|trial|prelim)/i.test(r)) return false;
        const p = String(progression || "").trim();
        return !p || p === "-" || /^n\/?a$/i.test(p) || /^none$/i.test(p);
    }

    function formatGap(leaderCh, ch, boatLenM) {
        if (!Number.isFinite(leaderCh) || !Number.isFinite(ch)) return "—";
        const d = leaderCh - ch;
        if (d < 0.4) return "LDR";
        const len = Number(boatLenM) > 0 ? boatLenM : 12.5;
        if (d / len >= 0.8) return `+${(d / len).toFixed(1)} L`;
        return `+${d.toFixed(0)} m`;
    }

    function parseDaysheet(text) {
        const races = [];
        let dayDate = null;
        let headerCols = null;
        for (const line of String(text || "").split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (/^DAY\s+\d+:/i.test(trimmed)) {
                const m = trimmed.match(
                    /DAY\s+\d+:\s+(?:\w+\s+)?(\d{1,2})(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/i,
                );
                dayDate = null;
                headerCols = null;
                if (m) {
                    const month = MONTHS[m[2].toLowerCase()];
                    if (month !== undefined) {
                        dayDate = new Date(parseInt(m[3], 10), month, parseInt(m[1], 10));
                    }
                }
                continue;
            }
            if (!dayDate) continue;
            if (/^Race,/i.test(trimmed)) {
                headerCols = parseCsvLine(trimmed);
                continue;
            }
            const cols = parseCsvLine(trimmed);
            const info = parseRaceLabel(cols[0]);
            if (!info.raceNum) continue;
            const tm = String(cols[1] || "").trim().match(/^(\d{1,2}):(\d{2})$/);
            if (!tm) continue;
            races.push({
                raceNum: info.raceNum,
                race: info.label,
                eventType: (cols[3] || "").trim(),
                round: (cols[4] || "").trim(),
                lanes: parseLanes(cols, headerCols),
                progression: progressionFromRow(cols, headerCols),
            });
        }
        return races;
    }

    function findRace(races, param) {
        const p = String(param || "").trim();
        if (!p || !races.length) return races[0] || null;
        const exact = races.find((r) => r.race === p);
        if (exact) return exact;
        const num = parseInt(p, 10);
        return races.find((r) => r.raceNum === num) || races[0];
    }

    function parseClubCode(raw) {
        const m = String(raw || "").trim().match(/^([A-Za-z0-9]+)(?:\s*[-.]?\s*(\d+))?$/);
        if (!m) return { id: String(raw || "").toLowerCase(), crewNum: "" };
        return { id: m[1].toLowerCase(), crewNum: m[2] || "" };
    }

    function clubInfo(clubId, lookup) {
        const id = String(clubId || "").toLowerCase();
        if (!id || !lookup?.clubs) {
            return { name: String(clubId || "").toUpperCase(), logoUrl: null };
        }
        const club = lookup.clubs[id] || lookup.clubs[clubId];
        if (!club) return { name: id.toUpperCase(), logoUrl: null };
        return {
            name: club.name || id.toUpperCase(),
            logoUrl: club.logo
                ? `${ORIGIN}/assets/school-logos/${encodeURIComponent(club.logo)}`
                : null,
        };
    }

    function enrichLanes(race, lookup) {
        return (race?.lanes || [])
            .filter((e) => e && e.code)
            .map((e) => {
                const club = parseClubCode(e.code);
                const info = clubInfo(club.id, lookup);
                return {
                    lane: e.lane,
                    code: e.code,
                    label: info.name,
                    shortLabel: club.id ? club.id.toUpperCase() : String(e.code).trim(),
                    logoUrl: info.logoUrl,
                };
            });
    }

    async function fetchCsv(url) {
        const proxied = `${ORIGIN}/api/fetch-csv?url=${encodeURIComponent(url)}`;
        let res = await fetch(proxied);
        if (!res.ok) res = await fetch(url);
        if (!res.ok) throw new Error(`Daysheet HTTP ${res.status}`);
        return res.text();
    }

    async function fetchDaysheet(code) {
        const locals = [
            `daysheets/${code}-daysheet.csv`,
            `/daysheets/${code}-daysheet.csv`,
        ];
        for (const url of locals) {
            try {
                const res = await fetch(url, { cache: "no-store" });
                if (res.ok) {
                    const text = await res.text();
                    if (text && /lane_1|,lane,/i.test(text)) return text;
                }
            } catch {
                /* try next */
            }
        }
        const daysheetUrl = `https://l.rowit.nz/altitude/${code}/daysheet.csv`;
        return fetchCsv(daysheetUrl);
    }

    async function loadLookup() {
        const urls = [
            `${ORIGIN}/data/ahd-lookup.json`,
            "data/ahd-lookup.json",
            "/data/ahd-lookup.json",
        ];
        for (const url of urls) {
            try {
                const res = await fetch(url);
                if (res.ok) return await res.json();
            } catch {
                /* try next */
            }
        }
        return { clubs: {} };
    }

    async function loadDraw({ regatta, race } = {}) {
        const code = String(regatta || "nzmm2026").trim().toLowerCase();
        const [lookup, csv] = await Promise.all([loadLookup(), fetchDaysheet(code)]);
        const races = parseDaysheet(csv);
        const current = findRace(races, race);
        const racesEnriched = races.map((row) => ({
            raceNum: row.raceNum,
            race: row.race,
            eventType: row.eventType,
            round: row.round,
            progression: row.progression,
            lanes: enrichLanes(row, lookup),
        }));
        return {
            ok: Boolean(current),
            origin: ORIGIN,
            regatta: code,
            race: current?.race || String(race || ""),
            eventType: current?.eventType || "",
            round: current?.round || "",
            progression: current?.progression || "",
            qualifyCount: parseQualifyCount(current?.progression),
            isFinal: isFinalRound(current?.round, current?.eventType, current?.progression),
            lanes: enrichLanes(current, lookup),
            races: racesEnriched,
        };
    }

    function selectRace(bundle, raceParam) {
        const current = findRace(bundle?.races || [], raceParam);
        return {
            ...(bundle || {}),
            ok: Boolean(current),
            race: current?.race || String(raceParam || ""),
            eventType: current?.eventType || "",
            round: current?.round || "",
            progression: current?.progression || "",
            qualifyCount: parseQualifyCount(current?.progression),
            isFinal: isFinalRound(current?.round, current?.eventType, current?.progression),
            lanes: current?.lanes || [],
        };
    }

    function stepRace(bundle, delta) {
        const races = bundle?.races || [];
        if (!races.length) return bundle;
        let idx = races.findIndex((r) => r.race === bundle.race);
        if (idx < 0) {
            const num = parseInt(bundle.race, 10);
            idx = races.findIndex((r) => r.raceNum === num);
        }
        if (idx < 0) idx = 0;
        const nextIdx = Math.max(0, Math.min(races.length - 1, idx + Number(delta || 0)));
        return selectRace(bundle, races[nextIdx].race);
    }

    async function persistLiveRace(configUrl, race, extraCloud) {
        const url = configUrl || "/api/config";
        const cfg = await fetch(url).then((r) => r.json());
        const cloud = { ...(cfg.cloud || {}), live_race: String(race), ...(extraCloud || {}) };
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cloud }),
        });
        return cloud;
    }

    /** When daysheet/draw is unavailable, still build lane stubs from race snapshot. */
    function syntheticLanesFromRace(raceSnap) {
        const seen = new Set();
        const laneNums = [];
        const push = (n) => {
            const lane = Number(n);
            if (!Number.isFinite(lane) || lane < 1 || seen.has(lane)) return;
            seen.add(lane);
            laneNums.push(lane);
        };
        (raceSnap?.occupied_lanes || []).forEach(push);
        (raceSnap?.draw_lanes || []).forEach(push);
        (raceSnap?.boats || []).forEach((b) => push(b?.lane));
        if (!laneNums.length) {
            const count = Math.max(0, Math.min(10, Number(raceSnap?.lane_count) || 0));
            for (let i = 1; i <= count; i++) push(i);
        }
        laneNums.sort((a, b) => a - b);
        return laneNums.map((lane) => ({
            lane,
            code: `Lane ${lane}`,
            label: `Lane ${lane}`,
            shortLabel: `L${lane}`,
            logoUrl: null,
        }));
    }

    function mergeRaceAndDraw(raceSnap, draw) {
        const byLane = new Map();
        (raceSnap?.boats || []).forEach((b) => {
            if (Number.isFinite(b.lane)) byLane.set(Number(b.lane), b);
        });
        const lanes =
            Array.isArray(draw?.lanes) && draw.lanes.length
                ? draw.lanes
                : syntheticLanesFromRace(raceSnap);
        const rows = lanes.map((crew) => {
            const cv = byLane.get(Number(crew.lane));
            const lostMs = Number(cv?.lost_ms);
            const ageMs = Number(cv?.age_ms);
            const holdMs = Number.isFinite(lostMs)
                ? lostMs
                : Number.isFinite(ageMs)
                  ? ageMs
                  : cv
                    ? 0
                    : 10001;
            const coastMode = cv?.coast_mode || null;
            let cvStatus = cv?.cv_status || "red";
            if (!cv?.cv_status) {
                if (coastMode === "out_of_view" || (cv?.coasting && cv?.in_view === false)) {
                    cvStatus = "pred";
                } else if (holdMs < 5000) cvStatus = "green";
                else if (holdMs < 10000) cvStatus = "amber";
                else cvStatus = "red";
            }
            return {
                ...crew,
                detected: Boolean(cv?.detected) && !cv.coasting,
                coasting: Boolean(cv?.coasting) || cvStatus === "pred" || (holdMs > 0 && holdMs < 10000 && !cv?.detected),
                in_view: Boolean(cv?.in_view),
                coast_mode: coastMode,
                pickup: !cv
                    ? "off"
                    : cv.from_draw
                      ? cv.detected
                          ? "set"
                          : "draw"
                      : cvStatus === "pred" || coastMode === "out_of_view"
                        ? "out"
                        : cvStatus === "amber" || cv.coasting
                          ? "pred"
                          : cv.in_view
                            ? "cam"
                            : "out",
                from_draw: Boolean(cv?.from_draw),
                slot: cv?.slot ?? null,
                track_id: cv?.track_id ?? null,
                locked: Boolean(cv?.locked),
                x: Number.isFinite(Number(cv?.x)) ? Number(cv.x) : null,
                y: Number.isFinite(Number(cv?.y)) ? Number(cv.y) : null,
                chainage_m: cv?.chainage_m,
                across_m: cv?.across_m,
                lat: cv?.lat,
                lon: cv?.lon,
                pred_lat: cv?.pred_lat,
                pred_lon: cv?.pred_lon,
                speed_mps: cv?.speed_mps,
                speed_kmh: cv?.speed_kmh,
                lost_ms: holdMs,
                age_ms: Number.isFinite(ageMs) ? ageMs : null,
                last_seen_ms: cv?.last_seen_ms ?? null,
                gap_hold_m: cv?.gap_hold_m ?? null,
                cvStatus,
                timing_valid: cv?.timing_valid !== false,
                finish_elapsed_ms: cv?.finish_elapsed_ms ?? null,
                finish_time: cv?.finish_time ?? null,
                finish_reason: cv?.finish_reason ?? null,
            };
        });
        const liveForPlacings = (r) =>
            Number.isFinite(r.chainage_m) &&
            (r.cvStatus === "green" || r.cvStatus === "amber" || r.cvStatus === "pred");
        const ranked = rows.filter(liveForPlacings).sort((a, b) => b.chainage_m - a.chainage_m);
        const leader = ranked[0] || null;
        return {
            eventType: draw?.eventType || "",
            race: draw?.race || "",
            round: draw?.round || "",
            progression: draw?.progression || "",
            qualifyCount: draw?.qualifyCount || 3,
            isFinal: Boolean(draw?.isFinal),
            course_mark: raceSnap?.course_mark,
            race_phase: raceSnap?.race_phase || "ready",
            start_lineup: raceSnap?.start_lineup || null,
            results: raceSnap?.results || null,
            leader,
            rows,
            ranked,
            drone: raceSnap?.drone || null,
            pose_age_ms: raceSnap?.pose_age_ms,
            stale: Boolean(raceSnap?.stale),
            clock: raceSnap?.clock || null,
            frame_w: Number(raceSnap?.frame_w) || null,
            frame_h: Number(raceSnap?.frame_h) || null,
        };
    }

    const LANE_COLORS = [
        "#ef4444",
        "#f97316",
        "#eab308",
        "#22c55e",
        "#14b8a6",
        "#3b82f6",
        "#8b5cf6",
        "#ec4899",
        "#06b6d4",
        "#a3e635",
    ];

    function laneColor(lane) {
        const n = Math.max(1, Number(lane) || 1);
        return LANE_COLORS[(n - 1) % LANE_COLORS.length];
    }

    function formatClock(elapsedMs) {
        const ms = Math.max(0, Number(elapsedMs) || 0);
        const t = Math.floor(ms / 100) / 10;
        const m = Math.floor(t / 60);
        const s = t - m * 60;
        return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
    }

    function drawSpeedGraph(ctx, box, series, elapsedS, labels) {
        const x = box.x;
        const y = box.y;
        const w = box.w;
        const h = box.h;
        ctx.save();
        ctx.fillStyle = "rgba(8, 14, 24, 0.82)";
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect?.(x, y, w, h, 10);
        if (!ctx.roundRect) {
            ctx.rect(x, y, w, h);
        }
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "600 22px Segoe UI, sans-serif";
        ctx.fillText(labels?.title || "Speed vs time", x + 18, y + 32);
        ctx.font = "14px Segoe UI, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText(labels?.caption || "Source: CV · m/s from start", x + 18, y + 52);

        const padL = 58;
        const padR = 18;
        const padT = 68;
        const padB = 36;
        const gx = x + padL;
        const gy = y + padT;
        const gw = w - padL - padR;
        const gh = h - padT - padB;
        const tMax = Math.max(30, Math.ceil((Number(elapsedS) || 0) / 30) * 30);
        const vMax = 8;
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "12px Segoe UI, sans-serif";
        ctx.lineWidth = 1;
        for (let v = 0; v <= vMax; v += 2) {
            const yy = gy + gh - (v / vMax) * gh;
            ctx.beginPath();
            ctx.moveTo(gx, yy);
            ctx.lineTo(gx + gw, yy);
            ctx.stroke();
            ctx.fillText(String(v), x + 18, yy + 4);
        }
        ctx.fillText("m/s", x + 16, gy - 8);
        ctx.fillText("0 s", gx, y + h - 12);
        ctx.fillText(`${tMax} s`, gx + gw - 36, y + h - 12);

        (series || []).forEach((row) => {
            const pts = row.points || [];
            if (pts.length < 2) return;
            ctx.beginPath();
            ctx.strokeStyle = row.color || laneColor(row.lane);
            ctx.lineWidth = 2.4;
            pts.forEach((p, i) => {
                const px = gx + (Number(p[0]) / tMax) * gw;
                const py = gy + gh - (Math.min(vMax, Math.max(0, Number(p[1]))) / vMax) * gh;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            });
            ctx.stroke();
        });
        ctx.restore();
    }

    global.CvOverlayDraw = {
        ORIGIN,
        LANE_COLORS,
        laneColor,
        formatClock,
        drawSpeedGraph,
        loadDraw,
        mergeRaceAndDraw,
        findRace,
        parseDaysheet,
        parseQualifyCount,
        isFinalRound,
        formatGap,
        selectRace,
        stepRace,
        persistLiveRace,
    };
})(window);
