/**
 * Saved vMix overlay layout overrides (per theme + graphic + region id).
 * Dev editor: ?dev=1 on vmix-kri.html / vmix-rnz-milford.html
 */
(function (global) {
    const LS_KEY = 'altitudeHdVmixLayout_v2';
    const LAYOUT_BUILD = 26;

    /** Baked-in layout defaults (localStorage overrides per region). */
    const DEFAULT_LAYOUTS = {
        /* Dev-tuned KRI draw layout — panel-local absolute head; transforms for nested blocks. */
        kri: {
            draw: {
                'draw-head': {
                    left: '445px',
                    top: '337px',
                    width: '935px',
                    color: 'rgb(255, 255, 255)',
                },
                'draw-kicker': {
                    transform: 'translate(-433px, -320px)',
                    color: 'rgb(49, 62, 80)',
                },
                'draw-title': {
                    width: '900px',
                    transform: 'translate(-433px, -319px)',
                    color: 'rgb(49, 62, 80)',
                },
                'draw-meta': {
                    transform: 'translate(-433px, -318px)',
                    color: 'rgb(49, 62, 80)',
                },
                'draw-body': {
                    transform: 'translate(-200px, -100px)',
                    color: 'rgb(255, 255, 255)',
                },
                'draw-cols': {
                    transform: 'translate(212px, 110px)',
                    color: 'rgb(49, 62, 80)',
                },
                'draw-lanes': {
                    width: '900px',
                    transform: 'translate(212px, 122px)',
                    color: 'rgb(255, 255, 255)',
                },
                'draw-lane-n': {
                    color: 'rgb(255, 255, 255)',
                },
                'draw-logo': {
                    width: '37px',
                    height: '35px',
                    color: 'rgb(255, 255, 255)',
                },
                'draw-crew': {
                    color: 'rgb(255, 255, 255)',
                },
            },
            results: {
                'results-head': {
                    left: '445px',
                    top: '337px',
                    width: '935px',
                    color: 'rgb(255, 255, 255)',
                },
                'results-kicker': {
                    transform: 'translate(-433px, -320px)',
                    color: 'rgb(49, 62, 80)',
                },
                'results-title': {
                    width: '900px',
                    transform: 'translate(-433px, -319px)',
                    color: 'rgb(49, 62, 80)',
                },
                'results-meta': {
                    transform: 'translate(-433px, -318px)',
                    color: 'rgb(49, 62, 80)',
                },
                'results-body': {
                    transform: 'translate(-200px, -100px)',
                    color: 'rgb(255, 255, 255)',
                },
                'results-cols': {
                    transform: 'translate(212px, 110px)',
                    color: 'rgb(49, 62, 80)',
                },
                'results-lanes': {
                    width: '900px',
                    transform: 'translate(212px, 122px)',
                    color: 'rgb(255, 255, 255)',
                },
                'results-lane-n': {
                    color: 'rgb(255, 255, 255)',
                },
                'results-logo': {
                    width: '37px',
                    height: '35px',
                    color: 'rgb(255, 255, 255)',
                },
                'results-crew': {
                    color: 'rgb(255, 255, 255)',
                },
            },
            schedule: {
                'schedule-head': {
                    left: '445px',
                    top: '337px',
                    width: '935px',
                    color: 'rgb(255, 255, 255)',
                },
                'schedule-kicker': {
                    transform: 'translate(-433px, -320px)',
                    color: 'rgb(49, 62, 80)',
                },
                'schedule-title': {
                    width: '900px',
                    transform: 'translate(-433px, -319px)',
                    color: 'rgb(49, 62, 80)',
                },
                'schedule-meta': {
                    transform: 'translate(-433px, -318px)',
                    color: 'rgb(49, 62, 80)',
                },
                'schedule-body': {
                    transform: 'translate(-200px, -100px)',
                    color: 'rgb(255, 255, 255)',
                },
                'schedule-cols': {
                    transform: 'translate(212px, 110px)',
                    color: 'rgb(49, 62, 80)',
                },
                'schedule-rows': {
                    width: '900px',
                    transform: 'translate(212px, 122px)',
                    color: 'rgb(255, 255, 255)',
                },
            },
            lower: {
                'lower-meta': {
                    left: '500px',
                    top: '900px',
                    width: '100px',
                    height: '28px',
                    fontSize: '20px',
                    color: '#0060BF',
                },
                'lower-race': {
                    left: '202px',
                    top: '890px',
                    width: '280px',
                    height: '28px',
                    fontSize: '20px',
                },
                'lower-event': {
                    left: '160px',
                    top: '940px',
                    width: '586px',
                    height: '72px',
                    color: '#0060BF',
                },
            },
        },
        /* Positions from Milford GT templates (1920×1080) in gt-templates/extracted/ */
        'rnz-milford': {
            draw: {
                _playback: {
                    textInMs: 4500,
                    textOutMs: 27000,
                    outroMs: 500,
                },
                'draw-head': { left: '140px', top: '154px', width: '812px' },
                'draw-lanes': { left: '273px', top: '378px', width: '900px', gap: '24px' },
                'draw-logo': { width: '37px', height: '39px' },
                'draw-crew': {},
            },
            results: {
                _playback: {
                    textInMs: 6000,
                    textOutMs: 16000,
                    outroMs: 500,
                },
                'results-head': { left: '140px', top: '154px', width: '812px' },
                'results-lanes': { left: '273px', top: '378px', width: '900px', gap: '24px' },
                'results-logo': { width: '37px', height: '39px' },
                'results-crew': {},
            },
            lower: {
                _playback: {
                    textInMs: 1500,
                    pauseAtMs: 1500,
                    outroMs: 500,
                },
                'lower-meta': {
                    left: '294px',
                    top: '952px',
                    width: '200px',
                    height: '22px',
                    fontSize: '20px',
                },
                'lower-race': {
                    left: '420px',
                    top: '954px',
                    width: '280px',
                    height: '22px',
                    fontSize: '18px',
                },
                'lower-progression': {
                    left: '677px',
                    top: '960px',
                    fontSize: '18px',
                    color: '#ffffff',
                },
                'lower-event': {
                    left: '287px',
                    top: '996px',
                    width: '615px',
                    fontSize: '36px',
                    color: 'rgb(255, 255, 255)',
                },
            },
            speed: {
                _playback: {
                    textInMs: 1000,
                    pauseAtMs: 3000,
                    outroMs: 500,
                },
            },
            leader: {
                _playback: {
                    pauseAtMs: 6000,
                    outroMs: 500,
                },
                'leader-wrap': {},
                'leader-logo': {
                    left: '1476.5px',
                    top: '80px',
                    width: '59.094px',
                    height: '52.92px',
                },
                'leader-crew': {
                    left: '1556.5px',
                    top: '84px',
                    width: '308.61px',
                    height: '41.31px',
                    fontSize: '19.2px',
                    color: 'rgb(255, 255, 255)',
                },
                'leader-badge': {
                    left: '1629px',
                    top: '51px',
                    width: '92px',
                    height: '35.1px',
                    fontSize: '14.4px',
                },
                'leader-badge-lane': {
                    left: '1705px',
                    top: '51px',
                    width: '113.85px',
                    height: '35.1px',
                    fontSize: '14.4px',
                },
            },
        },
        'beachsprints-milford': {
            draw: {
                'draw-head': { left: '140px', top: '134px', width: '812px' },
                'draw-lanes': { left: '273px', top: '378px', width: '900px', gap: '24px' },
                'draw-logo': { width: '37px', height: '39px' },
                'draw-crew': {},
            },
            lower: {
                'lower-meta': {
                    left: '294px',
                    top: '952px',
                    width: '200px',
                    height: '22px',
                    fontSize: '20px',
                },
                'lower-race': {
                    left: '420px',
                    top: '954px',
                    width: '280px',
                    height: '22px',
                    fontSize: '18px',
                },
                'lower-progression': {
                    left: '677px',
                    top: '960px',
                    fontSize: '18px',
                    color: '#ffffff',
                },
                'lower-event': {
                    left: '287px',
                    top: '996px',
                    width: '615px',
                    fontSize: '36px',
                    color: 'rgb(255, 255, 255)',
                },
            },
        },
    };

    const STYLE_KEYS = [
        'left',
        'top',
        'width',
        'height',
        'gap',
        'fontSize',
        'transform',
        'scale',
        'columnGap',
        'rowGap',
        'color',
    ];

    const TIMING_KEYS = ['fadeInDelay', 'fadeInDuration', 'fadeOutDuration'];

    const PLAYBACK_KEYS = ['textInMs', 'pauseAtMs', 'textOutMs', 'outroMs'];

    const TIMING_CSS_VARS = {
        fadeInDelay: '--vg-fade-in-delay',
        fadeInDuration: '--vg-fade-in-duration',
        fadeOutDuration: '--vg-fade-out-duration',
    };

    function formatTimingSeconds(value) {
        if (value == null || value === '') return null;
        const s = String(value).trim();
        if (/ms$/i.test(s)) return s;
        if (/s$/i.test(s)) return s;
        const n = parseFloat(s);
        if (!Number.isFinite(n)) return s;
        return `${n}s`;
    }

    /** Strip properties that Save all accidentally copied from the wrong region. */
    const TRANSFORM_ONLY_REGIONS = new Set([
        'draw-kicker',
        'draw-title',
        'draw-meta',
        'draw-body',
        'draw-cols',
        'draw-lanes',
        'results-kicker',
        'results-title',
        'results-meta',
        'results-body',
        'results-cols',
        'results-lanes',
        'schedule-kicker',
        'schedule-title',
        'schedule-meta',
        'schedule-body',
        'schedule-cols',
        'schedule-rows',
    ]);

    function sanitizeRegionProps(id, props, isTarget = false) {
        if (!props || typeof props !== 'object') return {};
        if (id === '_playback') {
            const out = {};
            for (const key of PLAYBACK_KEYS) {
                if (props[key] == null || props[key] === '') continue;
                const n = parseInt(String(props[key]), 10);
                if (Number.isFinite(n)) out[key] = n;
            }
            return out;
        }
        const allowed = new Set(['color', ...TIMING_KEYS]);
        if (isTarget) {
            allowed.add('transform');
            if (String(id).includes('logo')) {
                allowed.add('width');
                allowed.add('height');
            }
        } else {
            for (const key of [
                'transform',
                'left',
                'top',
                'width',
                'height',
                'gap',
                'columnGap',
                'rowGap',
                'fontSize',
                'scale',
            ]) {
                allowed.add(key);
            }
        }
        const out = {};
        for (const [key, value] of Object.entries(props)) {
            if (!allowed.has(key) || value == null || value === '') continue;
            if (key === 'transform' && value === 'translate(0px, 0px)') continue;
            out[key] = value;
        }
        if (TRANSFORM_ONLY_REGIONS.has(id)) {
            delete out.left;
            delete out.top;
        }
        return out;
    }

    function readAll() {
        try {
            const raw = global.localStorage.getItem(LS_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeAll(data) {
        try {
            global.localStorage.setItem(LS_KEY, JSON.stringify(data));
        } catch {
            /* quota */
        }
    }

    function getRegion(theme, graphic, id) {
        const defaults = DEFAULT_LAYOUTS[theme]?.[graphic]?.[id];
        const saved = readAll()[theme]?.[graphic]?.[id];
        if (!defaults && !saved) return null;
        const merged = { ...(defaults || {}), ...(saved || {}) };
        const targets = global.document.querySelectorAll(
            `[data-vg-layout-target="${id}"]`,
        );
        return sanitizeRegionProps(id, merged, targets.length > 0);
    }

    function setRegion(theme, graphic, id, props) {
        const all = readAll();
        if (!all[theme]) all[theme] = {};
        if (!all[theme][graphic]) all[theme][graphic] = {};
        if (props == null) {
            delete all[theme][graphic][id];
        } else {
            const targets = global.document.querySelectorAll(
                `[data-vg-layout-target="${id}"]`,
            );
            all[theme][graphic][id] = sanitizeRegionProps(
                id,
                props,
                targets.length > 0,
            );
        }
        writeAll(all);
    }

    function clearGraphic(theme, graphic) {
        const all = readAll();
        if (all[theme]?.[graphic]) {
            delete all[theme][graphic];
            writeAll(all);
        }
    }

    function applyStyle(el, props) {
        if (!el || !props) return;
        const hasLeft = props.left != null && props.left !== '';
        const hasTop = props.top != null && props.top !== '';
        const hasTransform = props.transform != null && props.transform !== '';
        const useAbsolute = hasLeft || hasTop;

        for (const key of STYLE_KEYS) {
            if (props[key] == null || props[key] === '') continue;
            if (key === 'scale') continue;
            if (key === 'transform' && useAbsolute) continue;
            if (key === 'left' || key === 'top') {
                if (!useAbsolute) continue;
            }
            const v = props[key];
            el.style[key] =
                typeof v === 'number' && key !== 'scale' ? `${v}px` : String(v);
        }
        let transform = useAbsolute ? '' : props.transform || '';
        if (!useAbsolute && props.scale != null && props.scale !== '' && Number(props.scale) !== 1) {
            const s = `scale(${props.scale})`;
            transform = transform ? `${s} ${transform}` : s;
        }
        if (useAbsolute) {
            el.style.transform = '';
            const cs = global.getComputedStyle(el);
            if (cs.position === 'static') {
                el.style.position = 'absolute';
            }
        } else if (transform) {
            el.style.transform = transform;
            el.style.left = '';
            el.style.top = '';
            if (el.style.position === 'absolute') {
                el.style.position = '';
            }
        }

        if (props.color) {
            el.style.color = String(props.color);
            el.querySelectorAll('h1, h2, h3, h4, p, span, li, ul, div').forEach((node) => {
                node.style.color = String(props.color);
            });
        }

        for (const key of TIMING_KEYS) {
            const cssVar = TIMING_CSS_VARS[key];
            if (!cssVar) continue;
            if (props[key] == null || props[key] === '') {
                el.style.removeProperty(cssVar);
                continue;
            }
            el.style.setProperty(cssVar, formatTimingSeconds(props[key]));
        }
    }

    function getPlayback(theme, graphic) {
        const region = getRegion(theme, graphic, '_playback');
        return region && Object.keys(region).length ? region : null;
    }

    function getRegions(theme, graphic) {
        const defaults = DEFAULT_LAYOUTS[theme]?.[graphic] || {};
        const saved = readAll()[theme]?.[graphic] || {};
        const out = {};
        const ids = new Set([...Object.keys(defaults), ...Object.keys(saved)]);
        for (const id of ids) {
            const merged = { ...(defaults[id] || {}), ...(saved[id] || {}) };
            const targets = global.document.querySelectorAll(
                `[data-vg-layout-target="${id}"]`,
            );
            out[id] = sanitizeRegionProps(id, merged, targets.length > 0);
        }
        return out;
    }

    function apply(theme, graphic) {
        if (!theme || !graphic) return;
        const regions = getRegions(theme, graphic);
        if (!Object.keys(regions).length) return;

        for (const [id, props] of Object.entries(regions)) {
            const targets = global.document.querySelectorAll(
                `[data-vg-layout-target="${id}"]`,
            );
            const clean = sanitizeRegionProps(id, props, targets.length > 0);
            if (targets.length) {
                targets.forEach((el) => applyStyle(el, clean));
                continue;
            }
            const el = global.document.querySelector(`[data-vg-layout="${id}"]`);
            if (el) applyStyle(el, clean);
        }
    }

    function clearInline(theme, graphic) {
        global.document.querySelectorAll('[data-vg-layout]').forEach((el) => {
            el.style.cssText = '';
        });
        global.document.querySelectorAll('[data-vg-layout-target]').forEach((el) => {
            el.style.cssText = '';
        });
    }

    global.VmixLayout = {
        LS_KEY,
        LAYOUT_BUILD,
        DEFAULT_LAYOUTS,
        TIMING_KEYS,
        PLAYBACK_KEYS,
        readAll,
        writeAll,
        getRegion,
        getRegions,
        getPlayback,
        setRegion,
        clearGraphic,
        apply,
        clearInline,
        applyStyle,
        sanitizeRegionProps,
    };
})(typeof window !== 'undefined' ? window : globalThis);
