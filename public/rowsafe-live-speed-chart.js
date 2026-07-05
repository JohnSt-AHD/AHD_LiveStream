/**
 * Live speed vs time chart for RNZ RowSafe map (CrewSight Manager style).
 */
(function (global) {
    const DEVICE_COLORS = [
        '#38bdf8',
        '#a78bfa',
        '#4ade80',
        '#fb923c',
        '#f472b6',
        '#facc15',
        '#2dd4bf',
        '#818cf8',
    ];
    const WINDOW_MS = 5 * 60 * 1000;
    const LIVE_CHART_DENSIFY_SEC = 0.25;
    const LIVE_SPEED_SMOOTH = { tauSec: 4, maxAccelMps2: 2.5, glitchHoldAboveMps: 1.5 };

    /** @type {Map<string, { points: { t: number, speedMps: number }[] }>} */
    const buffers = new Map();
    /** @type {Map<string, number>} */
    const deviceOrder = new Map();
    /** @type {Map<string, string>} */
    const deviceLabels = new Map();

    function deviceColor(deviceId) {
        if (!deviceOrder.has(deviceId)) {
            deviceOrder.set(deviceId, deviceOrder.size);
        }
        return DEVICE_COLORS[deviceOrder.get(deviceId) % DEVICE_COLORS.length];
    }

    function prune(buf, now) {
        const cutoff = now - WINDOW_MS;
        buf.points = buf.points.filter((p) => p.t >= cutoff);
    }

    function smoothSpeedTimeSeries(points, opts = {}) {
        if (points.length <= 1) return points.map((p) => ({ ...p }));

        const tauSec = opts.tauSec ?? 12;
        const maxAccel = opts.maxAccelMps2 ?? 1.0;
        const glitchHold = opts.glitchHoldAboveMps ?? 1.5;
        const out = [{ tMs: points[0].tMs, value: points[0].value }];

        for (let i = 1; i < points.length; i++) {
            const prev = out[out.length - 1];
            const sample = points[i];
            const dtSec = Math.max(0.05, (sample.tMs - prev.tMs) / 1000);

            let target = sample.value;
            if (target < 0.3 && prev.value >= glitchHold) {
                target = prev.value * Math.exp(-dtSec / 18);
            }

            const maxDelta = maxAccel * dtSec;
            const clamped = Math.max(prev.value - maxDelta, Math.min(prev.value + maxDelta, target));
            const alpha = 1 - Math.exp(-dtSec / tauSec);
            const value = prev.value + alpha * (clamped - prev.value);
            out.push({ tMs: sample.tMs, value: Math.max(0, value) });
        }

        return out;
    }

    function densifyTimeSeries(points, stepSec = 0.25) {
        if (points.length <= 1) return points.map((p) => ({ ...p }));

        const stepMs = Math.max(50, stepSec * 1000);
        const out = [{ ...points[0] }];

        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            const span = b.tMs - a.tMs;
            if (span <= 0) continue;

            for (let tMs = a.tMs + stepMs; tMs < b.tMs; tMs += stepMs) {
                const f = (tMs - a.tMs) / span;
                out.push({ tMs, value: a.value + f * (b.value - a.value) });
            }
            out.push({ ...b });
        }

        return out;
    }

    function niceTicks(min, max, count) {
        if (max <= min) return [min];
        const span = max - min;
        const step = 10 ** Math.floor(Math.log10(span / count));
        const err = span / step / count;
        let tickStep = step;
        if (err >= 7.5) tickStep = step * 10;
        else if (err >= 3.5) tickStep = step * 5;
        else if (err >= 1.5) tickStep = step * 2;
        const start = Math.ceil(min / tickStep) * tickStep;
        const ticks = [];
        for (let v = start; v <= max + tickStep * 0.01; v += tickStep) ticks.push(v);
        return ticks.length ? ticks : [min, max];
    }

    function liveSpeedVsTimeSeries(activeDeviceIds) {
        return activeDeviceIds
            .filter((id) => (buffers.get(id)?.points.length ?? 0) >= 2)
            .map((id) => {
                const pts = buffers.get(id).points;
                const t0 = pts[0].t;
                const smoothed = densifyTimeSeries(
                    smoothSpeedTimeSeries(
                        pts.map((p) => ({ tMs: p.t, value: p.speedMps })),
                        LIVE_SPEED_SMOOTH,
                    ),
                    LIVE_CHART_DENSIFY_SEC,
                );
                return {
                    id,
                    label: deviceLabels.get(id) || id,
                    color: deviceColor(id),
                    points: smoothed.map((p) => ({
                        x: (p.tMs - t0) / 1000,
                        y: p.value * 3.6,
                    })),
                };
            });
    }

    function drawMultiSeriesChart(canvas, series, opts) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(global.devicePixelRatio || 1, 2);
        const cssW = canvas.clientWidth || 320;
        const cssH = canvas.clientHeight || 200;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const w = cssW;
        const h = cssH;
        const padL = 44;
        const padR = 12;
        const padT = 36;
        const padB = 32;
        const plotW = w - padL - padR;
        const plotH = h - padT - padB;

        ctx.clearRect(0, 0, w, h);

        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#0f172a');
        bg.addColorStop(1, '#1e293b');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '600 13px "Source Sans 3", system-ui, sans-serif';
        ctx.fillText(opts.title, padL, 20);

        const allPts = series.flatMap((s) => s.points);
        if (allPts.length < 2) {
            ctx.fillStyle = '#64748b';
            ctx.font = '12px system-ui';
            ctx.fillText(opts.emptyMessage || 'Waiting for active device speeds…', padL, padT + 24);
            return;
        }

        const xs = allPts.map((p) => p.x);
        const ys = allPts.map((p) => p.y);
        let minX = Math.min(...xs);
        let maxX = Math.max(...xs);
        let minY = Math.min(...ys);
        let maxY = Math.max(...ys);
        if (maxX - minX < 1e-6) maxX = minX + 1;
        if (maxY - minY < 1e-6) {
            minY -= 1;
            maxY += 1;
        }
        minY = Math.max(0, minY - (maxY - minY) * 0.08);
        maxY += (maxY - minY) * 0.08;

        const sx = (x) => padL + ((x - minX) / (maxX - minX)) * plotW;
        const sy = (y) => padT + plotH - ((y - minY) / (maxY - minY)) * plotH;

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
        ctx.lineWidth = 1;
        for (const ty of niceTicks(minY, maxY, 4)) {
            const py = sy(ty);
            ctx.beginPath();
            ctx.moveTo(padL, py);
            ctx.lineTo(padL + plotW, py);
            ctx.stroke();
            ctx.fillStyle = '#64748b';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'right';
            const label = opts.yFormat ? opts.yFormat(ty) : ty.toFixed(1);
            ctx.fillText(label, padL - 6, py + 3);
        }
        for (const tx of niceTicks(minX, maxX, 5)) {
            const px = sx(tx);
            ctx.beginPath();
            ctx.moveTo(px, padT);
            ctx.lineTo(px, padT + plotH);
            ctx.stroke();
            ctx.fillStyle = '#64748b';
            ctx.textAlign = 'center';
            ctx.fillText(String(Math.round(tx * 10) / 10), px, h - 10);
        }

        for (const s of series) {
            if (s.points.length < 2) continue;
            ctx.beginPath();
            s.points.forEach((p, i) => {
                const px = sx(p.x);
                const py = sy(p.y);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            });
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 2.25;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();

            ctx.lineTo(sx(s.points[s.points.length - 1].x), padT + plotH);
            ctx.lineTo(sx(s.points[0].x), padT + plotH);
            ctx.closePath();
            ctx.fillStyle = `${s.color}22`;
            ctx.fill();
        }

        let lx = padL;
        const ly = h - 6;
        ctx.font = '11px system-ui';
        ctx.textAlign = 'left';
        for (const s of series) {
            if (!s.points.length) continue;
            ctx.fillStyle = s.color;
            ctx.fillRect(lx, ly - 9, 10, 10);
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(s.label, lx + 14, ly);
            lx += ctx.measureText(s.label).width + 28;
        }

        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'right';
        ctx.fillText(opts.xLabel, w - padR, h - 10);
    }

    /**
     * @param {{ deviceId: string, deviceName?: string, speed?: number, fixTime?: string|number }[]} samples
     */
    function recordSamples(samples) {
        const now = Date.now();
        const seen = new Set();

        for (const sample of samples || []) {
            const deviceId = sample.deviceId != null ? String(sample.deviceId) : '';
            if (!deviceId) continue;
            seen.add(deviceId);
            if (sample.deviceName) deviceLabels.set(deviceId, String(sample.deviceName));

            const speed =
                typeof sample.speed === 'number' && !Number.isNaN(sample.speed) ? sample.speed : null;
            if (speed == null) continue;

            const fixMs = sample.fixTime ? new Date(sample.fixTime).getTime() : NaN;
            const t = Number.isFinite(fixMs) ? fixMs : now;

            let buf = buffers.get(deviceId);
            if (!buf) {
                buf = { points: [] };
                buffers.set(deviceId, buf);
                deviceColor(deviceId);
            }

            const prev = buf.points[buf.points.length - 1];
            if (prev && Math.abs(t - prev.t) < 80) {
                prev.speedMps = speed;
                prune(buf, now);
                continue;
            }

            buf.points.push({ t, speedMps: speed });
            prune(buf, now);
        }

        for (const id of buffers.keys()) {
            if (!seen.has(id)) {
                const buf = buffers.get(id);
                prune(buf, now);
                if (!buf.points.length) buffers.delete(id);
            }
        }
    }

    /** @param {string[]} activeDeviceIds */
    function draw(activeDeviceIds) {
        const canvas = global.document.getElementById('rnzLiveSpeedChart');
        if (!canvas) return;
        const series = liveSpeedVsTimeSeries(activeDeviceIds || []);
        drawMultiSeriesChart(canvas, series, {
            title: 'Speed vs time (last 5 min)',
            xLabel: 'seconds',
            yLabel: 'km/h',
            yFormat: (v) => `${v.toFixed(0)}`,
            emptyMessage: 'No active device speeds yet',
        });
    }

    global.RowsafeLiveSpeedChart = {
        recordSamples,
        draw,
        clear() {
            buffers.clear();
            deviceOrder.clear();
            deviceLabels.clear();
        },
    };
})(typeof window !== 'undefined' ? window : globalThis);
