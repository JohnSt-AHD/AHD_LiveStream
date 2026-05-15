/**
 * Beach sprints head-to-head race analysis (live trail or loaded history).
 * Expects globals from beachsprints-map.js.
 */
const RACE_MOVE_THRESHOLD_MS = 2;

const RACE_PHASES = [
    { id: 'launch', label: 'Launch', hint: 'Start → L1–R1', from: 'start', to: 'line1' },
    { id: 'slalom1', label: 'Slalom 1', hint: 'L1–R1 → L2–R2', from: 'line1', to: 'line2' },
    { id: 'toTop', label: 'To top buoy', hint: 'L2–R2 → R3–L3', from: 'line2', to: 'line3First' },
    { id: 'turn', label: 'Turn at top', hint: 'Around L3', from: 'line3First', to: 'line3Second', needsTurn: true },
    { id: 'return', label: 'Return to beach', hint: 'Top → stop', from: 'line3Second', to: 'end' },
];

function pointSpeedMps(p) {
    const s = typeof p.speed === 'number' && !Number.isNaN(p.speed) ? p.speed : 0;
    return Math.max(0, s);
}

function checkpointTimeMs(timing, key, raceWindow) {
    if (key === 'start') return raceWindow.startMs;
    if (key === 'end') return raceWindow.endMs;
    if (key === 'line1') return timing.line1?.timeMs ?? null;
    if (key === 'line2') return timing.line2?.timeMs ?? null;
    if (key === 'line3First') return timing.line3First?.timeMs ?? null;
    if (key === 'line3Second') return timing.line3Second?.timeMs ?? null;
    return null;
}

function findRaceWindow(sorted) {
    if (!sorted || sorted.length < 2) return null;

    let startMs = null;
    let startIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
        if (pointSpeedMps(sorted[i]) >= RACE_MOVE_THRESHOLD_MS) {
            startMs = positionTimeMs(sorted[i]);
            startIdx = i;
            break;
        }
    }
    if (!Number.isFinite(startMs)) return null;

    const timing = analyzeDeviceTiming(sorted);
    const afterTopMs =
        timing.line3Second?.timeMs ?? timing.line3First?.timeMs ?? timing.line2?.timeMs ?? startMs;

    let endMs = null;
    for (let i = 0; i < sorted.length; i++) {
        const t = positionTimeMs(sorted[i]);
        if (t < afterTopMs) continue;
        if (pointSpeedMps(sorted[i]) < RACE_MOVE_THRESHOLD_MS) {
            endMs = t;
            break;
        }
    }
    if (!Number.isFinite(endMs)) {
        for (let i = sorted.length - 1; i >= startIdx; i--) {
            if (pointSpeedMps(sorted[i]) < RACE_MOVE_THRESHOLD_MS) {
                endMs = positionTimeMs(sorted[i]);
                break;
            }
        }
    }
    if (!Number.isFinite(endMs)) {
        endMs = positionTimeMs(sorted[sorted.length - 1]);
    }

    return { startMs, endMs, timing };
}

function speedStatsBetween(sorted, t0, t1) {
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) {
        return { avgMps: null, maxMps: null, avgKmh: null, maxKmh: null };
    }
    const speeds = [];
    for (const p of sorted) {
        const t = positionTimeMs(p);
        if (t < t0 || t > t1) continue;
        speeds.push(pointSpeedMps(p));
    }
    if (!speeds.length) {
        return { avgMps: null, maxMps: null, avgKmh: null, maxKmh: null };
    }
    const avgMps = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const maxMps = Math.max(...speeds);
    return { avgMps, maxMps, avgKmh: avgMps * 3.6, maxKmh: maxMps * 3.6 };
}

function buildRacePhases(sorted, raceWindow) {
    const { startMs, endMs, timing } = raceWindow;
    return RACE_PHASES.map((phase) => {
        if (phase.needsTurn && !timing.line3Second) {
            return { ...phase, durationMs: null, speed: null, skipped: true };
        }
        let t0 = checkpointTimeMs(timing, phase.from, raceWindow);
        let t1 = checkpointTimeMs(timing, phase.to, raceWindow);
        if (phase.id === 'return' && !Number.isFinite(t0) && timing.line3First) {
            t0 = timing.line3First.timeMs;
        }
        if (phase.from === 'line3Second' && !timing.line3Second && phase.id !== 'return') {
            return { ...phase, durationMs: null, speed: null, skipped: true };
        }
        if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
            return { ...phase, durationMs: null, speed: null, skipped: false };
        }
        return {
            ...phase,
            durationMs: t1 - t0,
            speed: speedStatsBetween(sorted, t0, t1),
            skipped: false,
        };
    });
}

function analyzeCoastalRace(points, deviceName) {
    const sorted = sortRoutePoints(points);
    const raceWindow = findRaceWindow(sorted);
    if (!raceWindow) {
        return { valid: false, name: deviceName, reason: 'No race detected (never exceeded 2 m/s).' };
    }

    const { startMs, endMs, timing } = raceWindow;
    const totalMs = endMs - startMs;
    if (!Number.isFinite(totalMs) || totalMs <= 0) {
        return { valid: false, name: deviceName, reason: 'Race window too short to analyse.' };
    }

    const raceSpeed = speedStatsBetween(sorted, startMs, endMs);
    const phases = buildRacePhases(sorted, raceWindow);

    const checkpoints = [
        { key: 'start', label: 'Start (>2 m/s)', timeMs: startMs },
        { key: 'line1', label: 'L1 – R1', timeMs: timing.line1?.timeMs },
        { key: 'line2', label: 'L2 – R2', timeMs: timing.line2?.timeMs },
        { key: 'line3First', label: 'R3 – L3 (out)', timeMs: timing.line3First?.timeMs },
        { key: 'line3Second', label: 'R3 – L3 (return)', timeMs: timing.line3Second?.timeMs },
        { key: 'end', label: 'Beach (<2 m/s)', timeMs: endMs },
    ].filter((c) => Number.isFinite(c.timeMs));

    return {
        valid: true,
        name: deviceName,
        startMs,
        endMs,
        totalMs,
        timing,
        checkpoints,
        phases,
        raceSpeed,
        turnTimeMs: timing.turnTimeMs,
    };
}

function getRaceAnalysisForDevice(deviceId) {
    const { sources } = getTimingDataSources();
    const source = sources.find((s) => String(s.deviceId) === String(deviceId));
    if (!source) return null;
    const name = source.name || `Device ${deviceId}`;
    return analyzeCoastalRace(source.points, name);
}

function formatGapMs(gapMs) {
    if (!Number.isFinite(gapMs)) return '—';
    const abs = Math.abs(gapMs);
    const sign = gapMs > 0 ? '+' : gapMs < 0 ? '−' : '';
    if (abs < 60000) return `${sign}${(abs / 1000).toFixed(2)}s`;
    const m = Math.floor(abs / 60000);
    const s = (abs % 60000) / 1000;
    return `${sign}${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function compareRaceAnalyses(a, b) {
    if (!a?.valid || !b?.valid) {
        const parts = [];
        if (!a?.valid) parts.push(`${a?.name || 'Boat A'}: ${a?.reason || 'invalid'}`);
        if (!b?.valid) parts.push(`${b?.name || 'Boat B'}: ${b?.reason || 'invalid'}`);
        return { valid: false, reason: parts.join(' · ') };
    }

    const phaseCompare = RACE_PHASES.map((def) => {
        const pa = a.phases.find((p) => p.id === def.id);
        const pb = b.phases.find((p) => p.id === def.id);
        const durA = pa?.durationMs;
        const durB = pb?.durationMs;
        let leader = null;
        let gap = null;
        if (Number.isFinite(durA) && Number.isFinite(durB)) {
            gap = durB - durA;
            if (Math.abs(gap) < 30) leader = 'tie';
            else leader = gap > 0 ? 'a' : 'b';
        }
        return { def, pa, pb, gap, leader };
    });

    const checkpointCompare = [
        { key: 'line1', label: 'L1 – R1' },
        { key: 'line2', label: 'L2 – R2' },
        { key: 'line3First', label: 'R3 – L3 (out)' },
        { key: 'line3Second', label: 'R3 – L3 (return)' },
        { key: 'end', label: 'Finish' },
    ].map((cp) => {
        const ca = a.checkpoints.find((c) => c.key === cp.key);
        const cb = b.checkpoints.find((c) => c.key === cp.key);
        const elapsedA = ca ? ca.timeMs - a.startMs : null;
        const elapsedB = cb ? cb.timeMs - b.startMs : null;
        let leader = null;
        let gap = null;
        if (Number.isFinite(elapsedA) && Number.isFinite(elapsedB)) {
            gap = elapsedB - elapsedA;
            leader = Math.abs(gap) < 30 ? 'tie' : gap > 0 ? 'a' : 'b';
        }
        return { ...cp, elapsedA, elapsedB, gap, leader };
    });

    const totalGap = b.totalMs - a.totalMs;
    const totalLeader = Math.abs(totalGap) < 50 ? 'tie' : totalGap > 0 ? 'a' : 'b';

    let sectionsWonA = 0;
    let sectionsWonB = 0;
    phaseCompare.forEach((p) => {
        if (p.leader === 'a') sectionsWonA++;
        else if (p.leader === 'b') sectionsWonB++;
    });

    return {
        valid: true,
        a,
        b,
        phaseCompare,
        checkpointCompare,
        totalGap,
        totalLeader,
        sectionsWonA,
        sectionsWonB,
    };
}

function populateCompareDeviceSelects() {
    const selA = document.getElementById('bspCompareA');
    const selB = document.getElementById('bspCompareB');
    if (!selA || !selB) return;

    const { sources } = getTimingDataSources();
    const prevA = selA.value;
    const prevB = selB.value;
    const opts =
        '<option value="">— Select boat —</option>' +
        sources
            .map(
                (s) =>
                    `<option value="${escapeHtml(String(s.deviceId))}">${escapeHtml(s.name)}</option>`
            )
            .join('');
    selA.innerHTML = opts;
    selB.innerHTML = opts;
    if (prevA && sources.some((s) => String(s.deviceId) === prevA)) selA.value = prevA;
    if (prevB && sources.some((s) => String(s.deviceId) === prevB)) selB.value = prevB;
}

function renderTimelineBar(compare, cp) {
    const maxT = Math.max(compare.a.totalMs, compare.b.totalMs, 1);
    const wA = cp.elapsedA != null ? (cp.elapsedA / maxT) * 100 : 0;
    const wB = cp.elapsedB != null ? (cp.elapsedB / maxT) * 100 : 0;
    const leaderClass =
        cp.leader === 'a' ? ' bsp-race-tl-bar--leading' : cp.leader === 'b' ? '' : '';
    const leaderClassB =
        cp.leader === 'b' ? ' bsp-race-tl-bar--leading' : cp.leader === 'a' ? '' : '';

    return (
        `<div class="bsp-race-timeline-row">` +
        `<span class="bsp-race-tl-label">${escapeHtml(cp.label)}</span>` +
        `<div class="bsp-race-tl-boat">` +
        `<span class="bsp-race-tl-name bsp-race-tl-name--a">${escapeHtml(compare.a.name)}</span>` +
        `<div class="bsp-race-tl-track"><div class="bsp-race-tl-bar bsp-race-tl-bar--a${leaderClass}" style="width:${wA.toFixed(1)}%"></div></div>` +
        `<span class="bsp-race-tl-time">${cp.elapsedA != null ? formatDurationMs(cp.elapsedA) : '—'}</span>` +
        `</div>` +
        `<div class="bsp-race-tl-boat">` +
        `<span class="bsp-race-tl-name bsp-race-tl-name--b">${escapeHtml(compare.b.name)}</span>` +
        `<div class="bsp-race-tl-track"><div class="bsp-race-tl-bar bsp-race-tl-bar--b${leaderClassB}" style="width:${wB.toFixed(1)}%"></div></div>` +
        `<span class="bsp-race-tl-time">${cp.elapsedB != null ? formatDurationMs(cp.elapsedB) : '—'}</span>` +
        `</div>` +
        (cp.gap != null
            ? `<span class="bsp-race-tl-gap${cp.leader === 'a' ? ' bsp-race-tl-gap--a' : cp.leader === 'b' ? ' bsp-race-tl-gap--b' : ''}">${formatGapMs(cp.gap)}</span>`
            : '') +
        `</div>`
    );
}

function renderRaceCompareDashboard() {
    const el = document.getElementById('bspCompareDashboard');
    const sourceEl = document.getElementById('bspCompareSource');
    if (!el) return;

    populateCompareDeviceSelects();

    const idA = document.getElementById('bspCompareA')?.value;
    const idB = document.getElementById('bspCompareB')?.value;
    const { mode } = getTimingDataSources();

    if (sourceEl) {
        sourceEl.textContent =
            mode === 'history'
                ? 'Using loaded route history'
                : 'Using live GPS trail (updates every 10s)';
    }

    if (!idA || !idB) {
        el.innerHTML =
            '<p class="bsp-compare-empty">Select two boats to compare a coastal sprint race.</p>';
        return;
    }
    if (idA === idB) {
        el.innerHTML = '<p class="bsp-compare-empty">Choose two different boats.</p>';
        return;
    }

    const a = getRaceAnalysisForDevice(idA);
    const b = getRaceAnalysisForDevice(idB);
    const compare = compareRaceAnalyses(a, b);

    if (!compare.valid) {
        el.innerHTML = `<p class="bsp-compare-empty">${escapeHtml(compare.reason || 'Could not analyse one or both races.')}</p>`;
        return;
    }

    const winner =
        compare.totalLeader === 'a'
            ? compare.a.name
            : compare.totalLeader === 'b'
              ? compare.b.name
              : 'Dead heat';
    const verdictDetail =
        compare.totalLeader === 'tie'
            ? `Both crossed the beach timing in ${formatDurationMs(compare.a.totalMs)}.`
            : `${winner} is ${formatGapMs(Math.abs(compare.totalGap))} faster overall (${formatDurationMs(compare.a.totalMs)} vs ${formatDurationMs(compare.b.totalMs)}).`;

    const phaseRows = compare.phaseCompare
        .map((p) => {
            if (p.pa?.skipped && p.pb?.skipped) return '';
            const durA = p.pa?.durationMs != null ? formatDurationMs(p.pa.durationMs) : '—';
            const durB = p.pb?.durationMs != null ? formatDurationMs(p.pb.durationMs) : '—';
            const spdA = p.pa?.speed?.avgKmh != null ? `${p.pa.speed.avgKmh.toFixed(1)} km/h` : '—';
            const spdB = p.pb?.speed?.avgKmh != null ? `${p.pb.speed.avgKmh.toFixed(1)} km/h` : '—';
            const gapCell =
                p.gap != null
                    ? `<span class="bsp-phase-gap bsp-phase-gap--${p.leader || 'tie'}">${formatGapMs(p.gap)}</span>`
                    : '—';
            return (
                `<tr>` +
                `<td><strong>${escapeHtml(p.def.label)}</strong><br><span class="bsp-phase-hint">${escapeHtml(p.def.hint)}</span></td>` +
                `<td>${durA}<br><span class="bsp-phase-spd">${spdA}</span></td>` +
                `<td>${durB}<br><span class="bsp-phase-spd">${spdB}</span></td>` +
                `<td>${gapCell}</td>` +
                `</tr>`
            );
        })
        .join('');

    const timeline = compare.checkpointCompare.map((cp) => renderTimelineBar(compare, cp)).join('');

    const turnRow =
        compare.a.turnTimeMs != null || compare.b.turnTimeMs != null
            ? `<div class="bsp-compare-stat-card">` +
              `<span class="bsp-compare-stat-label">Turn at top (R3–L3)</span>` +
              `<span class="bsp-compare-stat-val">${formatDurationMs(compare.a.turnTimeMs)} vs ${formatDurationMs(compare.b.turnTimeMs)}</span>` +
              `</div>`
            : '';

    el.innerHTML =
        `<div class="bsp-compare-verdict">` +
        `<div class="bsp-compare-verdict-title">${escapeHtml(winner)}</div>` +
        `<p class="bsp-compare-verdict-detail">${escapeHtml(verdictDetail)}</p>` +
        `<p class="bsp-compare-verdict-sections">${escapeHtml(compare.a.name)} won ${compare.sectionsWonA} leg(s) · ${escapeHtml(compare.b.name)} won ${compare.sectionsWonB} leg(s)</p>` +
        `</div>` +
        `<div class="bsp-compare-stats">` +
        `<div class="bsp-compare-stat-card">` +
        `<span class="bsp-compare-stat-label">Race time</span>` +
        `<span class="bsp-compare-stat-val">${formatDurationMs(compare.a.totalMs)} vs ${formatDurationMs(compare.b.totalMs)}</span>` +
        `</div>` +
        `<div class="bsp-compare-stat-card">` +
        `<span class="bsp-compare-stat-label">Avg speed (race)</span>` +
        `<span class="bsp-compare-stat-val">${compare.a.raceSpeed.avgKmh?.toFixed(1) ?? '—'} vs ${compare.b.raceSpeed.avgKmh?.toFixed(1) ?? '—'} km/h</span>` +
        `</div>` +
        `<div class="bsp-compare-stat-card">` +
        `<span class="bsp-compare-stat-label">Peak speed</span>` +
        `<span class="bsp-compare-stat-val">${compare.a.raceSpeed.maxKmh?.toFixed(1) ?? '—'} vs ${compare.b.raceSpeed.maxKmh?.toFixed(1) ?? '—'} km/h</span>` +
        `</div>` +
        turnRow +
        `</div>` +
        `<h3 class="bsp-compare-subtitle">Checkpoint timeline</h3>` +
        `<p class="bsp-compare-hint">Bar length = elapsed from race start (2 m/s). Gap shows how far B is behind A.</p>` +
        `<div class="bsp-race-timeline">${timeline}</div>` +
        `<h3 class="bsp-compare-subtitle">Leg-by-leg breakdown</h3>` +
        `<table class="bsp-compare-phase-table">` +
        `<thead><tr><th>Leg</th><th>${escapeHtml(compare.a.name)}</th><th>${escapeHtml(compare.b.name)}</th><th>Gap (B−A)</th></tr></thead>` +
        `<tbody>${phaseRows}</tbody>` +
        `</table>`;
}

function wireRaceComparePanel() {
    const selA = document.getElementById('bspCompareA');
    const selB = document.getElementById('bspCompareB');
    const onChange = () => renderRaceCompareDashboard();
    if (selA && selA.dataset.bound !== '1') {
        selA.dataset.bound = '1';
        selA.addEventListener('change', onChange);
    }
    if (selB && selB.dataset.bound !== '1') {
        selB.dataset.bound = '1';
        selB.addEventListener('change', onChange);
    }
    const details = document.getElementById('bspCompareDetails');
    if (details && details.dataset.resizeBound !== '1') {
        details.dataset.resizeBound = '1';
        details.addEventListener('toggle', () => scheduleMapResize());
    }
}

function initRaceCompare() {
    wireRaceComparePanel();
    renderRaceCompareDashboard();
}
