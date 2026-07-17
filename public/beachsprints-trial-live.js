/**
 * U19 coastal selection trial — event-wide athletes, manual split timers, GPS map overlay.
 * Active when regatta code is u19_ct_26.
 */
(function (global) {
    const TRIAL_CODE = 'u19_ct_26';
    const LS_TRIAL = 'bsrTrialLive_v3';
    const GPS_LABELS = ['C1X_A', 'C1X_B'];
    const GPS_TO_ALIAS = { C1X_A: 'boat_1', C1X_B: 'boat_2' };

    const MANUAL_SPLITS = [
        { id: 'boatEntry', label: 'Boat entry', short: 'Entry' },
        { id: 'b1', label: 'Buoy 1', short: 'B1' },
        { id: 'b2', label: 'Buoy 2', short: 'B2' },
        { id: 'b3', label: 'Buoy 3', short: 'B3' },
        { id: 'turn', label: 'Turn', short: 'Turn' },
        { id: 'b2r', label: 'Buoy 2', short: 'B2↓' },
        { id: 'b1r', label: 'Buoy 1', short: 'B1↓' },
        { id: 'boatExit', label: 'Boat exit', short: 'Exit' },
        { id: 'finish', label: 'Finish', short: 'Fin' },
    ];

    /** @type {object|null} */
    let meta = null;
    /** @type {Map<string, {name:string, club:string}>} */
    let codeLookup = new Map();
    let store = {
        races: {},
        rankings: { women: [], men: [] },
        selectedKey: '',
        publishedEvents: {},
    };
    let activeEventKey = '';
    let activeRaceNum = null;
    const tickers = new Map();
    const trialMapHolder = { map: null, layers: [] };
    let panelBound = false;
    let statusFlash = '';

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function isTrialRegatta(code) {
        return String(code || '').toLowerCase() === TRIAL_CODE;
    }

    function loadStore() {
        try {
            const raw = localStorage.getItem(LS_TRIAL);
            if (raw) {
                const parsed = JSON.parse(raw);
                store = {
                    races: parsed.races || {},
                    rankings: parsed.rankings || { women: [], men: [] },
                    selectedKey: parsed.selectedKey || '',
                    publishedEvents: parsed.publishedEvents || {},
                };
            }
        } catch {
            /* ignore */
        }
    }

    function saveStore() {
        try {
            localStorage.setItem(LS_TRIAL, JSON.stringify(store));
        } catch {
            /* ignore */
        }
    }

    function slotKey(raceNum, lane) {
        return `${raceNum}:${lane}`;
    }

    function emptySlot() {
        return {
            crew: '',
            gps: '',
            runningAt: null,
            startAt: null,
            splits: {},
            gpsPoints: [],
            gpsMs: null,
            saved: false,
            savedAt: null,
            notes: '',
        };
    }

    function getSlot(raceNum, lane) {
        const k = slotKey(raceNum, lane);
        if (!store.races[k]) store.races[k] = emptySlot();
        if (!store.races[k].splits) store.races[k].splits = {};
        return store.races[k];
    }

    function formatMs(ms) {
        if (ms == null || !Number.isFinite(ms)) return '—';
        const sec = ms / 1000;
        const m = Math.floor(sec / 60);
        const s = sec - m * 60;
        return `${m}:${s.toFixed(2).padStart(5, '0')}`;
    }

    function formatTimeCsv(ms) {
        if (ms == null || !Number.isFinite(ms)) return '';
        const sec = ms / 1000;
        const m = Math.floor(sec / 60);
        const s = sec - m * 60;
        return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
    }

    function splitLegMs(splits, idx) {
        const id = MANUAL_SPLITS[idx]?.id;
        if (!id || splits[id] == null) return null;
        const prevId = idx > 0 ? MANUAL_SPLITS[idx - 1].id : null;
        const prev = prevId && splits[prevId] != null ? splits[prevId] : 0;
        return splits[id] - prev;
    }

    function finishMs(slot) {
        return slot.splits?.finish ?? null;
    }

    function athleteName(code) {
        const hit = codeLookup.get(String(code || '').toUpperCase());
        return hit?.name || code || '—';
    }

    function athleteMeta(code) {
        return codeLookup.get(String(code || '').toUpperCase()) || null;
    }

    function resolvedCrewForRow(row) {
        const prog = global.BsrTrialProgression;
        if (prog?.resolveLane && row.race) {
            const hit = prog.resolveLane(row.race, row.crewDefault);
            if (hit?.code && prog.isAthleteCode?.(hit.code)) return hit.code;
        }
        const raw = String(row.crewDefault || '').trim();
        if (prog?.isAthleteCode?.(raw)) return raw.toUpperCase();
        return '';
    }

    function displayNameForRow(row, slot) {
        const prog = global.BsrTrialProgression;
        const hit = prog?.resolveLane?.(row.race, row.crewDefault);
        const bracket = prog?.isBracketLabel?.(row.crewDefault);
        if (bracket && hit?.display) return hit.display;
        const code =
            slot.crew && prog?.isAthleteCode?.(slot.crew) ? slot.crew
            : hit?.code && prog?.isAthleteCode?.(hit.code) ? hit.code
            :   '';
        if (code && prog?.formatAthleteDisplay) {
            const labelled = prog.formatAthleteDisplay(code);
            if (labelled) return labelled;
        }
        return hit?.display || athleteName(code || row.crewDefault);
    }

    function syncProgressionCrew(row, slot) {
        if (slot.runningAt || slot.saved) return;
        const prog = global.BsrTrialProgression;
        const hit = prog?.resolveLane?.(row.race, row.crewDefault);
        const resolved = hit?.code && prog?.isAthleteCode?.(hit.code) ? hit.code : '';
        const bracket = prog?.isBracketLabel?.(row.crewDefault);
        if (bracket) {
            if (resolved && slot.crew !== resolved) {
                slot.crew = resolved;
                saveStore();
            } else if (!resolved && slot.crew && !prog?.isAthleteCode?.(slot.crew)) {
                slot.crew = '';
                saveStore();
            }
        } else if (resolved && !slot.crew) {
            slot.crew = resolved;
            saveStore();
        }
    }

    function refreshBracketCrews() {
        for (const row of buildEventRows()) {
            syncProgressionCrew(row, getSlot(row.raceNum, row.lane));
        }
    }

    function buildCodeLookup() {
        codeLookup = new Map();
        if (!meta?.athletes) return;
        for (const a of [...(meta.athletes.women || []), ...(meta.athletes.men || [])]) {
            codeLookup.set(a.code, a);
        }
    }

    async function loadMeta() {
        try {
            const res = await fetch('data/archives/u19_ct_26/latest/trial-meta.json');
            if (res.ok) meta = await res.json();
        } catch {
            meta = null;
        }
        buildCodeLookup();
    }

    function resolveDeviceId(gpsLabel) {
        const api = global.BsrRegatta;
        if (!api || !gpsLabel) return '';
        const alias = GPS_TO_ALIAS[gpsLabel];
        const aliases = api.getDeviceAliases?.() || {};
        if (alias && aliases[alias]) return aliases[alias];
        const devices = api.getDevices?.() || [];
        const found = devices.find((d) => {
            const n = String(d.name || d.uniqueId || '').toUpperCase();
            return n.includes(gpsLabel.replace('_', '')) || n === gpsLabel.toUpperCase();
        });
        return found ? String(found.id) : '';
    }

    function clipPoints(points, startMs, endMs) {
        if (!points?.length) return [];
        return points.filter((p) => {
            const t = new Date(p.fixTime || p.deviceTime).getTime();
            return Number.isFinite(t) && t >= startMs && t <= endMs;
        });
    }

    async function fetchGpsForSlot(raceNum, lane, slot) {
        const api = global.BsrRegatta;
        if (!api?.fetchRoute || !slot.gps) return;
        const race = api.getRace?.(raceNum);
        if (!race) return;
        const deviceId = resolveDeviceId(slot.gps);
        if (!deviceId) {
            slot.notes = 'GPS device not found — map C1X_A / C1X_B in settings';
            saveStore();
            renderPanel();
            return;
        }
        const startMs =
            slot.startAt ||
            slot.runningAt ||
            (race.startAt ? race.startAt.getTime() : Date.now());
        const endMs = finishMs(slot) != null ? startMs + finishMs(slot) : startMs + 240000;
        const from = new Date(startMs - 45 * 1000);
        const to = new Date(endMs + 45 * 1000);
        try {
            const raw = await api.fetchRoute(deviceId, from, to);
            slot.gpsPoints = clipPoints(raw, startMs - 5000, endMs + 5000);
            const coastal = global.BeachSprintsCoastal;
            if (coastal?.analyzeCoastalRace && slot.gpsPoints.length > 5) {
                const analysis = coastal.analyzeCoastalRace(slot.gpsPoints, slot.gps, {
                    officialTimeMs: finishMs(slot),
                    manualTrim: { startMs, endMs },
                });
                if (analysis?.valid) {
                    slot.gpsMs = analysis.totalMs ?? analysis.boatWaterMs ?? finishMs(slot);
                    slot.notes = '';
                } else {
                    slot.gpsMs = finishMs(slot);
                    slot.notes = analysis?.reason || 'GPS clipped; course analysis partial';
                }
            } else if (slot.gpsPoints.length) {
                slot.gpsMs = finishMs(slot);
                slot.notes = slot.gpsPoints.length < 6 ? 'Few GPS points' : 'GPS clipped to race window';
            } else {
                slot.notes = 'No GPS points in window';
                slot.gpsPoints = [];
            }
        } catch (err) {
            slot.notes = `GPS fetch failed: ${err.message || err}`;
        }
        saveStore();
        renderPanel();
    }

    function pushResultToDashboard(raceNum, lane, slot, rank) {
        const api = global.BsrRegatta;
        const total = finishMs(slot);
        if (!api?.applyTrialResult || total == null) return;
        api.applyTrialResult(raceNum, {
            lane,
            crew: slot.crew,
            time: formatTimeCsv(total),
            manualMs: total,
            gpsMs: slot.gpsMs,
            rank,
        });
    }

    function savedEventEntries() {
        return buildEventRows()
            .map((row) => {
                const slot = getSlot(row.raceNum, row.lane);
                const ms = finishMs(slot);
                if (!slot.saved || ms == null) return null;
                return { ...row, slot, ms };
            })
            .filter(Boolean)
            .sort((a, b) => a.ms - b.ms);
    }

    function finishedUnsavedEntries() {
        return buildEventRows()
            .map((row) => {
                const slot = getSlot(row.raceNum, row.lane);
                const ms = finishMs(slot);
                if (ms == null || slot.saved) return null;
                return { ...row, slot, ms };
            })
            .filter(Boolean);
    }

    function saveRow(raceNum, lane) {
        const slot = getSlot(raceNum, lane);
        const row = buildEventRows().find((r) => r.raceNum === raceNum && r.lane === lane);
        if (row) {
            syncProgressionCrew(row, slot);
            const hit = global.BsrTrialProgression?.resolveLane?.(row.race, row.crewDefault);
            if (hit?.code && global.BsrTrialProgression?.isAthleteCode?.(hit.code)) {
                slot.crew = hit.code;
            }
        }
        const total = finishMs(slot);
        if (total == null) {
            slot.notes = 'Mark finish (Fin split or Stop) before Save';
            saveStore();
            renderPanel();
            return;
        }
        slot.saved = true;
        slot.savedAt = Date.now();
        saveStore();
        publishEventLeaderboard(false);
        refreshBracketCrews();
        statusFlash = `Saved ${athleteName(slot.crew)} — ${formatMs(total)}`;
        global.BsrTrialProgression?.refreshViews?.();
        renderPanel();
    }

    function resetRow(raceNum, lane) {
        const k = slotKey(raceNum, lane);
        const slot = getSlot(raceNum, lane);
        const crew = slot.crew;
        if (tickers.has(k)) {
            clearInterval(tickers.get(k));
            tickers.delete(k);
        }
        const row = buildEventRows().find((r) => r.raceNum === raceNum && r.lane === lane);
        store.races[k] = emptySlot();
        const def = row ? resolvedCrewForRow(row) || row.crewDefault : '';
        if (def) getSlot(raceNum, lane).crew = def;
        saveStore();
        const api = global.BsrRegatta;
        if (api?.removeTrialResult && crew) {
            api.removeTrialResult(raceNum, crew);
        }
        publishEventLeaderboard(false);
        global.BsrTrialProgression?.refreshViews?.();
        statusFlash = `Reset ${athleteName(crew || def)} — ready to re-run`;
        renderPanel();
    }

    function rankForPublishedEntry(entry, entries) {
        const ttEvents = new Set(['1', '2', '6']);
        if (ttEvents.has(String(activeEventKey))) {
            return entries.findIndex((e) => e.raceNum === entry.raceNum && e.lane === entry.lane) + 1;
        }
        const sameRace = entries
            .filter((e) => e.raceNum === entry.raceNum)
            .sort((a, b) => a.ms - b.ms);
        const idx = sameRace.findIndex((e) => e.raceNum === entry.raceNum && e.lane === entry.lane);
        return idx >= 0 ? idx + 1 : 1;
    }

    function publishEventLeaderboard(showMessage = true) {
        const entries = savedEventEntries();
        if (!entries.length) {
            if (showMessage) statusFlash = 'No saved results yet — tap Save on each finished row';
            renderPanel();
            return;
        }
        entries.forEach((entry) => {
            pushResultToDashboard(entry.raceNum, entry.lane, entry.slot, rankForPublishedEntry(entry, entries));
        });
        const api = global.BsrRegatta;
        if (api?.refreshTrialLeaderboard) {
            api.refreshTrialLeaderboard(activeEventKey);
        }
        if (activeEventKey === '1' || activeEventKey === '2') {
            updateRankingsFromTt(activeEventKey);
        }
        global.BsrTrialProgression?.refreshViews?.();
        store.publishedEvents[activeEventKey] = Date.now();
        if (String(activeEventKey) === '5') {
            const best = computeMixRecommendation();
            if (best) {
                store.mixRecommendation = {
                    label: best.label,
                    ms: best.ms,
                    run: best.run,
                    raceNum: best.raceNum,
                    at: Date.now(),
                };
            }
        }
        saveStore();
        if (showMessage) {
            let msg = `Leaderboard published — ${entries.length} result${entries.length === 1 ? '' : 's'} ranked by total time`;
            if (String(activeEventKey) === '5' && store.mixRecommendation) {
                msg += `. Recommended mix pair: ${store.mixRecommendation.label} (${formatMs(store.mixRecommendation.ms)})`;
            }
            statusFlash = msg;
        }
        renderPanel();
    }

    function updateRankingsFromTt(eventNum) {
        if (String(eventNum) !== String(activeEventKey)) return;
        const codes = savedEventEntries().map((e) => e.slot.crew || e.crewDefault);
        if (eventNum === 1 || eventNum === '1') store.rankings.women = codes;
        if (eventNum === 2 || eventNum === '2') store.rankings.men = codes;
        saveStore();
    }

    function startRow(raceNum, lane) {
        const slot = getSlot(raceNum, lane);
        slot.runningAt = Date.now();
        slot.startAt = null;
        slot.splits = {};
        slot.gpsPoints = [];
        slot.gpsMs = null;
        slot.saved = false;
        slot.savedAt = null;
        slot.notes = '';
        saveStore();
        const k = slotKey(raceNum, lane);
        if (tickers.has(k)) clearInterval(tickers.get(k));
        tickers.set(k, setInterval(() => updateLiveTimes(), 100));
        store.selectedKey = k;
        saveStore();
        renderPanel();
    }

    function markSplit(raceNum, lane, splitId) {
        const slot = getSlot(raceNum, lane);
        if (!slot.runningAt) return;
        if (slot.splits[splitId] != null) return;
        const elapsed = Date.now() - slot.runningAt;
        slot.splits[splitId] = elapsed;
        slot.saved = false;
        if (splitId === 'finish') {
            stopRow(raceNum, lane, { skipFinishMark: true });
            return;
        }
        saveStore();
        updateLiveTimes();
    }

    async function stopRow(raceNum, lane, opts = {}) {
        const slot = getSlot(raceNum, lane);
        const k = slotKey(raceNum, lane);
        if (tickers.has(k)) {
            clearInterval(tickers.get(k));
            tickers.delete(k);
        }
        if (slot.runningAt) {
            slot.startAt = slot.runningAt;
            if (!opts.skipFinishMark && slot.splits.finish == null) {
                slot.splits.finish = Date.now() - slot.runningAt;
            }
            slot.runningAt = null;
        }
        slot.saved = false;
        saveStore();
        renderPanel();
        if (slot.gps) {
            void fetchGpsForSlot(raceNum, lane, slot);
        }
    }

    function buildEventRows() {
        const api = global.BsrRegatta;
        if (!api || !activeEventKey) return [];
        const races = api.getEventRaces?.(activeEventKey) || api.getRacesForEvent?.(activeEventKey) || [];
        const rows = [];
        for (const race of races) {
            const lanes = race.lanes?.length ? race.lanes : [{ lane: 1, crew: '' }];
            for (const l of lanes) {
                rows.push({
                    raceNum: race.raceNum,
                    lane: l.lane,
                    crewDefault: l.crew,
                    race,
                    sched: race.startAt ?
                        race.startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    :   '',
                });
            }
        }
        return rows;
    }

    function traceForSlot(row, slot, traceIdx) {
        return {
            lane: row.lane,
            label: `${global.BsrTrialProgression?.formatAthleteDisplay?.(slot.crew || row.crewDefault) || athleteName(slot.crew || row.crewDefault)} (${slot.crew || row.crewDefault})`,
            points: slot.gpsPoints?.length ? slot.gpsPoints : [],
            colorIdx: traceIdx,
        };
    }

    function tracesForKeys(keys) {
        const rows = buildEventRows();
        const traces = [];
        let i = 0;
        for (const row of rows) {
            const k = slotKey(row.raceNum, row.lane);
            if (keys && !keys.includes(k)) continue;
            const slot = getSlot(row.raceNum, row.lane);
            if (!slot.gpsPoints?.length) continue;
            traces.push(traceForSlot(row, slot, i++));
        }
        return traces;
    }

    function showMapTraces(keys) {
        const api = global.BsrRegatta;
        const el = document.getElementById('bsrTrialMap');
        if (!api?.renderTraceMap || !el) return;
        const traces = tracesForKeys(keys);
        if (!traces.length) {
            el.innerHTML =
                '<p class="bsr-note">No GPS traces loaded — assign GPS, finish a run, and tap Fetch GPS.</p>';
            return;
        }
        el.innerHTML = '';
        api.renderTraceMap(el, traces, trialMapHolder);
        requestAnimationFrame(() => trialMapHolder.map?.invalidateSize());
    }

    function nextOpenSplitIndex(slot) {
        if (!slot.runningAt) return -1;
        for (let i = 0; i < MANUAL_SPLITS.length; i++) {
            if (slot.splits[MANUAL_SPLITS[i].id] == null) return i;
        }
        return -1;
    }

    function renderSplitCells(slot, rowKey) {
        const running = slot.runningAt != null;
        const nextIdx = nextOpenSplitIndex(slot);
        return MANUAL_SPLITS.map((sp, idx) => {
            const cum = slot.splits[sp.id];
            const leg = cum != null ? splitLegMs(slot.splits, idx) : null;
            const isLive = running && idx === nextIdx;
            const display = cum != null ? formatMs(cum) : isLive ? formatMs(Date.now() - slot.runningAt) : '—';
            const legHtml =
                leg != null && idx > 0 ? `<span class="bsr-trial-leg">+${formatMs(leg)}</span>` : '';
            const btn =
                running && cum == null ?
                    `<button type="button" class="bsr-trial-split-btn" data-action="split" data-split="${esc(sp.id)}" title="Mark ${esc(sp.label)}">${esc(sp.short)}</button>`
                :   '';
            return (
                `<td class="bsr-trial-split-col${isLive ? ' bsr-trial-split-col--live' : ''}" data-split-col="${esc(sp.id)}">` +
                `<div class="bsr-trial-split-time">${display}${legHtml}</div>${btn}</td>`
            );
        }).join('');
    }

    function renderAthleteRow(row, orderIdx) {
        const { raceNum, lane, crewDefault, sched } = row;
        const slot = getSlot(raceNum, lane);
        syncProgressionCrew(row, slot);
        const defaultCrew = resolvedCrewForRow(row) || (global.BsrTrialProgression?.isAthleteCode?.(crewDefault) ? crewDefault : '');
        if (!slot.crew && defaultCrew) slot.crew = defaultCrew;
        const athleteDisplay = displayNameForRow(row, slot);
        const k = slotKey(raceNum, lane);
        const selected = store.selectedKey === k || activeRaceNum === raceNum;
        const running = slot.runningAt != null;
        const total = finishMs(slot);
        const canSave = total != null && !running;
        const gpsOpts = ['', ...GPS_LABELS]
            .map(
                (g) =>
                    `<option value="${esc(g)}"${slot.gps === g ? ' selected' : ''}>${g || '—'}</option>`,
            )
            .join('');
        return (
            `<tr class="bsr-trial-row${selected ? ' bsr-trial-row--selected' : ''}${slot.saved ? ' bsr-trial-row--saved' : ''}" data-key="${esc(k)}" data-race="${raceNum}" data-lane="${lane}">` +
            `<td class="bsr-trial-order">${orderIdx + 1}</td>` +
            `<td class="bsr-trial-sched">${esc(sched)}</td>` +
            `<td><input type="text" class="bsr-trial-crew" value="${esc(slot.crew)}" placeholder="${esc(global.BsrTrialProgression?.isAthleteCode?.(crewDefault) ? crewDefault : '')}"></td>` +
            `<td><span class="bsr-trial-athlete-name">${esc(athleteDisplay)}</span></td>` +
            `<td><select class="bsr-trial-gps">${gpsOpts}</select></td>` +
            renderSplitCells(slot, k) +
            `<td class="bsr-trial-total${running ? ' bsr-trial-time--live' : ''}" data-live-total="1">${total != null ? formatMs(total) : running ? formatMs(Date.now() - slot.runningAt) : '—'}</td>` +
            `<td class="bsr-trial-actions">` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-trial-start" data-action="start"${running ? ' disabled' : ''}>Start</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-trial-stop" data-action="stop"${!running ? ' disabled' : ''}>Stop</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-btn--primary bsr-trial-save" data-action="save"${!canSave ? ' disabled' : ''}>${slot.saved ? 'Saved' : 'Save'}</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-btn--ghost bsr-trial-reset" data-action="reset"${running ? ' disabled' : ''}>Reset</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-btn--ghost bsr-trial-gps-fetch" data-action="gps">GPS</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-btn--ghost bsr-trial-map-one" data-action="map">Map</button>` +
            `</td>` +
            `<td class="bsr-trial-note">${slot.saved ? '<span class="bsr-trial-saved-tag">Saved</span> ' : ''}${esc(slot.notes || '')}${slot.gpsPoints?.length ? ` · ${slot.gpsPoints.length} pts` : ''}</td>` +
            `</tr>`
        );
    }

    function splitLeaders(entries) {
        const leaders = {};
        for (const sp of MANUAL_SPLITS) {
            let bestMs = null;
            const ids = [];
            for (const entry of entries) {
                const cum = entry.slot.splits?.[sp.id];
                if (cum == null) continue;
                if (bestMs == null || cum < bestMs) {
                    bestMs = cum;
                    ids.length = 0;
                    ids.push(entry.slot.crew || entry.crewDefault);
                } else if (cum === bestMs) {
                    ids.push(entry.slot.crew || entry.crewDefault);
                }
            }
            leaders[sp.id] = ids;
        }
        return leaders;
    }

    function normalizeMixLabel(str) {
        return String(str || '')
            .replace(/\s/g, '')
            .toUpperCase();
    }

    function buildMixMatrixResults() {
        const prog = global.BsrTrialPrognostic;
        if (!prog?.MIX_MATRIX) return [];
        const entries = savedEventEntries();
        return prog.MIX_MATRIX.map((def) => {
            const hit =
                entries.find((e) => e.raceNum === def.raceNum && e.lane === def.lane) ||
                entries.find(
                    (e) =>
                        normalizeMixLabel(e.slot.crew || e.crewDefault) === normalizeMixLabel(def.label),
                );
            return { ...def, entry: hit || null, ms: hit?.ms ?? null };
        });
    }

    function computeMixRecommendation() {
        const withTimes = buildMixMatrixResults().filter((r) => r.ms != null);
        if (!withTimes.length) return null;
        return withTimes.reduce((best, row) => (row.ms < best.ms ? row : best));
    }

    function renderMixMatrixLeaderboard() {
        if (String(activeEventKey) !== '5') return '';
        const prog = global.BsrTrialPrognostic;
        if (!prog) return '';
        const results = buildMixMatrixResults();
        if (!results.some((r) => r.ms != null)) return '';

        const best = computeMixRecommendation();
        const sorted = [...results].sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));
        let rows = '';
        for (const r of sorted) {
            const pct = r.ms != null ? prog.prognosticPct(r.ms, 'CJMix2X') : null;
            const isBest = best && r.label === best.label && r.ms != null;
            rows +=
                `<tr class="${isBest ? 'bsr-mix-row--best' : ''}${r.ms == null ? ' bsr-mix-row--pending' : ''}">` +
                `<td class="bsr-mix-label">${esc(r.label)}</td>` +
                `<td>${esc(r.run)} · R${r.raceNum} L${r.lane}</td>` +
                `<td class="bsr-trial-lb-time">${r.ms != null ? formatMs(r.ms) : '—'}</td>` +
                `<td class="bsr-trial-lb-prog">${prog.formatPrognosticPct(pct)}</td></tr>`;
        }

        const recHtml =
            best ?
                `<p class="bsr-mix-recommend" role="status">` +
                `<strong>Recommended mixed double:</strong> ${esc(best.label)} — ${formatMs(best.ms)} ` +
                `(${prog.formatPrognosticPct(prog.prognosticPct(best.ms, 'CJMix2X'))} vs reference)</p>`
            :   '';

        return (
            `<div class="bsr-mix-matrix bsr-trial-leaderboard">` +
            `<h3>Mixed double matrix — MX1 + MX2 total times</h3>` +
            `<p class="bsr-note">All four pairings across the two matrix heats. Fastest combination is recommended for the U19 mixed double crew.</p>` +
            recHtml +
            `<div class="bsr-trial-lb-wrap"><table class="bsr-trial-lb-table">` +
            `<thead><tr><th>Pair</th><th>Heat</th><th>Total</th><th>Prog %</th></tr></thead>` +
            `<tbody>${rows}</tbody></table></div></div>`
        );
    }

    function renderEventLeaderboard() {
        const entries = savedEventEntries();
        if (!entries.length) {
            return '<p class="bsr-note">Saved results appear here ranked by total time. Tap <strong>Save</strong> on each finished row, then <strong>Publish leaderboard</strong>.</p>';
        }
        const prog = global.BsrTrialPrognostic;
        const leaders = splitLeaders(entries);
        const splitHeaders = MANUAL_SPLITS.map((s) => `<th class="bsr-trial-lb-split-h">${esc(s.short)}</th>`).join('');
        let rows = '';
        entries.forEach((entry, idx) => {
            const code = entry.slot.crew || entry.crewDefault;
            const classCode = prog?.prognosticClassForEvent(activeEventKey, entry);
            const pct = prog?.prognosticPct(entry.ms, classCode);
            const splitCells = MANUAL_SPLITS.map((sp) => {
                const cum = entry.slot.splits?.[sp.id];
                const isLeader = cum != null && leaders[sp.id]?.includes(code);
                return `<td class="bsr-trial-lb-split${isLeader ? ' bsr-trial-lb-split--leader' : ''}">${cum != null ? formatMs(cum) : '—'}</td>`;
            }).join('');
            rows +=
                `<tr><td class="bsr-trial-lb-rank">${idx + 1}</td>` +
                `<td>${esc(global.BsrTrialProgression?.formatAthleteDisplay?.(code) || athleteName(code))} <span class="bsr-trial-code">${esc(code)}</span></td>` +
                splitCells +
                `<td class="bsr-trial-lb-time">${formatMs(entry.ms)}</td>` +
                `<td class="bsr-trial-lb-prog">${prog ? prog.formatPrognosticPct(pct) : '—'}</td>` +
                `<td>R${entry.raceNum}</td></tr>`;
        });
        const unsaved = finishedUnsavedEntries().length;
        const hint =
            unsaved ?
                `<p class="bsr-note bsr-note--warn">${unsaved} finished row${unsaved === 1 ? '' : 's'} not saved yet.</p>`
            :   '';
        const mixMatrix = renderMixMatrixLeaderboard();
        return (
            mixMatrix +
            `<div class="bsr-trial-leaderboard"><h3>Event leaderboard (saved, ranked by total time)</h3>` +
            `<p class="bsr-note">Green split cells = fastest cumulative time at that section. Prog % compares total time to the reference for this boat class (100% = reference pace).</p>` +
            hint +
            `<div class="bsr-trial-lb-wrap"><table class="bsr-trial-lb-table bsr-trial-lb-table--splits"><thead><tr><th>Rank</th><th>Athlete</th>${splitHeaders}<th>Total</th><th>Prog %</th><th>Race</th></tr></thead>` +
            `<tbody>${rows}</tbody></table></div></div>`
        );
    }

    function renderRankings() {
        const w = store.rankings.women;
        const m = store.rankings.men;
        if (!w.length && !m.length) return '';
        let html =
            '<div class="bsr-trial-ranks"><h3>Trial plan seeding (published TT times)</h3><div class="bsr-trial-ranks-grid">';
        if (w.length) {
            html += '<div><strong>Women</strong><ol>';
            w.forEach((c, i) => {
                html += `<li>W${i + 1} — ${esc(global.BsrTrialProgression?.formatAthleteDisplay?.(c) || athleteName(c))} <span class="bsr-trial-code">(${esc(c)})</span></li>`;
            });
            html += '</ol></div>';
        }
        if (m.length) {
            html += '<div><strong>Men</strong><ol>';
            m.forEach((c, i) => {
                html += `<li>M${i + 1} — ${esc(global.BsrTrialProgression?.formatAthleteDisplay?.(c) || athleteName(c))} <span class="bsr-trial-code">(${esc(c)})</span></li>`;
            });
            html += '</ol></div>';
        }
        html += '</div></div>';
        return html;
    }

    function updateLiveTimes() {
        const panel = document.getElementById('bsrTrialLive');
        if (!panel) return;
        const now = Date.now();
        panel.querySelectorAll('tr[data-key]').forEach((row) => {
            const parts = String(row.dataset.key || '').split(':');
            if (parts.length !== 2) return;
            const slot = getSlot(parseInt(parts[0], 10), parseInt(parts[1], 10));
            if (!slot.runningAt) return;
            const elapsed = now - slot.runningAt;
            const totalEl = row.querySelector('[data-live-total]');
            if (totalEl) totalEl.textContent = formatMs(elapsed);
            const nextIdx = nextOpenSplitIndex(slot);
            row.querySelectorAll('.bsr-trial-split-col').forEach((cell, idx) => {
                const sp = MANUAL_SPLITS[idx];
                if (!sp) return;
                const cum = slot.splits[sp.id];
                const timeEl = cell.querySelector('.bsr-trial-split-time');
                if (!timeEl) return;
                if (cum != null) {
                    const leg = idx > 0 ? splitLegMs(slot.splits, idx) : null;
                    timeEl.innerHTML =
                        `${formatMs(cum)}${leg != null && idx > 0 ? `<span class="bsr-trial-leg">+${formatMs(leg)}</span>` : ''}`;
                } else if (idx === nextIdx) {
                    timeEl.innerHTML = formatMs(elapsed);
                }
            });
        });
    }

    function renderPanel() {
        const panel = document.getElementById('bsrTrialLive');
        if (!panel) return;
        const api = global.BsrRegatta;
        if (!activeEventKey || !api) {
            panel.hidden = true;
            return;
        }
        const rows = buildEventRows();
        if (!rows.length) {
            panel.hidden = true;
            return;
        }
        panel.hidden = false;
        const group = api.getEventRaces?.(activeEventKey)?.[0];
        const eventName = group?.eventName || `Event ${activeEventKey}`;
        const isTt = rows.every((r) => /time trial/i.test(r.race.round || ''));
        const ttNote = isTt ?
            '<p class="bsr-note bsr-note--trial">Time trial — tap <strong>Start</strong>, mark each split button as the athlete passes, then <strong>Save</strong> to publish to the leaderboard below.</p>'
        :   '<p class="bsr-note bsr-note--trial">Start → mark splits → Stop or Fin → Save to publish. Use <strong>Publish leaderboard</strong> to refresh the Time trial panel.</p>';

        const splitHeaders = MANUAL_SPLITS.map((s) => `<th class="bsr-trial-split-h">${esc(s.short)}</th>`).join('');
        const body = rows.map((r, i) => renderAthleteRow(r, i)).join('');
        const statusHtml = statusFlash ?
            `<p class="bsr-trial-status" role="status">${esc(statusFlash)}</p>`
        :   '';

        panel.innerHTML =
            `<header class="bsr-trial-live-header">` +
            `<h2>Live trial — Event ${esc(activeEventKey)} · ${esc(eventName)}</h2>` +
            `<p class="bsr-trial-sched">${rows.length} athlete${rows.length === 1 ? '' : 's'} in this event</p>` +
            `</header>` +
            statusHtml +
            ttNote +
            `<div class="bsr-trial-event-toolbar">` +
            `<button type="button" class="bsr-btn bsr-btn--primary bsr-trial-publish-lb" data-action="publish-lb">Publish leaderboard</button>` +
            `<span class="bsr-note">Publish TT results to seed later rounds.</span>` +
            `</div>` +
            `<div class="bsr-trial-table-wrap bsr-trial-table-wrap--wide"><table class="bsr-trial-table bsr-trial-table--splits">` +
            `<thead><tr><th>#</th><th>Sched</th><th>Code</th><th>Athlete</th><th>GPS</th>${splitHeaders}<th>Total</th><th></th><th>Notes</th></tr></thead>` +
            `<tbody>${body}</tbody></table></div>` +
            renderEventLeaderboard() +
            `<div class="bsr-trial-map-toolbar">` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-trial-map-selected" data-action="map-selected">Show selected on map</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-trial-map-all" data-action="map-all">Overlay all GPS in event</button>` +
            `</div>` +
            `<div id="bsrTrialMapWrap" class="bsr-trial-map-wrap"><div id="bsrTrialMap" class="bsr-trial-map"></div></div>` +
            renderRankings();

        statusFlash = '';
        bindPanelEvents();
    }

    function rowFromEventTarget(target) {
        const row = target.closest('tr[data-race]');
        if (!row) return null;
        return {
            raceNum: parseInt(row.dataset.race, 10),
            lane: parseInt(row.dataset.lane, 10),
            key: row.dataset.key,
            row,
        };
    }

    async function handlePanelAction(action, ctx) {
        if (action === 'publish-lb') {
            publishEventLeaderboard(true);
            return;
        }
        if (action === 'map-selected') {
            showMapTraces(store.selectedKey ? [store.selectedKey] : []);
            return;
        }
        if (action === 'map-all') {
            showMapTraces(null);
            return;
        }
        if (!ctx) return;
        const { raceNum, lane, key } = ctx;
        const slot = getSlot(raceNum, lane);
        if (action === 'start') startRow(raceNum, lane);
        else if (action === 'stop') await stopRow(raceNum, lane);
        else if (action === 'save') saveRow(raceNum, lane);
        else if (action === 'reset') resetRow(raceNum, lane);
        else if (action === 'gps') await fetchGpsForSlot(raceNum, lane, slot);
        else if (action === 'map') {
            store.selectedKey = key;
            saveStore();
            showMapTraces([key]);
            renderPanel();
        }
    }

    function bindPanelEvents() {
        const panel = document.getElementById('bsrTrialLive');
        if (!panel || panelBound) return;
        panelBound = true;

        const onPointer = (e) => {
            if (!panel.contains(e.target)) return;
            const btn = e.target.closest('button[data-action]');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                const ctx = rowFromEventTarget(btn);
                const action = btn.dataset.action;
                if (action === 'split') {
                    if (ctx) markSplit(ctx.raceNum, ctx.lane, btn.dataset.split);
                    return;
                }
                void handlePanelAction(action, ctx);
                return;
            }
            const ctx = rowFromEventTarget(e.target);
            if (
                ctx &&
                !e.target.closest('button') &&
                !e.target.closest('input') &&
                !e.target.closest('select')
            ) {
                store.selectedKey = ctx.key;
                saveStore();
                ctx.row.classList.add('bsr-trial-row--selected');
                panel.querySelectorAll('.bsr-trial-row--selected').forEach((el) => {
                    if (el !== ctx.row) el.classList.remove('bsr-trial-row--selected');
                });
            }
        };

        panel.addEventListener('pointerdown', onPointer, { passive: false });

        panel.addEventListener('change', (e) => {
            const ctx = rowFromEventTarget(e.target);
            if (!ctx) return;
            const slot = getSlot(ctx.raceNum, ctx.lane);
            if (e.target.classList.contains('bsr-trial-crew')) {
                slot.crew = e.target.value.trim().toUpperCase();
                slot.saved = false;
                saveStore();
            }
            if (e.target.classList.contains('bsr-trial-gps')) {
                slot.gps = e.target.value;
                saveStore();
            }
        });

        panel.addEventListener('input', (e) => {
            if (!e.target.classList.contains('bsr-trial-crew')) return;
            const ctx = rowFromEventTarget(e.target);
            if (!ctx) return;
            getSlot(ctx.raceNum, ctx.lane).crew = e.target.value.trim().toUpperCase();
            saveStore();
        });
    }

    function syncEventKey() {
        const api = global.BsrRegatta;
        activeEventKey =
            api?.getSelectedEventKey?.() ||
            (activeRaceNum ? String(global.BsrRegatta?.getRace?.(activeRaceNum)?.eventNum || '') : '');
    }

    function onRaceSelected(detail) {
        activeRaceNum = detail?.raceNum ?? null;
        syncEventKey();
        if (detail?.race) {
            const lane = detail.race.lanes?.[0]?.lane || 1;
            store.selectedKey = slotKey(activeRaceNum, lane);
            saveStore();
        }
        renderPanel();
    }

    function onEventSelected(detail) {
        activeEventKey = detail?.eventKey || '';
        activeRaceNum = null;
        renderPanel();
    }

    function onRegattaLoaded(detail) {
        const panel = document.getElementById('bsrTrialLive');
        if (!panel) return;
        if (!isTrialRegatta(detail?.code)) {
            panel.hidden = true;
            activeEventKey = '';
            return;
        }
        syncEventKey();
        renderPanel();
    }

    async function init() {
        loadStore();
        await loadMeta();
        global.addEventListener('bsr:race-selected', (e) => onRaceSelected(e.detail));
        global.addEventListener('bsr:event-selected', (e) => onEventSelected(e.detail));
        global.addEventListener('bsr:regatta-loaded', (e) => onRegattaLoaded(e.detail));
    }

    global.BsrTrialLive = {
        TRIAL_CODE,
        isTrialRegatta,
        getRankings: () => ({ ...store.rankings }),
        getAthleteMeta: (code) => athleteMeta(code),
        rerender: () => renderPanel(),
        refreshProgression: () => global.BsrTrialProgression?.refreshViews?.(),
        reset: () => {
            store = {
                races: {},
                rankings: { women: [], men: [] },
                selectedKey: '',
                publishedEvents: {},
                mixRecommendation: null,
            };
            saveStore();
            renderPanel();
        },
        getMixRecommendation: () => store.mixRecommendation || null,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        void init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
