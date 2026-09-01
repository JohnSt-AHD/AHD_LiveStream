/**
 * Karāpiro / Ged overlay renderers — RowIT data, Ged layouts.
 * Loaded after vmix-graphics.js on vmix-karapiro.html only.
 */
(function () {
    const SUIT_PATH =
        'M16 6 L30 6 C30 20 50 20 50 6 L64 6 C64 28 68 36 68 52 L68 90 Q40 100 12 90 L12 52 C12 36 16 28 16 6 Z';
    const COLOR_POOL = [
        ['#8a1f2d', '#f2c94c'],
        ['#12325e', '#7fb6f0'],
        ['#1d6b45', '#f5f0e4'],
        ['#1b1f26', '#e5484d'],
        ['#5b2d86', '#f5f0e4'],
        ['#b8452c', '#f5e8c8'],
        ['#0f5d6b', '#f2c94c'],
        ['#c9a227', '#12325e'],
        ['#20365c', '#c9a227'],
        ['#7a1f4d', '#8fd0ff'],
        ['#2b2b2b', '#f2c94c'],
        ['#245c8f', '#e5484d'],
    ];
    const FIRST_NAMES = [
        'Tom', 'Sam', 'Jack', 'Liam', 'Ollie', 'Finn', 'George', 'Harry', 'Ben', 'Max',
        'Kahu', 'Nikau', 'Josh', 'Luke', 'Ella', 'Sophie', 'Grace', 'Ruby', 'Amelia', 'Zoe',
        'Aroha', 'Maia', 'Isla', 'Charlotte', 'Hannah', 'Lucy',
    ];
    const LAST_NAMES = [
        'Walker', 'Thompson', 'Kirk', 'Ngata', 'Harris', 'Bennett', 'Clarke', 'Murray',
        'Parata', 'Wilson', "MacDonald", "O'Brien", 'Stewart', 'Rangi', 'Hughes', 'Campbell',
        'Drysdale', 'Twigg', 'Bond', 'Sullivan', 'Mackintosh', 'Henare',
    ];
    const OWN = {
        title: 1, lower: 1, draw: 1, results: 1, schedule: 1, leader: 1,
        drill: 1, suits: 1, suitstrip: 1, lowersuits: 1, brand: 1,
        next: 1, prev: 1, tracker: 1, speed: 1, speedchart: 1,
        livetracking: 1, livetrack: 1, weather: 1,
        cvleader: 1, cvdraw: 1, coursescroll: 1, course: 1,
    };
    const CANON = {
        speed: 'speedchart',
        livetrack: 'livetracking',
        course: 'coursescroll',
    };
    const GED_KEYS = {
        '1': 'title', '2': 'lower', '3': 'draw', '4': 'results', '5': 'leader',
        '6': 'cvleader', '7': 'cvdraw', '8': 'coursescroll', '9': 'schedule',
        '0': 'tracker', q: 'speedchart', w: 'livetracking', e: 'weather',
        s: 'suits', a: 'suitstrip', f: 'lowersuits', b: 'brand',
    };
    const LAYER_CLASS = {
        title: 'vg-layer--title',
        lower: 'vg-layer--lower',
        draw: 'vg-layer--draw',
        results: 'vg-layer--results',
        schedule: 'vg-layer--schedule',
        leader: 'vg-layer--leader',
        drill: 'vg-layer--drill',
        suits: 'vg-layer--suits',
        suitstrip: 'vg-layer--suitstrip',
        lowersuits: 'vg-layer--lowersuits',
        brand: 'vg-layer--brand',
        next: 'vg-layer--next',
        prev: 'vg-layer--prev',
        tracker: 'vg-layer--tracker',
        speedchart: 'vg-layer--speedchart',
        livetracking: 'vg-layer--livetracking',
        weather: 'vg-layer--weather',
        cvleader: 'vg-layer--cvleader',
        cvdraw: 'vg-layer--cvdraw',
        coursescroll: 'vg-layer--coursescroll',
    };
    const OPS = [
        ['1', 'Title', 'title'],
        ['2', 'Lower 3rd', 'lower'],
        ['D', 'Drill-down', 'drill'],
        ['S', 'Rowsuits', 'suits'],
        ['A', 'Suit strip', 'suitstrip'],
        ['F', 'L3 + suits', 'lowersuits'],
        ['3', 'Draw', 'draw'],
        ['4', 'Results', 'results'],
        ['5', 'Leader', 'leader'],
        ['6', 'CV leader', 'cvleader'],
        ['7', 'CV draw', 'cvdraw'],
        ['8', 'Course', 'coursescroll'],
        ['9', 'Schedule', 'schedule'],
        ['0', 'Tracker', 'tracker'],
        ['Q', 'Speed', 'speedchart'],
        ['W', 'Live track', 'livetracking'],
        ['E', 'Weather', 'weather'],
        ['N', 'Next', 'next'],
        ['P', 'Prev', 'prev'],
        ['B', 'Brand', 'brand'],
    ];

    const state = {
        t: 0,
        drillLane: null,
        brand: false,
        ctrlOpen: true,
        motionTimer: null,
        stringTimer: null,
        stringTok: 0,
        dHeld: false,
        dCombo: false,
        flakes: [],
    };

    function el(tag, className, text) {
        return vgEl(tag, className, text);
    }

    function canon(g) {
        return CANON[g] || g;
    }

    function festive() {
        return vgKpFestive();
    }

    function bar(extra) {
        const b = el('div', `kp-bar${festive() ? ' kp-bar--festive' : ''}${extra ? ` ${extra}` : ''}`);
        return b;
    }

    function liveBadge() {
        const s = el('span', 'kp-live');
        s.appendChild(el('span', 'kp-live-dot'));
        s.appendChild(document.createTextNode('Live'));
        return s;
    }

    function chip(text, extra) {
        return el('span', extra ? `kp-chip ${extra}` : 'kp-chip', text);
    }

    function hashHue(id) {
        let h = 0;
        const s = String(id || '');
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return COLOR_POOL[h % COLOR_POOL.length];
    }

    function laneEntries(race) {
        return (race?.lanes || []).filter((l) => l.code);
    }

    function clubOf(code) {
        const parsed = vgParseClubCode(code);
        const info = vgClubInfo(parsed.id, vgState.lookup);
        const abbr = vgKpAbbr(code);
        const [c1, c2] = hashHue(parsed.id || abbr);
        return { ...info, abbr, c1, c2, id: parsed.id };
    }

    function crewLogo(club, extraClass) {
        const cls = extraClass ? `kp-crew-logo ${extraClass}` : 'kp-crew-logo';
        if (club?.logoUrl) {
            const img = document.createElement('img');
            img.className = cls;
            img.src = club.logoUrl;
            img.alt = club.name || '';
            return img;
        }
        return el('span', `${cls} kp-crew-logo--empty`);
    }

    function logoSvg(size, opacity, hat) {
        const wrap = el('div', 'kp-logo');
        const h = Math.round(size * 1.26);
        wrap.innerHTML =
            `<svg viewBox="0 0 100 126" width="${size}" height="${h}" aria-hidden="true" style="opacity:${opacity ?? 1}">` +
            ['#4a97ee', '#2e7de0', '#1b5cb4', '#12325e']
                .map((c, r) => {
                    const y = r * 26;
                    return (
                        `<path d="M2 ${4 + y} L38 ${40 + y} L74 ${4 + y}" stroke="${c}" stroke-width="9" fill="none"/>` +
                        `<path d="M26 ${4 + y} L62 ${40 + y} L98 ${4 + y}" stroke="${c}" stroke-width="9" fill="none"/>`
                    );
                })
                .join('') +
            '</svg>';
        if (hat) {
            const hatEl = document.createElement('div');
            hatEl.innerHTML =
                `<svg class="kp-hat" viewBox="0 0 60 42" width="${size * 0.56}" height="${size * 0.39}" ` +
                `style="top:${-size * 0.17}px;left:${size * 0.52}px;transform:rotate(14deg)">` +
                `<path d="M8 32 C14 12 30 5 48 9 L44 30 Z" fill="#e5484d"/>` +
                `<circle cx="50" cy="8" r="6" fill="#f5f0e4"/>` +
                `<rect x="4" y="29" width="44" height="9" rx="4.5" fill="#f5f0e4"/>` +
                `</svg>`;
            wrap.appendChild(hatEl.firstChild);
        }
        return wrap;
    }

    function makeSuit(c1, c2, size, key) {
        const id = `suitclip-${key}`;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 80 100');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(Math.round(size * 1.25)));
        svg.style.display = 'block';
        svg.innerHTML =
            `<defs><clipPath id="${id}"><path d="${SUIT_PATH}"/></clipPath></defs>` +
            `<path d="${SUIT_PATH}" fill="${c1}"/>` +
            `<g clip-path="url(#${id})">` +
            `<path d="M12 30 L68 62 L68 76 L12 44 Z" fill="${c2}"/>` +
            `<path d="M12 84 L68 84 L68 100 L12 100 Z" fill="${c2}" opacity="0.35"/>` +
            `</g>` +
            `<path d="${SUIT_PATH}" fill="none" stroke="rgba(13,17,23,0.55)" stroke-width="2"/>`;
        return svg;
    }

    function sponsorBits(size) {
        const src = vgKriRandomSponsorUrl();
        return { src, name: src ? 'Race sponsor' : 'Karāpiro Rowing' };
    }

    function appendSponsor(parent, className, imgClass) {
        const box = el('div', className);
        const copy = el('div', 'kp-lower-sponsor-copy');
        copy.appendChild(el('span', 'kp-sponsor-label', 'Race sponsor'));
        const bits = sponsorBits();
        copy.appendChild(el('span', 'kp-sponsor-name', bits.name));
        box.appendChild(copy);
        if (bits.src) {
            const img = document.createElement('img');
            img.src = bits.src;
            img.alt = '';
            box.appendChild(img);
        }
        parent.appendChild(box);
        return box;
    }

    function eventName(race) {
        return vgExpandEventName(race?.eventType, vgState.lookup) || race?.eventType || '';
    }

    function dayLabel(race) {
        const r = race || vgState.races[0];
        return r ? vgFormatDayLabel(r.dayLabel) : '';
    }

    function lowerSub(race) {
        const parts = [
            vgFormatRoundLabel(race.round, race.division),
            vgFormatScheduleTime(race.startAt),
            race.progression,
        ].filter(Boolean);
        return parts.join(' · ') || 'Lake Karāpiro · 2000m';
    }

    function boatClass(race) {
        const ev = `${race?.eventType || ''} ${eventName(race)}`;
        if (/eight|octuple|8\+|8x/i.test(ev)) return { n: 8, cox: true };
        if (/quad|4x/i.test(ev)) return { n: 4, cox: /4x\+|cox/i.test(ev) };
        if (/four|4\+|4-/i.test(ev)) return { n: 4, cox: /4\+|cox/i.test(ev) };
        if (/pair|double|2x|2-/i.test(ev)) return { n: 2, cox: false };
        if (/single|1x/i.test(ev)) return { n: 1, cox: false };
        return { n: 8, cox: true };
    }

    function seatLabels(n) {
        if (n === 8) return ['BOW', 'SEAT 2', 'SEAT 3', 'SEAT 4', 'SEAT 5', 'SEAT 6', 'SEAT 7', 'STROKE'];
        if (n === 4) return ['BOW', 'SEAT 2', 'SEAT 3', 'STROKE'];
        if (n === 2) return ['BOW', 'STROKE'];
        return ['1'];
    }

    function splitNames(raw) {
        return String(raw || '')
            .split(/\s*(?:,|;|\/|\n| {2,})\s*/)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    function fakeName(raceNo, lane, i) {
        const f = FIRST_NAMES[(raceNo * 7 + lane * 11 + i * 5) % FIRST_NAMES.length];
        const l = LAST_NAMES[(raceNo * 13 + lane * 3 + i * 7) % LAST_NAMES.length];
        return `${f} ${l}`;
    }

    function crewFor(race, laneNum) {
        const lanes = laneEntries(race);
        const lane = lanes.find((l) => l.lane === laneNum) || lanes[0];
        if (!lane) return { club: '—', seats: [] };
        const club = clubOf(lane.code);
        const { n, cox } = boatClass(race);
        const labels = seatLabels(n);
        const parsed = splitNames(vgCompetitorNames(race, lane));
        const seats = labels.map((seat, i) => ({
            seat,
            name: parsed[i] || fakeName(race.raceNum || 0, laneNum, i),
        }));
        if (cox) {
            seats.push({
                seat: 'COX',
                name: parsed[labels.length] || fakeName(race.raceNum || 0, laneNum, 17),
            });
        }
        return { club: club.name, logoUrl: club.logoUrl, seats, lane: lane.lane };
    }

    function resultRows(race) {
        const result = vgState.results.get(race.raceNum);
        if (result?.placings?.length) {
            const first = result.placings[0];
            return result.placings.map((p, i) => {
                const club = clubOf(p.competitor);
                const lane = laneEntries(race).find((l) => {
                    const a = vgParseClubCode(l.code);
                    const b = vgParseClubCode(p.competitor);
                    return a.id && a.id === b.id;
                });
                return {
                    rank: p.place || i + 1,
                    lane: lane?.lane || '',
                    club: club.name,
                    logoUrl: club.logoUrl,
                    abbr: club.abbr,
                    time: p.time || '',
                    margin: i === 0 ? '' : '',
                    first: i === 0,
                };
            });
        }
        return laneEntries(race).map((l, i) => {
            const club = clubOf(l.code);
            return {
                rank: i + 1,
                lane: l.lane,
                club: club.name,
                logoUrl: club.logoUrl,
                abbr: club.abbr,
                time: '',
                margin: '',
                first: i === 0,
            };
        });
    }

    function neighbour(delta) {
        const races = vgState.races;
        if (!races.length) return null;
        const cur = vgFindRace(vgGetRaceParam()) || races[0];
        const idx = races.findIndex((r) => r.race === cur.race);
        const i = idx < 0 ? 0 : idx;
        return races[(i + delta + races.length) % races.length];
    }

    function fmtClock(s) {
        const m = Math.floor(s / 60);
        return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
    }

    function boatsNow(race) {
        const lanes = laneEntries(race);
        const tt = state.t % 450;
        return lanes.map((l, i) => {
            const off = (((i * 7) % 13) - 6) * 1.1;
            const dur = 372 + off;
            const m = Math.max(0, Math.min(2000, 2000 * Math.min(1, tt / dur) + 6 * Math.sin(tt / 9 + i * 2.1)));
            const club = clubOf(l.code);
            return { ...club, lane: l.lane, m, dur };
        });
    }

    function leadOf(race) {
        const boats = boatsNow(race).sort((a, b) => b.m - a.m);
        return { lead: boats[0], second: boats[1], boats };
    }

    function renderTitle(layer, race) {
        const root = el('div', 'kp-title');
        const card = el('div', 'kp-title-card');
        card.appendChild(bar('kp-bar--lg'));
        const inner = el('div', 'kp-title-inner');
        inner.appendChild(logoSvg(130, 1, festive()));
        inner.appendChild(el('div', 'kp-title-kicker', 'Karāpiro Rowing'));
        inner.appendChild(
            el('h1', 'kp-title-word', festive() ? 'Christmas Regatta' : 'Lake Karāpiro'),
        );
        const meta = el('div', 'kp-title-meta');
        const bits = ['Lake Karāpiro', dayLabel(race), '2000m'].filter(Boolean);
        bits.forEach((b, i) => {
            if (i) meta.appendChild(el('span', 'kp-dot', '·'));
            meta.appendChild(el('span', '', b));
        });
        inner.appendChild(meta);
        const live = el('div', 'kp-title-live-row');
        live.appendChild(liveBadge());
        live.appendChild(
            el(
                'span',
                'kp-title-live-copy',
                festive() ? 'Merry Christmas from Lake Karāpiro' : 'Live from Lake Karāpiro',
            ),
        );
        inner.appendChild(live);
        card.appendChild(inner);
        card.appendChild(bar('kp-bar--lg'));
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderLowerInner(race) {
        const wrap = el('div', 'kp-lower-card');
        wrap.appendChild(bar('kp-bar--sm'));
        const body = el('div', 'kp-lower-body');
        body.appendChild(el('div', 'kp-chip kp-chip--lg', vgKpRaceChip(race)));
        const copy = el('div', 'kp-lower-copy');
        const ev = el('h2', 'kp-lower-event', eventName(race));
        ev.dataset.vgLayout = 'lower-event';
        copy.appendChild(ev);
        copy.appendChild(el('p', 'kp-lower-sub', lowerSub(race)));
        body.appendChild(copy);
        appendSponsor(body, 'kp-lower-sponsor');
        wrap.appendChild(body);
        return wrap;
    }

    function renderLower(layer, race) {
        const root = el('div', 'kp-lower');
        root.dataset.vgLayout = 'lower';
        root.appendChild(renderLowerInner(race));
        layer.appendChild(root);
    }

    function renderBoardHead(board, race, metaText) {
        const head = el('div', 'kp-board-head');
        head.appendChild(chip(vgKpRaceChip(race)));
        head.appendChild(el('span', 'kp-board-title', eventName(race)));
        head.appendChild(el('span', 'kp-board-meta', metaText));
        board.appendChild(head);
        return head;
    }

    function renderDraw(layer, race) {
        const wrap = el('div', 'kp-board-wrap kp-board-wrap--draw');
        const board = el('div', 'kp-board');
        renderBoardHead(board, race, `Draw · ${vgFormatScheduleTime(race.startAt)}`);
        const rows = el('div', 'kp-rows');
        laneEntries(race).forEach((lane, i) => {
            const club = clubOf(lane.code);
            const row = el('div', 'kp-row');
            row.style.animationDelay = `${0.25 + i * 0.14}s`;
            row.appendChild(el('span', 'kp-lane', String(lane.lane)));
            row.appendChild(crewLogo(club));
            const name = el('span', 'kp-row-club', club.name);
            name.dataset.vgLayoutTarget = 'draw-crew';
            row.appendChild(name);
            row.appendChild(el('span', 'kp-row-abbr', club.abbr));
            rows.appendChild(row);
        });
        board.appendChild(rows);
        const foot = el('div', 'kp-board-foot');
        const n = laneEntries(race).length;
        foot.appendChild(el('span', '', `Lake Karāpiro · 2000m${n ? ` · ${n} lanes` : ''}`));
        appendSponsor(foot, 'kp-board-sponsor');
        board.appendChild(foot);
        wrap.appendChild(board);
        layer.appendChild(wrap);
    }

    function renderResults(layer, race) {
        const wrap = el('div', 'kp-board-wrap kp-board-wrap--results');
        const board = el('div', 'kp-board');
        const result = vgState.results.get(race.raceNum);
        renderBoardHead(board, race, result?.status ? `Result · ${result.status}` : 'Result · Official');
        const rows = el('div', 'kp-rows');
        const list = resultRows(race);
        if (!list.length) {
            rows.appendChild(el('div', 'kp-row kp-empty', 'Results not available'));
        } else {
            list.forEach((p, i) => {
                const row = el('div', `kp-row kp-row--results${p.first ? ' kp-row--first' : ''}`);
                row.style.animationDelay = `${0.25 + i * 0.14}s`;
                row.appendChild(el('span', `kp-lane${p.first ? '' : ' kp-lane--rest'}`, String(p.rank)));
                row.appendChild(el('span', 'kp-row-llane', p.lane ? `L${p.lane}` : ''));
                row.appendChild(crewLogo(p));
                const name = el('span', 'kp-row-club', p.club);
                name.dataset.vgLayoutTarget = 'results-crew';
                row.appendChild(name);
                row.appendChild(el('span', 'kp-row-time', p.time));
                row.appendChild(el('span', 'kp-row-margin', p.margin));
                rows.appendChild(row);
            });
        }
        board.appendChild(rows);
        wrap.appendChild(board);
        layer.appendChild(wrap);
    }

    function renderSchedule(layer, raceParam) {
        const wrap = el('div', 'kp-board-wrap kp-board-wrap--schedule');
        const board = el('div', 'kp-board');
        const head = el('div', 'kp-board-head');
        head.appendChild(el('span', 'kp-board-title', 'Race schedule'));
        const day = dayLabel(vgFindRace(raceParam) || vgState.races[0]);
        head.appendChild(el('span', 'kp-board-meta', day ? `${day} · Lake Karāpiro` : 'Lake Karāpiro'));
        board.appendChild(head);
        const { current, upcoming } = vgGetUpcomingRaces(raceParam, 10);
        const rows = el('div', 'kp-rows');
        const all = upcoming.length ? upcoming : vgState.races.slice(0, 10);
        if (!all.length) {
            rows.appendChild(el('div', 'kp-row kp-empty', 'No races on daysheet'));
        } else {
            const curIdx = current ? all.findIndex((r) => r.race === current.race) : 0;
            all.forEach((row, i) => {
                const li = el('div', 'kp-row kp-row--schedule');
                li.style.animationDelay = `${0.2 + i * 0.1}s`;
                let chipText = '';
                let chipClass = 'kp-sched-chip';
                if (current && row.race === current.race) {
                    li.classList.add('kp-row--current');
                    chipText = 'On water';
                    chipClass += ' kp-sched-chip--now';
                } else if (curIdx >= 0 && i === curIdx + 1) {
                    chipText = 'Up next';
                    chipClass += ' kp-sched-chip--next';
                } else if (curIdx >= 0 && i < curIdx) {
                    li.classList.add('kp-row--raced');
                    chipText = 'Raced';
                    chipClass += ' kp-sched-chip--raced';
                }
                li.appendChild(el('span', 'kp-sched-time', vgFormatScheduleTime(row.startAt)));
                li.appendChild(el('span', 'kp-sched-race', vgKpRaceChip(row)));
                li.appendChild(el('span', 'kp-sched-event', eventName(row)));
                li.appendChild(el('span', chipClass, chipText));
                rows.appendChild(li);
            });
        }
        board.appendChild(rows);
        wrap.appendChild(board);
        layer.appendChild(wrap);
    }

    function renderLeader(layer, race, laneNum) {
        const { lead, second } = leadOf(race);
        let club = lead;
        let lane = lead?.lane;
        if (laneNum) {
            const entry = vgFindDrawLane(race, laneNum);
            if (entry) {
                club = { ...clubOf(entry.code), lane: laneNum, m: lead?.m || 0 };
                lane = laneNum;
            }
        }
        if (!club) return;
        const root = el('div', 'kp-bug');
        root.dataset.vgLayout = 'leader-wrap';
        const card = el('div', 'kp-bug-card');
        card.appendChild(bar('kp-bar--sm'));
        const body = el('div', 'kp-bug-body');
        body.appendChild(liveBadge());
        body.appendChild(chip('Leader'));
        body.appendChild(crewLogo(club, 'kp-crew-logo--bug'));
        const name = el('span', 'kp-bug-name vg-leader-crew', club.name);
        name.dataset.vgLayout = 'leader-crew';
        body.appendChild(name);
        body.appendChild(el('span', 'kp-bug-lane', `Lane ${lane}`));
        body.appendChild(el('span', 'kp-bug-rule'));
        const dist = Math.round((club.m || 0) / 10) * 10;
        body.appendChild(el('span', 'kp-bug-dist', `${dist}m`));
        if (second && lead) {
            const gap = ((lead.m - second.m) / 5.35).toFixed(1);
            body.appendChild(el('span', 'kp-bug-gap', `+${gap}s`));
        }
        card.appendChild(body);
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderNext(layer) {
        const nxt = neighbour(1);
        if (!nxt) return;
        const root = el('div', 'kp-bug');
        const card = el('div', 'kp-bug-card');
        card.appendChild(bar('kp-bar--sm'));
        const body = el('div', 'kp-bug-body');
        body.appendChild(chip('Next race'));
        body.appendChild(el('span', 'kp-bug-no', vgKpRaceChip(nxt)));
        body.appendChild(el('span', 'kp-bug-name', eventName(nxt)));
        body.appendChild(el('span', 'kp-bug-rule'));
        body.appendChild(el('span', 'kp-bug-time', vgFormatScheduleTime(nxt.startAt)));
        card.appendChild(body);
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderPrev(layer) {
        const prv = neighbour(-1);
        if (!prv) return;
        const rows = resultRows(prv);
        const win = rows[0];
        const root = el('div', 'kp-bug');
        const card = el('div', 'kp-bug-card');
        card.appendChild(bar('kp-bar--sm'));
        const body = el('div', 'kp-bug-body');
        body.appendChild(chip('Previous race', 'kp-bug-chip--prev'));
        body.appendChild(el('span', 'kp-bug-no', vgKpRaceChip(prv)));
        body.appendChild(el('span', 'kp-bug-name', eventName(prv)));
        body.appendChild(el('span', 'kp-bug-rule'));
        const res = win?.time ? `1st ${win.club} · ${win.time}` : win ? `1st ${win.club}` : 'Awaiting result';
        body.appendChild(el('span', 'kp-bug-result', res));
        card.appendChild(body);
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderDrill(layer, race) {
        const { lead } = leadOf(race);
        const lane = state.drillLane || lead?.lane || laneEntries(race)[0]?.lane || 1;
        const crew = crewFor(race, lane);
        const root = el('div', 'kp-drill');
        const card = el('div', 'kp-drill-card');
        card.appendChild(bar('kp-bar--sm'));
        const body = el('div', 'kp-drill-body');
        const head = el('div', 'kp-drill-head');
        head.appendChild(chip('Crew'));
        head.appendChild(crewLogo(crew, 'kp-crew-logo--bug'));
        head.appendChild(el('span', 'kp-drill-club', crew.club));
        head.appendChild(el('span', 'kp-drill-lane', `Lane ${crew.lane}`));
        body.appendChild(head);
        const seats = el('div', 'kp-seats');
        crew.seats.forEach((s, i) => {
            const cell = el('div', 'kp-seat');
            cell.style.animationDelay = `${0.1 + i * 0.06}s`;
            cell.appendChild(el('span', 'kp-seat-lab', s.seat));
            cell.appendChild(el('span', 'kp-seat-name', s.name));
            seats.appendChild(cell);
        });
        body.appendChild(seats);
        card.appendChild(body);
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderSuits(layer, race) {
        const wrap = el('div', 'kp-board-wrap kp-board-wrap--suits');
        const board = el('div', 'kp-board');
        const n = laneEntries(race).length;
        renderBoardHead(board, race, n ? `Lanes 1–${n}` : 'Lanes');
        const grid = el('div', 'kp-suits-grid');
        if (n && n !== 8) grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
        laneEntries(race).forEach((lane, i) => {
            const club = clubOf(lane.code);
            const card = el('div', 'kp-suit-card');
            card.style.animationDelay = `${0.08 + i * 0.06}s`;
            card.appendChild(makeSuit(club.c1, club.c2, 96, `l${i}`));
            card.appendChild(el('span', 'kp-suit-lane', `Lane ${lane.lane}`));
            card.appendChild(crewLogo(club, 'kp-crew-logo--suit'));
            card.appendChild(el('span', 'kp-suit-club', club.name));
            grid.appendChild(card);
        });
        board.appendChild(grid);
        wrap.appendChild(board);
        layer.appendChild(wrap);
    }

    function suitStripBody(race, size) {
        const body = el('div', 'kp-suitstrip-body');
        laneEntries(race).forEach((lane, i) => {
            const club = clubOf(lane.code);
            const cell = el('div', 'kp-suit-cell');
            cell.style.animationDelay = `${0.1 + i * 0.05}s`;
            cell.appendChild(makeSuit(club.c1, club.c2, size, `sm${size}-${i}`));
            cell.appendChild(crewLogo(club, 'kp-crew-logo--strip'));
            cell.appendChild(el('span', 'kp-suit-lane', `Lane ${lane.lane}`));
            cell.appendChild(el('span', 'kp-suit-abbr', club.abbr));
            body.appendChild(cell);
        });
        return body;
    }

    function renderSuitStrip(layer, race) {
        const root = el('div', 'kp-suitstrip');
        const card = el('div', 'kp-suitstrip-card');
        card.appendChild(bar('kp-bar--sm'));
        card.appendChild(suitStripBody(race, 44));
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderLowerSuits(layer, race) {
        const root = el('div', 'kp-lowersuits');
        const card = el('div', 'kp-lower-card');
        card.appendChild(bar());
        const body = el('div', 'kp-lower-body');
        body.appendChild(el('div', 'kp-chip kp-chip--lg', vgKpRaceChip(race)));
        const copy = el('div', 'kp-lower-copy');
        copy.appendChild(el('h2', 'kp-lower-event', eventName(race)));
        copy.appendChild(el('p', 'kp-lower-sub', lowerSub(race)));
        body.appendChild(copy);
        card.appendChild(body);
        card.appendChild(suitStripBody(race, 34));
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderBrand(layer) {
        const root = el('div', 'kp-brand');
        const row = el('div', 'kp-brand-row');
        row.appendChild(logoSvg(40));
        const copy = el('div', '');
        copy.appendChild(el('div', 'kp-brand-title', 'Karāpiro Rowing'));
        copy.appendChild(
            el('div', 'kp-brand-sub', festive() ? 'Christmas Regatta' : 'Lake Karāpiro'),
        );
        row.appendChild(copy);
        root.appendChild(row);
        const sp = el('div', 'kp-brand-sponsor');
        const bits = sponsorBits();
        if (bits.src) {
            const img = document.createElement('img');
            img.src = bits.src;
            img.alt = '';
            sp.appendChild(img);
        }
        const sc = el('div', 'kp-lower-sponsor-copy');
        sc.style.alignItems = 'flex-start';
        sc.appendChild(el('span', 'kp-sponsor-label', 'Race sponsor'));
        sc.appendChild(el('span', 'kp-sponsor-name', bits.name));
        sp.appendChild(sc);
        root.appendChild(sp);
        layer.appendChild(root);
    }

    function renderCvLeader(layer, race) {
        const { lead } = leadOf(race);
        const root = el('div', 'kp-cvleader');
        const card = el('div', 'kp-cvleader-card');
        card.appendChild(el('span', 'kp-cvleader-lab', 'Leader'));
        if (lead) card.appendChild(crewLogo(lead, 'kp-crew-logo--bug'));
        card.appendChild(
            el('span', 'kp-cvleader-val vg-leader-crew', lead ? `L${lead.lane} ${lead.abbr}` : '—'),
        );
        root.appendChild(card);
        layer.appendChild(root);
    }

    function renderCvDraw(layer, race) {
        const root = el('div', 'kp-cvdraw');
        root.appendChild(el('div', 'kp-cvdraw-head', `Draw · ${vgKpRaceChip(race)}`));
        laneEntries(race).forEach((lane) => {
            const club = clubOf(lane.code);
            const row = el('div', 'kp-cvdraw-row');
            row.appendChild(el('span', 'kp-lane', String(lane.lane)));
            row.appendChild(crewLogo(club, 'kp-crew-logo--cv'));
            row.appendChild(el('span', 'kp-row-abbr', club.abbr));
            root.appendChild(row);
        });
        layer.appendChild(root);
    }

    function renderTracker(layer, race) {
        const boats = boatsNow(race);
        const root = el('div', 'kp-tracker');
        root.dataset.kpLive = 'tracker';
        const head = el('div', 'kp-tracker-head');
        head.appendChild(document.createTextNode(`Race tracker · ${vgKpRaceChip(race)} · ${eventName(race)}`));
        head.appendChild(el('span', 'kp-tracker-clock', fmtClock(Math.min(state.t % 450, 385))));
        root.appendChild(head);
        const marks = el('div', 'kp-track-marks');
        ['500M', '1000M', '1500M'].forEach((m) => marks.appendChild(el('span', '', m)));
        root.appendChild(marks);
        const leadM = Math.max(...boats.map((b) => b.m), 1);
        boats.forEach((b) => {
            const row = el('div', 'kp-track-row');
            row.appendChild(el('span', 'kp-lane', String(b.lane)));
            row.appendChild(crewLogo(b, 'kp-crew-logo--cv'));
            row.appendChild(el('span', 'kp-suit-abbr', b.abbr));
            const barWrap = el('div', 'kp-track-bar');
            const fill = el('div', b.m === leadM ? 'kp-track-fill kp-track-fill--lead' : 'kp-track-fill');
            fill.style.width = `${(b.m / 20).toFixed(1)}%`;
            barWrap.appendChild(fill);
            row.appendChild(barWrap);
            row.appendChild(el('span', 'kp-track-m', `${Math.round(b.m)}m`));
            root.appendChild(row);
        });
        layer.appendChild(root);
    }

    function renderSpeed(layer, race) {
        const { boats } = leadOf(race);
        const top = [...boats].sort((a, b) => b.m - a.m).slice(0, 4);
        const cols = ['#2e7de0', '#d9e7f8', '#8a96a5', festive() ? '#e5484d' : '#4e5a68'];
        const lines = top.map((b, k) => {
            const pts = [];
            for (let i = 0; i <= 36; i++) {
                const sp = 4.6 + 0.45 * Math.sin(i / 4.2 + k * 1.9) + 0.12 * Math.sin(i / 1.7 + k) - k * 0.09 + 0.35;
                const x = 52 + i * 14.1;
                const y = Math.max(30, Math.min(228, 228 - (sp - 4) * 90));
                pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
            }
            return { pts: pts.join(' '), col: cols[k], abbr: b.abbr };
        });
        const root = el('div', 'kp-speed');
        const head = el('div', 'kp-speed-head');
        head.appendChild(document.createTextNode('Boat speed · m/s'));
        root.appendChild(head);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 700 260');
        let grid = '';
        [
            [48, '6.0'],
            [138, '5.0'],
            [228, '4.0'],
        ].forEach(([y, lab]) => {
            grid += `<line x1="52" y1="${y}" x2="660" y2="${y}" stroke="rgba(245,240,228,0.12)" />`;
            grid += `<text x="12" y="${y + 4}" fill="#8a96a5" font-size="12" font-family="JetBrains Mono,monospace">${lab}</text>`;
        });
        [
            [52, '0'],
            [179, '500'],
            [306, '1000'],
            [433, '1500'],
            [560, '2000M'],
        ].forEach(([x, lab]) => {
            grid += `<text x="${x}" y="252" fill="#8a96a5" font-size="11" font-family="JetBrains Mono,monospace">${lab}</text>`;
        });
        const polylines = lines
            .map((l) => `<polyline fill="none" stroke="${l.col}" stroke-width="2.4" points="${l.pts}"/>`)
            .join('');
        svg.innerHTML = grid + polylines;
        root.appendChild(svg);
        const legend = el('div', 'kp-speed-legend');
        lines.forEach((l, i) => {
            const s = el('span', '', l.abbr);
            s.style.color = cols[i];
            legend.appendChild(s);
        });
        root.appendChild(legend);
        layer.appendChild(root);
    }

    function renderLiveTrack(layer, race) {
        const boats = boatsNow(race);
        const root = el('div', 'kp-livetrack');
        const head = el('div', 'kp-live-head');
        head.appendChild(liveBadge());
        head.appendChild(el('span', '', `${vgKpRaceChip(race)} · ${eventName(race)} — live tracking`));
        head.appendChild(el('span', 'kp-tracker-clock', fmtClock(Math.min(state.t % 450, 385))));
        root.appendChild(head);
        const course = el('div', 'kp-live-course');
        const grid = el('div', 'kp-live-grid');
        ['START', '500M', '1000M', '1500M', 'FINISH'].forEach((lab, i) => {
            const m = el('div', 'kp-live-mark');
            m.style.left = `${i * 25}%`;
            if (i === 4) m.style.background = festive() ? 'rgba(229,72,77,0.8)' : 'rgba(46,125,224,0.8)';
            m.appendChild(el('span', i === 4 ? 'kp-finish' : '', lab));
            grid.appendChild(m);
        });
        course.appendChild(grid);
        const leadM = Math.max(...boats.map((b) => b.m), 1);
        boats.forEach((b, i) => {
            const lab = el('span', 'kp-live-lab', `${b.lane}`);
            lab.style.top = `${28 + i * 22}px`;
            lab.style.color = b.m === leadM ? 'var(--alt-sky)' : 'var(--alt-grey-500)';
            course.appendChild(lab);
            const lane = el('div', 'kp-live-lane');
            lane.style.top = `${28 + i * 22}px`;
            lane.style.left = '48px';
            lane.style.right = '48px';
            const dot = el('div', b.m === leadM ? 'kp-live-dot-boat kp-live-dot-boat--lead' : 'kp-live-dot-boat');
            dot.style.left = `${(b.m / 20).toFixed(2)}%`;
            lane.appendChild(dot);
            const ab = el('span', 'kp-suit-abbr', b.abbr);
            ab.style.position = 'absolute';
            ab.style.right = '-44px';
            ab.style.top = '0';
            lane.appendChild(ab);
            course.appendChild(lane);
        });
        root.appendChild(course);
        layer.appendChild(root);
    }

    function renderCourse(layer) {
        const root = el('div', 'kp-course');
        const ghost = logoSvg(640, 0.06);
        ghost.classList.add('kp-course-ghost');
        root.appendChild(ghost);
        const head = el('div', 'kp-course-head');
        head.appendChild(logoSvg(58));
        const copy = el('div', '');
        copy.appendChild(el('div', 'kp-course-kicker', 'Karāpiro Rowing'));
        copy.appendChild(
            el('div', 'kp-course-sub', festive() ? 'Christmas Regatta' : 'Lake Karāpiro'),
        );
        copy.appendChild(el('div', 'kp-course-sub', 'Lake Karāpiro · 2000m buoyed course · 8 lanes'));
        head.appendChild(copy);
        root.appendChild(head);
        const marks = el('div', 'kp-course-marks');
        ['START', '500M', '1000M', '1500M', 'FINISH'].forEach((m, i) => {
            marks.appendChild(el('span', i === 4 ? 'kp-finish' : '', m));
        });
        root.appendChild(marks);
        const lanes = el('div', 'kp-course-lanes');
        for (let i = 1; i <= 8; i++) {
            const ln = el('div', 'kp-course-lane', String(i));
            lanes.appendChild(ln);
        }
        root.appendChild(lanes);
        layer.appendChild(root);
    }

    function renderWeather(layer) {
        const wrap = el('div', 'kp-weather-wrap');
        const card = el('div', 'kp-weather');
        card.appendChild(bar());
        const head = el('div', 'kp-board-head');
        head.appendChild(el('span', 'kp-board-title', 'Lake Karāpiro conditions'));
        if (festive()) {
            const flake = document.createElement('span');
            flake.style.marginLeft = 'auto';
            flake.innerHTML =
                '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 2 V22 M2 12 H22 M5 5 L19 19 M19 5 L5 19" stroke="#d9e7f8" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
            head.appendChild(flake);
        }
        card.appendChild(head);
        const grid = el('div', 'kp-wx-grid');
        const map = el('div', 'kp-wx-map');
        map.innerHTML =
            `<svg viewBox="0 0 320 280" width="320" height="280">` +
            `<path d="M24 44 C86 18, 128 78, 158 112 C190 148, 244 152, 292 208" stroke="#1b5cb4" stroke-width="30" fill="none" stroke-linecap="round"/>` +
            `<path d="M24 44 C86 18, 128 78, 158 112 C190 148, 244 152, 292 208" stroke="#2e7de0" stroke-width="16" fill="none" stroke-linecap="round" opacity="0.55"/>` +
            `<line x1="196" y1="146" x2="282" y2="200" stroke="#f5f0e4" stroke-width="2.5" stroke-dasharray="7 6"/>` +
            `<circle cx="196" cy="146" r="4" fill="#f5f0e4"/>` +
            `<circle cx="282" cy="200" r="4" fill="#2e7de0"/>` +
            `<text x="150" y="248" font-family="JetBrains Mono,monospace" font-size="13" letter-spacing="1.5" fill="#8a96a5">2000M COURSE</text>` +
            `<text x="288" y="34" font-family="JetBrains Mono,monospace" font-size="13" font-weight="700" fill="#c9d1da">N</text>` +
            `<path d="M292 44 L292 58" stroke="#c9d1da" stroke-width="2"/>` +
            `<path d="M292 40 L287 50 L297 50 Z" fill="#c9d1da"/>` +
            `</svg>`;
        [60, 120, 66].forEach((top, i) => {
            const w = el('div', 'kp-wx-wind');
            w.style.top = `${top}px`;
            w.style.left = `${40 + i * 70}px`;
            w.style.animationDelay = `${i * 0.7}s`;
            w.innerHTML =
                '<svg width="34" height="12" viewBox="0 0 34 12"><line x1="0" y1="6" x2="24" y2="6" stroke="#d9e7f8" stroke-width="2.5"/><path d="M22 0 L34 6 L22 12 Z" fill="#d9e7f8"/></svg>';
            map.appendChild(w);
        });
        grid.appendChild(map);
        const stats = el('div', 'kp-wx-stats');
        const pair = el('div', 'kp-wx-pair');
        const wind = Math.round(12 + 3 * Math.sin(state.t / 6));
        const gust = Math.round(17 + 3 * Math.sin(state.t / 6 + 1));
        [
            ['Air', '22°C'],
            ['Water', '19°C'],
            ['Wind', `NE ${wind}`],
            ['Gust', `${gust}`],
        ].forEach(([lab, val]) => {
            const st = el('div', 'kp-wx-stat');
            st.appendChild(el('span', 'kp-wx-lab', lab));
            st.appendChild(el('span', 'kp-wx-val', val));
            pair.appendChild(st);
        });
        stats.appendChild(pair);
        stats.appendChild(el('div', 'kp-wx-note', 'Fine · light NE chop'));
        stats.appendChild(el('div', 'kp-wx-note', 'Forecast 14:00 — NE freshening 15 km/h'));
        grid.appendChild(stats);
        card.appendChild(grid);
        wrap.appendChild(card);
        layer.appendChild(wrap);
    }

    const RENDER = {
        title: renderTitle,
        lower: renderLower,
        draw: renderDraw,
        results: renderResults,
        schedule: (layer) => renderSchedule(layer, vgGetRaceParam()),
        leader: (layer, race) => renderLeader(layer, race, vgLeaderLane ?? vgGetLeaderLane()),
        drill: renderDrill,
        suits: renderSuits,
        suitstrip: renderSuitStrip,
        lowersuits: renderLowerSuits,
        brand: renderBrand,
        next: (layer) => renderNext(layer),
        prev: (layer) => renderPrev(layer),
        tracker: renderTracker,
        speedchart: renderSpeed,
        livetracking: renderLiveTrack,
        weather: (layer) => renderWeather(layer),
        cvleader: renderCvLeader,
        cvdraw: renderCvDraw,
        coursescroll: (layer) => renderCourse(layer),
    };

    function render(layer, graphic, race) {
        const g = canon(graphic);
        vgSetLayerGraphicClass(layer, LAYER_CLASS[g] || 'vg-layer--title');
        const fn = RENDER[g];
        if (!fn) return false;
        const r = race || vgFindRace(vgGetRaceParam());
        if (!r && g !== 'title' && g !== 'schedule' && g !== 'weather' && g !== 'brand' && g !== 'coursescroll') {
            return false;
        }
        fn(layer, r);
        paintOps();
        return true;
    }

    function ensureSnow() {
        let snow = document.getElementById('vgKpSnow');
        if (!festive()) {
            snow?.remove();
            return;
        }
        if (!snow) {
            snow = el('div', 'kp-snow');
            snow.id = 'vgKpSnow';
            document.querySelector('.vg-stage')?.appendChild(snow);
        }
        if (!state.flakes.length) {
            for (let i = 0; i < 70; i++) {
                state.flakes.push({
                    l: Math.random() * 100,
                    s: 2.5 + Math.random() * 4.5,
                    d: 7 + Math.random() * 9,
                    del: -Math.random() * 16,
                    o: 0.25 + Math.random() * 0.55,
                });
            }
        }
        snow.replaceChildren();
        state.flakes.forEach((f) => {
            const d = el('div', 'kp-flake');
            d.style.left = `${f.l}%`;
            d.style.width = `${f.s}px`;
            d.style.height = `${f.s}px`;
            d.style.opacity = String(f.o);
            d.style.animationDuration = `${f.d.toFixed(1)}s`;
            d.style.animationDelay = `${f.del.toFixed(1)}s`;
            snow.appendChild(d);
        });
    }

    function ensureBrandLayer() {
        let brand = document.getElementById('vgKpBrand');
        if (!brand) {
            brand = el('div', '');
            brand.id = 'vgKpBrand';
            brand.style.position = 'absolute';
            brand.style.inset = '0';
            brand.style.pointerEvents = 'none';
            brand.style.zIndex = '14';
            document.querySelector('.vg-stage')?.appendChild(brand);
        }
        brand.replaceChildren();
        if (state.brand) renderBrand(brand);
        paintOps();
    }

    function toggleBrand() {
        state.brand = !state.brand;
        ensureBrandLayer();
    }

    function showGraphic(g) {
        if (g === 'brand') {
            toggleBrand();
            return;
        }
        if (vgPlayback.state !== 'idle') vgTriggerClear();
        vgTriggerIn(g);
    }

    function setDrill(lane) {
        state.drillLane = lane;
        if (vgPlayback.graphic === 'drill' && vgPlayback.state !== 'idle') {
            const layer = vgGetLayerEl();
            if (layer) {
                layer.replaceChildren();
                renderDrill(layer, vgFindRace(vgGetRaceParam()));
            }
            paintOps();
            return;
        }
        vgTriggerIn('drill');
    }

    function playString(name) {
        stopString();
        const strings = {
            l3: [
                { g: 'lower', hold: 4500 },
                { g: 'drill', hold: 6000 },
                { g: 'suitstrip', hold: 6000 },
            ],
            drawstr: [
                { g: 'draw', hold: 8000 },
                { g: 'cvdraw', hold: 0 },
            ],
            resultstr: [
                { g: 'results', hold: 10000 },
                { g: 'next', hold: 0 },
            ],
        };
        const seq = strings[name];
        if (!seq) return;
        const tok = ++state.stringTok;
        let i = 0;
        const step = () => {
            if (state.stringTok !== tok) return;
            const s = seq[i];
            showGraphic(s.g);
            i += 1;
            if (i < seq.length && s.hold) {
                state.stringTimer = setTimeout(step, s.hold);
            }
        };
        step();
    }

    function stopString() {
        state.stringTok += 1;
        if (state.stringTimer) {
            clearTimeout(state.stringTimer);
            state.stringTimer = null;
        }
    }

    function paintOps() {
        const ops = document.getElementById('vgKpOps');
        if (!ops) return;
        ops.querySelectorAll('[data-kp-g]').forEach((btn) => {
            const g = btn.getAttribute('data-kp-g');
            const on = g === 'brand' ? state.brand : vgPlayback.graphic === g && vgPlayback.state !== 'idle';
            btn.classList.toggle('is-on', on);
        });
        ops.querySelectorAll('[data-kp-lane]').forEach((btn) => {
            const lane = +btn.getAttribute('data-kp-lane');
            btn.classList.toggle('is-on', vgPlayback.graphic === 'drill' && state.drillLane === lane);
        });
        const race = vgFindRace(vgGetRaceParam());
        const lab = ops.querySelector('[data-kp-race]');
        if (lab && race) lab.textContent = `${vgKpRaceChip(race)} · ${eventName(race)}`;
    }

    function buildOps() {
        if (new URLSearchParams(location.search).get('live') === '1') {
            document.body.dataset.vmixLive = '1';
            return;
        }
        if (!document.documentElement.classList.contains('vg-preview')) return;
        const hint = document.querySelector('.vg-preview-hint');
        if (hint) hint.hidden = true;
        const root = el('div', 'kp-ops');
        root.id = 'vgKpOps';
        const min = el('button', 'kp-ops-min', '— Hide keys');
        min.addEventListener('click', (e) => {
            e.stopPropagation();
            state.ctrlOpen = !state.ctrlOpen;
            root.querySelectorAll('.kp-ops-row').forEach((r) => {
                r.hidden = !state.ctrlOpen;
            });
            min.textContent = state.ctrlOpen ? '— Hide keys' : '+ Show keys';
        });
        root.appendChild(min);
        const row = el('div', 'kp-ops-row');
        OPS.forEach(([k, label, g]) => {
            const b = el('button', '', `${k} · ${label}`);
            b.dataset.kpG = g;
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                stopString();
                if (g === 'brand') toggleBrand();
                else if (vgPlayback.graphic === g && vgPlayback.state !== 'idle') vgTriggerOut();
                else showGraphic(g);
            });
            row.appendChild(b);
        });
        const clr = el('button', 'kp-ops-clear', 'C · Clear');
        clr.addEventListener('click', (e) => {
            e.stopPropagation();
            stopString();
            vgTriggerClear();
            paintOps();
        });
        row.appendChild(clr);
        root.appendChild(row);
        const row2 = el('div', 'kp-ops-row');
        row2.appendChild(el('span', 'kp-sponsor-label', 'Drill lane'));
        for (let i = 1; i <= 8; i++) {
            const b = el('button', '', String(i));
            b.dataset.kpLane = String(i);
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                stopString();
                setDrill(i);
            });
            row2.appendChild(b);
        }
        row2.appendChild(el('span', 'kp-sponsor-label', 'hold D + 1–8'));
        ;[
            ['L3 → drill → suits', 'l3'],
            ['Draw → CV draw + L3', 'drawstr'],
            ['Results → next race', 'resultstr'],
        ].forEach(([label, name]) => {
            const b = el('button', '', `▸ ${label}`);
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                playString(name);
            });
            row2.appendChild(b);
        });
        root.appendChild(row2);
        const row3 = el('div', 'kp-ops-row');
        const prev = el('button', '', '‹');
        prev.addEventListener('click', (e) => {
            e.stopPropagation();
            vgStepLiveRace(-1);
            paintOps();
        });
        const next = el('button', '', '›');
        next.addEventListener('click', (e) => {
            e.stopPropagation();
            vgStepLiveRace(1);
            paintOps();
        });
        const lab = el('span', '', '');
        lab.dataset.kpRace = '1';
        lab.style.minWidth = '230px';
        lab.style.textAlign = 'center';
        lab.style.color = '#f5f0e4';
        lab.style.fontFamily = 'var(--font-mono)';
        lab.style.fontSize = '12px';
        row3.appendChild(prev);
        row3.appendChild(lab);
        row3.appendChild(next);
        row3.appendChild(el('span', 'kp-sponsor-label', 'vMix: ?g=title,lower · ?live=1 hides keys'));
        root.appendChild(row3);
        document.querySelector('.vg-stage')?.appendChild(root);
        paintOps();
    }

    function onKey(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        const k = e.key.toLowerCase();
        const preview = document.documentElement.classList.contains('vg-preview');
        if (k === 'd') {
            if (!e.repeat) {
                state.dHeld = true;
                state.dCombo = false;
            }
            if (preview) {
                e.preventDefault();
                return true;
            }
            return false;
        }
        if (state.dHeld && /^[1-8]$/.test(k)) {
            state.dCombo = true;
            e.preventDefault();
            setDrill(+k);
            return true;
        }
        if (GED_KEYS[k] && preview) {
            e.preventDefault();
            stopString();
            const g = GED_KEYS[k];
            if (g === 'brand') toggleBrand();
            else if (vgPlayback.graphic === g && vgPlayback.state !== 'idle') vgTriggerOut();
            else showGraphic(g);
            return true;
        }
        return false;
    }

    function onKeyUp(e) {
        if (e.key.toLowerCase() !== 'd') return;
        const combo = state.dCombo;
        state.dHeld = false;
        state.dCombo = false;
        if (!combo && document.documentElement.classList.contains('vg-preview')) {
            stopString();
            if (vgPlayback.graphic === 'drill' && vgPlayback.state !== 'idle') vgTriggerOut();
            else showGraphic('drill');
        }
    }

    function tick() {
        state.t += 0.1;
        const g = canon(vgPlayback.graphic);
        if (!g || vgPlayback.state === 'idle') return;
        const race = vgFindRace(vgGetRaceParam());
        if (!race) return;
        const boats = boatsNow(race);
        const leadM = Math.max(...boats.map((b) => b.m), 1);
        const clock = fmtClock(Math.min(state.t % 450, 385));
        document.querySelectorAll('.kp-tracker-clock').forEach((n) => {
            n.textContent = clock;
        });
        if (g === 'tracker') {
            document.querySelectorAll('.kp-track-row').forEach((row, i) => {
                const b = boats[i];
                if (!b) return;
                const fill = row.querySelector('.kp-track-fill');
                const m = row.querySelector('.kp-track-m');
                if (fill) {
                    fill.style.width = `${(b.m / 20).toFixed(1)}%`;
                    fill.classList.toggle('kp-track-fill--lead', b.m === leadM);
                }
                if (m) m.textContent = `${Math.round(b.m)}m`;
            });
        }
        if (g === 'livetracking') {
            document.querySelectorAll('.kp-live-dot-boat').forEach((dot, i) => {
                const b = boats[i];
                if (!b) return;
                dot.style.left = `${(b.m / 20).toFixed(2)}%`;
                dot.classList.toggle('kp-live-dot-boat--lead', b.m === leadM);
            });
        }
        if (g === 'leader') {
            const { lead, second } = leadOf(race);
            const dist = document.querySelector('.kp-bug-dist');
            const gap = document.querySelector('.kp-bug-gap');
            if (dist && lead) dist.textContent = `${Math.round(lead.m / 10) * 10}m`;
            if (gap && lead && second) gap.textContent = `+${((lead.m - second.m) / 5.35).toFixed(1)}s`;
        }
        if (g === 'cvleader') {
            const { lead } = leadOf(race);
            const val = document.querySelector('.kp-cvleader-val');
            if (val && lead) val.textContent = `L${lead.lane} ${lead.abbr}`;
        }
        if (g === 'weather') {
            const vals = document.querySelectorAll('.kp-wx-val');
            if (vals[2]) vals[2].textContent = `NE ${Math.round(12 + 3 * Math.sin(state.t / 6))}`;
            if (vals[3]) vals[3].textContent = `${Math.round(17 + 3 * Math.sin(state.t / 6 + 1))}`;
        }
    }

    function init() {
        ensureSnow();
        const q = new URLSearchParams(location.search);
        const g = (q.get('g') || '').toLowerCase();
        if (!g && q.get('live') !== '1') {
            state.brand = true;
            ensureBrandLayer();
        }
        buildOps();
        window.addEventListener('keyup', onKeyUp);
        if (!state.motionTimer) state.motionTimer = setInterval(tick, 100);
        document.addEventListener('altitudehd:liverace', paintOps);
    }

    window.VmixKarapiro = {
        owns(graphic) {
            return !!OWN[canon(graphic)];
        },
        render,
        init,
        onKey,
        paintOps,
        canon,
    };
})();
