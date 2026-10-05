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
    const PANEL_PAD_TOP = 52;
    const PANEL_PAD_BOTTOM = 28;
    const PANEL_SLACK = 24;
    const ROW_H = 42;
    const ROW_GAP = 6;

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
        img.dataset.logoSrc = url;
        const cached = crestCutoutCache.get(url);
        if (cached) {
            img.src = cached;
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
                    if (el.dataset.logoSrc === url) el.src = out;
                });
            });
        });
    }

    let pollTimer = null;
    let sampleCache = null;
    let rootEl = null;
    let forceSplit = null;

    function params() {
        return new URLSearchParams(location.search);
    }

    function useSample() {
        const p = params();
        if (p.get('sample') === '1' || p.get('sample') === 'true') return true;
        if (p.get('live') === '1') return false;
        return p.get('preview') === '1';
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

    async function fetchRace() {
        if (useSample()) {
            const snap = await loadSample();
            return structuredClone(snap);
        }
        try {
            const res = await fetch(`${cvOrigin()}/api/race`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store',
            });
            if (!res.ok) throw new Error(String(res.status));
            return await res.json();
        } catch {
            const snap = await loadSample();
            return structuredClone(snap);
        }
    }

    function paint(snap) {
        if (!rootEl) return;
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

        rootEl.classList.toggle('mf-cvboard--split', !!split);
        if (split) {
            rootEl.style.setProperty('--mf-cvboard-shift', `-${SHIFT_PX}px`);
        } else {
            rootEl.style.setProperty('--mf-cvboard-shift', '0px');
        }

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
        const QLINE_H = 20;
        const childCount = n + (qCut ? 1 : 0);
        const panelH =
            PANEL_PAD_TOP +
            PANEL_PAD_BOTTOM +
            PANEL_SLACK +
            n * ROW_H +
            (qCut ? QLINE_H : 0) +
            Math.max(0, childCount - 1) * ROW_GAP;
        rootEl.style.setProperty('--mf-cvboard-h', `${panelH}px`);

        const splitByLane = new Map(
            (split?.rows || []).map((row) => [Number(row.lane), row]),
        );

        list.replaceChildren();
        ranked.forEach((b, i) => {
            const place = i + 1;
            const row = document.createElement('div');
            row.className = 'mf-cvboard-row' + (i === 0 ? ' mf-cvboard-row--lead' : '');
            row.dataset.lane = String(b.lane);

            const medal = document.createElement('span');
            medal.className = 'mf-cvboard-medal';
            if (showMedals && place <= 3) {
                medal.classList.add(`mf-cvboard-medal--${place}`);
            }
            row.appendChild(medal);

            const rank = document.createElement('span');
            rank.className = 'mf-cvboard-rank';
            rank.textContent = ordinal(place);
            row.appendChild(rank);

            if (b.logoUrl) {
                const crest = document.createElement('img');
                crest.className = 'mf-cvboard-crest';
                crest.alt = '';
                crest.setAttribute('aria-hidden', 'true');
                applyCrestCutout(crest, b.logoUrl);
                row.appendChild(crest);
            } else {
                const ph = document.createElement('span');
                ph.className = 'mf-cvboard-crest mf-cvboard-crest--empty';
                ph.setAttribute('aria-hidden', 'true');
                row.appendChild(ph);
            }

            const name = document.createElement('span');
            name.className = 'mf-cvboard-name';
            name.textContent = b.name;
            row.appendChild(name);

            const dist = document.createElement('span');
            dist.className = 'mf-cvboard-dist';
            if (i === 0 && Number.isFinite(leadM)) {
                dist.textContent = `${Math.max(0, Math.round(course - leadM))}m`;
            } else if (Number.isFinite(leadM)) {
                dist.textContent = `${Math.max(0, Math.round(leadM - b.m))}m`;
            } else {
                dist.textContent = '—';
            }
            row.appendChild(dist);

            const splitCell = document.createElement('span');
            splitCell.className = 'mf-cvboard-split';
            const srow = splitByLane.get(b.lane);
            if (split && srow && Number.isFinite(Number(srow.elapsed_ms))) {
                splitCell.textContent =
                    i === 0
                        ? formatSplitAbs(srow.elapsed_ms)
                        : formatSplitDelta(srow.elapsed_ms, leadSplitMs);
            } else {
                splitCell.textContent = '';
            }
            row.appendChild(splitCell);

            list.appendChild(row);
            if (qCut && place === qCut) {
                list.appendChild(makeQualifyLine());
            }
        });
    }

    async function tick() {
        try {
            const snap = await fetchRace();
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
        rootEl = null;
    }

    function toggleSplit() {
        if (forceSplit) forceSplit = null;
        else forceSplit = '500';
        tick();
    }

    function onKey(e) {
        if (e.repeat) return;
        if (e.target.closest?.('input, textarea, select')) return;
        if (e.key.toLowerCase() === 'y' && rootEl) {
            e.preventDefault();
            toggleSplit();
        }
    }

    document.addEventListener('keydown', onKey);

    global.VmixMilfordCvBoard = {
        mount,
        stop,
        toggleSplit,
        paint,
        useSample,
    };
})(window);
