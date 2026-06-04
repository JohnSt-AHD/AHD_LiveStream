/**
 * KRI live stream — speed vs distance chart (lower third, vMix overlay).
 */
(function (global) {
    const DATA_URL = 'data/kri-sample-wrcp1-m1x-h1.json';
    const Y_MIN = 3.5;
    const Y_MAX = 6;
    const X_MAX = 2000;
    const MARKERS = [0, 500, 1000, 1500, 2000];
    const INTRO_MS = 900;
    const HOLD_MS = 15000;
    const OUTRO_MS = 900;
    const CYCLE_MS = 2500;
    const DRAW_MS = 2400;

    let panel = null;
    let timers = [];
    let cycleIndex = 0;
    let cachedData = null;

    function clearTimers() {
        timers.forEach((t) => clearTimeout(t));
        timers = [];
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

    function xScale(d, w) {
        return (d / X_MAX) * w;
    }

    function yScale(s, h) {
        const t = (s - Y_MIN) / (Y_MAX - Y_MIN);
        return h - Math.max(0, Math.min(1, t)) * h;
    }

    function speedAtDistance(points, dist) {
        if (!points?.length) return null;
        if (dist <= points[0].distance) return points[0].speed;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            if (dist <= b.distance) {
                const span = b.distance - a.distance;
                if (span <= 0) return b.speed;
                const f = (dist - a.distance) / span;
                return a.speed + f * (b.speed - a.speed);
            }
        }
        return points[points.length - 1].speed;
    }

    function pathForBoat(points, w, h) {
        const usable = points.filter((p) => p.speed != null && Number.isFinite(p.speed));
        if (!usable.length) return '';
        return usable
            .map((p, i) => {
                const x = xScale(p.distance, w);
                const y = yScale(p.speed, h);
                return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
            })
            .join(' ');
    }

    function renderChart(data) {
        const svg = document.getElementById('vgSpeedChartSvg');
        const legend = document.getElementById('vgSpeedChartLegend');
        const title = document.getElementById('vgSpeedChartTitle');
        const meta = document.getElementById('vgSpeedChartMeta');
        if (!svg || !legend) return;

        const w = 1680;
        const h = 260;
        const padLeft = 52;
        const padBottom = 28;
        const chartW = w - padLeft - 12;
        const chartH = h - padBottom - 8;

        if (title) {
            title.textContent = data.title || 'Speed vs distance';
        }
        if (meta) {
            const bits = [data.event, data.round, data.race ? `Race ${data.race}` : '']
                .filter(Boolean)
                .join(' · ');
            meta.textContent = bits;
        }

        const parts = [];

        parts.push(
            `<rect x="${padLeft}" y="0" width="${chartW}" height="${chartH}" class="vg-speed-chart__plot-bg" />`,
        );

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
        );
        parts.push(
            `<text x="12" y="${chartH / 2}" class="vg-speed-chart__axis-title vg-speed-chart__axis-title--y" text-anchor="middle" transform="rotate(-90 12 ${chartH / 2})">Speed (m/s)</text>`,
        );

        const boats = data.boats || [];
        boats.forEach((boat, idx) => {
            const d = pathForBoat(boat.points, chartW, chartH);
            if (!d) return;
            parts.push(
                `<path class="vg-speed-chart__trace" data-boat-idx="${idx}" transform="translate(${padLeft},0)" d="${d}" fill="none" stroke="${boat.color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />`,
            );
            for (const dist of MARKERS) {
                const spd = speedAtDistance(boat.points, dist);
                if (spd == null) continue;
                const cx = padLeft + xScale(dist, chartW);
                const cy = yScale(spd, chartH);
                parts.push(
                    `<circle class="vg-speed-chart__dot" data-boat-idx="${idx}" cx="${cx}" cy="${cy}" r="4.5" fill="${boat.color}" stroke="#0a1628" stroke-width="1.2" />`,
                );
            }
        });

        svg.innerHTML = parts.join('');

        legend.innerHTML = boats
            .map(
                (boat, idx) =>
                    `<li class="vg-speed-chart__legend-item" data-boat-idx="${idx}">` +
                    `<span class="vg-speed-chart__legend-swatch" style="background:${boat.color}"></span>` +
                    `<span class="vg-speed-chart__legend-label">${escapeHtml(boat.label || boat.id)}</span>` +
                    (boat.rank != null ? `<span class="vg-speed-chart__legend-rank">P${boat.rank}</span>` : '') +
                    `</li>`,
            )
            .join('');

        requestAnimationFrame(() => animateTraceDraw());
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function animateTraceDraw() {
        const paths = panel?.querySelectorAll('.vg-speed-chart__trace') || [];
        paths.forEach((path, i) => {
            const len = path.getTotalLength();
            path.style.strokeDasharray = String(len);
            path.style.strokeDashoffset = String(len);
            path.style.transition = 'none';
            requestAnimationFrame(() => {
                path.style.transition = `stroke-dashoffset ${DRAW_MS - i * 120}ms ease-out ${i * 120}ms`;
                path.style.strokeDashoffset = '0';
            });
        });
    }

    function setHighlight(index) {
        if (!panel) return;
        const boats = panel.querySelectorAll('[data-boat-idx]');
        boats.forEach((el) => {
            const idx = Number(el.getAttribute('data-boat-idx'));
            const isTrace = el.classList.contains('vg-speed-chart__trace');
            const isDot = el.classList.contains('vg-speed-chart__dot');
            const on = index >= 0 && idx === index;
            if (index < 0) {
                el.classList.remove(
                    'vg-speed-chart__trace--dim',
                    'vg-speed-chart__trace--active',
                    'vg-speed-chart__dot--dim',
                    'vg-speed-chart__dot--active',
                );
                return;
            }
            if (isTrace) {
                el.classList.toggle('vg-speed-chart__trace--dim', !on);
                el.classList.toggle('vg-speed-chart__trace--active', on);
            }
            if (isDot) {
                el.classList.toggle('vg-speed-chart__dot--dim', !on);
                el.classList.toggle('vg-speed-chart__dot--active', on);
            }
        });
        panel.querySelectorAll('.vg-speed-chart__legend-item').forEach((el) => {
            const idx = Number(el.getAttribute('data-boat-idx'));
            el.classList.toggle('vg-speed-chart__legend-item--active', index >= 0 && idx === index);
        });
    }

    function startCycle(boatCount) {
        cycleIndex = 0;
        setHighlight(0);
        if (boatCount <= 1) return;
        let step = 0;
        const tick = () => {
            step = (step + 1) % boatCount;
            setHighlight(step);
            schedule(tick, CYCLE_MS);
        };
        schedule(tick, CYCLE_MS);
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

    async function show(opts = {}) {
        clearTimers();
        const stage = document.querySelector('.vg-stage');
        ensurePanel(stage);
        if (!panel) return;

        const data = opts.data || (await loadData(opts.dataUrl));
        renderChart(data);

        panel.classList.remove('vg-speed-chart--outro', 'vg-speed-chart--hold');
        panel.classList.add('vg-speed-chart--intro');
        void panel.offsetWidth;
        panel.classList.add('vg-speed-chart--visible');

        await wait(INTRO_MS);
        panel.classList.remove('vg-speed-chart--intro');
        panel.classList.add('vg-speed-chart--hold');
        startCycle((data.boats || []).length);
    }

    async function hide() {
        clearTimers();
        if (!panel) return;
        setHighlight(-1);
        panel.classList.remove('vg-speed-chart--hold', 'vg-speed-chart--intro');
        panel.classList.add('vg-speed-chart--outro');
        await wait(OUTRO_MS);
        destroy();
    }

    function destroy() {
        clearTimers();
        if (panel) {
            panel.classList.remove(
                'vg-speed-chart--visible',
                'vg-speed-chart--intro',
                'vg-speed-chart--hold',
                'vg-speed-chart--outro',
            );
        }
        setHighlight(-1);
    }

    function remove() {
        clearTimers();
        if (panel) {
            panel.remove();
            panel = null;
        }
    }

    global.KriVmixSpeedChart = {
        DATA_URL,
        INTRO_MS,
        HOLD_MS,
        OUTRO_MS,
        show,
        hide,
        destroy,
        remove,
        loadData,
        renderChart,
    };
})(typeof window !== 'undefined' ? window : globalThis);
