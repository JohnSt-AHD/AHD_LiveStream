/**
 * Dev layout editor — ?dev=1&g=d on vmix overlay pages.
 */
(function (global) {
    const LAYOUT_IDS = {
        title: [{ id: 'title', label: 'Title block' }],
        lower: [
            { id: 'lower', label: 'Lower third (whole layer)' },
            { id: 'lower-meta', label: 'Lower — round / progression' },
            { id: 'lower-race', label: 'Lower — race number + time' },
            { id: 'lower-event', label: 'Lower — event title' },
        ],
        draw: [
            { id: 'draw-head', label: 'Draw — header text' },
            { id: 'draw-lanes', label: 'Draw — lane list' },
            { id: 'draw-logo', label: 'Draw — school logos', target: 'draw-logo' },
            { id: 'draw-crew', label: 'Draw — crew text', target: 'draw-crew' },
        ],
        results: [
            { id: 'results-head', label: 'Results — header text' },
            { id: 'results-lanes', label: 'Results — lane list' },
            { id: 'results-logo', label: 'Results — school logos', target: 'results-logo' },
            { id: 'results-crew', label: 'Results — crew text', target: 'results-crew' },
        ],
    };

    const editor = {
        theme: '',
        graphic: 'draw',
        selectedId: null,
        drag: null,
        panel: null,
        statusEl: null,
    };

    function isDevMode() {
        const p = new URLSearchParams(global.location.search);
        return p.get('dev') === '1' || p.get('layout') === 'edit';
    }

    function getStage() {
        return global.document.querySelector('.vg-stage');
    }

    function regionDefs(graphic) {
        return LAYOUT_IDS[graphic] || [];
    }

    function findBlockEl(id) {
        return global.document.querySelector(`[data-vg-layout="${id}"]`);
    }

    function findTargetEls(targetKey) {
        return global.document.querySelectorAll(`[data-vg-layout-target="${targetKey}"]`);
    }

    function readPropsFromEl(el) {
        const s = el.style;
        const props = {};
        for (const key of ['left', 'top', 'width', 'height', 'gap', 'fontSize', 'transform', 'columnGap', 'color']) {
            if (s[key]) props[key] = s[key];
        }
        const m = s.transform?.match(/scale\(([\d.]+)\)/);
        if (m) props.scale = parseFloat(m[1]);
        return props;
    }

    function stagePoint(clientX, clientY) {
        const stage = getStage();
        if (!stage) return { x: 0, y: 0 };
        const r = stage.getBoundingClientRect();
        return {
            x: ((clientX - r.left) / r.width) * 1920,
            y: ((clientY - r.top) / r.height) * 1080,
        };
    }

    function elPositionPx(el) {
        const stage = getStage();
        if (!stage) return { left: 0, top: 0 };
        const er = el.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        return {
            left: ((er.left - sr.left) / sr.width) * 1920,
            top: ((er.top - sr.top) / sr.height) * 1080,
        };
    }

    function getSelectedDef() {
        return regionDefs(editor.graphic).find((d) => d.id === editor.selectedId);
    }

    function selectRegion(id) {
        editor.selectedId = id;
        global.document.querySelectorAll('.vg-layout-selected').forEach((n) => {
            n.classList.remove('vg-layout-selected');
        });
        const def = getSelectedDef();
        if (!def) return;
        if (def.target) {
            const first = findTargetEls(def.target)[0];
            if (first) first.classList.add('vg-layout-selected');
        } else {
            const el = findBlockEl(def.id);
            if (el) el.classList.add('vg-layout-selected');
        }
        syncFieldsFromSelection();
    }

    function syncFieldsFromSelection() {
        const panel = editor.panel;
        const def = getSelectedDef();
        if (!panel || !def) return;

        const el = def.target ? findTargetEls(def.target)[0] : findBlockEl(def.id);
        if (!el) return;

        const pos = elPositionPx(el);
        const set = (name, val) => {
            const input = panel.querySelector(`[data-field="${name}"]`);
            if (input) input.value = val ?? '';
        };
        set('left', Math.round(pos.left));
        set('top', Math.round(pos.top));
        const saved = global.VmixLayout.getRegion(editor.theme, editor.graphic, def.id);
        set('width', saved?.width || el.style.width || '');
        set('gap', saved?.gap || el.style.gap || '');
        set('fontSize', saved?.fontSize || el.style.fontSize || '');
        set('transform', saved?.transform || el.style.transform || '');
        set('scale', saved?.scale ?? '');
        const computedColor = global.getComputedStyle(el).color || '';
        set('color', saved?.color || el.style.color || rgbToHex(computedColor) || '');
    }

    function rgbToHex(rgb) {
        if (!rgb) return '';
        if (/^#/.test(rgb)) return rgb;
        const m = rgb.match(/rgba?\(([^)]+)\)/);
        if (!m) return '';
        const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
        if (parts.length < 3) return '';
        const [r, g, b] = parts;
        const to2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
        return `#${to2(r)}${to2(g)}${to2(b)}`;
    }

    function applyFieldsToSelection() {
        const def = getSelectedDef();
        const panel = editor.panel;
        if (!def || !panel) return;

        const props = collectFieldProps();

        if (def.target) {
            findTargetEls(def.target).forEach((el) => global.VmixLayout.applyStyle(el, props));
        } else {
            const el = findBlockEl(def.id);
            if (el) global.VmixLayout.applyStyle(el, props);
        }
    }

    function collectFieldProps() {
        const panel = editor.panel;
        const get = (name) => panel.querySelector(`[data-field="${name}"]`)?.value?.trim() ?? '';
        const props = {};
        if (get('left') !== '') props.left = `${get('left')}px`;
        if (get('top') !== '') props.top = `${get('top')}px`;
        if (get('width')) props.width = get('width');
        if (get('gap')) props.gap = get('gap');
        if (get('fontSize')) props.fontSize = get('fontSize');
        if (get('transform')) props.transform = get('transform');
        if (get('scale') !== '') props.scale = Number(get('scale')) || 1;
        if (get('color')) props.color = get('color');
        return props;
    }

    function setStatus(msg, isErr) {
        if (!editor.statusEl) return;
        editor.statusEl.textContent = msg;
        editor.statusEl.classList.toggle('vg-layout-status--err', !!isErr);
    }

    function saveCurrent() {
        const def = getSelectedDef();
        if (!def) {
            setStatus('Select a region first.', true);
            return;
        }
        applyFieldsToSelection();
        const el = def.target ? findTargetEls(def.target)[0] : findBlockEl(def.id);
        const props = el ? readPropsFromEl(el) : {};
        Object.assign(props, collectFieldProps());

        global.VmixLayout.setRegion(editor.theme, editor.graphic, def.id, props);
        setStatus(`Saved ${editor.theme} / ${editor.graphic} / ${def.id}`);
    }

    function saveAllVisible() {
        for (const def of regionDefs(editor.graphic)) {
            if (def.target) {
                const el = findTargetEls(def.target)[0];
                if (!el) continue;
                const props = readPropsFromEl(el);
                global.VmixLayout.setRegion(editor.theme, editor.graphic, def.id, props);
            } else {
                const el = findBlockEl(def.id);
                if (!el) continue;
                const pos = elPositionPx(el);
                const props = readPropsFromEl(el);
                props.left = `${Math.round(pos.left)}px`;
                props.top = `${Math.round(pos.top)}px`;
                global.VmixLayout.setRegion(editor.theme, editor.graphic, def.id, props);
            }
        }
        setStatus(`Saved all regions for ${editor.graphic}`);
    }

    function resetGraphic() {
        global.VmixLayout.clearGraphic(editor.theme, editor.graphic);
        global.VmixLayout.clearInline(editor.theme, editor.graphic);
        previewGraphic(editor.graphic);
        setStatus(`Reset ${editor.graphic} to CSS defaults`);
    }

    async function copyJson() {
        const all = global.VmixLayout.readAll();
        const slice = {
            [editor.theme]: {
                [editor.graphic]: all[editor.theme]?.[editor.graphic] || {},
            },
        };
        const text = JSON.stringify(slice, null, 2);
        try {
            await global.navigator.clipboard.writeText(text);
            setStatus('Layout JSON copied to clipboard');
        } catch {
            global.prompt('Copy layout JSON:', text);
        }
    }

    function onPointerDown(e) {
        const block = e.target.closest('[data-vg-layout]');
        const logo = e.target.closest('[data-vg-layout-target]');
        const target = block || logo;
        if (!target) return;
        e.preventDefault();

        if (block) {
            editor.selectedId = block.getAttribute('data-vg-layout');
        } else {
            editor.selectedId = logo.getAttribute('data-vg-layout-target');
        }
        const regionSel = editor.panel?.querySelector('#vgLayoutRegion');
        if (regionSel) regionSel.value = editor.selectedId;
        selectRegion(editor.selectedId);

        const pos = elPositionPx(target);
        const pt = stagePoint(e.clientX, e.clientY);
        editor.drag = {
            el: target,
            isLogo: !!logo,
            startX: pt.x,
            startY: pt.y,
            origLeft: pos.left,
            origTop: pos.top,
            origTransform: target.style.transform || '',
        };
        target.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e) {
        if (!editor.drag) return;
        const pt = stagePoint(e.clientX, e.clientY);
        const dx = Math.round(pt.x - editor.drag.startX);
        const dy = Math.round(pt.y - editor.drag.startY);

        if (editor.drag.isLogo) {
            const key = editor.drag.el.getAttribute('data-vg-layout-target');
            findTargetEls(key).forEach((node) => {
                node.style.transform = `translate(${dx}px, ${dy}px)`;
            });
        } else {
            editor.drag.el.style.left = `${Math.round(editor.drag.origLeft + dx)}px`;
            editor.drag.el.style.top = `${Math.round(editor.drag.origTop + dy)}px`;
        }

        const panel = editor.panel;
        const leftInput = panel?.querySelector('[data-field="left"]');
        const topInput = panel?.querySelector('[data-field="top"]');
        if (leftInput) leftInput.value = String(Math.round(editor.drag.origLeft + dx));
        if (topInput) topInput.value = String(Math.round(editor.drag.origTop + dy));
        if (editor.drag.isLogo) {
            const transformInput = panel?.querySelector('[data-field="transform"]');
            if (transformInput) transformInput.value = `translate(${dx}px, ${dy}px)`;
        }
    }

    function onPointerUp() {
        editor.drag = null;
    }

    function onKeyDown(e) {
        if (!editor.selectedId) return;
        const def = getSelectedDef();
        if (!def || def.target) return;
        const el = findBlockEl(def.id);
        if (!el) return;

        const step = e.shiftKey ? 10 : 1;
        let left = parseFloat(el.style.left);
        let top = parseFloat(el.style.top);
        if (!Number.isFinite(left)) left = elPositionPx(el).left;
        if (!Number.isFinite(top)) top = elPositionPx(el).top;

        if (e.key === 'ArrowLeft') left -= step;
        else if (e.key === 'ArrowRight') left += step;
        else if (e.key === 'ArrowUp') top -= step;
        else if (e.key === 'ArrowDown') top += step;
        else return;

        e.preventDefault();
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        syncFieldsFromSelection();
    }

    function mountPanel() {
        editor.panel = global.document.createElement('div');
        editor.panel.className = 'vg-layout-panel';
        editor.panel.innerHTML = `
            <h2>Layout dev mode</h2>
            <p>Drag blocks or logos. Saved in this browser only — vMix Web Browser on the same PC uses the same store. Arrow keys nudge (Shift = 10px).</p>
            <label for="vgLayoutGraphic">Graphic</label>
            <select id="vgLayoutGraphic">
                <option value="title">Title</option>
                <option value="lower">Lower third</option>
                <option value="draw">Draw</option>
                <option value="results">Results</option>
            </select>
            <label for="vgLayoutRegion">Region</label>
            <select id="vgLayoutRegion"></select>
            <div class="vg-layout-fields">
                <div><label>Left (px)</label><input data-field="left" type="number" step="1"></div>
                <div><label>Top (px)</label><input data-field="top" type="number" step="1"></div>
                <div><label>Width</label><input data-field="width" type="text" placeholder="860px"></div>
                <div><label>Gap</label><input data-field="gap" type="text" placeholder="4.5px"></div>
                <div><label>Font size</label><input data-field="fontSize" type="text"></div>
                <div><label>Transform</label><input data-field="transform" type="text" placeholder="translate(5vw, 1vh)"></div>
                <div><label>Scale</label><input data-field="scale" type="number" step="0.05" min="0.5" max="1.5"></div>
                <div class="vg-layout-field-color"><label>Text colour</label><input data-field="color" type="color"></div>
            </div>
            <div class="vg-layout-actions">
                <button type="button" class="primary" data-action="save">Save region</button>
                <button type="button" class="secondary" data-action="save-all">Save all</button>
                <button type="button" class="secondary" data-action="apply">Apply fields</button>
                <button type="button" class="secondary" data-action="copy">Copy JSON</button>
                <button type="button" class="danger" data-action="reset">Reset graphic</button>
            </div>
            <p class="vg-layout-status" id="vgLayoutStatus"></p>
        `;

        global.document.body.appendChild(editor.panel);
        editor.statusEl = editor.panel.querySelector('#vgLayoutStatus');

        const gSel = editor.panel.querySelector('#vgLayoutGraphic');
        gSel.value = editor.graphic;
        gSel.addEventListener('change', () => {
            editor.graphic = gSel.value;
            previewGraphic(editor.graphic);
            populateRegionSelect();
        });

        editor.panel.querySelector('#vgLayoutRegion').addEventListener('change', (e) => {
            selectRegion(e.target.value);
        });

        editor.panel.querySelectorAll('[data-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const a = btn.getAttribute('data-action');
                if (a === 'save') saveCurrent();
                else if (a === 'save-all') saveAllVisible();
                else if (a === 'apply') applyFieldsToSelection();
                else if (a === 'copy') copyJson();
                else if (a === 'reset') resetGraphic();
            });
        });

        const colorInput = editor.panel.querySelector('[data-field="color"]');
        if (colorInput) {
            colorInput.addEventListener('input', () => applyFieldsToSelection());
        }

        populateRegionSelect();
    }

    function populateRegionSelect() {
        const sel = editor.panel.querySelector('#vgLayoutRegion');
        if (!sel) return;
        sel.replaceChildren();
        for (const def of regionDefs(editor.graphic)) {
            const opt = global.document.createElement('option');
            opt.value = def.id;
            opt.textContent = def.label;
            sel.appendChild(opt);
        }
        editor.selectedId = sel.value;
        selectRegion(editor.selectedId);
    }

    function previewGraphic(graphic) {
        const api = global.VmixGraphics || global.AltitudeHdVmix;
        if (!api?.devPreviewHold) return;
        api.devPreviewHold(graphic);
        global.VmixLayout.apply(editor.theme, graphic);
    }

    function boot() {
        if (!isDevMode() || !global.VmixLayout) return;

        editor.theme = global.document.body?.dataset?.vmixTheme || 'kri';
        const params = new URLSearchParams(global.location.search);
        const g = (params.get('g') || params.get('graphic') || 'draw').toLowerCase();
        const aliases = { t: 'title', l: 'lower', d: 'draw', r: 'results' };
        editor.graphic = aliases[g] || g;

        global.document.body.classList.add('vg-layout-dev');

        const waitInit = () => {
            if (!(global.VmixGraphics || global.AltitudeHdVmix)?.devPreviewHold) {
                global.setTimeout(waitInit, 50);
                return;
            }
            mountPanel();
            previewGraphic(editor.graphic);

            getStage()?.addEventListener('pointerdown', onPointerDown);
            global.addEventListener('pointermove', onPointerMove);
            global.addEventListener('pointerup', onPointerUp);
            global.addEventListener('keydown', onKeyDown);
        };
        waitInit();
    }

    global.VmixLayoutEditor = { boot, isDevMode };
    if (isDevMode()) {
        global.document.addEventListener('DOMContentLoaded', boot);
    }
})(typeof window !== 'undefined' ? window : globalThis);
