/**
 * U19 coastal selection trial — live manual timers + CrewSight GPS assignment.
 * Active when regatta code is u19_ct_26.
 */
(function (global) {
    const TRIAL_CODE = 'u19_ct_26';
    const LS_TRIAL = 'bsrTrialLive_v1';
    const GPS_LABELS = ['C1X_A', 'C1X_B'];
    const GPS_TO_ALIAS = { C1X_A: 'boat_1', C1X_B: 'boat_2' };

    /** @type {object|null} */
    let meta = null;
    /** @type {Map<string, {name:string, club:string}>} */
    let codeLookup = new Map();
    /** @type {{ races: Record<string, object>, rankings: { women: string[], men: string[] } }} */
    let store = { races: {}, rankings: { women: [], men: [] } };
    let activeRaceNum = null;
    /** @type {Map<string, number>} slot timers */
    const tickers = new Map();

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
            if (raw) store = { ...store, ...JSON.parse(raw) };
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

    function raceKey(raceNum, lane) {
        return `${raceNum}:${lane}`;
    }

    function getSlot(raceNum, lane) {
        const k = raceKey(raceNum, lane);
        if (!store.races[k]) {
            store.races[k] = {
                crew: '',
                gps: '',
                manualMs: null,
                manualStartedAt: null,
                manualStartAt: null,
                gpsMs: null,
                gpsSplits: null,
                notes: '',
            };
        }
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
        const found = devices.find((d) =>
            String(d.name || '').toUpperCase().includes(gpsLabel.replace('_', '')),
        );
        return found ? String(found.id) : '';
    }

    function applyGpsToRegattaAliases(gpsLabel, lane) {
        const api = global.BsrRegatta;
        if (!api?.setLaneDevice) return;
        const alias = GPS_TO_ALIAS[gpsLabel];
        if (alias) {
            api.setLaneDevice(lane, alias);
            api.setDeviceAlias?.(alias, resolveDeviceId(gpsLabel));
        }
    }

    async function fetchGpsForSlot(raceNum, lane, slot) {
        const api = global.BsrRegatta;
        if (!api?.fetchRoute || !slot.gps) return;
        const race = api.getRace?.(raceNum);
        if (!race) return;
        const deviceId = resolveDeviceId(slot.gps);
        if (!deviceId) {
            slot.notes = 'GPS device not found — map C1X_A/C1X_B in settings';
            saveStore();
            renderPanel();
            return;
        }
        const startMs = slot.manualStartAt || slot.manualStartedAt || (race.startAt ? race.startAt.getTime() : Date.now());
        const from = new Date(startMs - 30 * 1000);
        const to = new Date(startMs + (slot.manualMs || 240000) + 60 * 1000);
        try {
            const points = await api.fetchRoute(deviceId, from, to);
            const coastal = global.BeachSprintsCoastal;
            if (coastal?.analyzeCoastalRace && points?.length > 5) {
                const endMs = slot.manualStartedAt ?
                    Date.now()
                :   startMs + (slot.manualMs || 0);
                const analysis = coastal.analyzeCoastalRace(points, slot.gps, {
                    officialTimeMs: slot.manualMs,
                    manualTrim:
                        slot.manualMs != null ?
                            { startMs, endMs: startMs + slot.manualMs }
                        :   undefined,
                });
                if (analysis?.valid) {
                    slot.gpsMs = analysis.totalMs ?? analysis.boatWaterMs ?? null;
                    slot.gpsSplits = (analysis.phases || []).map((p) => ({
                        label: p.label || p.id,
                        ms: p.durationMs,
                    }));
                    slot.notes = '';
                } else {
                    slot.notes = analysis?.reason || 'GPS track found but course analysis incomplete';
                }
            } else if (points?.length) {
                const times = points
                    .map((p) => new Date(p.fixTime || p.deviceTime).getTime())
                    .filter(Number.isFinite);
                if (times.length >= 2) {
                    slot.gpsMs = Math.max(...times) - Math.min(...times);
                }
                slot.notes = points.length < 6 ? 'Few GPS points — check CrewSight recording' : '';
            } else {
                slot.notes = 'No GPS points in window';
            }
        } catch (err) {
            slot.notes = `GPS fetch failed: ${err.message || err}`;
        }
        saveStore();
        renderPanel();
        pushResultToDashboard(raceNum, lane, slot);
    }

    function pushResultToDashboard(raceNum, lane, slot) {
        const api = global.BsrRegatta;
        if (!api?.applyTrialResult || slot.manualMs == null) return;
        api.applyTrialResult(raceNum, {
            lane,
            crew: slot.crew,
            time: formatTimeCsv(slot.manualMs),
            manualMs: slot.manualMs,
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
                return { code: slot.crew || r.lanes?.[0]?.crew, ms: slot.manualMs, raceNum: r.raceNum };
            })
            .filter((x) => x.code && x.ms != null)
            .sort((a, b) => a.ms - b.ms);
        const codes = ranked.map((x) => x.code);
        if (eventNum === 1 || eventNum === '1') store.rankings.women = codes;
        if (eventNum === 2 || eventNum === '2') store.rankings.men = codes;
        saveStore();
    }

    function startTimer(raceNum, lane) {
        const slot = getSlot(raceNum, lane);
        slot.manualStartedAt = Date.now();
        slot.manualMs = null;
        saveStore();
        const k = raceKey(raceNum, lane);
        if (tickers.has(k)) clearInterval(tickers.get(k));
        tickers.set(
            k,
            setInterval(() => renderPanel(), 100),
        );
        renderPanel();
    }

    async function stopTimer(raceNum, lane) {
        const slot = getSlot(raceNum, lane);
        const k = raceKey(raceNum, lane);
        if (tickers.has(k)) {
            clearInterval(tickers.get(k));
            tickers.delete(k);
        }
        if (slot.manualStartedAt) {
            slot.manualStartAt = slot.manualStartedAt;
            slot.manualMs = Date.now() - slot.manualStartedAt;
            slot.manualStartedAt = null;
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

    function renderRankings() {
        const w = store.rankings.women;
        const m = store.rankings.men;
        if (!w.length && !m.length) return '';
        let html = '<div class="bsr-trial-ranks"><h3>Trial plan rankings (from TT times)</h3><div class="bsr-trial-ranks-grid">';
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

    function renderSlotRow(race, lane, crewDefault) {
        const raceNum = race.raceNum;
        const slot = getSlot(raceNum, lane);
        if (!slot.crew && crewDefault) slot.crew = crewDefault;
        const running = slot.manualStartedAt != null;
        const elapsed = running ? Date.now() - slot.manualStartedAt : slot.manualMs;
        const gpsOpts = ['', ...GPS_LABELS]
            .map(
                (g) =>
                    `<option value="${esc(g)}"${slot.gps === g ? ' selected' : ''}>${g || '— no GPS —'}</option>`,
            )
            .join('');
        const splits =
            slot.gpsSplits?.length ?
                `<ul class="bsr-trial-splits">${slot.gpsSplits.map((s) => `<li>${esc(s.label)}: ${formatMs(s.ms)}</li>`).join('')}</ul>`
            :   '';
        return (
            `<tr data-race="${raceNum}" data-lane="${lane}">` +
            `<td>Lane ${lane}</td>` +
            `<td><input type="text" class="bsr-trial-crew" value="${esc(slot.crew)}" placeholder="${esc(crewDefault || '')}" title="Athlete code or name"></td>` +
            `<td><span class="bsr-trial-athlete-name">${esc(athleteName(slot.crew || crewDefault))}</span></td>` +
            `<td><select class="bsr-trial-gps">${gpsOpts}</select></td>` +
            `<td class="bsr-trial-time${running ? ' bsr-trial-time--live' : ''}">${formatMs(elapsed)}</td>` +
            `<td>${slot.gpsMs != null ? formatMs(slot.gpsMs) : '—'}${splits}</td>` +
            `<td class="bsr-trial-actions">` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-trial-start"${running ? ' disabled' : ''}>Start</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-trial-stop"${!running ? ' disabled' : ''}>Stop</button> ` +
            `<button type="button" class="bsr-btn bsr-btn--small bsr-btn--ghost bsr-trial-gps-fetch">GPS</button>` +
            `</td>` +
            `<td class="bsr-trial-note">${esc(slot.notes || '')}</td>` +
            `</tr>`
        );
    }

    function renderPanel() {
        const panel = document.getElementById('bsrTrialLive');
        if (!panel) return;
        const api = global.BsrRegatta;
        if (!activeRaceNum || !api) {
            panel.hidden = true;
            return;
        }
        const race = api.getRace?.(activeRaceNum);
        if (!race) {
            panel.hidden = true;
            return;
        }
        panel.hidden = false;
        const isTt = /time trial/i.test(race.round || '');
        const ttNote = isTt ?
            '<p class="bsr-note bsr-note--trial">Time trial — assign one GPS per start. Swap C1X_A / C1X_B between boats; only two on water at once.</p>'
        :   '<p class="bsr-note bsr-note--trial">Head-to-head — assign GPS per lane, start timer when athlete crosses the start line.</p>';

        const lanes = race.lanes?.length ?
            race.lanes
        :   [{ lane: 1, crew: '' }];

        const rows = lanes
            .map((l) => renderSlotRow(race, l.lane, l.crew))
            .join('');

        panel.innerHTML =
            `<header class="bsr-trial-live-header">` +
            `<h2>Live trial — Race ${esc(race.race)} · ${esc(race.eventName || '')} · ${esc(race.round || '')}</h2>` +
            `<p class="bsr-trial-sched">${race.startAt ? esc(race.startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : ''} · Event ${esc(race.eventNum)}</p>` +
            `</header>` +
            ttNote +
            `<div class="bsr-trial-table-wrap"><table class="bsr-trial-table">` +
            `<thead><tr><th>Lane</th><th>Crew code</th><th>Athlete</th><th>GPS</th><th>Manual</th><th>GPS total</th><th></th><th>Notes</th></tr></thead>` +
            `<tbody>${rows}</tbody></table></div>` +
            renderRankings();
    }

    function bindPanelEvents() {
        const panel = document.getElementById('bsrTrialLive');
        if (!panel || panel.dataset.bound === '1') return;
        panel.dataset.bound = '1';

        panel.addEventListener('click', async (e) => {
            const row = e.target.closest('tr[data-race]');
            if (!row) return;
            const raceNum = parseInt(row.dataset.race, 10);
            const lane = parseInt(row.dataset.lane, 10);
            if (e.target.classList.contains('bsr-trial-start')) startTimer(raceNum, lane);
            if (e.target.classList.contains('bsr-trial-stop')) await stopTimer(raceNum, lane);
            if (e.target.classList.contains('bsr-trial-gps-fetch')) {
                const slot = getSlot(raceNum, lane);
                await fetchGpsForSlot(raceNum, lane, slot);
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
                applyGpsToRegattaAliases(slot.gps, lane);
                renderPanel();
            }
        });

        panel.addEventListener('input', (e) => {
            if (!e.target.classList.contains('bsr-trial-crew')) return;
            const row = e.target.closest('tr[data-race]');
            if (!row) return;
            const raceNum = parseInt(row.dataset.race, 10);
            const lane = parseInt(row.dataset.lane, 10);
            getSlot(raceNum, lane).crew = e.target.value.trim().toUpperCase();
            saveStore();
        });
    }

    function onRaceSelected(detail) {
        activeRaceNum = detail?.raceNum ?? null;
        renderPanel();
    }

    function onRegattaLoaded(detail) {
        const panel = document.getElementById('bsrTrialLive');
        if (!panel) return;
        if (!isTrialRegatta(detail?.code)) {
            panel.hidden = true;
            activeRaceNum = null;
            return;
        }
        panel.hidden = false;
        renderPanel();
    }

    async function init() {
        loadStore();
        await loadMeta();
        bindPanelEvents();
        global.addEventListener('bsr:race-selected', (e) => onRaceSelected(e.detail));
        global.addEventListener('bsr:regatta-loaded', (e) => onRegattaLoaded(e.detail));
    }

    global.BsrTrialLive = {
        TRIAL_CODE,
        isTrialRegatta,
        getRankings: () => ({ ...store.rankings }),
        reset: () => {
            store = { races: {}, rankings: { women: [], men: [] } };
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
