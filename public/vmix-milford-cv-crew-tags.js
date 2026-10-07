/**
 * Milford CV crew identification tags — orange leader tip + white name plate.
 * Positions from live /api/cv-position slots (or sample fan for preview).
 */
(function (global) {
    const OUT_W = 1920;
    const OUT_H = 1080;
    const DEFAULT_REF_W = 1280;
    const DEFAULT_REF_H = 720;
    const LOGO_PLACEHOLDER = 'assets/school-logos/placeholder-white.svg';
    const ORANGE_SRC = 'assets/vmix/milford/crew-tag-orange.png?v=4';
    const WHITE_SRC = 'assets/vmix/milford/crew-tag-white.png?v=4';
    const TAG_GAP_PX = 18;
    const INTRO_MS = 900;
    /* Preview: ?medal=1 forces A-final medal glows on places 1–3 */

    let rootEl = null;
    let pollTimer = null;
    let cutoutCache = null;
    let cutoutModPromise = null;
    let lastCrewSig = '';
    let introTimer = null;

    function params() {
        return new URLSearchParams(location.search);
    }

    function pollMs() {
        const n = parseInt(params().get('poll') || '200', 10);
        return Number.isFinite(n) ? Math.max(100, Math.min(n, 2000)) : 200;
    }

    function useSample() {
        const p = params();
        if (p.get('sample') === '1' || p.get('demo') === '1') return true;
        if (p.get('sample') === '0' || p.get('live') === '1') return false;
        return p.get('preview') === '1';
    }

    function liveRace() {
        const vg = global.VmixGraphics;
        if (!vg?.findRace || !vg?.getRaceParam) return null;
        return vg.findRace(vg.getRaceParam());
    }

    function lookup() {
        return global.VmixGraphics?.getLookup?.() || null;
    }

    function mapPoint(data, x, y) {
        const cv = global.AltitudeHdCvOverlay;
        if (!cv?.mapPoint) return null;
        const refW = Number(data.refW) || DEFAULT_REF_W;
        const refH = Number(data.refH) || DEFAULT_REF_H;
        const offset = data.offset || cv.venueOffset?.(data.venue) || { x: 0, y: 0 };
        return cv.mapPoint(x, y, refW, refH, offset);
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function applyLogoCutout(img, url) {
        if (!img || !url) return;
        img.dataset.logoSrc = url;
        img.src = url;
        if (!cutoutCache) cutoutCache = new Map();
        const cached = cutoutCache.get(url);
        if (cached) {
            img.src = cached;
            return;
        }
        if (!cutoutModPromise) {
            cutoutModPromise = import('./regatta-nz/logo-cutout.js').catch(() => null);
        }
        cutoutModPromise.then((mod) => {
            if (!mod?.prepareLogoCutout) return;
            mod.prepareLogoCutout(url).then((dataUrl) => {
                const out = dataUrl || url;
                cutoutCache.set(url, out);
                rootEl?.querySelectorAll('img.mf-crew-tag-logo').forEach((node) => {
                    if (node.dataset.logoSrc === url) node.src = out;
                });
            });
        });
    }

    function enrichLane(entry) {
        const raw = String(entry?.code || '').trim();
        const m = raw.match(/^([a-z0-9]+)/i);
        const id = (m ? m[1] : raw).toLowerCase();
        const club = id ? lookup()?.clubs?.[id] : null;
        return {
            shortLabel: id ? id.toUpperCase() : raw.toUpperCase() || 'CREW',
            label: club?.name || (id ? id.toUpperCase() : raw),
            logoUrl: club?.logo
                ? `assets/school-logos/${encodeURIComponent(club.logo)}`
                : null,
            lane: entry?.lane,
        };
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

    /** Places that auto-qualify from daysheet progression (e.g. 1-3=S). */
    function qualifyPlaces(progression) {
        const s = String(progression || '').trim();
        if (!s) return new Set();
        const out = new Set();
        for (const m of s.matchAll(/([\d,\s-]+)\s*=\s*([^;+]+)/gi)) {
            if (destQualifyScore(m[2]) <= 0) continue;
            placesFromSpec(m[1]).forEach((p) => out.add(p));
        }
        for (const m of s.matchAll(/([\d,\s-]+)\s*->\s*([^;+]+)/gi)) {
            if (destQualifyScore(m[2]) <= 0) continue;
            placesFromSpec(m[1]).forEach((p) => out.add(p));
        }
        return out;
    }

    function highlightForPlace(race, place) {
        if (!Number.isFinite(place) || place < 1) return '';
        const forceMedal = params().get('medal') === '1';
        if (forceMedal || isAFinalRace(race)) {
            if (place === 1) return 'medal-1';
            if (place === 2) return 'medal-2';
            if (place === 3) return 'medal-3';
            return '';
        }
        /* Heats / semis / non-A finals: blue for auto-qual spots (else leader) */
        const quals = qualifyPlaces(race?.progression);
        if (quals.size) return quals.has(place) ? 'qualify' : '';
        return place === 1 ? 'qualify' : '';
    }

    function raceSortScore(boat, data) {
        const chain = Number(boat.chainage_m);
        if (Number.isFinite(chain)) return chain;
        const dir = String(
            data?.boat_direction ||
                data?.boatDirection ||
                (data?.venue === 'twizel' ? 'right_to_left' : 'left_to_right'),
        )
            .toLowerCase()
            .replace(/-/g, '_');
        const x = Number(boat.x ?? boat.left);
        if (!Number.isFinite(x)) return 0;
        return dir === 'right_to_left' ? -x : x;
    }

    function withPlaces(boats, race, data) {
        const ranked = [...boats].sort(
            (a, b) => raceSortScore(b, data) - raceSortScore(a, data),
        );
        return ranked.map((boat, i) => {
            const place = i + 1;
            return {
                ...boat,
                place,
                highlight: highlightForPlace(race, place),
            };
        });
    }

    function applyHighlight(tag, highlight) {
        tag.classList.remove(
            'mf-crew-tag--medal-1',
            'mf-crew-tag--medal-2',
            'mf-crew-tag--medal-3',
            'mf-crew-tag--qualify',
        );
        if (highlight === 'medal-1') tag.classList.add('mf-crew-tag--medal-1');
        else if (highlight === 'medal-2') tag.classList.add('mf-crew-tag--medal-2');
        else if (highlight === 'medal-3') tag.classList.add('mf-crew-tag--medal-3');
        else if (highlight === 'qualify') tag.classList.add('mf-crew-tag--qualify');
        if (highlight) tag.dataset.highlight = highlight;
        else delete tag.dataset.highlight;
    }

    function sampleBoats(race) {
        const lanes = (race?.lanes || [])
            .filter((entry) => entry && entry.code)
            .sort((a, b) => a.lane - b.lane)
            .slice(0, 8);
        if (!lanes.length) {
            return withPlaces(
                [{ slot: 1, shortLabel: 'AVON', logoUrl: null, left: 960, top: 540 }],
                race,
                null,
            );
        }
        const n = lanes.length;
        const boats = lanes.map((entry, i) => {
            const info = enrichLane(entry);
            const t = n === 1 ? 0.5 : i / (n - 1);
            const left = 260 + t * 1400;
            const top = 470 + Math.sin(t * Math.PI) * 90 + (i % 2) * 28;
            return {
                slot: i + 1,
                drawLane: entry.lane,
                shortLabel: info.shortLabel,
                label: info.label,
                logoUrl: info.logoUrl,
                left,
                top,
                /* Fake lead → trailing for sample place order */
                chainage_m: 2000 - i * 12,
                sample: true,
            };
        });
        return withPlaces(boats, race, null);
    }

    function buildTag(boat) {
        const tag = el('div', 'mf-crew-tag');
        tag.dataset.slot = String(boat.slot ?? '');
        if (boat.drawLane != null) tag.dataset.lane = String(boat.drawLane);
        if (boat.place != null) tag.dataset.place = String(boat.place);
        applyHighlight(tag, boat.highlight || '');

        const plates = el('div', 'mf-crew-tag-plates');
        plates.setAttribute('aria-hidden', 'true');

        const orange = document.createElement('img');
        orange.className = 'mf-crew-tag-orange';
        orange.src = ORANGE_SRC;
        orange.alt = '';
        plates.appendChild(orange);

        const white = document.createElement('img');
        white.className = 'mf-crew-tag-white';
        white.src = WHITE_SRC;
        white.alt = '';
        plates.appendChild(white);

        tag.appendChild(plates);

        const logoUrl = boat.logoUrl || LOGO_PLACEHOLDER;
        const logo = document.createElement('img');
        logo.className = 'mf-crew-tag-logo';
        logo.alt = '';
        tag.appendChild(logo);
        if (boat.logoUrl) applyLogoCutout(logo, boat.logoUrl);
        else logo.src = logoUrl;

        const name = el(
            'span',
            'mf-crew-tag-name',
            boat.shortLabel || boat.label || `L${boat.slot}`,
        );
        tag.appendChild(name);

        return tag;
    }

    function placeTag(tag, left, top) {
        const x = Math.max(40, Math.min(OUT_W - 40, left));
        const y = Math.max(40, Math.min(OUT_H - 20, top));
        tag.style.left = `${x}px`;
        tag.style.top = `${y - TAG_GAP_PX}px`;
    }

    function crewSig(boats) {
        return boats
            .map(
                (b) =>
                    `${b.slot}|${b.shortLabel || ''}|${b.logoUrl || ''}|${Math.round(b.left)}|${Math.round(b.top)}|${b.place || ''}|${b.highlight || ''}`,
            )
            .join(';');
    }

    function identitySig(boats) {
        return boats
            .map((b) => `${b.slot}|${b.shortLabel || ''}|${b.logoUrl || ''}`)
            .join(';');
    }

    function markIntro(tags) {
        if (!rootEl) return;
        const list = tags?.length
            ? tags
            : [...rootEl.querySelectorAll('.mf-crew-tag')];
        list.forEach((tag, i) => {
            tag.classList.remove('mf-crew-tag--intro');
            /* Restart sequenced reveal */
            void tag.offsetWidth;
            tag.style.setProperty('--mf-crew-tag-delay', `${i * 0.06}s`);
            tag.classList.add('mf-crew-tag--intro');
        });
        if (introTimer) clearTimeout(introTimer);
        introTimer = setTimeout(() => {
            list.forEach((tag) => tag.classList.remove('mf-crew-tag--intro'));
            introTimer = null;
        }, INTRO_MS + list.length * 60 + 80);
    }

    function renderBoats(boats) {
        if (!rootEl) return;
        const list = boats.filter(
            (b) => Number.isFinite(b.left) && Number.isFinite(b.top),
        );
        const sig = crewSig(list);
        if (sig === lastCrewSig) return;
        const idChanged = identitySig(list) !== identitySig(
            [...rootEl.querySelectorAll('.mf-crew-tag')].map((tag) => ({
                slot: tag.dataset.slot,
                shortLabel: tag.querySelector('.mf-crew-tag-name')?.textContent || '',
                logoUrl: tag.querySelector('.mf-crew-tag-logo')?.dataset.logoSrc || '',
            })),
        );
        lastCrewSig = sig;

        const keep = new Set(list.map((b) => String(b.slot)));
        [...rootEl.querySelectorAll('.mf-crew-tag')].forEach((tag) => {
            if (!keep.has(tag.dataset.slot)) tag.remove();
        });

        const fresh = [];
        for (const boat of list) {
            const key = String(boat.slot);
            let tag = rootEl.querySelector(`.mf-crew-tag[data-slot="${key}"]`);
            if (!tag) {
                tag = buildTag(boat);
                rootEl.appendChild(tag);
                fresh.push(tag);
            } else {
                const nameEl = tag.querySelector('.mf-crew-tag-name');
                const label = boat.shortLabel || boat.label || `L${boat.slot}`;
                if (nameEl && nameEl.textContent !== label) nameEl.textContent = label;
                const logo = tag.querySelector('.mf-crew-tag-logo');
                if (logo && boat.logoUrl && logo.dataset.logoSrc !== boat.logoUrl) {
                    applyLogoCutout(logo, boat.logoUrl);
                }
                if (boat.drawLane != null) tag.dataset.lane = String(boat.drawLane);
            }
            if (boat.place != null) tag.dataset.place = String(boat.place);
            else delete tag.dataset.place;
            applyHighlight(tag, boat.highlight || '');
            placeTag(tag, boat.left, boat.top);
        }
        if (fresh.length || idChanged) {
            markIntro(fresh.length ? fresh : [...rootEl.querySelectorAll('.mf-crew-tag')]);
        }
        rootEl.classList.toggle('mf-crewtags--empty', !rootEl.childElementCount);
    }

    function renderFromCv(data) {
        if (!rootEl) return;
        if (!data || data.stale) {
            rootEl.classList.add('mf-crewtags--stale');
            if (useSample()) {
                renderBoats(sampleBoats(liveRace()));
            }
            return;
        }
        rootEl.classList.remove('mf-crewtags--stale');
        const race = liveRace();
        const map = global.AltitudeHdCvBoatMap;
        if (!race || !map?.enrichCvBoats) {
            if (useSample()) renderBoats(sampleBoats(race));
            else rootEl.replaceChildren();
            return;
        }
        const boats = map.enrichCvBoats(data, race, lookup());
        if (!boats.length) {
            if (useSample()) {
                renderBoats(sampleBoats(race));
                return;
            }
            rootEl.replaceChildren();
            return;
        }
        const placed = boats
            .map((boat) => {
                const pt = mapPoint(data, boat.x, boat.y);
                if (!pt) return null;
                return {
                    ...boat,
                    left: pt.left,
                    top: pt.top,
                };
            })
            .filter(Boolean);
        const ranked = placed.length
            ? withPlaces(placed, race, data)
            : useSample()
              ? sampleBoats(race)
              : [];
        renderBoats(ranked);
    }

    async function tick() {
        if (!rootEl) return;
        if (useSample() && !params().get('streamId') && !params().get('live')) {
            renderBoats(sampleBoats(liveRace()));
            return;
        }
        if (!global.AltitudeHdCvOverlay?.fetchPosition) {
            if (useSample()) renderBoats(sampleBoats(liveRace()));
            return;
        }
        try {
            const data = await global.AltitudeHdCvOverlay.fetchPosition();
            renderFromCv(data);
        } catch {
            rootEl.classList.add('mf-crewtags--stale');
            if (useSample()) renderBoats(sampleBoats(liveRace()));
        }
    }

    function clearPoll() {
        if (pollTimer != null) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function mount(layer) {
        stop();
        if (!layer) return null;
        rootEl = el('div', 'mf-crewtags');
        rootEl.dataset.vgLayout = 'mf-crewtags';
        rootEl.setAttribute('aria-hidden', 'true');
        layer.appendChild(rootEl);
        tick();
        clearPoll();
        pollTimer = setInterval(tick, pollMs());
        return rootEl;
    }

    function stop() {
        clearPoll();
        if (introTimer) {
            clearTimeout(introTimer);
            introTimer = null;
        }
        lastCrewSig = '';
        if (rootEl) {
            rootEl.remove();
            rootEl = null;
        }
    }

    function paint() {
        tick();
    }

    document.addEventListener('altitudehd:liverace', () => {
        if (rootEl) tick();
    });

    global.VmixMilfordCvCrewTags = {
        mount,
        stop,
        paint,
        useSample,
    };
})(typeof window !== 'undefined' ? window : globalThis);
