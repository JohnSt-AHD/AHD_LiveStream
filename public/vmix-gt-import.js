/**
 * Parse vMix GT Designer templates (.gtxml, .gtzip, or plain .gt XML)
 * for text/object position and animation timing.
 *
 * Drop source files in /gt-templates/ or import via ?dev=1 layout panel.
 */
(function (global) {
    const REGION_ALIASES = {
        'draw-head': /draw|head|event|title|race|meta|header/i,
        'draw-lanes': /lane|lanes|list|grid|row/i,
        'draw-logo': /logo|crest|badge|school.*img/i,
        'draw-crew': /crew|club|school|name|athlete/i,
        'lower-meta': /meta|round|progression/i,
        'lower-race': /race.*num|number|time/i,
        'lower-event': /event|discipline/i,
        'title': /^title$/i,
        'results-head': /result.*head|results.*head/i,
        'results-lanes': /result.*lane/i,
        'results-logo': /result.*logo/i,
        'results-crew': /result.*crew|result.*club/i,
    };

    function parseMargin(margin) {
        if (!margin) return null;
        const p = String(margin)
            .split(',')
            .map((s) => parseFloat(s.trim()));
        if (p.length < 2 || Number.isNaN(p[0]) || Number.isNaN(p[1])) return null;
        return { left: p[0], top: p[1] };
    }

    function parseDuration(raw) {
        if (raw == null || raw === '') return null;
        const s = String(raw).trim();
        const parts = s.split(':').map((x) => parseFloat(x));
        if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : null;
    }

    function px(v) {
        if (v == null || v === '') return null;
        const n = parseFloat(String(v).replace(/px$/i, ''));
        return Number.isFinite(n) ? `${n}px` : String(v);
    }

    function colorToCss(fg) {
        if (!fg) return null;
        const s = String(fg).trim();
        if (/^#/.test(s) || /^rgb/i.test(s)) return s;
        return null;
    }

    function attr(el, name) {
        return (
            el.getAttribute(name) ||
            el.getAttribute(`x:${name}`) ||
            el.getAttributeNS('http://schemas.microsoft.com/winfx/2006/xaml', name)
        );
    }

    function elementPosition(el) {
        const margin = parseMargin(attr(el, 'Margin'));
        const canvasLeft = parseFloat(attr(el, 'Canvas.Left'));
        const canvasTop = parseFloat(attr(el, 'Canvas.Top'));
        const left = Number.isFinite(canvasLeft)
            ? canvasLeft
            : margin
              ? margin.left
              : null;
        const top = Number.isFinite(canvasTop)
            ? canvasTop
            : margin
              ? margin.top
              : null;
        const props = {};
        if (left != null) props.left = px(left);
        if (top != null) props.top = px(top);
        const w = attr(el, 'Width');
        const h = attr(el, 'Height');
        if (w) props.width = px(w);
        if (h) props.height = px(h);
        const fs = attr(el, 'FontSize');
        if (fs) props.fontSize = px(fs);
        const fg = colorToCss(attr(el, 'Foreground'));
        if (fg) props.color = fg;
        return props;
    }

    function guessRegionId(name, graphic) {
        if (!name) return null;
        const n = String(name);
        for (const [regionId, re] of Object.entries(REGION_ALIASES)) {
            if (!regionId.startsWith(graphic.split('-')[0]) && graphic.includes('-')) {
                if (!regionId.includes(graphic.replace(/-.*/, '')) && graphic !== 'lower') {
                    /* allow cross-match for draw/results prefixes */
                }
            }
            if (re.test(n)) return regionId;
        }
        if (/head/i.test(n) && graphic === 'draw') return 'draw-head';
        if (/head/i.test(n) && graphic === 'results') return 'results-head';
        return null;
    }

    function parseAnimations(doc) {
        const out = {};
        const animTags = [
            'DoubleAnimation',
            'ThicknessAnimation',
            'ColorAnimation',
            'ObjectAnimationUsingKeyFrames',
        ];
        for (const tag of animTags) {
            doc.querySelectorAll(tag).forEach((anim) => {
                const target =
                    attr(anim, 'Storyboard.TargetName') ||
                    anim.getAttribute('Storyboard.TargetName');
                if (!target) return;
                const begin = parseDuration(attr(anim, 'BeginTime')) || 0;
                const dur = parseDuration(attr(anim, 'Duration')) || 0;
                if (!out[target]) out[target] = [];
                out[target].push({
                    beginSec: begin,
                    durationSec: dur,
                    endSec: begin + dur,
                    tag,
                });
            });
        }
        doc.querySelectorAll('Storyboard').forEach((sb) => {
            const begin = parseDuration(attr(sb, 'BeginTime')) || 0;
            const dur = parseDuration(attr(sb, 'Duration'));
            const name = attr(sb, 'x:Name') || attr(sb, 'Name') || 'Storyboard';
            if (!out[name]) out[name] = [];
            out[name].push({
                beginSec: begin,
                durationSec: dur,
                endSec: dur != null ? begin + dur : null,
                tag: 'Storyboard',
            });
        });
        return out;
    }

    function parseGtXml(xmlText) {
        const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        if (doc.querySelector('parsererror')) {
            throw new Error('Invalid GT/XML document');
        }

        const elements = [];
        const tagNames = [
            'TextBlock',
            'Rectangle',
            'Image',
            'Grid',
            'Canvas',
            'Border',
        ];

        for (const tag of tagNames) {
            doc.querySelectorAll(tag).forEach((el) => {
                const name = attr(el, 'Name');
                const props = elementPosition(el);
                if (!name && !props.left && !props.top) return;
                elements.push({
                    name: name || `${tag}_${elements.length}`,
                    tag,
                    props,
                    text: (el.textContent || '').trim().slice(0, 80),
                });
            });
        }

        return {
            elements,
            animations: parseAnimations(doc),
            rawLength: xmlText.length,
        };
    }

    function mapToLayoutRegions(parsed, graphic) {
        const regions = {};
        const unmapped = [];

        for (const el of parsed.elements) {
            const regionId = guessRegionId(el.name, graphic);
            if (!regionId) {
                unmapped.push(el);
                continue;
            }
            if (!regions[regionId]) {
                regions[regionId] = { ...el.props };
            } else {
                Object.assign(regions[regionId], el.props);
            }
        }

        return { regions, unmapped };
    }

    function timingHints(parsed, graphic) {
        const hints = [];
        for (const [name, anims] of Object.entries(parsed.animations)) {
            const regionId = guessRegionId(name, graphic) || name;
            for (const a of anims) {
                hints.push({
                    regionId,
                    name,
                    beginMs: Math.round(a.beginSec * 1000),
                    durationMs: Math.round((a.durationSec || 0) * 1000),
                    endMs:
                        a.endSec != null
                            ? Math.round(a.endSec * 1000)
                            : null,
                });
            }
        }
        return hints;
    }

    async function loadGtFile(file) {
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.gtxml') || name.endsWith('.gt')) {
            const text = await file.text();
            return parseGtXml(text);
        }
        if (name.endsWith('.gtzip')) {
            if (!global.JSZip) {
                throw new Error(
                    'GTZIP requires JSZip. Use a .gtxml export, or open ?dev=1 on a page that loads JSZip.',
                );
            }
            const buf = await file.arrayBuffer();
            const zip = await global.JSZip.loadAsync(buf);
            const docName = zip.files['document.xml']
                ? 'document.xml'
                : Object.keys(zip.files).find((k) => /document\.xml$/i.test(k));
            if (!docName) {
                throw new Error('GTZIP has no document.xml');
            }
            const text = await zip.files[docName].async('string');
            return parseGtXml(text);
        }
        const text = await file.text();
        if (text.trim().startsWith('<')) return parseGtXml(text);
        throw new Error('Unsupported file type. Use .gtxml, .gtzip, or .gt XML.');
    }

    async function importFileToLayout(file, theme, graphic) {
        const parsed = await loadGtFile(file);
        const { regions, unmapped } = mapToLayoutRegions(parsed, graphic);
        const hints = timingHints(parsed, graphic);

        if (global.VmixLayout) {
            for (const [id, props] of Object.entries(regions)) {
                global.VmixLayout.setRegion(theme, graphic, id, props);
            }
            global.VmixLayout.apply(theme, graphic);
        }

        return { parsed, regions, unmapped, hints };
    }

    global.VmixGtImport = {
        parseGtXml,
        mapToLayoutRegions,
        timingHints,
        loadGtFile,
        importFileToLayout,
        guessRegionId,
    };
})(typeof window !== 'undefined' ? window : globalThis);
