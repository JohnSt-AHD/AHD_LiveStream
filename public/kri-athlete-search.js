/**
 * KRI safety map — athlete search (competitors CSV + on-water boats).
 */
(function (global) {
    const ON_WATER_FIX_MAX_MIN = 30;
    const STOP_SPEED_MPS = 0.5;

    let competitors = new Map();
    let competitorsLoaded = false;
    let competitorsError = null;
    let onWaterBoats = [];
    const boatInfoByDeviceId = new Map();
    const expandedCrewDeviceIds = new Set();
    let laneAthletesCacheKey = '';
    let laneAthletesCache = new Map();

    function escapeHtml(value) {
        if (value == null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parseCsvLine(line) {
        const out = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQ) {
                if (c === '"' && line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else if (c === '"') {
                    inQ = false;
                } else {
                    cur += c;
                }
            } else if (c === '"') {
                inQ = true;
            } else if (c === ',') {
                out.push(cur);
                cur = '';
            } else {
                cur += c;
            }
        }
        out.push(cur);
        return out;
    }

    function parseRaceLabel(raw) {
        const s = String(raw || '').trim();
        const withLetter = s.match(/^(\d+)\s*\(([A-Za-z])\)\s*$/);
        if (withLetter) {
            return { raceNum: parseInt(withLetter[1], 10), label: `${withLetter[1]} (${withLetter[2].toUpperCase()})` };
        }
        const plain = s.match(/^(\d+)$/);
        if (plain) return { raceNum: parseInt(plain[1], 10), label: plain[1] };
        return { raceNum: null, label: s };
    }

    function parseCompetitorsCsv(text) {
        const map = new Map();
        let dayDate = null;
        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (/^DAY\s+\d+:/i.test(trimmed)) {
                dayDate = true;
                continue;
            }
            if (!dayDate || /^Race,/i.test(trimmed)) continue;
            const cols = parseCsvLine(trimmed);
            const info = parseRaceLabel(cols[0]);
            if (!info.raceNum) continue;
            const division = cols[5] ? cols[5].trim() : '';
            map.set(`${info.label}|${division}`, {
                race: info.label,
                raceNum: info.raceNum,
                eventNum: cols[2] ? cols[2].trim() : '',
                eventType: cols[3] ? cols[3].trim() : '',
                division,
                names: cols[6] ? cols[6].trim() : '',
            });
        }
        return map;
    }

    /** Lane → athlete names for one race (names in col G, lane order from daysheet draw). */
    function buildLaneAthletesMap(race) {
        if (global.RegattaCrewAthletes?.buildLaneAthletesMap) {
            return global.RegattaCrewAthletes.buildLaneAthletesMap(race, competitors);
        }
        return new Map();
    }

    function laneAthletesMapForRace(race) {
        if (!race) return new Map();
        const key = `${race.race}|${race.division || ''}|${race.eventName || ''}`;
        if (key !== laneAthletesCacheKey) {
            laneAthletesCacheKey = key;
            laneAthletesCache = buildLaneAthletesMap(race);
        }
        return laneAthletesCache;
    }

    function athletesForLane(race, lane) {
        if (!race || !lane) return [];
        return laneAthletesMapForRace(race).get(lane) || [];
    }

    function clearLaneAthletesCache() {
        laneAthletesCacheKey = '';
        laneAthletesCache = new Map();
    }

    function parseClubCode(raw) {
        const m = String(raw || '')
            .trim()
            .match(/^([A-Za-z]+)(?:\s+(\d+))?$/);
        if (!m) return { id: '', crewNum: '' };
        return { id: m[1].toLowerCase(), crewNum: m[2] || '' };
    }

    function deviceDemoLane(device) {
        if (!device) return null;
        const m = /^A(\d)$/i.exec(String(device.name || '').trim());
        if (m) return parseInt(m[1], 10);
        if (device.id >= 9001 && device.id <= 9008) return device.id - 9000;
        return null;
    }

    function findLaneByDeviceName(device, race) {
        if (!race?.lanes?.length || !device?.name) return null;
        const name = String(device.name).trim().toLowerCase();
        for (const l of race.lanes) {
            if (!l.crew) continue;
            if (String(l.crew).trim().toLowerCase() === name) return l.lane;
            const club = parseClubCode(l.crew);
            if (club.id && name.includes(club.id)) return l.lane;
        }
        return null;
    }

    function resolveBoatAthletes(device) {
        const panel = global.KriSafetyRegattaPanel;
        const race = panel?.getCurrentRace?.() || null;
        let lane = deviceDemoLane(device);
        let crew = device.demoCrew || '';

        if (!crew && race) {
            if (!lane) lane = findLaneByDeviceName(device, race);
            if (lane) {
                const assignment = panel?.getLaneAssignment?.(lane);
                crew = assignment?.crew || '';
            }
        }

        if (!crew && lane && panel?.getLaneAssignment) {
            crew = panel.getLaneAssignment(lane)?.crew || '';
        }

        const athletes = athletesForLane(race, lane);
        const clubName = device.demoClubName || panel?.crewDisplay?.(crew)?.name || '';

        return {
            lane,
            crew,
            clubName,
            athletes,
            raceLabel: race ? `Race ${race.race}` : '',
        };
    }

    async function loadCompetitors() {
        const board = global.AltitudeHdRegattaBoard;
        if (!board?.fetchCsvText || !board?.getCsvUrl) {
            competitors = new Map();
            competitorsLoaded = false;
            competitorsError = 'Regatta data not available';
            return;
        }
        try {
            const text = await board.fetchCsvText(board.getCsvUrl('competitors'));
            competitors = parseCompetitorsCsv(text);
            clearLaneAthletesCache();
            competitorsLoaded = true;
            competitorsError = null;
        } catch (err) {
            competitors = new Map();
            clearLaneAthletesCache();
            competitorsLoaded = false;
            competitorsError = err.message || 'Could not load competitors CSV';
        }
    }

    function normalizeQuery(q) {
        return String(q || '')
            .trim()
            .toLowerCase();
    }

    function buildBoatInfo(device, pos) {
        const meta = resolveBoatAthletes(device);
        const clubLabel = meta.clubName || meta.crew || '';
        const boatLabel = clubLabel
            ? `${device.name} · ${clubLabel}`
            : device.name;
        return {
            device,
            pos,
            deviceId: device.id,
            deviceName: device.name,
            boatLabel,
            clubName: meta.clubName,
            crew: meta.crew,
            lane: meta.lane,
            raceLabel: meta.raceLabel,
            athletes: meta.athletes,
            lat: pos.latitude,
            lng: pos.longitude,
        };
    }

    function refreshOnWater(devices, positions, boundaryParts, helpers) {
        onWaterBoats = [];
        boatInfoByDeviceId.clear();

        if (!helpers?.getOnWaterParts || !helpers?.isOnWater) return onWaterBoats;

        const parts = helpers.getOnWaterParts(boundaryParts);
        if (!parts || parts.length === 0) return onWaterBoats;

        for (const d of devices || []) {
            const pos = positions[d.id];
            if (!pos || !helpers.isOnWater(d, pos, parts)) continue;
            const info = buildBoatInfo(d, pos);
            onWaterBoats.push(info);
            boatInfoByDeviceId.set(d.id, info);
        }

        onWaterBoats.sort((a, b) =>
            String(a.deviceName).localeCompare(String(b.deviceName), undefined, { sensitivity: 'base' }),
        );

        const currentIds = new Set(onWaterBoats.map((b) => b.deviceId));
        for (const id of expandedCrewDeviceIds) {
            if (!currentIds.has(id)) expandedCrewDeviceIds.delete(id);
        }

        return onWaterBoats;
    }

    function searchOnWater(query) {
        const q = normalizeQuery(query);
        if (!q) return [];

        const results = [];
        const seen = new Set();

        for (const boat of onWaterBoats) {
            const boatHay = `${boat.deviceName} ${boat.boatLabel} ${boat.crew} ${boat.clubName}`.toLowerCase();
            const boatMatches = boatHay.includes(q);

            for (const name of boat.athletes) {
                if (!name.toLowerCase().includes(q) && !boatMatches) continue;
                const key = `${boat.deviceId}|${name.toLowerCase()}`;
                if (seen.has(key)) continue;
                seen.add(key);
                results.push({
                    athleteName: name,
                    boat,
                });
            }

            if (!boat.athletes.length && boatMatches) {
                const key = `${boat.deviceId}|boat`;
                if (!seen.has(key)) {
                    seen.add(key);
                    results.push({
                        athleteName: boat.boatLabel,
                        boat,
                        isBoatOnly: true,
                    });
                }
            }
        }

        return results.slice(0, 40);
    }

    function listAllOnWaterAthletes() {
        const results = [];
        for (const boat of onWaterBoats) {
            for (const name of boat.athletes || []) {
                const trimmed = String(name).trim();
                if (!trimmed) continue;
                results.push({ athleteName: trimmed, boat });
            }
        }
        results.sort((a, b) =>
            a.athleteName.localeCompare(b.athleteName, undefined, { sensitivity: 'base' }),
        );
        return results;
    }

    function isSearchPanelOpen() {
        const box = document.getElementById('kriAthleteSearchBox');
        return box?.tagName === 'DETAILS' && box.open;
    }

    function renderSearchHitsHtml(hits) {
        return (
            '<ul class="kri-athlete-search-list">' +
            hits
                .map((hit) => {
                    const sub = [
                        hit.boat.deviceName,
                        hit.boat.clubName || hit.boat.crew,
                        hit.boat.raceLabel,
                    ]
                        .filter(Boolean)
                        .join(' · ');
                    return (
                        `<li>` +
                        `<button type="button" class="kri-athlete-search-hit" ` +
                        `data-fly-lat="${hit.boat.lat}" data-fly-lng="${hit.boat.lng}" data-device-id="${hit.boat.deviceId}">` +
                        `<span class="kri-athlete-search-name">${escapeHtml(hit.athleteName)}</span>` +
                        `<span class="kri-athlete-search-meta">${escapeHtml(sub)}</span>` +
                        `</button>` +
                        `</li>`
                    );
                })
                .join('') +
            '</ul>'
        );
    }

    function toggleCrewExpanded(deviceId) {
        const id = Number(deviceId);
        if (!Number.isFinite(id)) return false;
        if (expandedCrewDeviceIds.has(id)) {
            expandedCrewDeviceIds.delete(id);
            return false;
        }
        expandedCrewDeviceIds.add(id);
        return true;
    }

    function isCrewExpanded(deviceId) {
        return expandedCrewDeviceIds.has(Number(deviceId));
    }

    function flyToBoat(boat) {
        if (!boat) return;
        global.dispatchEvent(
            new CustomEvent('kri-fly-to-device', {
                detail: {
                    lat: boat.lat,
                    lng: boat.lng,
                    deviceId: boat.deviceId,
                },
            }),
        );
    }

    function renderSearchResults() {
        const el = document.getElementById('kriAthleteSearchResults');
        const input = document.getElementById('kriAthleteSearchInput');
        if (!el || !input) return;

        const q = input.value;

        if (!competitorsLoaded && !competitorsError) {
            el.innerHTML = '<p class="kri-athlete-search-hint">Loading competitors…</p>';
            return;
        }

        if (competitorsError) {
            el.innerHTML = `<p class="kri-athlete-search-hint">${escapeHtml(competitorsError)}</p>`;
            return;
        }

        if (!onWaterBoats.length) {
            el.innerHTML =
                '<p class="kri-athlete-search-hint">No on-water boats right now. Athletes appear when boats match the on-water list.</p>';
            return;
        }

        if (!normalizeQuery(q)) {
            if (isSearchPanelOpen()) {
                const all = listAllOnWaterAthletes();
                if (!all.length) {
                    el.innerHTML =
                        '<p class="kri-athlete-search-hint">No athlete names listed for on-water boats yet (check competitors CSV and current race draw).</p>';
                    return;
                }
                el.innerHTML = renderSearchHitsHtml(all);
                return;
            }
            el.innerHTML = `<p class="kri-athlete-search-hint">${onWaterBoats.length} boat${onWaterBoats.length === 1 ? '' : 's'} on water — expand to list athletes A–Z, or type to search.</p>`;
            return;
        }

        const hits = searchOnWater(q);
        if (!hits.length) {
            el.innerHTML = '<p class="kri-athlete-search-hint">No matching athletes on the water.</p>';
            return;
        }

        el.innerHTML = renderSearchHitsHtml(hits);
    }

    function getBoatInfo(deviceId) {
        return boatInfoByDeviceId.get(deviceId) || null;
    }

    function countOnWaterCompetitors() {
        const seen = new Set();
        for (const boat of onWaterBoats) {
            for (const name of boat.athletes || []) {
                const key = name.trim().toLowerCase();
                if (key) seen.add(key);
            }
        }
        return seen.size;
    }

    function wireSearch() {
        const input = document.getElementById('kriAthleteSearchInput');
        const results = document.getElementById('kriAthleteSearchResults');
        if (!input || input.dataset.bound === '1') return;
        input.dataset.bound = '1';

        input.addEventListener('input', () => renderSearchResults());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                input.value = '';
                renderSearchResults();
            }
        });

        if (results) {
            results.addEventListener('click', (e) => {
                const btn = e.target.closest('.kri-athlete-search-hit');
                if (!btn) return;
                flyToBoat({
                    lat: parseFloat(btn.dataset.flyLat),
                    lng: parseFloat(btn.dataset.flyLng),
                    deviceId: Number(btn.dataset.deviceId),
                });
            });
        }

        const searchBox = document.getElementById('kriAthleteSearchBox');
        if (searchBox && searchBox.tagName === 'DETAILS') {
            searchBox.addEventListener('toggle', () => renderSearchResults());
        }
    }

    function wireOnWaterCrewToggle() {
        const list = document.getElementById('rnzOnWaterBoatsList');
        if (!list || list.dataset.kriCrewBound === '1') return;
        list.dataset.kriCrewBound = '1';

        list.addEventListener('click', (e) => {
            const toggle = e.target.closest('.rnz-onwater-crew-toggle');
            if (toggle) {
                e.preventDefault();
                e.stopPropagation();
                const id = toggle.dataset.deviceId;
                const panel = document.getElementById(`rnz-onwater-crew-${id}`);
                if (!panel) return;
                const open = toggleCrewExpanded(id);
                panel.hidden = !open;
                toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                toggle.textContent = open ? 'Hide athletes' : 'Athletes';
                return;
            }

            const athleteBtn = e.target.closest('.rnz-onwater-athlete-fly');
            if (athleteBtn) {
                e.preventDefault();
                e.stopPropagation();
                flyToBoat({
                    lat: parseFloat(athleteBtn.dataset.flyLat),
                    lng: parseFloat(athleteBtn.dataset.flyLng),
                    deviceId: Number(athleteBtn.dataset.deviceId),
                });
            }
        });
    }

    async function init() {
        const panel = document.getElementById('kriAthleteSearchBox');
        if (!panel || panel.dataset.bound === '1') return;
        panel.dataset.bound = '1';

        wireSearch();
        wireOnWaterCrewToggle();
        await loadCompetitors();
        renderSearchResults();

        global.addEventListener('altitudehd:urls', () => {
            loadCompetitors().then(() => {
                renderSearchResults();
            });
        });
        global.addEventListener('storage', (e) => {
            if (e.key === 'altitudeHdRegattaCode_v1') {
                loadCompetitors().then(() => renderSearchResults());
            }
        });
        global.addEventListener('kri-race-updated', () => {
            clearLaneAthletesCache();
            renderSearchResults();
        });
    }

    global.KriAthleteSearch = {
        init,
        loadCompetitors,
        refreshOnWater,
        searchOnWater,
        renderSearchResults,
        getBoatInfo,
        countOnWaterCompetitors,
        isCrewExpanded,
        toggleCrewExpanded,
        getOnWaterBoats: () => onWaterBoats,
        ON_WATER_FIX_MAX_MIN,
        STOP_SPEED_MPS,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
