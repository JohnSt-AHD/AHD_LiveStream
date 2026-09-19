/**
 * Ged CV distance splits — bottom-right placing board.
 * Standalone page, or embed on Ged CV course overlay via GedCvSplits API.
 *
 * Shortcuts (when embed handles keys): y = toggle splits board
 */
(function (global) {
    const HOLD_MS_DEFAULT = 45000;

    function createController(opts) {
        const o = opts && typeof opts === "object" ? opts : {};
        const rootId = o.rootId || "gedSplits";
        const holdMs = Math.max(8000, Number(o.holdMs) || HOLD_MS_DEFAULT);
        const showSection = o.showSection !== false;
        let latestDraw = o.draw || null;
        let enabled = o.enabled !== false;
        let shownMark = null;
        let fingerprint = "";
        let hideTimer = null;

        function escapeHtml(s) {
            return String(s || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");
        }

        function crewByLane(lane) {
            const lanes = latestDraw?.lanes || [];
            return lanes.find((r) => Number(r.lane) === Number(lane)) || null;
        }

        function boardFingerprint(mark, rows) {
            return `${mark}|${(rows || [])
                .map((r) => `${r.lane}:${r.elapsed_ms}`)
                .join(",")}`;
        }

        function scheduleHide() {
            clearTimeout(hideTimer);
            if (!enabled) return;
            hideTimer = setTimeout(() => {
                const root = document.getElementById(rootId);
                if (!root || root.hidden) return;
                root.classList.add("is-outro");
                setTimeout(() => {
                    root.hidden = true;
                    root.classList.remove("is-outro");
                    shownMark = null;
                    fingerprint = "";
                }, 420);
            }, holdMs);
        }

        function hideNow() {
            clearTimeout(hideTimer);
            const root = document.getElementById(rootId);
            if (!root) return;
            root.hidden = true;
            root.classList.remove("is-outro");
            shownMark = null;
            fingerprint = "";
        }

        function renderBoard(mark, rows) {
            const root = document.getElementById(rootId);
            const list = document.getElementById("gedSplitsList");
            const title = document.getElementById("gedSplitsTitle");
            const sub = document.getElementById("gedSplitsSub");
            if (!root || !list) return;
            if (!enabled) {
                hideNow();
                return;
            }
            if (!mark || !rows?.length) {
                if (!root.hidden) scheduleHide();
                return;
            }

            const fp = boardFingerprint(mark, rows);
            const markChanged = shownMark !== mark;
            const dataChanged = fp !== fingerprint;
            fingerprint = fp;
            shownMark = mark;

            if (title) title.textContent = `${mark} m`;
            if (sub) {
                sub.textContent =
                    rows.length === 1 ? "1st through" : `${rows.length} crews`;
            }

            list.innerHTML = rows
                .map((row, idx) => {
                    const crew = crewByLane(row.lane);
                    const name = escapeHtml(
                        crew?.label || crew?.shortLabel || crew?.code || `Lane ${row.lane}`,
                    );
                    const code = escapeHtml(crew?.shortLabel || `L${row.lane}`);
                    const logo = crew?.logoUrl
                        ? `<img class="ged-splits__logo" src="${crew.logoUrl}" alt="">`
                        : '<span class="ged-splits__logo ged-splits__logo--empty" aria-hidden="true"></span>';
                    const section =
                        showSection && mark > 500 && row.section_time
                            ? ` · +${escapeHtml(row.section_time)}`
                            : "";
                    const lead = idx === 0 ? " ged-splits__row--lead" : "";
                    return (
                        `<div class="ged-splits__row${lead}">` +
                        `<span class="ged-splits__rank">${row.placing || idx + 1}</span>` +
                        logo +
                        `<div class="ged-splits__copy">` +
                        `<span class="ged-splits__name">${name}</span>` +
                        `<span class="ged-splits__meta">${code} · Ln ${row.lane}${section}</span>` +
                        `</div>` +
                        `<span class="ged-splits__time">${escapeHtml(row.time || "—")}</span>` +
                        `</div>`
                    );
                })
                .join("");

            if (root.hidden || markChanged) {
                root.hidden = false;
                root.classList.remove("is-outro");
                const panel = root.querySelector(".ged-splits__panel");
                if (panel) {
                    panel.style.animation = "none";
                    void panel.offsetWidth;
                    panel.style.animation = "";
                }
            }
            if (dataChanged) scheduleHide();
        }

        function setDraw(draw) {
            latestDraw = draw || null;
        }

        function setEnabled(on) {
            enabled = Boolean(on);
            if (!enabled) hideNow();
        }

        function update(race) {
            if (!enabled) {
                hideNow();
                return;
            }
            const splits = race?.splits || race?.results?.splits || null;
            if (!splits) return;
            const mark = Number(splits.active_mark);
            const rows = splits.by_mark?.[String(mark)] || [];
            if (Number.isFinite(mark) && rows.length) renderBoard(mark, rows);
        }

        return {
            setDraw,
            setEnabled,
            isEnabled: () => enabled,
            update,
            hideNow,
        };
    }

    global.GedCvSplits = { create: createController };

    // Standalone page boot
    const isStandalone = Boolean(document.getElementById("gedSplitsStandalone"));
    if (!isStandalone) return;

    const params = new URLSearchParams(location.search);
    const laptop = (
        params.get("cvLaptop") ||
        params.get("laptop") ||
        "http://127.0.0.1:8790"
    ).replace(/\/$/, "");
    const raceUrl = params.get("raceUrl") || `${laptop}/api/race`;
    const configUrl = `${laptop}/api/config`;
    let raceOverride = params.get("race") || "";
    const ctrl = createController({
        holdMs: params.get("holdMs"),
        showSection: params.get("section") !== "0",
        enabled: true,
    });

    async function loadDraw() {
        let cloud = {};
        try {
            const res = await fetch(configUrl, { cache: "no-store" });
            if (res.ok) {
                const cfg = await res.json();
                cloud = cfg.cloud || {};
            }
        } catch (_) {}
        if (!window.CvOverlayDraw) return;
        try {
            const draw = await CvOverlayDraw.loadDraw({
                regatta: params.get("regatta") || cloud.regatta,
                race: raceOverride || params.get("race") || cloud.live_race,
            });
            if (draw?.race) raceOverride = draw.race;
            ctrl.setDraw(draw);
        } catch (_) {}
    }

    async function poll() {
        try {
            const res = await fetch(raceUrl, { cache: "no-store" });
            if (!res.ok) return;
            const race = await res.json();
            ctrl.update(race);
        } catch (_) {}
    }

    loadDraw().then(() => {
        poll();
        setInterval(poll, 250);
        setInterval(loadDraw, 20000);
    });
})(window);
