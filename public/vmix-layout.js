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
            draw: {
                'draw-head': {
                    left: '156px',
                    top: '191px',
                    width: '935px',
                    color: 'rgb(255, 255, 255)',
                },
                'draw-lanes': {
                    left: '253px',
                    top: '434px',
                    width: '900px',
                    gap: '0',
                    color: 'rgb(255, 255, 255)',
                },
                'draw-logo': { width: '37px', height: '35px' },
                'draw-crew': { color: 'rgb(255, 255, 255)' },
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
                    gap: '10px',
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
                    left: '182px',
                    top: '870px',
                    width: '100px',
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
            all[theme][graphic][id] = { ...props };
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
        for (const key of STYLE_KEYS) {
            if (props[key] == null || props[key] === '') continue;
            if (key === 'scale') continue;
            const v = props[key];
            el.style[key] =
                typeof v === 'number' && key !== 'scale' ? `${v}px` : String(v);
        }
        let transform = props.transform || '';
        if (props.scale != null && props.scale !== '' && Number(props.scale) !== 1) {
            const s = `scale(${props.scale})`;
            transform = transform ? `${s} ${transform}` : s;
        }
        if (transform) el.style.transform = transform;

        const hasLeft = props.left != null && props.left !== '';
        const hasTop = props.top != null && props.top !== '';
        if (hasLeft || hasTop) {
            const cs = global.getComputedStyle(el);
            if (cs.position === 'static') {
                el.style.position = 'absolute';
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
            if (id.endsWith('-logo') || id.endsWith('-crew')) {
                global.document
                    .querySelectorAll(`[data-vg-layout-target="${id}"]`)
                    .forEach((el) => applyStyle(el, props));
                continue;
            }
            const el = global.document.querySelector(`[data-vg-layout="${id}"]`);
            if (el) applyStyle(el, props);
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
    };
})(typeof window !== 'undefined' ? window : globalThis);
