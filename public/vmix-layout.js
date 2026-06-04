/**
 * Saved vMix overlay layout overrides (per theme + graphic + region id).
 * Dev editor: ?dev=1 on vmix-kri.html / vmix-rnz-milford.html
 */
(function (global) {
    const LS_KEY = 'altitudeHdVmixLayout_v1';

    /** Baked-in layout defaults (localStorage overrides per region). */
    const DEFAULT_LAYOUTS = {
        /* Positions from KRI GT templates (1920×1080) in gt-templates/extracted/kri/ */
        kri: {
            /* Dev-tuned draw layout (1920×1080) — vmix-kri.html?dev=1&g=d */
            draw: {
                'draw-head': {
                    width: '935px',
                    transform: 'translate(7px, 0px)',
                    color: 'rgb(255, 255, 255)',
                    left: '160px',
                    top: '174px',
                },
                'draw-kicker': {
                    transform: 'translate(-65px, -93px)',
                    color: 'rgb(255, 255, 255)',
                },
                'draw-title': {
                    transform: 'translate(7px, 0px)',
                    color: 'rgb(255, 255, 255)',
                    left: '96px',
                    top: '114px',
                },
                'draw-meta': {
                    transform: 'translate(-65px, -20px)',
                    color: 'rgb(255, 255, 255)',
                },
                'draw-body': {
                    transform: 'translate(-200px, -100px)',
                    color: 'rgb(255, 255, 255)',
                },
                'draw-cols': {
                    transform: 'translate(206px, 218px)',
                    color: 'rgb(255, 255, 255)',
                },
                'draw-lanes': {
                    transform: 'translate(204px, 241px)',
                    color: 'rgb(255, 255, 255)',
                    width: '900px',
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
                    left: '156px',
                    top: '191px',
                    width: '935px',
                    color: 'rgb(255, 255, 255)',
                },
                'results-lanes': {
                    left: '253px',
                    top: '434px',
                    width: '900px',
                    gap: '0',
                    color: 'rgb(255, 255, 255)',
                },
                'results-logo': { width: '37px', height: '35px' },
                'results-crew': { color: 'rgb(255, 255, 255)' },
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
                'draw-head': { left: '140px', top: '154px', width: '812px' },
                'draw-lanes': { left: '273px', top: '378px', width: '900px', gap: '24px' },
                'draw-logo': { width: '37px', height: '39px' },
                'draw-crew': {},
            },
            results: {
                'results-head': { left: '140px', top: '134px', width: '812px' },
                'results-lanes': { left: '273px', top: '378px', width: '900px', gap: '24px' },
                'results-logo': { width: '37px', height: '39px' },
                'results-crew': {},
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
                    left: '436px',
                    top: '952px',
                    width: '280px',
                    height: '22px',
                    fontSize: '20px',
                },
                'lower-event': {
                    left: '287px',
                    top: '996px',
                    width: '615px',
                    fontSize: '36px',
                    color: 'rgb(255, 255, 255)',
                },
            },
            leader: {
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
                    fontSize: '21.87px',
                    color: 'rgb(255, 255, 255)',
                },
                'leader-badge': {
                    left: '1662px',
                    top: '51px',
                    width: '92px',
                    height: '35.1px',
                    fontSize: '14.4px',
                },
                'leader-badge-lane': {
                    left: '1720px',
                    top: '51px',
                    width: '113.85px',
                    height: '35.1px',
                    fontSize: '18px',
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
                    left: '436px',
                    top: '952px',
                    width: '280px',
                    height: '22px',
                    fontSize: '20px',
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

    /** Strip properties that Save all accidentally copied from the wrong region. */
    const TRANSFORM_ONLY_REGIONS = new Set([
        'draw-kicker',
        'draw-meta',
        'draw-body',
        'draw-cols',
        'draw-lanes',
        'results-kicker',
        'results-meta',
        'results-cols',
        'results-lanes',
    ]);

    function sanitizeRegionProps(id, props, isTarget = false) {
        if (!props || typeof props !== 'object') return {};
        const allowed = new Set(['color']);
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
        return readAll()[theme]?.[graphic]?.[id] || null;
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

        for (const key of STYLE_KEYS) {
            if (props[key] == null || props[key] === '') continue;
            if (key === 'scale') continue;
            if (key === 'left' || key === 'top') {
                if (hasTransform && !hasLeft && !hasTop) continue;
            }
            const v = props[key];
            el.style[key] =
                typeof v === 'number' && key !== 'scale' ? `${v}px` : String(v);
        }
        let transform = props.transform || '';
        if (props.scale != null && props.scale !== '' && Number(props.scale) !== 1) {
            const s = `scale(${props.scale})`;
            transform = transform ? `${s} ${transform}` : s;
        }
        if (transform) {
            el.style.transform = transform;
        }

        if (hasLeft || hasTop) {
            const cs = global.getComputedStyle(el);
            if (cs.position === 'static') {
                el.style.position = 'absolute';
            }
        } else if (hasTransform) {
            el.style.left = '';
            el.style.top = '';
            if (el.style.position === 'absolute') {
                el.style.position = '';
            }
        }

        if (props.color) {
            el.querySelectorAll('h1, h2, h3, h4, p, span, li, ul, div').forEach((node) => {
                node.style.color = String(props.color);
            });
        }
    }

    function getRegions(theme, graphic) {
        const defaults = DEFAULT_LAYOUTS[theme]?.[graphic] || {};
        const saved = readAll()[theme]?.[graphic] || {};
        return { ...defaults, ...saved };
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
        DEFAULT_LAYOUTS,
        readAll,
        writeAll,
        getRegion,
        getRegions,
        setRegion,
        clearGraphic,
        apply,
        clearInline,
        applyStyle,
        sanitizeRegionProps,
    };
})(typeof window !== 'undefined' ? window : globalThis);
