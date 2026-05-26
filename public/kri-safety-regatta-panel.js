/**
 * KRI safety map — current race panel (daysheet + club logos).
 */
(function (global) {
    const LOGO_PLACEHOLDER = 'assets/school-logos/placeholder-white.svg';
    let lookup = null;
    let races = [];
    let results = new Map();
    let tickTimer = null;

    function board() {
        return global.AltitudeHdRegattaBoard;
    }

    function escapeHtml(value) {
        if (value == null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parseClubCode(raw) {
        const m = String(raw || '')
            .trim()
            .match(/^([A-Za-z]+)(?:\s+(\d+))?$/);
        if (!m) return { id: '', crewNum: '' };
        return { id: m[1].toLowerCase(), crewNum: m[2] || '' };
    }

    function clubInfo(clubId) {
        if (!clubId || !lookup?.clubs) {
            return { name: clubId ? clubId.toUpperCase() : '—', logoUrl: null };
        }
        const c = lookup.clubs[clubId];
        if (!c) return { name: clubId.toUpperCase(), logoUrl: null };
        const logoUrl = c.logo
            ? `assets/school-logos/${encodeURIComponent(c.logo)}`
            : null;
        return { name: c.name || clubId.toUpperCase(), logoUrl };
    }

    function lookupToken(map, token) {
        if (!map || !token) return token;
        if (map[token]) return map[token];
        const lower = token.toLowerCase();
        for (const [k, v] of Object.entries(map)) {
            if (k.toLowerCase() === lower) return v;
        }
        return token;
    }

    function expandEventName(eventType) {
        if (!lookup || !eventType) return eventType;
        const parts = eventType.trim().split(/\s+/);
        if (parts.length < 3) return eventType;
        const g = lookupToken(lookup.gender, parts[0]);
        const c = lookupToken(lookup.class, parts[1]);
        const b = lookupToken(lookup.boat, parts[2]);
        return `${g} ${c} ${b}`;
    }

    async function loadLookup() {
        if (lookup) return lookup;
        const res = await fetch('data/ahd-lookup.json');
        if (!res.ok) throw new Error('Club lookup not available');
        lookup = await res.json();
        return lookup;
    }

    function setStatus(text) {
        const el = document.getElementById('kriRacePanelStatus');
        if (el) el.textContent = text || '';
    }

    function renderLaneDraw(lanes) {
        const grid = document.createElement('div');
        grid.className = 'kri-lane-grid';
        grid.setAttribute('aria-label', 'Lane draw');

        for (const { lane, crew } of lanes) {
            const chip = document.createElement('div');
            chip.className = crew ? 'kri-lane' : 'kri-lane kri-lane--empty';

            const num = document.createElement('span');
            num.className = 'kri-lane-n';
            num.textContent = String(lane);
            chip.appendChild(num);

            const club = parseClubCode(crew);
            const info = clubInfo(club.id);

            if (info.logoUrl) {
                const img = document.createElement('img');
                img.className = 'kri-lane-logo';
                img.src = info.logoUrl;
                img.alt = '';
                img.loading = 'lazy';
                chip.appendChild(img);
            } else {
                const ph = document.createElement('img');
                ph.className = 'kri-lane-logo kri-lane-logo--placeholder';
                ph.src = LOGO_PLACEHOLDER;
                ph.alt = '';
                chip.appendChild(ph);
            }

            const text = document.createElement('div');
            text.className = 'kri-lane-text';

            const clubEl = document.createElement('span');
            clubEl.className = 'kri-lane-club';
            clubEl.textContent = crew ? info.name : '—';
            text.appendChild(clubEl);

            if (crew && club.crewNum) {
                const crewEl = document.createElement('span');
                crewEl.className = 'kri-lane-code';
                crewEl.textContent = crew;
                text.appendChild(crewEl);
            }

            chip.appendChild(text);
            grid.appendChild(chip);
        }

        return grid;
    }

    function renderCurrentRace(race, result) {
        const body = document.getElementById('kriRacePanelBody');
        if (!body) return;
        body.replaceChildren();

        const card = document.createElement('article');
        card.className = 'kri-race-card';

        const head = document.createElement('div');
        head.className = 'kri-race-card-head';

        const time = document.createElement('span');
        time.className = 'kri-race-time';
        time.textContent = board().formatRaceTime(race.startAt);

        const title = document.createElement('h3');
        title.className = 'kri-race-title';
        title.textContent = `Race ${race.race} · Event ${race.eventNum}`;

        const event = document.createElement('p');
        event.className = 'kri-race-event';
        event.textContent = expandEventName(race.eventName);

        const meta = document.createElement('p');
        meta.className = 'kri-race-meta';
        meta.textContent = race.division
            ? `${race.round} · Div ${race.division}`
            : race.round;

        head.appendChild(time);
        head.appendChild(title);
        head.appendChild(event);
        head.appendChild(meta);

        if (result?.status) {
            const badge = document.createElement('span');
            badge.className = 'kri-race-result-badge';
            badge.textContent = result.status;
            head.appendChild(badge);
        }

        card.appendChild(head);

        if (race.lanes?.length) {
            card.appendChild(renderLaneDraw(race.lanes));
        } else {
            const empty = document.createElement('p');
            empty.className = 'kri-race-empty-lanes';
            empty.textContent = 'No lane draw for this race yet.';
            card.appendChild(empty);
        }

        body.appendChild(card);
    }

    function renderPanel() {
        const body = document.getElementById('kriRacePanelBody');
        if (!body || !board()) return;

        const settings = board().loadClockSettings();
        const effectiveNow = board().getEffectiveNow(settings);
        const dayRaces = board().racesOnDate(races, effectiveNow);
        const { currentIndex } = board().findRaceWindow(dayRaces, effectiveNow);
        const race = currentIndex >= 0 ? dayRaces[currentIndex] : null;

        if (!races.length) {
            body.replaceChildren();
            setStatus('Load the daysheet on the hub (Regatta schedule) to show the current race here.');
            return;
        }

        if (!dayRaces.length) {
            body.replaceChildren();
            setStatus(`No races on ${board().formatYmd(effectiveNow)} for this regatta.`);
            return;
        }

        if (!race) {
            body.replaceChildren();
            setStatus(`Before first race · ${board().formatClock(effectiveNow)}`);
            return;
        }

        const result = results.get(race.raceNum) || null;
        const code =
            global.AltitudeHdHub?.getRegattaCode?.() ||
            global.AltitudeHdHub?.loadRegattaCode?.() ||
            '';
        setStatus(
            `${board().formatClock(effectiveNow)}${code ? ` · ${code.toUpperCase()}` : ''} · Current race`,
        );
        renderCurrentRace(race, result);
    }

    async function reloadSchedule() {
        const rb = board();
        if (!rb) return;
        setStatus('Loading schedule…');
        try {
            await loadLookup();
            const [daysheetText, resultsText] = await Promise.all([
                rb.fetchCsvText(rb.getCsvUrl('daysheet')),
                rb.fetchCsvText(rb.getCsvUrl('results')).catch(() => ''),
            ]);
            races = rb.parseDaysheetCsv(daysheetText);
            results = resultsText ? rb.parseResultsCsv(resultsText) : new Map();
        } catch (err) {
            races = [];
            results = new Map();
            const body = document.getElementById('kriRacePanelBody');
            if (body) body.replaceChildren();
            setStatus(err.message || 'Could not load daysheet.');
            return;
        }
        renderPanel();
    }

    function setupTimers() {
        if (tickTimer) clearInterval(tickTimer);
        tickTimer = setInterval(() => {
            const settings = board()?.loadClockSettings?.();
            if (settings?.mode === 'live') renderPanel();
        }, 30_000);
    }

    function init() {
        const panel = document.getElementById('kriRacePanel');
        if (!panel || panel.dataset.bound === '1') return;
        panel.dataset.bound = '1';

        setupTimers();
        reloadSchedule();

        global.addEventListener('altitudehd:urls', () => reloadSchedule());
        global.addEventListener('storage', (e) => {
            if (e.key === 'altitudeHdClock_v1' || e.key === 'altitudeHdRegattaCode_v1') {
                reloadSchedule();
            }
        });
    }

    global.KriSafetyRegattaPanel = { init, reloadSchedule, renderPanel };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
