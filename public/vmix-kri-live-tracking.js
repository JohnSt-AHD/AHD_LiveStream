/**
 * KRI live stream — bottom-right live tracking panel (no chart).
 * Replays the same demo speed-vs-distance data as the speed chart module.
 */
(function (global) {
    const DATA_URL = 'data/kri-sample-wrcp1-m1x-h1.json';
    const INTRO_MS = 900;
    const OUTRO_MS = 900;
    const POST_RACE_MS = 2000;
    const SWAP_MS = 3000;
    const ROW_HEIGHT_PX = 48;
    const ROW_GAP_PX = 8;
    const ROW_STEP_PX = ROW_HEIGHT_PX + ROW_GAP_PX;
    const LOGO_PLACEHOLDER = 'assets/school-logos/placeholder-white.svg';

    let panel = null;
    let activeRaceContext = null;
    let timers = [];
    let rafId = null;
    let cachedData = null;
    let raceState = null;
    let playbackAbort = false;
    let layoutReady = false;

    function clearTimers() {
        playbackAbort = true;
        timers.forEach((t) => clearTimeout(t));
        timers = [];
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

    function beginPlayback() {
        playbackAbort = false;
    }

    function schedule(fn, ms) {
        timers.push(setTimeout(fn, ms));
    }

    function wait(ms) {
        return new Promise((resolve) => schedule(resolve, ms));
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function ensurePanel(stage) {
        if (panel) return panel;
        const root = stage || document.querySelector('.vg-stage');
        if (!root) return null;
        panel = document.createElement('div');
        panel.id = 'kriLiveTrackingPanel';
        panel.className = 'kri-live-tracking';
        panel.setAttribute('role', 'img');
        panel.setAttribute('aria-label', 'Live tracking');
        panel.innerHTML =
            '<div class="kri-live-tracking__panel">' +
            '<div class="kri-live-tracking__head">' +
            '<h2 class="kri-live-tracking__title">Live Tracking</h2>' +
            '<p class="kri-live-tracking__to-go" id="kriLiveTrackingToGo">—</p>' +
            '</div>' +
            '<div class="kri-live-tracking__list" id="kriLiveTrackingList"></div>' +
            '</div>';
        root.appendChild(panel);
        return panel;
    }

    function applyLiveTrackingContext(state, raceContext) {
        const speedChart = global.KriVmixSpeedChart;
        const base =
            speedChart?.applyRaceContext?.(state, raceContext) ||
            state;
        if (!raceContext) {
            const boats = base.boats.map((boat) => ({
                ...boat,
                shortLabel: boat.shortLabel || boat.id || boat.label,
            }));
            return { ...base, boats };
        }
        const lanes = Array.isArray(raceContext.lanes) ? raceContext.lanes : [];
        const boats = base.boats.map((boat, idx) => {
            const lane = lanes[idx];
            return {
                ...boat,
                label: lane?.label || boat.label || boat.id,
                logoUrl: lane?.logoUrl || boat.logoUrl || null,
                lane: lane?.lane ?? boat.lane,
                shortLabel:
                    lane?.shortLabel ||
                    boat.shortLabel ||
                    boat.id ||
                    boat.label,
            };
        });
        const data = {
            ...base.data,
            event: raceContext.event || base.data.event,
            round: raceContext.round ?? base.data.round,
            race: raceContext.race ?? base.data.race,
            venue: raceContext.venue ?? base.data.venue,
        };
        return { ...base, data, boats };
    }

    function courseLength(state) {
        return state?.data?.courseLength || global.KriVmixSpeedChart?.COURSE_LENGTH || 2000;
    }

    function formatToGo(leaderDistance, length) {
        const remaining = Math.max(0, Math.round(length - leaderDistance));
        return `${remaining.toLocaleString('en-NZ')} m to go`;
    }

    function rowHtml(boat, idx) {
        const src = boat.logoUrl || LOGO_PLACEHOLDER;
        const name = boat.shortLabel || boat.id || boat.label;
        return (
            `<div class="kri-live-tracking__row" data-boat-idx="${idx}">` +
            `<span class="kri-live-tracking__rank"></span>` +
            `<img class="kri-live-tracking__logo" src="${escapeHtml(src)}" alt="">` +
            `<span class="kri-live-tracking__name">${escapeHtml(name)}</span>` +
            `<span class="kri-live-tracking__gap"></span>` +
            `</div>`
        );
    }

    function renderRows(state) {
        const list = document.getElementById('kriLiveTrackingList');
        if (!list) return;
        const count = state.boats.length;
        list.style.height = `${Math.max(0, count * ROW_STEP_PX - ROW_GAP_PX)}px`;
        list.innerHTML = state.boats.map((boat, idx) => rowHtml(boat, idx)).join('');
        layoutReady = false;
    }

    function updateFrame(tSec, opts = {}) {
        if (!raceState || !panel) return;
        const speedChart = global.KriVmixSpeedChart;
        if (!speedChart?.liveStandings) return;

        const animate = opts.animate !== false && layoutReady;
        const { boats } = raceState;
        const length = courseLength(raceState);
        const standings = speedChart.liveStandings(boats, tSec);
        const leaderDistance = standings[0]?.distance ?? 0;

        const toGo = document.getElementById('kriLiveTrackingToGo');
        if (toGo) toGo.textContent = formatToGo(leaderDistance, length);

        standings.forEach((entry, rank) => {
            const row = panel.querySelector(
                `.kri-live-tracking__row[data-boat-idx="${entry.idx}"]`,
            );
            if (!row) return;

            if (!animate) row.style.transition = 'none';
            row.style.top = `${rank * ROW_STEP_PX}px`;
            if (!animate) {
                void row.offsetWidth;
                row.style.transition = '';
            }

            const rankEl = row.querySelector('.kri-live-tracking__rank');
            if (rankEl) rankEl.textContent = String(rank + 1);

            const gapEl = row.querySelector('.kri-live-tracking__gap');
            if (gapEl) {
                gapEl.textContent = speedChart.formatGapFromLeader(
                    leaderDistance - entry.distance,
                    rank === 0,
                );
            }
        });

        layoutReady = true;
    }

    async function loadData(url) {
        if (cachedData && !url) return cachedData;
        if (global.KriVmixSpeedChart?.loadData) {
            cachedData = await global.KriVmixSpeedChart.loadData(url);
            return cachedData;
        }
        const res = await fetch(url || DATA_URL);
        if (!res.ok) throw new Error(`Could not load ${url || DATA_URL}`);
        cachedData = await res.json();
        return cachedData;
    }

    function prepareState(data) {
        if (!global.KriVmixSpeedChart?.prepareChartState) {
            throw new Error('Speed chart module not loaded');
        }
        return global.KriVmixSpeedChart.prepareChartState(data);
    }

    function playRaceRealtime() {
        return new Promise((resolve) => {
            const durationSec = raceState.raceDurationSec;
            let startTs = null;

            function frame(ts) {
                if (!raceState || playbackAbort) {
                    rafId = null;
                    resolve();
                    return;
                }
                if (startTs == null) startTs = ts;
                const elapsedSec = (ts - startTs) / 1000;
                updateFrame(elapsedSec, { animate: true });

                if (elapsedSec < durationSec + POST_RACE_MS / 1000) {
                    rafId = requestAnimationFrame(frame);
                } else {
                    rafId = null;
                    resolve();
                }
            }

            updateFrame(0, { animate: false });
            rafId = requestAnimationFrame(frame);
        });
    }

    function getPlaybackDurationMs(state) {
        return INTRO_MS + state.raceDurationMs + POST_RACE_MS;
    }

    async function show(opts = {}) {
        clearTimers();
        beginPlayback();
        ensurePanel(document.querySelector('.vg-stage'));
        if (!panel) return { raceDurationMs: 0, playbackDurationMs: 0 };

        const data = opts.data || (await loadData(opts.dataUrl));
        activeRaceContext = opts.raceContext || null;
        raceState = applyLiveTrackingContext(prepareState(data), activeRaceContext);
        renderRows(raceState);
        updateFrame(0, { animate: false });

        panel.classList.remove('kri-live-tracking--outro', 'kri-live-tracking--hold');
        panel.classList.add('kri-live-tracking--intro');
        void panel.offsetWidth;
        panel.classList.add('kri-live-tracking--visible');

        await wait(INTRO_MS);
        panel.classList.remove('kri-live-tracking--intro');
        panel.classList.add('kri-live-tracking--hold');

        await playRaceRealtime();

        return {
            raceDurationMs: raceState.raceDurationMs,
            raceDurationSec: raceState.raceDurationSec,
            playbackDurationMs: getPlaybackDurationMs(raceState),
        };
    }

    async function hide() {
        clearTimers();
        raceState = null;
        activeRaceContext = null;
        layoutReady = false;
        if (!panel) return;
        panel.classList.remove('kri-live-tracking--hold', 'kri-live-tracking--intro');
        panel.classList.add('kri-live-tracking--outro');
        await wait(OUTRO_MS);
        destroy();
    }

    function destroy() {
        clearTimers();
        raceState = null;
        activeRaceContext = null;
        layoutReady = false;
        if (panel) {
            panel.classList.remove(
                'kri-live-tracking--visible',
                'kri-live-tracking--intro',
                'kri-live-tracking--hold',
                'kri-live-tracking--outro',
            );
        }
    }

    function remove() {
        clearTimers();
        raceState = null;
        activeRaceContext = null;
        layoutReady = false;
        if (panel) {
            panel.remove();
            panel = null;
        }
    }

    global.KriVmixLiveTracking = {
        DATA_URL,
        INTRO_MS,
        OUTRO_MS,
        POST_RACE_MS,
        SWAP_MS,
        ROW_STEP_PX,
        show,
        hide,
        destroy,
        remove,
        loadData,
        getPlaybackDurationMs,
    };
})(typeof window !== 'undefined' ? window : globalThis);
