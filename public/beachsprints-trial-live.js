/**
 * U19 coastal selection trial — event-wide athletes, manual split timers, GPS map overlay.
 * Active when regatta code is u19_ct_26.
 */
(function (global) {
    const TRIAL_CODE = 'u19_ct_26';
    const LS_TRIAL = 'bsrTrialLive_v2';
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
    /** @type {{ races: Record<string, object>, rankings: { women: string[], men: string[] }, selectedKey: string }} */
    let store = { races: {}, rankings: { women: [], men: [] }, selectedKey: '' };
    let activeEventKey = '';
    let activeRaceNum = null;
    const tickers = new Map();
    const trialMapHolder = { map: null, layers: [] };

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
        const endMs =
            finishMs(slot) != null ?
                startMs + finishMs(slot)
            :   startMs + 240000;
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
        if (finishMs(slot) != null) {
            pushResultToDashboard(raceNum, lane, slot);
        }
    }

    function pushResultToDashboard(raceNum, lane, slot) {
        const api = global.BsrRegatta;
        const total = finishMs(slot);
        if (!api?.applyTrialResult || total == null) return;
        api.applyTrialResult(raceNum, {
            lane,
            crew: slot.crew,
            time: formatTimeCsv(total),
            manualMs: total,
            gpsMs: slot.gpsMs,
        });
    }

    function updateRankingsFromTt(eventNum) {
        const api = global.BsrRegatta;
        if (!api?.getRacesForEvent) return;
        const races = api.getRacesForEvent(String(eventNum)) || [];
        const ttRaces = races.filter((r) => /time trial/i.test(r.round || ''));
        const ranked = ttRaces
            .map((r) => {
                const slot = getSlot(r.raceNum, 1);
                return { code: slot.crew || r.lanes?.[0]?.crew, ms: finishMs(slot), raceNum: r.raceNum };
            })
            .filter((x) => x.code && x.ms != null)
            .sort((a, b) => a.ms - b.ms);
        const codes = ranked.map((x) => x.code);
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
        slot.notes = '';
        saveStore();
        const k = slotKey(raceNum, lane);
        if (tickers.has(k)) clearInterval(tickers.get(k));
        tickers.set(k, setInterval(() => renderPanel(), 100));
        store.selectedKey = k;
        saveStore();
        renderPanel();
    }

    function markSplit(raceNum, lane, splitId) {
        const slot = getSlot(raceNum, lane);
        if (!slot.runningAt) return;
        const elapsed = Date.now() - slot.runningAt;
        slot.splits[splitId] = elapsed;
        if (splitId === 'finish') {
            stopRow(raceNum, lane, { skipFinishMark: true });
        } else {
            saveStore();
            renderPanel();
        }
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
        saveStore();
        const race = global.BsrRegatta?.getRace?.(raceNum);
        if (race && /time trial/i.test(race.round || '')) {
            updateRankingsFromTt(race.eventNum);
        }
        renderPanel();
        pushResultToDashboard(raceNum, lane, slot);
        if (slot.gps) await fetchGpsForSlot(raceNum, lane, slot);
    }

    function buildEventRows() {
        const api = global.BsrRegatta;
        if (!api || !activeEventKey) return [];
        const races = api.getEventRaces?.(activeEventKey) || api.getRacesForEvent?.(activeEventKey) || [];
        const rows = [];
        for (const race of races) {
            const lanes =
                race.lanes?.length ?
                    race.lanes
                :   [{ lane: 1, crew: '' }];
            for (const l of lanes) {
                rows.push({
                    raceNum: race.raceNum,
                    lane: l.lane,
                    crewDefault: l.crew,
                    race,
                    sched: race.startAt ?
                        race.startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    :   '',
                    division: race.division || '',
                });
            }
        }
        return rows;
    }

    function traceForSlot(row, slot, traceIdx) {
        const pts = slot.gpsPoints?.length ? slot.gpsPoints : [];
        return {
            lane: row.lane,
            label: `${athleteName(slot.crew || row.crewDefault)} (${slot.crew || row.crewDefault})`,
            points: pts,
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
        const wrap = document.getElementById('bsrTrialMapWrap');
        if (!api?.renderTraceMap || !el) return;
        const traces = tracesForKeys(keys);
        if (!traces.length) {
            if (wrap) wrap.hidden = false;
            el.innerHTML = '<p class="bsr-note">No GPS traces loaded — assign GPS, finish a run, and tap Fetch GPS.</p>';
            return;
        }
        if (wrap) wrap.hidden = false;
        el.innerHTML = '';
        api.renderTraceMap(el, traces, trialMapHolder);
        requestAnimationFrame(() => trialMapHolder.map?.invalidateSize());
    }

    function renderSplitCells(slot) {
        const running = slot.runningAt != null;
        const liveMs = running ? Date.now() - slot.runningAt : null;
        return MANUAL_SPLITS.map((sp, idx) => {
            const cum = slot.splits[sp.id];
            const leg = cum != null ? splitLegMs(slot.splits, idx) : null;
            const showLive = running && cum == null && (idx === 0 || slot.splits[MANUAL_SPLITS[idx - 1].id] != null);
            const display = cum != null ? formatMs(cum) : showLive ? formatMs(liveMs) : '—';
            const legHtml =
                leg != null && idx > 0 ?
                    `<span class="bsr-trial-leg">+${formatMs(leg)}</span>`
                :   '';
            const btn =
                running && cum == null ?
                    `<button type="button" class="bsr-trial-split-btn" data-split="${esc(sp.id)}" title="Mark ${esc(sp.label)}">${esc(sp.short)}</button>`
                :   '';
            return (
                `<td class="bsr-trial-split-col${showLive ? ' bsr-trial-split-col--live' : ''}">` +
                `<div class="bsr-trial-split-time">${display}${legHtml}</div>${btn}</td>`
            );
        }).join('');
    }

    function renderAthleteRow(row, orderIdx) {
        const { raceNum, lane, crewDefault, race, sched, division } = row;
        const slot = getSlot(raceNum, lane);
        if (!slot.crew && crewDefault) slot.crew = crewDefault;
        const k = slotKey(raceNum, lane);
        const selected = store.selectedKey === k || activeRaceNum === raceNum;
        const running = slot.runningAt != null;
        const total = finishMs(slot);
        const gpsOpts = ['', ...GPS_LABELS]
            .map(
                (g) =>
                    `<option value="${esc(g)}"${slot.gps === g ? ' selected' : ''}>${g || '—'}</option>`,
            )
            .join('');
        return (
            `<tr class="bsr-trial-row${selected ? ' bsr-trial-row--selected' : ''}" data-key="${esc(k)}" data-race="${raceNum}" data-lane="${lane}">` +
            `<td class="bsr-trial-order">${orderIdx + 1}</td>` +
            `<td class="bsr-trial-sched">${esc(sched)}</td>` +
            `<td><input type="text" class="bsr-trial-crew" value="${esc(slot.crew)}" placeholder="${esc(crewDefault || '')}"></td>` +
            `<td><span class="bsr-trial-athlete-name">${esc(athleteName(slot.crew || crewDefault))}</span></td>` +
            `<td><select class="bsr-trial-gps">${gpsOpts}</select></td>` +
            renderSplitCells(slot) +
            `<td class="bsr-trial-total${running ? ' bsr-trial-time--live' : ''}">${total != null ? formatMs(total) : running ? formatMs(Date.now() - slot.runningAt) : '—'}</td>` +
            `<td class="bsr-trial-actions">` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-trial-start"${running ? ' disabled' : ''}>Start</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-trial-stop"${!running ? ' disabled' : ''}>Stop</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-btn--ghost bsr-trial-gps-fetch">GPS</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-btn--ghost bsr-trial-map-one">Map</button>` +
            `</td>` +
            `<td class="bsr-trial-note">${esc(slot.notes || '')}${slot.gpsPoints?.length ? ` · ${slot.gpsPoints.length} pts` : ''}</td>` +
            `</tr>`
        );
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
            '<p class="bsr-note bsr-note--trial">Time trial — all athletes in this event. Tap split buttons as each mark is passed. Swap C1X_A / C1X_B between starts.</p>'
        :   '<p class="bsr-note bsr-note--trial">Tap <strong>Start</strong> at the line, then mark each split. Use <strong>Map</strong> for one trace or overlay all below.</p>';

        const splitHeaders = MANUAL_SPLITS.map((s) => `<th class="bsr-trial-split-h">${esc(s.short)}</th>`).join('');
        const body = rows.map((r, i) => renderAthleteRow(r, i)).join('');

        panel.innerHTML =
            `<header class="bsr-trial-live-header">` +
            `<h2>Live trial — Event ${esc(activeEventKey)} · ${esc(eventName)}</h2>` +
            `<p class="bsr-trial-sched">${rows.length} athlete${rows.length === 1 ? '' : 's'} in this event</p>` +
            `</header>` +
            ttNote +
            `<div class="bsr-trial-table-wrap bsr-trial-table-wrap--wide"><table class="bsr-trial-table bsr-trial-table--splits">` +
            `<thead><tr><th>#</th><th>Sched</th><th>Code</th><th>Athlete</th><th>GPS</th>${splitHeaders}<th>Total</th><th></th><th>Notes</th></tr></thead>` +
            `<tbody>${body}</tbody></table></div>` +
            `<div class="bsr-trial-map-toolbar">` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-trial-map-selected">Show selected on map</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-btn--primary bsr-trial-map-all">Overlay all GPS in event</button>` +
            `</div>` +
            `<div id="bsrTrialMapWrap" class="bsr-trial-map-wrap"><div id="bsrTrialMap" class="bsr-trial-map"></div></div>` +
            renderRankings();
    }

    function renderRankings() {
        const w = store.rankings.women;
        const m = store.rankings.men;
        if (!w.length && !m.length) return '';
        let html = '<div class="bsr-trial-ranks"><h3>Trial plan rankings (from TT finish times)</h3><div class="bsr-trial-ranks-grid">';
        if (w.length) {
            html += '<div><strong>Women</strong><ol>';
            w.forEach((c, i) => {
                html += `<li>W${i + 1} — ${esc(athleteName(c))} <span class="bsr-trial-code">(${esc(c)})</span></li>`;
            });
            html += '</ol></div>';
        }
        if (m.length) {
            html += '<div><strong>Men</strong><ol>';
            m.forEach((c, i) => {
                html += `<li>M${i + 1} — ${esc(athleteName(c))} <span class="bsr-trial-code">(${esc(c)})</span></li>`;
            });
            html += '</ol></div>';
        }
        html += '</div></div>';
        return html;
    }

    function bindPanelEvents() {
        const panel = document.getElementById('bsrTrialLive');
        if (!panel || panel.dataset.bound === '2') return;
        panel.dataset.bound = '2';

        panel.addEventListener('click', async (e) => {
            if (e.target.classList.contains('bsr-trial-map-selected')) {
                showMapTraces(store.selectedKey ? [store.selectedKey] : []);
                return;
            }
            if (e.target.classList.contains('bsr-trial-map-all')) {
                showMapTraces(null);
                return;
            }
            const row = e.target.closest('tr[data-race]');
            if (!row) return;
            const raceNum = parseInt(row.dataset.race, 10);
            const lane = parseInt(row.dataset.lane, 10);
            const key = row.dataset.key;
            if (e.target.classList.contains('bsr-trial-start')) startRow(raceNum, lane);
            if (e.target.classList.contains('bsr-trial-stop')) await stopRow(raceNum, lane);
            if (e.target.classList.contains('bsr-trial-gps-fetch')) {
                await fetchGpsForSlot(raceNum, lane, getSlot(raceNum, lane));
            }
            if (e.target.classList.contains('bsr-trial-map-one')) {
                store.selectedKey = key;
                saveStore();
                showMapTraces([key]);
                renderPanel();
                return;
            }
            if (e.target.classList.contains('bsr-trial-split-btn')) {
                markSplit(raceNum, lane, e.target.dataset.split);
                return;
            }
            if (!e.target.closest('button') && !e.target.closest('input') && !e.target.closest('select')) {
                store.selectedKey = key;
                saveStore();
                renderPanel();
            }
        });

        panel.addEventListener('change', (e) => {
            const row = e.target.closest('tr[data-race]');
            if (!row) return;
            const raceNum = parseInt(row.dataset.race, 10);
            const lane = parseInt(row.dataset.lane, 10);
            const slot = getSlot(raceNum, lane);
            if (e.target.classList.contains('bsr-trial-crew')) {
                slot.crew = e.target.value.trim().toUpperCase();
                saveStore();
                renderPanel();
            }
            if (e.target.classList.contains('bsr-trial-gps')) {
                slot.gps = e.target.value;
                saveStore();
                renderPanel();
            }
        });

        panel.addEventListener('input', (e) => {
            if (!e.target.classList.contains('bsr-trial-crew')) return;
            const row = e.target.closest('tr[data-race]');
            if (!row) return;
            getSlot(parseInt(row.dataset.race, 10), parseInt(row.dataset.lane, 10)).crew =
                e.target.value.trim().toUpperCase();
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
        bindPanelEvents();
        global.addEventListener('bsr:race-selected', (e) => onRaceSelected(e.detail));
        global.addEventListener('bsr:event-selected', (e) => onEventSelected(e.detail));
        global.addEventListener('bsr:regatta-loaded', (e) => onRegattaLoaded(e.detail));
    }

    global.BsrTrialLive = {
        TRIAL_CODE,
        isTrialRegatta,
        getRankings: () => ({ ...store.rankings }),
        reset: () => {
            store = { races: {}, rankings: { women: [], men: [] }, selectedKey: '' };
            saveStore();
            renderPanel();
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        void init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
