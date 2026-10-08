/**
 * Milford CV leaderboard (j) — placings, gaps / to-go, and 500m split shift.
 * Polls CV laptop GET /api/race, or loads sample JSON when ?sample=1 / offline.
 */
(function (global) {
    const COURSE_M_DEFAULT = 2000;
    const POLL_MS = 400;
    const SAMPLE_URL = 'data/cv-demo/milford-leaderboard-sample.json';
    const SHIFT_PX = 140;
    /** Panel height: pads + rows × rowH + gaps (bottom-anchored to orange). */
    const PANEL_PAD_BOTTOM = 28;
    const ROW_H = 42;
    const ROW_GAP = 6;
    /** Place-change pass duration (ms) — keep in sync with CSS. */
    const FLIP_MS = 600;

    function clearRowFlip(row) {
        if (!row) return;
        row.classList.remove(
            'mf-cvboard-row--animating',
            'mf-cvboard-row--rising',
            'mf-cvboard-row--falling',
        );
        row.style.transition = '';
        row.style.transform = '';
        row.style.removeProperty('--mf-flip-y');
        row.style.removeProperty('z-index');
    }

    /** Transparent crest cutouts (same pipeline as Karāpiro / Regatta NZ). */
    const crestCutoutCache = new Map();
    let cutoutModPromise = null;

    function getCutoutMod() {
        if (!cutoutModPromise) {
            cutoutModPromise = import('./regatta-nz/logo-cutout.js').catch(() => null);
        }
        return cutoutModPromise;
    }

    function applyCrestCutout(img, url) {
        if (!url || !img) return;
        /* Already showing this crest (raw or cutout) — do not flash reload */
        if (img.dataset.logoSrc === url && img.getAttribute('src')) return;
        img.dataset.logoSrc = url;
        const cached = crestCutoutCache.get(url);
        if (cached) {
            if (img.getAttribute('src') !== cached) img.src = cached;
            return;
        }
        img.src = url;
        getCutoutMod().then((mod) => {
            if (!mod?.prepareLogoCutout) return;
            mod.prepareLogoCutout(url).then((dataUrl) => {
                const out = dataUrl || url;
                crestCutoutCache.set(url, out);
                if (!rootEl) return;
                rootEl.querySelectorAll('img.mf-cvboard-crest').forEach((el) => {
                    if (el.dataset.logoSrc === url && el.getAttribute('src') !== out) {
                        el.src = out;
                    }
                });
            });
        });
    }

    let pollTimer = null;
    let sampleCache = null;
    let rootEl = null;
    let forceSplit = null;
    /** True while the board is painting demo/sample JSON (not live CV). */
    let feedIsSample = false;
    /** Ignore paint/poll while a place-pass animation is running. */
    let flipUntil = 0;
    let paintGen = 0;

    function params() {
        return new URLSearchParams(location.search);
    }

    function useSample() {
        const p = params();
        if (p.get('sample') === '1' || p.get('sample') === 'true') return true;
        if (p.get('live') === '1') return false;
        return p.get('preview') === '1';
    }

    /** P demo-swap: URL sample/preview, or offline fallback sample feed. */
    function canDemoSwap() {
        if (params().get('live') === '1') return false;
        return useSample() || feedIsSample;
    }

    function cvOrigin() {
        const p = params();
        return (p.get('cv') || p.get('cvOrigin') || 'http://127.0.0.1:8790').replace(/\/$/, '');
    }

    function courseLength(snap) {
        const n = Number(snap?.course_m ?? snap?.courseLength ?? COURSE_M_DEFAULT);
        return Number.isFinite(n) && n > 0 ? n : COURSE_M_DEFAULT;
    }

    function formatClock(ms) {
        const t = Math.max(0, Number(ms) || 0);
        const totalSec = t / 1000;
        const m = Math.floor(totalSec / 60);
        const s = totalSec - m * 60;
        const whole = Math.floor(s);
        const tenth = Math.floor((s - whole) * 10);
        return `${m}:${String(whole).padStart(2, '0')}.${tenth}`;
    }

    function formatSplitAbs(ms) {
        const t = Math.max(0, Number(ms) || 0);
        const totalSec = t / 1000;
        const m = Math.floor(totalSec / 60);
        const s = totalSec - m * 60;
        return `${m}:${s.toFixed(2).padStart(5, '0')}`;
    }

    function formatSplitDelta(ms, leadMs) {
        const d = (Number(ms) || 0) - (Number(leadMs) || 0);
        if (Math.abs(d) < 5) return formatSplitAbs(ms);
        const sec = d / 1000;
        const sign = sec >= 0 ? '+' : '−';
        return `${sign}${Math.abs(sec).toFixed(2)}`;
    }

    function ordinal(n) {
        const v = Number(n) || 0;
        const j = v % 10;
        const k = v % 100;
        if (j === 1 && k !== 11) return `${v}st`;
        if (j === 2 && k !== 12) return `${v}nd`;
        if (j === 3 && k !== 13) return `${v}rd`;
        return `${v}th`;
    }

    function parseClubId(raw) {
        const s = String(raw || '').trim();
        if (!s) return '';
        const ageM = s.match(/^(.*?)\s*\(([A-Za-z])\*?\)\s*$/);
        const core = (ageM ? ageM[1] : s).trim();
        const m = core.match(/^([A-Za-z]{2,6})(\*?)(?:\s+(\d+))?$/);
        return m ? m[1].toLowerCase() : s.toLowerCase().replace(/\*+$/, '');
    }

    function logoFromLookup(clubId) {
        const lookup = global.VmixGraphics?.getLookup?.();
        const clubs = lookup?.clubs;
        if (!clubs || !clubId) return null;
        let c = clubs[clubId];
        if (!c && clubId.length <= 3) {
            const hits = Object.keys(clubs).filter(
                (k) => k !== 'comp' && k.startsWith(clubId),
            );
            if (hits.length) c = clubs[hits[0]];
        }
        return c?.logo
            ? `assets/school-logos/${encodeURIComponent(c.logo)}`
            : null;
    }

    function daysheetEntry(lane) {
        try {
            const race = global.VmixGraphics?.getRace?.() || null;
            const entry = race?.lanes?.find?.(
                (l) => Number(l.lane) === Number(lane),
            );
            if (entry) return entry;
            const vg = global.vgFindRace?.(global.vgGetRaceParam?.());
            return vg?.lanes?.find?.((l) => Number(l.lane) === Number(lane)) || null;
        } catch {
            return null;
        }
    }

    function daysheetName(lane) {
        const entry = daysheetEntry(lane);
        if (entry?.crew || entry?.name) return entry.crew || entry.name;
        return null;
    }

    function resolveLogoUrl(lane, draw) {
        const entry = daysheetEntry(lane);
        const code = entry?.code || draw?.code || '';
        return logoFromLookup(parseClubId(code));
    }

    function rankedBoats(snap) {
        const drawMap = new Map(
            (snap?.draw || []).map((d) => [Number(d.lane), d]),
        );
        const boats = (snap?.boats || [])
            .map((b) => {
                const lane = Number(b.lane);
                const m = Number(b.chainage_m);
                const draw = drawMap.get(lane);
                const name =
                    b.name ||
                    daysheetName(lane) ||
                    draw?.label ||
                    draw?.code ||
                    `Lane ${lane}`;
                return {
                    lane,
                    m: Number.isFinite(m) ? m : 0,
                    name,
                    abbr: b.abbr || draw?.code || `L${lane}`,
                    logoUrl: resolveLogoUrl(lane, draw),
                };
            })
            .filter((b) => Number.isFinite(b.lane));
        boats.sort((a, b) => b.m - a.m || a.lane - b.lane);
        return boats;
    }

    function activeSplit(snap) {
        if (forceSplit != null) {
            if (!forceSplit) return null;
            const mark = String(forceSplit);
            const rows = snap?.splits?.by_mark?.[mark] || [];
            return { mark, rows };
        }
        const p = params();
        const q = p.get('split');
        if (q === '0' || q === 'off') return null;
        if (q && q !== '1') {
            const mark = String(q);
            const rows = snap?.splits?.by_mark?.[mark] || [];
            return { mark, rows };
        }
        const mark = snap?.splits?.active_mark;
        if (mark == null || mark === '' || mark === false) return null;
        const key = String(mark);
        const rows = snap?.splits?.by_mark?.[key] || [];
        return { mark: key, rows };
    }

    function currentRace(snap) {
        if (snap?.round || snap?.progression) {
            return {
                round: snap.round || '',
                division: snap.division || '',
                progression: snap.progression || '',
            };
        }
        try {
            return global.VmixGraphics?.getRace?.() || null;
        } catch {
            return null;
        }
    }

    function isFinalRace(race) {
        const r = String(race?.round || '').toLowerCase().trim();
        return r === 'f' || /final/.test(r) || /exhibition/.test(r);
    }

    function isAFinalRace(race) {
        if (!race || !isFinalRace(race)) return false;
        const r = String(race.round || '').toLowerCase();
        if (/exhibition/.test(r)) return false;
        const div = String(race.division || '').trim().toLowerCase();
        if (!div) return true;
        return div === 'a' || div === '1' || /^a\b/.test(div);
    }

    function placesFromSpec(spec) {
        const s = String(spec || '').trim();
        const range = s.match(/^(\d+)\s*-\s*(\d+)$/);
        if (range) {
            const from = parseInt(range[1], 10);
            const to = parseInt(range[2], 10);
            const places = [];
            for (let p = from; p <= to; p++) places.push(p);
            return places;
        }
        return s
            .split(/[,+]/)
            .map((x) => parseInt(x.trim(), 10))
            .filter((n) => Number.isFinite(n));
    }

    function destQualifyScore(dest) {
        const t = String(dest || '')
            .toLowerCase()
            .replace(/\s+/g, '');
        if (!t || /elim/.test(t)) return 0;
        if (/^fa$|^afinal$|^f$|^finala$|^final$/.test(t)) return 100;
        if (/^s$|^sf$|semi/.test(t)) return 90;
        if (/^q$|^qf$|quarter/.test(t)) return 80;
        if (/^r$|rep/.test(t)) return 40;
        if (/^fb$|^bfinal$/.test(t)) return 20;
        if (/^f[c-z]$|[c-z]final/.test(t)) return 15;
        return 50;
    }

    /** Place after which the blue QF line sits (e.g. 3 → between 3rd and 4th). */
    function qualifyCutAfter(progression) {
        const s = String(progression || '').trim();
        if (!s) return null;
        const groups = [];
        for (const m of s.matchAll(/([\d,\s-]+)\s*=\s*([^;+]+)/gi)) {
            const places = placesFromSpec(m[1]);
            if (places.length) {
                groups.push({ places, score: destQualifyScore(m[2]) });
            }
        }
        for (const m of s.matchAll(/([\d,\s-]+)\s*->\s*([^;+]+)/gi)) {
            const places = placesFromSpec(m[1]);
            if (places.length) {
                groups.push({ places, score: destQualifyScore(m[2]) });
            }
        }
        const best = groups
            .filter((g) => g.score > 0)
            .sort(
                (a, b) =>
                    b.score - a.score ||
                    Math.max(...b.places) - Math.max(...a.places),
            )[0];
        if (!best) return null;
        return Math.max(...best.places);
    }

    function makeQualifyLine() {
        const line = document.createElement('div');
        line.className = 'mf-cvboard-qline';
        line.setAttribute('aria-hidden', 'true');
        const rule = document.createElement('span');
        rule.className = 'mf-cvboard-qline-rule';
        line.appendChild(rule);
        const label = document.createElement('span');
        label.className = 'mf-cvboard-qline-label';
        label.textContent = 'QF';
        line.appendChild(label);
        return line;
    }

    async function loadSample() {
        if (sampleCache) return sampleCache;
        const res = await fetch(`${SAMPLE_URL}?v=3`);
        if (!res.ok) throw new Error(`Sample ${res.status}`);
        sampleCache = await res.json();
        return sampleCache;
    }

    /** Demo helper: ?crews=4 keeps the top N boats (by chainage) from the sample. */
    function limitCrews(snap) {
        const n = parseInt(params().get('crews') || '', 10);
        if (!Number.isFinite(n) || n < 1 || !snap?.boats?.length) return snap;
        if (n >= snap.boats.length) return snap;
        const boats = [...snap.boats]
            .sort((a, b) => Number(b.chainage_m) - Number(a.chainage_m))
            .slice(0, n);
        const lanes = new Set(boats.map((b) => Number(b.lane)));
        snap.boats = boats;
        if (Array.isArray(snap.draw)) {
            snap.draw = snap.draw.filter((d) => lanes.has(Number(d.lane)));
        }
        if (snap.splits?.by_mark) {
            for (const key of Object.keys(snap.splits.by_mark)) {
                const rows = snap.splits.by_mark[key];
                if (Array.isArray(rows)) {
                    snap.splits.by_mark[key] = rows.filter((r) =>
                        lanes.has(Number(r.lane)),
                    );
                }
            }
        }
        /* Typical 4-crew heat: top 2 advance */
        if (n <= 4 && /1\s*-\s*3\s*=/.test(String(snap.progression || ''))) {
            snap.progression = '1-2=S; Rest Elim';
        }
        return snap;
    }

    async function fetchRace() {
        if (useSample()) {
            feedIsSample = true;
            const snap = await loadSample();
            return limitCrews(structuredClone(snap));
        }
        try {
            /* Short timeout — hung 127.0.0.1 CV laptop left the board empty forever */
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 1200);
            const res = await fetch(`${cvOrigin()}/api/race`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store',
                signal: ac.signal,
            });
            clearTimeout(timer);
            if (!res.ok) throw new Error(String(res.status));
            feedIsSample = false;
            return await res.json();
        } catch {
            /* No CV laptop — same demo JSON as ?sample=1 so P can still animate */
            feedIsSample = true;
            const snap = await loadSample();
            return limitCrews(structuredClone(snap));
        }
    }

    function paint(snap, opts = {}) {
        if (!rootEl) return;
        /* A second paint mid-pass clears --mf-flip-y and yields dy≈0 (no rotate,
           just cell/logo updates). Hold off until the pass finishes. */
        if (!opts.skipFlip && Date.now() < flipUntil) return;
        const ranked = rankedBoats(snap);
        const leadM = ranked[0]?.m;
        const course = courseLength(snap);
        const split = activeSplit(snap);
        const leadSplitMs = split?.rows?.length
            ? Number(
                  [...split.rows].sort(
                      (a, b) => Number(a.elapsed_ms) - Number(b.elapsed_ms),
                  )[0]?.elapsed_ms,
              )
            : null;

        const clockEl = rootEl.querySelector('.mf-cvboard-clock');
        if (clockEl) {
            clockEl.textContent = formatClock(snap?.clock?.elapsed_ms);
        }

        const splitLabel = rootEl.querySelector('.mf-cvboard-split-label');
        if (splitLabel) {
            splitLabel.hidden = !split;
            if (split) {
                splitLabel.innerHTML = `<span>SPLIT</span><strong>${split.mark}m</strong>`;
            }
        }

        const list = rootEl.querySelector('.mf-cvboard-list');
        if (!list) return;

        const race = currentRace(snap);
        const showMedals = isAFinalRace(race);
        const qCutRaw = isFinalRace(race)
            ? null
            : qualifyCutAfter(race?.progression);
        const qCut =
            Number.isFinite(qCutRaw) &&
            qCutRaw >= 1 &&
            qCutRaw < ranked.length
                ? qCutRaw
                : null;

        const n = Math.max(1, ranked.length);
        /* Net height after qline negative margins (−5px × 2) */
        const QLINE_H = 2;
        const childCount = n + (qCut ? 1 : 0);
        const contentH =
            n * ROW_H +
            (qCut ? QLINE_H : 0) +
            Math.max(0, childCount - 1) * ROW_GAP;
        /* Just enough for mountain peaks — scales lightly with crew count */
        const padTop = Math.max(34, Math.min(46, Math.round(contentH * 0.06) + 28));
        const panelH = padTop + PANEL_PAD_BOTTOM + contentH;
        rootEl.style.setProperty('--mf-cvboard-h', `${panelH}px`);
        /* Inline height wins over layout defaults / saved layout height */
        const panelEl = rootEl.querySelector('.mf-cvboard-panel');
        if (panelEl) {
            panelEl.style.height = `${panelH}px`;
            panelEl.style.removeProperty('top');
            if (!panelEl.style.bottom) panelEl.style.bottom = '22px';
        }
        const listEl = rootEl.querySelector('.mf-cvboard-list');
        if (listEl) {
            listEl.style.removeProperty('height');
            listEl.style.top = `${padTop}px`;
            listEl.style.bottom = `${PANEL_PAD_BOTTOM}px`;
        }

        const splitByLane = new Map(
            (split?.rows || []).map((row) => [Number(row.lane), row]),
        );

        const distText = (b, i) => {
            if (i === 0 && Number.isFinite(leadM)) {
                return `${Math.max(0, Math.round(course - leadM))}m`;
            }
            if (Number.isFinite(leadM)) {
                return `${Math.max(0, Math.round(leadM - b.m))}m`;
            }
            return '—';
        };

        const splitText = (b, i) => {
            const srow = splitByLane.get(b.lane);
            if (split && srow && Number.isFinite(Number(srow.elapsed_ms))) {
                return i === 0
                    ? formatSplitAbs(srow.elapsed_ms)
                    : formatSplitDelta(srow.elapsed_ms, leadSplitMs);
            }
            return '';
        };

        const fillRow = (row, b, i) => {
            const place = i + 1;
            /* Preserve pass-animation classes — className wipe was killing ~1s mid-flight */
            row.classList.add('mf-cvboard-row');
            row.classList.toggle('mf-cvboard-row--lead', i === 0);
            row.dataset.lane = String(b.lane);

            const medal = row.querySelector('.mf-cvboard-medal');
            if (medal) {
                medal.className = 'mf-cvboard-medal';
                if (showMedals && place <= 3) {
                    medal.classList.add(`mf-cvboard-medal--${place}`);
                }
            }
            const rank = row.querySelector('.mf-cvboard-rank');
            if (rank) rank.textContent = ordinal(place);

            let crest = row.querySelector('.mf-cvboard-crest');
            if (b.logoUrl) {
                if (!crest || crest.tagName !== 'IMG') {
                    crest?.remove();
                    crest = document.createElement('img');
                    crest.className = 'mf-cvboard-crest';
                    crest.alt = '';
                    crest.setAttribute('aria-hidden', 'true');
                    rank?.after(crest);
                }
                if (crest.dataset.logoSrc !== b.logoUrl) {
                    applyCrestCutout(crest, b.logoUrl);
                }
            } else if (!crest || crest.tagName === 'IMG') {
                crest?.remove();
                const ph = document.createElement('span');
                ph.className = 'mf-cvboard-crest mf-cvboard-crest--empty';
                ph.setAttribute('aria-hidden', 'true');
                rank?.after(ph);
            }

            const name = row.querySelector('.mf-cvboard-name');
            if (name) name.textContent = b.name;
            const dist = row.querySelector('.mf-cvboard-dist');
            if (dist) dist.textContent = distText(b, i);
            const splitCell = row.querySelector('.mf-cvboard-split');
            if (splitCell) splitCell.textContent = splitText(b, i);
        };

        const makeRow = (b, i) => {
            const row = document.createElement('div');
            row.appendChild(document.createElement('span')).className =
                'mf-cvboard-medal';
            row.appendChild(document.createElement('span')).className =
                'mf-cvboard-rank';
            row.appendChild(document.createElement('span')).className =
                'mf-cvboard-crest mf-cvboard-crest--empty';
            row.appendChild(document.createElement('span')).className =
                'mf-cvboard-name';
            row.appendChild(document.createElement('span')).className =
                'mf-cvboard-dist';
            row.appendChild(document.createElement('span')).className =
                'mf-cvboard-split';
            fillRow(row, b, i);
            return row;
        };

        /* Crew set + QF cut — order changes use FLIP, not a full rebuild */
        const crewSig = `${[...ranked]
            .map((b) => b.lane)
            .sort((a, b) => a - b)
            .join(',')}|q${qCut || 0}`;
        const orderSig = ranked.map((b) => b.lane).join(',');
        const wasSplit = rootEl.classList.contains('mf-cvboard--split');
        const wantSplit = !!split;

        const existingByLane = new Map(
            [...list.querySelectorAll('.mf-cvboard-row')].map((r) => [
                r.dataset.lane,
                r,
            ]),
        );
        let qlineEl = list.querySelector('.mf-cvboard-qline');
        const sameCrews = list.dataset.crewSig === crewSig;
        const orderChanged = list.dataset.orderSig !== orderSig;

        if (!sameCrews) {
            list.replaceChildren();
            ranked.forEach((b, i) => {
                list.appendChild(makeRow(b, i));
                if (qCut && i + 1 === qCut) list.appendChild(makeQualifyLine());
            });
            list.dataset.crewSig = crewSig;
            list.dataset.orderSig = orderSig;
            list.dataset.rowSig = `${orderSig}|q${qCut || 0}`;
        } else if (!orderChanged || opts.skipFlip) {
            /* Same order — update cells only. Do not re-append rows or the
               CSS pass animation gets cancelled by the next poll (~400ms).
               skipFlip: commit a demo swap after WAAPI has already moved rows. */
            if (orderChanged) {
                qlineEl?.classList.remove('mf-cvboard-qline--pass');
                ranked.forEach((b, i) => {
                    const key = String(b.lane);
                    let row = existingByLane.get(key);
                    if (!row) {
                        row = makeRow(b, i);
                        existingByLane.set(key, row);
                    } else {
                        clearRowFlip(row);
                        fillRow(row, b, i);
                    }
                    list.appendChild(row);
                    if (qCut && i + 1 === qCut) {
                        if (!qlineEl) qlineEl = makeQualifyLine();
                        list.appendChild(qlineEl);
                    }
                });
                existingByLane.forEach((el, lane) => {
                    if (!ranked.some((b) => String(b.lane) === lane)) el.remove();
                });
                if (!qCut && qlineEl) qlineEl.remove();
                list.dataset.orderSig = orderSig;
                list.dataset.rowSig = `${orderSig}|q${qCut || 0}`;
            } else {
                ranked.forEach((b, i) => {
                    const row = existingByLane.get(String(b.lane));
                    if (row) fillRow(row, b, i);
                });
            }
        } else {
            /* Use offsetTop (layout px), not getBoundingClientRect — preview
               stages CSS-scale .vg-stage, so viewport dy ≠ translateY px. */
            const firstTops = new Map();
            existingByLane.forEach((el, lane) => {
                firstTops.set(lane, el.offsetTop);
                clearRowFlip(el);
                el.style.transition = 'none';
            });
            qlineEl?.classList.remove('mf-cvboard-qline--pass');

            ranked.forEach((b, i) => {
                const key = String(b.lane);
                let row = existingByLane.get(key);
                if (!row) {
                    row = makeRow(b, i);
                    existingByLane.set(key, row);
                } else {
                    fillRow(row, b, i);
                }
                list.appendChild(row);
                if (qCut && i + 1 === qCut) {
                    if (!qlineEl) qlineEl = makeQualifyLine();
                    list.appendChild(qlineEl);
                }
            });

            existingByLane.forEach((el, lane) => {
                if (!ranked.some((b) => String(b.lane) === lane)) el.remove();
            });
            if (!qCut && qlineEl) qlineEl.remove();

            list.dataset.orderSig = orderSig;
            list.dataset.rowSig = `${orderSig}|q${qCut || 0}`;

            const movers = [];
            ranked.forEach((b) => {
                const key = String(b.lane);
                const row = existingByLane.get(key);
                if (!row || !firstTops.has(key)) return;
                const dy = firstTops.get(key) - row.offsetTop;
                if (Math.abs(dy) < 0.5) return;
                /* Invert: park at old visual Y before the pass animation */
                row.style.setProperty('--mf-flip-y', `${dy}px`);
                row.style.transform = `translateY(${dy}px)`;
                /* dy > 0 → was below, now above → rising in front */
                movers.push({ row, rising: dy > 0 });
            });
            if (movers.length) {
                flipUntil = Date.now() + FLIP_MS + 120;
                const qlineNow = list.querySelector('.mf-cvboard-qline');
                if (qlineNow) qlineNow.classList.add('mf-cvboard-qline--pass');
                void list.offsetHeight;
                requestAnimationFrame(() => {
                    movers.forEach(({ row, rising }) => {
                        row.style.transition = '';
                        row.style.transform = '';
                        row.classList.add(
                            'mf-cvboard-row--animating',
                            rising
                                ? 'mf-cvboard-row--rising'
                                : 'mf-cvboard-row--falling',
                        );
                        const done = (ev) => {
                            if (
                                ev.target !== row ||
                                (ev.animationName &&
                                    !String(ev.animationName).includes(
                                        'mf-cvboard-row-',
                                    ))
                            ) {
                                return;
                            }
                            clearRowFlip(row);
                            row.removeEventListener('animationend', done);
                        };
                        row.addEventListener('animationend', done);
                        setTimeout(() => clearRowFlip(row), FLIP_MS + 100);
                    });
                    setTimeout(() => {
                        list
                            .querySelector('.mf-cvboard-qline')
                            ?.classList.remove('mf-cvboard-qline--pass');
                        flipUntil = 0;
                    }, FLIP_MS + 100);
                });
            }
        }

        /* Toggle split after DOM is stable so orange/QF rules can ease-in */
        if (wasSplit !== wantSplit) {
            if (wantSplit) {
                rootEl.classList.remove('mf-cvboard--split');
                rootEl.style.setProperty('--mf-cvboard-shift', '0px');
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (!rootEl) return;
                        rootEl.classList.add('mf-cvboard--split');
                        rootEl.style.setProperty(
                            '--mf-cvboard-shift',
                            `-${SHIFT_PX}px`,
                        );
                    });
                });
            } else {
                rootEl.classList.remove('mf-cvboard--split');
                rootEl.style.setProperty('--mf-cvboard-shift', '0px');
            }
        } else if (wantSplit) {
            rootEl.classList.add('mf-cvboard--split');
            rootEl.style.setProperty('--mf-cvboard-shift', `-${SHIFT_PX}px`);
        } else {
            rootEl.classList.remove('mf-cvboard--split');
            rootEl.style.setProperty('--mf-cvboard-shift', '0px');
        }
    }

    async function tick() {
        if (Date.now() < flipUntil) return;
        const gen = ++paintGen;
        try {
            const snap = await fetchRace();
            if (gen !== paintGen || Date.now() < flipUntil) return;
            paint(snap);
        } catch (err) {
            console.warn('Milford CV board poll failed', err);
        }
    }

    function mount(root) {
        stop();
        rootEl = root;
        const p = params();
        if (p.get('split') && p.get('split') !== '0' && p.get('split') !== 'off') {
            forceSplit = p.get('split') === '1' ? '500' : p.get('split');
        } else {
            forceSplit = null;
        }
        tick();
        pollTimer = setInterval(tick, POLL_MS);
    }

    function stop() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        flipUntil = 0;
        paintGen += 1;
        rootEl = null;
    }

    function toggleSplit() {
        if (forceSplit) forceSplit = null;
        else forceSplit = '500';
        tick();
    }

    /**
     * Sample/preview helper: swap two placings (1-based) with an in-place pass.
     * Animates the rows first (WAAPI), then commits DOM/data — avoids paint/poll
     * FLIP races that flash and snap back under preview stage scale.
     */
    function demoSwapPlaces(placeA = 2, placeB = 3) {
        if (!canDemoSwap()) return false;
        if (!sampleCache?.boats?.length || !rootEl) return false;
        if (Date.now() < flipUntil) return false;
        const list = rootEl.querySelector('.mf-cvboard-list');
        if (!list) return false;
        const rows = [...list.querySelectorAll('.mf-cvboard-row')];
        const i = Math.min(placeA, placeB) - 1;
        const j = Math.max(placeA, placeB) - 1;
        const rowFall = rows[i];
        const rowRise = rows[j];
        if (!rowFall || !rowRise) return false;

        const gap = rowRise.offsetTop - rowFall.offsetTop;
        if (Math.abs(gap) < 0.5) return false;

        const snap = limitCrews(structuredClone(sampleCache));
        const ranked = rankedBoats(snap);
        const a = ranked[i];
        const b = ranked[j];
        if (!a || !b) return false;
        const boatA = sampleCache.boats.find(
            (x) => Number(x.lane) === Number(a.lane),
        );
        const boatB = sampleCache.boats.find(
            (x) => Number(x.lane) === Number(b.lane),
        );
        if (!boatA || !boatB) return false;

        /* Trade chainage; keep the rising boat strictly ahead after the pass */
        const mA = Number(boatA.chainage_m);
        const mB = Number(boatB.chainage_m);
        boatA.chainage_m = mB;
        boatB.chainage_m = mA;
        if (!(Number(boatB.chainage_m) > Number(boatA.chainage_m))) {
            boatB.chainage_m = Number(boatA.chainage_m) + 1;
        }

        /* Lock polls for the whole pass + commit */
        flipUntil = Date.now() + FLIP_MS + 240;
        paintGen += 1;

        clearRowFlip(rowFall);
        clearRowFlip(rowRise);
        rowFall.getAnimations?.().forEach((anim) => anim.cancel());
        rowRise.getAnimations?.().forEach((anim) => anim.cancel());

        const qlineNow = list.querySelector('.mf-cvboard-qline');
        qlineNow?.classList.add('mf-cvboard-qline--pass');
        /* z-index only — do not add --rising/--falling (those CSS animations
           fight this WAAPI transform and cancel the pass). */
        rowFall.classList.add('mf-cvboard-row--animating');
        rowRise.classList.add('mf-cvboard-row--animating');
        rowFall.style.zIndex = '1';
        rowRise.style.zIndex = '5';

        const animOpts = { duration: FLIP_MS, easing: 'linear', fill: 'forwards' };
        const animFall = rowFall.animate(
            [
                {
                    transform:
                        'translateY(0) translateZ(0) rotateX(0deg) scale(1)',
                },
                {
                    transform: `translateY(${gap * 0.5}px) translateZ(-24px) rotateX(10deg) scale(0.985)`,
                    offset: 0.5,
                },
                {
                    transform: `translateY(${gap}px) translateZ(0) rotateX(0deg) scale(1)`,
                },
            ],
            animOpts,
        );
        const animRise = rowRise.animate(
            [
                {
                    transform:
                        'translateY(0) translateZ(0) rotateX(0deg) scale(1)',
                },
                {
                    transform: `translateY(${-gap * 0.5}px) translateZ(28px) rotateX(-10deg) scale(1.02)`,
                    offset: 0.5,
                },
                {
                    transform: `translateY(${-gap}px) translateZ(0) rotateX(0deg) scale(1)`,
                },
            ],
            animOpts,
        );

        let finished = false;
        const commit = () => {
            if (finished) return;
            finished = true;
            qlineNow?.classList.remove('mf-cvboard-qline--pass');
            /* Reorder DOM first, then drop WAAPI transforms in the same turn
               so we never paint a frame at the pre-swap slots. */
            paintGen += 1;
            paint(limitCrews(structuredClone(sampleCache)), { skipFlip: true });
            try {
                animFall.cancel();
            } catch {
                /* ignore */
            }
            try {
                animRise.cancel();
            } catch {
                /* ignore */
            }
            clearRowFlip(rowFall);
            clearRowFlip(rowRise);
            flipUntil = 0;
        };

        Promise.all([animFall.finished, animRise.finished])
            .then(commit)
            .catch(commit);
        setTimeout(commit, FLIP_MS + 100);
        return true;
    }

    function onKey(e) {
        if (e.repeat) return;
        if (e.target.closest?.('input, textarea, select')) return;
        const k = e.key.toLowerCase();
        if (k === 'y' && rootEl) {
            e.preventDefault();
            toggleSplit();
        }
        /* P is handled in vmix-graphics.js so it doesn't also step live race */
    }

    document.addEventListener('keydown', onKey);

    global.VmixMilfordCvBoard = {
        mount,
        stop,
        toggleSplit,
        demoSwapPlaces,
        paint,
        useSample,
        canDemoSwap,
    };
})(window);
