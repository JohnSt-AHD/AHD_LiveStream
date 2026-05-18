/**
 * Saved vMix overlay layout overrides (per theme + graphic + region id).
 * Dev editor: ?dev=1 on vmix-kri.html / vmix-rnz-milford.html
 */
(function (global) {
    const LS_KEY = 'altitudeHdVmixLayout_v1';

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

    function apply(theme, graphic) {
        if (!theme || !graphic) return;
        const regions = readAll()[theme]?.[graphic];
        if (!regions) return;

        for (const [id, props] of Object.entries(regions)) {
            if (id.endsWith('-logo')) {
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
        readAll,
        writeAll,
        getRegion,
        setRegion,
        clearGraphic,
        apply,
        clearInline,
        applyStyle,
    };
})(typeof window !== 'undefined' ? window : globalThis);
