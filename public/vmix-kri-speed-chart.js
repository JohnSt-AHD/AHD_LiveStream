/**
 * KRI live stream — speed vs distance chart (lower third, vMix overlay).
 * Demo/sample: replays WR split speeds in real time (~7 min for 2k M1x H1).
 */
(function (global) {
    const DATA_URL = 'data/kri-sample-wrcp1-m1x-h1.json';
    const Y_MIN = 3.5;
    const Y_MAX = 6;
    const X_MAX = 2000;
    const MARKERS = [0, 500, 1000, 1500, 2000];
    const INTRO_MS = 900;
    const OUTRO_MS = 900;
    const POST_RACE_MS = 2000;
    const TRACE_OPACITY = 0.92;

    let panel = null;
    let timers = [];
    let rafId = null;
    let cachedData = null;
    let chartState = null;
    let playbackAbort = false;

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

    function ensurePanel(stage) {
        if (panel) return panel;
        const root = stage || document.querySelector('.vg-stage');
        if (!root) return null;
        panel = document.createElement('div');
        panel.id = 'vgSpeedChartPanel';
        panel.className = 'vg-speed-chart';
        panel.setAttribute('role', 'img');
        panel.setAttribute('aria-label', 'Speed vs distance');
        panel.innerHTML = `
            <div class="vg-speed-chart__panel">
                <div class="vg-speed-chart__head">
                    <p class="vg-speed-chart__title" id="vgSpeedChartTitle">Speed vs distance</p>
                    <p class="vg-speed-chart__meta" id="vgSpeedChartMeta"></p>
                </div>
                <div class="vg-speed-chart__body">
                    <svg class="vg-speed-chart__svg" id="vgSpeedChartSvg" viewBox="0 0 1680 260" preserveAspectRatio="none" aria-hidden="true"></svg>
                    <ul class="vg-speed-chart__legend" id="vgSpeedChartLegend"></ul>
                </div>
            </div>
        `;
        root.appendChild(panel);
        return panel;
    }

    /** Map speed (m/s) to SVG y; 0 m/s sits on the chart floor. */
    function yScale(speed, chartH) {
        if (speed <= 0) return chartH;
        const clamped = Math.max(Y_MIN, Math.min(Y_MAX, speed));
        const t = (clamped - Y_MIN) / (Y_MAX - Y_MIN);
        return chartH - t * chartH;
    }

    function xScale(distance, chartW) {
        return (distance / X_MAX) * chartW;
    }

    /** Real-time timeline: integrate 50 m splits using average segment speed. */
    function buildTimeline(points) {
        const rows = points
            .filter((p) => p.distance > 0 && Number.isFinite(p.speed))
            .sort((a, b) => a.distance - b.distance);
        const timeline = [{ t: 0, distance: 0, speed: 0 }];
        let t = 0;
        let prevDist = 0;
        let prevSpeed = 0;
        for (const row of rows) {
            const segDist = row.distance - prevDist;
            const segSpeed = Math.max(0.1, (prevSpeed + row.speed) / 2);
            t += segDist / segSpeed;
            timeline.push({ t, distance: row.distance, speed: row.speed });
            prevDist = row.distance;
            prevSpeed = row.speed;
        }
        return timeline;
    }

    function stateAtTime(timeline, tSec) {
        if (tSec <= 0) return { distance: 0, speed: 0 };
        const last = timeline[timeline.length - 1];
        if (tSec >= last.t) return { distance: last.distance, speed: last.speed };
        for (let i = 1; i < timeline.length; i++) {
            const b = timeline[i];
            if (tSec <= b.t) {
                const a = timeline[i - 1];
                const f = (tSec - a.t) / (b.t - a.t);
                return {
                    distance: a.distance + f * (b.distance - a.distance),
                    speed: a.speed + f * (b.speed - a.speed),
                };
            }
        }
        return last;
    }

    function tracePointsUpToTime(timeline, tSec) {
        const pts = [{ distance: 0, speed: 0 }];
        for (let i = 1; i < timeline.length; i++) {
            if (timeline[i].t <= tSec) pts.push(timeline[i]);
            else break;
        }
        const cur = stateAtTime(timeline, tSec);
        const tail = pts[pts.length - 1];
        if (cur.distance > tail.distance + 0.05) {
            pts.push(cur);
        }
        return pts;
    }

    function pathFromPoints(points, chartW, chartH) {
        if (!points.length) return '';
        return points
            .map((p, i) => {
                const x = xScale(p.distance, chartW);
                const y = yScale(p.speed, chartH);
                return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
            })
            .join(' ');
    }

    function formatRaceClock(sec) {
        const s = Math.max(0, Math.floor(sec));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m}:${String(r).padStart(2, '0')}`;
    }

    function prepareChartState(data) {
        const boats = (data.boats || []).map((boat) => {
            const timeline = buildTimeline(boat.points || []);
            return {
                ...boat,
                timeline,
                finishTime: timeline[timeline.length - 1].t,
            };
        });
        const raceDurationSec = Math.max(0, ...boats.map((b) => b.finishTime));
        return {
            data,
            boats,
            raceDurationSec,
            raceDurationMs: raceDurationSec * 1000,
            layout: {
                w: 1680,
                h: 260,
                padLeft: 52,
                padBottom: 28,
                chartW: 1680 - 52 - 12,
                chartH: 260 - 28 - 8,
            },
        };
    }

    function renderStaticLayers(state) {
        const svg = document.getElementById('vgSpeedChartSvg');
        const legend = document.getElementById('vgSpeedChartLegend');
        const title = document.getElementById('vgSpeedChartTitle');
        const meta = document.getElementById('vgSpeedChartMeta');
        if (!svg || !legend) return;

        const { data, layout } = state;
        const { w, h, padLeft, chartW, chartH } = layout;

        if (title) title.textContent = data.title || 'Speed vs distance';
        if (meta) {
            const bits = [data.event, data.round, data.race ? `Race ${data.race}` : '']
                .filter(Boolean)
                .join(' · ');
            meta.textContent = bits;
        }

        const parts = [
            `<rect x="${padLeft}" y="0" width="${chartW}" height="${chartH}" class="vg-speed-chart__plot-bg" />`,
        ];

        for (let y = Y_MIN; y <= Y_MAX + 0.01; y += 0.5) {
            const py = yScale(y, chartH);
            parts.push(
                `<line x1="${padLeft}" y1="${py}" x2="${padLeft + chartW}" y2="${py}" class="vg-speed-chart__grid" />`,
            );
            parts.push(
                `<text x="${padLeft - 8}" y="${py + 4}" class="vg-speed-chart__ylabel" text-anchor="end">${y.toFixed(1)}</text>`,
            );
        }

        for (const dist of MARKERS) {
            const px = padLeft + xScale(dist, chartW);
            parts.push(
                `<line x1="${px}" y1="0" x2="${px}" y2="${chartH}" class="vg-speed-chart__marker-line" />`,
            );
            const label = dist === 0 ? 'Start' : dist === 2000 ? 'Finish' : `${dist}m`;
            parts.push(
                `<text x="${px}" y="${chartH + 20}" class="vg-speed-chart__xlabel" text-anchor="middle">${label}</text>`,
            );
        }

        parts.push(
            `<text x="${padLeft + chartW / 2}" y="${h - 2}" class="vg-speed-chart__axis-title" text-anchor="middle">Distance (m)</text>`,
            `<text x="12" y="${chartH / 2}" class="vg-speed-chart__axis-title vg-speed-chart__axis-title--y" text-anchor="middle" transform="rotate(-90 12 ${chartH / 2})">Speed (m/s)</text>`,
            `<g id="vgSpeedChartBoats" transform="translate(${padLeft},0)"></g>`,
        );

        svg.innerHTML = parts.join('');

        legend.innerHTML = state.boats
            .map(
                (boat, idx) =>
                    `<li class="vg-speed-chart__legend-item" data-boat-idx="${idx}">` +
                    `<span class="vg-speed-chart__legend-swatch" style="background:${boat.color}"></span>` +
                    `<span class="vg-speed-chart__legend-label">${escapeHtml(boat.label || boat.id)}</span>` +
                    (boat.rank != null ? `<span class="vg-speed-chart__legend-rank">P${boat.rank}</span>` : '') +
                    `</li>`,
            )
            .join('');

        const group = document.getElementById('vgSpeedChartBoats');
        if (group) {
            group.innerHTML = state.boats
                .map(
                    (boat, idx) =>
                        `<g class="vg-speed-chart__boat" data-boat-idx="${idx}">` +
                        `<path class="vg-speed-chart__trace" fill="none" stroke="${boat.color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" opacity="${TRACE_OPACITY}" />` +
                        MARKERS.filter((d) => d > 0)
                            .map(
                                () =>
                                    `<circle class="vg-speed-chart__dot vg-speed-chart__dot--marker" r="4.5" fill="${boat.color}" stroke="#0a1628" stroke-width="1.2" opacity="0" />`,
                            )
                            .join('') +
                        `<circle class="vg-speed-chart__dot vg-speed-chart__dot--head" r="5" fill="${boat.color}" stroke="#fff" stroke-width="1.4" opacity="${TRACE_OPACITY}" />` +
                        `</g>`,
                )
                .join('');
        }
    }

    function speedAtMarker(timeline, dist) {
        const hit = timeline.find((p) => p.distance === dist);
        if (hit) return hit.speed;
        return stateAtTime(timeline, timeline[timeline.length - 1].t).speed;
    }

    function updateFrame(tSec) {
        if (!chartState || !panel) return;
        const { boats, layout, data } = chartState;
        const { chartW, chartH } = layout;
        const meta = document.getElementById('vgSpeedChartMeta');
        if (meta) {
            const bits = [data.event, data.round, data.race ? `Race ${data.race}` : '']
                .filter(Boolean)
                .join(' · ');
            meta.textContent = `${bits} · ${formatRaceClock(tSec)}`;
        }

        const markerDists = MARKERS.filter((d) => d > 0);

        boats.forEach((boat, idx) => {
            const g = panel.querySelector(`.vg-speed-chart__boat[data-boat-idx="${idx}"]`);
            if (!g) return;
            const trace = g.querySelector('.vg-speed-chart__trace');
            const head = g.querySelector('.vg-speed-chart__dot--head');
            const markerDots = g.querySelectorAll('.vg-speed-chart__dot--marker');
            const pts = tracePointsUpToTime(boat.timeline, tSec);
            const cur = pts[pts.length - 1];

            if (trace) trace.setAttribute('d', pathFromPoints(pts, chartW, chartH));
            if (head) {
                head.setAttribute('cx', xScale(cur.distance, chartW));
                head.setAttribute('cy', yScale(cur.speed, chartH));
            }

            markerDots.forEach((dot, mi) => {
                const dist = markerDists[mi];
                if (cur.distance >= dist) {
                    dot.setAttribute('cx', xScale(dist, chartW));
                    dot.setAttribute('cy', yScale(speedAtMarker(boat.timeline, dist), chartH));
                    dot.setAttribute('opacity', String(TRACE_OPACITY));
                } else {
                    dot.setAttribute('opacity', '0');
                }
            });
        });
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function playRaceRealtime() {
        return new Promise((resolve) => {
            const durationSec = chartState.raceDurationSec;
            let startTs = null;

            function frame(ts) {
                if (!chartState || playbackAbort) {
                    rafId = null;
                    resolve();
                    return;
                }
                if (startTs == null) startTs = ts;
                const elapsedSec = (ts - startTs) / 1000;
                updateFrame(elapsedSec);

                if (elapsedSec < durationSec + POST_RACE_MS / 1000) {
                    rafId = requestAnimationFrame(frame);
                } else {
                    rafId = null;
                    resolve();
                }
            }

            updateFrame(0);
            rafId = requestAnimationFrame(frame);
        });
    }

    async function loadData(url) {
        if (cachedData && !url) return cachedData;
        const res = await fetch(url || DATA_URL);
        if (!res.ok) throw new Error(`Could not load ${url || DATA_URL}`);
        cachedData = await res.json();
        return cachedData;
    }

    function wait(ms) {
        return new Promise((resolve) => schedule(resolve, ms));
    }

    function getPlaybackDurationMs(state) {
        return INTRO_MS + state.raceDurationMs + POST_RACE_MS;
    }

    async function show(opts = {}) {
        clearTimers();
        beginPlayback();
        const stage = document.querySelector('.vg-stage');
        ensurePanel(stage);
        if (!panel) return { raceDurationMs: 0, playbackDurationMs: 0 };

        const data = opts.data || (await loadData(opts.dataUrl));
        chartState = prepareChartState(data);
        renderStaticLayers(chartState);
        updateFrame(0);

        panel.classList.remove('vg-speed-chart--outro', 'vg-speed-chart--hold');
        panel.classList.add('vg-speed-chart--intro');
        void panel.offsetWidth;
        panel.classList.add('vg-speed-chart--visible');

        await wait(INTRO_MS);
        panel.classList.remove('vg-speed-chart--intro');
        panel.classList.add('vg-speed-chart--hold');

        await playRaceRealtime();

        const result = {
            raceDurationMs: chartState.raceDurationMs,
            raceDurationSec: chartState.raceDurationSec,
            playbackDurationMs: getPlaybackDurationMs(chartState),
        };
        return result;
    }

    async function hide() {
        clearTimers();
        chartState = null;
        if (!panel) return;
        panel.classList.remove('vg-speed-chart--hold', 'vg-speed-chart--intro');
        panel.classList.add('vg-speed-chart--outro');
        await wait(OUTRO_MS);
        destroy();
    }

    function destroy() {
        clearTimers();
        chartState = null;
        if (panel) {
            panel.classList.remove(
                'vg-speed-chart--visible',
                'vg-speed-chart--intro',
                'vg-speed-chart--hold',
                'vg-speed-chart--outro',
            );
        }
    }

    function remove() {
        clearTimers();
        chartState = null;
        if (panel) {
            panel.remove();
            panel = null;
        }
    }

    global.KriVmixSpeedChart = {
        DATA_URL,
        INTRO_MS,
        OUTRO_MS,
        POST_RACE_MS,
        show,
        hide,
        destroy,
        remove,
        loadData,
        prepareChartState,
        getPlaybackDurationMs,
    };
})(typeof window !== 'undefined' ? window : globalThis);
