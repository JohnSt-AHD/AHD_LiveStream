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
            { id: 'draw-head', label: 'Draw — header block (all)', posMode: 'absolute' },
            { id: 'draw-kicker', label: 'Draw — “Start list” kicker', posMode: 'transform' },
            { id: 'draw-title', label: 'Draw — event title', posMode: 'transform' },
            { id: 'draw-meta', label: 'Draw — race / round line', posMode: 'transform' },
            { id: 'draw-body', label: 'Draw — columns + rows block', posMode: 'transform' },
            { id: 'draw-cols', label: 'Draw — Lane / Crew header row', posMode: 'transform' },
            { id: 'draw-lanes', label: 'Draw — lane list', posMode: 'transform' },
            { id: 'draw-lane-n', label: 'Draw — lane numbers (1–8)', target: 'draw-lane-n' },
            { id: 'draw-logo', label: 'Draw — school logos', target: 'draw-logo' },
            { id: 'draw-crew', label: 'Draw — crew names', target: 'draw-crew' },
        ],
        results: [
            { id: 'results-head', label: 'Results — header block (all)' },
            { id: 'results-kicker', label: 'Results — kicker' },
            { id: 'results-title', label: 'Results — event title', posMode: 'transform' },
            { id: 'results-meta', label: 'Results — race line' },
            { id: 'results-cols', label: 'Results — column headers', posMode: 'transform' },
            { id: 'results-lanes', label: 'Results — lane list', posMode: 'transform' },
            { id: 'results-logo', label: 'Results — school logos', target: 'results-logo' },
            { id: 'results-crew', label: 'Results — crew names', target: 'results-crew' },
        ],
        leader: [
            { id: 'leader-wrap', label: 'Leader — overlay root' },
            { id: 'leader-logo', label: 'Leader — school logo' },
            { id: 'leader-badge', label: 'Leader — “Leader Lane” label' },
            { id: 'leader-badge-lane', label: 'Leader — lane number' },
            { id: 'leader-crew', label: 'Leader — crew name' },
        ],
    };

    /** Map legacy / child ids to editor region ids. */
    const REGION_ALIASES = {
        draw: {
            'kri-head': 'draw-head',
            'kri-draw-body': 'draw-body',
            'kri-cols': 'draw-cols',
        },
        results: {
            'kri-head': 'results-head',
            'kri-cols': 'results-cols',
        },
    };

    const editor = {
        theme: '',
        graphic: 'draw',
        selectedId: null,
        drag: null,
        panel: null,
        statusEl: null,
        syncingFields: false,
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

    function findRegionEl(def) {
        if (!def) return null;
        if (def.target) return findTargetEls(def.target)[0] || null;
        return findBlockEl(def.id);
    }

    function resolveRegionId(el) {
        if (!el) return null;
        const defs = regionDefs(editor.graphic);
        const targetKey = el.getAttribute('data-vg-layout-target');
        if (targetKey) {
            const byTarget = defs.find((d) => d.target === targetKey);
            if (byTarget) return byTarget.id;
            if (defs.some((d) => d.id === targetKey)) return targetKey;
        }
        const layoutId = el.getAttribute('data-vg-layout');
        if (layoutId) {
            if (defs.some((d) => d.id === layoutId)) return layoutId;
            const alias = REGION_ALIASES[editor.graphic]?.[layoutId];
            if (alias) return alias;
        }
        return null;
    }

    function findSelectableFromEvent(e) {
        if (editor.panel?.contains(e.target)) return null;
        let node = e.target;
        const stage = getStage();
        while (node && node !== stage) {
            const id = resolveRegionId(node);
            if (id) return { regionId: id, hit: node };
            node = node.parentElement;
        }
        return null;
    }

    function regionPosMode(def, el) {
        if (def?.posMode) return def.posMode;
        if (def?.target) return 'transform';
        if (!el) return 'absolute';
        const pos = global.getComputedStyle(el).position;
        if (pos === 'absolute' || el.style.left) return 'absolute';
        return 'transform';
    }

    function parseTranslate(transformStr) {
        if (!transformStr || transformStr === 'none') return { x: 0, y: 0 };
        const m = String(transformStr).match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
        const m2 = String(transformStr).match(/translate\(([-\d.]+)px\)/);
        if (m2) return { x: parseFloat(m2[1]), y: 0 };
        const mat = String(transformStr).match(/matrix\(([^)]+)\)/);
        if (mat) {
            const p = mat[1].split(',').map((s) => parseFloat(s.trim()));
            if (p.length >= 6) return { x: p[4], y: p[5] };
        }
        return { x: 0, y: 0 };
    }

    function readTranslate(el) {
        if (!el) return { x: 0, y: 0 };
        if (el.style.transform) return parseTranslate(el.style.transform);
        return parseTranslate(global.getComputedStyle(el).transform);
    }

    function formatTranslate(x, y) {
        return `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
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
        const el = findRegionEl(def);
        if (el) el.classList.add('vg-layout-selected');
        syncFieldsFromSelection();
        updateRegionSelectHighlight();
    }

    function updateRegionSelectHighlight() {
        const sel = editor.panel?.querySelector('#vgLayoutRegion');
        if (!sel) return;
        for (const opt of sel.options) {
            const def = regionDefs(editor.graphic).find((d) => d.id === opt.value);
            const found = def ? !!findRegionEl(def) : false;
            const plain = def?.label?.replace(/^[●○]\s*/, '') || opt.value;
            opt.textContent = `${found ? '● ' : '○ '}${plain}`;
            opt.disabled = !found;
        }
    }

    function usesTransformPos(def, el) {
        return regionPosMode(def, el) === 'transform' || !!def?.target;
    }

    function formatPositionReadout(def, el) {
        if (!el || !def) return '—';
        const pos = elPositionPx(el);
        const l = Math.round(pos.left);
        const t = Math.round(pos.top);
        if (usesTransformPos(def, el)) {
            const tr = readTranslate(el);
            return `On stage: left ${l} px · top ${t} px · transform X ${Math.round(tr.x)} px · Y ${Math.round(tr.y)} px`;
        }
        const left = parseFloat(el.style.left);
        const top = parseFloat(el.style.top);
        const leftPx = Number.isFinite(left) ? Math.round(left) : l;
        const topPx = Number.isFinite(top) ? Math.round(top) : t;
        return `Left ${leftPx} px · Top ${topPx} px`;
    }

    function formatPositionBadge(def, el) {
        if (!el || !def) return '';
        const pos = elPositionPx(el);
        const l = Math.round(pos.left);
        const t = Math.round(pos.top);
        if (usesTransformPos(def, el)) {
            const tr = readTranslate(el);
            return `L ${l} · T ${t} · ΔX ${Math.round(tr.x)} · ΔY ${Math.round(tr.y)}`;
        }
        const left = parseFloat(el.style.left);
        const top = parseFloat(el.style.top);
        const leftPx = Number.isFinite(left) ? Math.round(left) : l;
        const topPx = Number.isFinite(top) ? Math.round(top) : t;
        return `L ${leftPx} · T ${topPx}`;
    }

    function hidePosBadge() {
        if (editor.posBadge) editor.posBadge.hidden = true;
    }

    function updatePositionReadout(def, el) {
        const panel = editor.panel;
        const live = panel?.querySelector('[data-field="livePos"]');
        if (!def || !el) {
            if (live) live.textContent = '—';
            hidePosBadge();
            return;
        }
        if (live) live.textContent = formatPositionReadout(def, el);
        const stage = getStage();
        if (!stage) return;
        let badge = editor.posBadge;
        if (!badge) {
            badge = global.document.createElement('div');
            badge.className = 'vg-layout-pos-badge';
            badge.setAttribute('aria-live', 'polite');
            editor.posBadge = badge;
            stage.appendChild(badge);
        }
        const er = el.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        const scaleX = sr.width / 1920;
        const scaleY = sr.height / 1080;
        const x = (er.left - sr.left) / scaleX;
        const y = (er.top - sr.top) / scaleY;
        badge.textContent = formatPositionBadge(def, el);
        badge.hidden = false;
        const badgeH = 26;
        const above = y - badgeH - 6;
        badge.style.left = `${Math.max(0, x)}px`;
        badge.style.top = `${above >= 0 ? above : y + er.height / scaleY + 6}px`;
    }

    function syncFieldsFromSelection() {
        const panel = editor.panel;
        const def = getSelectedDef();
        if (!panel || !def) return;

        const el = findRegionEl(def);
        if (!el) return;

        editor.syncingFields = true;
        try {
            const pos = elPositionPx(el);
            const transformPos = usesTransformPos(def, el);
            const set = (name, val) => {
                const input = panel.querySelector(`[data-field="${name}"]`);
                if (input) input.value = val ?? '';
            };
            if (transformPos) {
                set('left', '');
                set('top', '');
            } else {
                set('left', Math.round(pos.left));
                set('top', Math.round(pos.top));
            }
            const saved = global.VmixLayout.getRegion(editor.theme, editor.graphic, def.id);
            const tr = readTranslate(el);
            const liveTransform =
                el.style.transform ||
                (tr.x || tr.y ? formatTranslate(tr.x, tr.y) : '');
            set(
                'transform',
                liveTransform === 'translate(0px, 0px)' ? '' : liveTransform || saved?.transform || '',
            );
            set('width', el.style.width || saved?.width || '');
            set('gap', el.style.gap || saved?.gap || '');
            set('fontSize', el.style.fontSize || saved?.fontSize || '');
            set('scale', saved?.scale ?? '');
            const computedColor = global.getComputedStyle(el).color || '';
            set(
                'color',
                el.style.color || rgbToHex(computedColor) || saved?.color || '',
            );

            const modeEl = panel.querySelector('[data-field="posMode"]');
            if (modeEl) modeEl.textContent = regionPosMode(def, el);

            const leftInput = panel.querySelector('[data-field="left"]');
            const topInput = panel.querySelector('[data-field="top"]');
            if (leftInput) leftInput.disabled = transformPos;
            if (topInput) topInput.disabled = transformPos;
            updatePositionReadout(def, el);
        } finally {
            editor.syncingFields = false;
        }
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

    function collectFieldProps(def) {
        const panel = editor.panel;
        const get = (name) => panel.querySelector(`[data-field="${name}"]`)?.value?.trim() ?? '';
        const props = {};
        const transformPos = def && usesTransformPos(def, findRegionEl(def));
        if (!transformPos) {
            if (get('left') !== '') props.left = `${get('left')}px`;
            if (get('top') !== '') props.top = `${get('top')}px`;
        }
        if (get('width')) props.width = get('width');
        if (get('gap')) props.gap = get('gap');
        if (get('fontSize')) props.fontSize = get('fontSize');
        if (get('transform')) props.transform = get('transform');
        if (get('scale') !== '') props.scale = Number(get('scale')) || 1;
        if (get('color')) props.color = get('color');
        return props;
    }

    function applyStyleToRegion(def, el, props) {
        if (!el || !props) return;
        const transformPos = usesTransformPos(def, el);
        const styleProps = { ...props };
        if (transformPos) {
            delete styleProps.left;
            delete styleProps.top;
            if (!styleProps.transform) {
                const tr = readTranslate(el);
                if (tr.x || tr.y) styleProps.transform = formatTranslate(tr.x, tr.y);
            }
        }
        global.VmixLayout.applyStyle(el, styleProps);
        if (transformPos) {
            el.style.left = '';
            el.style.top = '';
            if (el.style.position === 'absolute') el.style.position = '';
        }
    }

    function applyFieldsToSelection() {
        if (editor.syncingFields) return;
        const def = getSelectedDef();
        const panel = editor.panel;
        if (!def || !panel) return;

        const props = collectFieldProps(def);

        if (def.target) {
            findTargetEls(def.target).forEach((el) => applyStyleToRegion(def, el, props));
        } else {
            const el = findBlockEl(def.id);
            if (el) applyStyleToRegion(def, el, props);
        }
    }

    function setStatus(msg, isErr) {
        if (!editor.statusEl) return;
        editor.statusEl.textContent = msg;
        editor.statusEl.classList.toggle('vg-layout-status--err', !!isErr);
    }

    function buildSavedProps(def, el, { includeForm = false } = {}) {
        const props = includeForm
            ? { ...readPropsFromEl(el), ...collectFieldProps(def) }
            : { ...readPropsFromEl(el) };
        if (!el) {
            return global.VmixLayout.sanitizeRegionProps(def.id, props, !!def.target);
        }
        if (usesTransformPos(def, el)) {
            const tr = readTranslate(el);
            props.transform = formatTranslate(tr.x, tr.y);
            delete props.left;
            delete props.top;
        } else {
            const pos = elPositionPx(el);
            props.left = `${Math.round(pos.left)}px`;
            props.top = `${Math.round(pos.top)}px`;
            delete props.transform;
        }
        return global.VmixLayout.sanitizeRegionProps(def.id, props, !!def.target);
    }

    function saveCurrent() {
        const def = getSelectedDef();
        if (!def) {
            setStatus('Select a region first.', true);
            return;
        }
        const el = findRegionEl(def);
        const props = buildSavedProps(def, el, { includeForm: true });
        global.VmixLayout.setRegion(editor.theme, editor.graphic, def.id, props);
        setStatus(`Saved ${editor.theme} / ${editor.graphic} / ${def.id}`);
    }

    function saveAllVisible() {
        for (const def of regionDefs(editor.graphic)) {
            const el = findRegionEl(def);
            if (!el) continue;
            global.VmixLayout.setRegion(
                editor.theme,
                editor.graphic,
                def.id,
                buildSavedProps(def, el, { includeForm: false }),
            );
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
        const raw = all[editor.theme]?.[editor.graphic] || {};
        const cleaned = {};
        for (const [id, props] of Object.entries(raw)) {
            const def = regionDefs(editor.graphic).find((d) => d.id === id);
            cleaned[id] = global.VmixLayout.sanitizeRegionProps(
                id,
                props,
                !!def?.target,
            );
        }
        const slice = {
            [editor.theme]: {
                [editor.graphic]: cleaned,
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
        const pick = findSelectableFromEvent(e);
        if (!pick) return;
        e.preventDefault();

        editor.selectedId = pick.regionId;
        const regionSel = editor.panel?.querySelector('#vgLayoutRegion');
        if (regionSel) regionSel.value = editor.selectedId;
        selectRegion(editor.selectedId);

        const def = getSelectedDef();
        if (!def) return;

        let dragEl;
        if (def.target) {
            dragEl =
                pick.hit.closest(`[data-vg-layout-target="${def.target}"]`) ||
                findTargetEls(def.target)[0];
        } else {
            dragEl = findBlockEl(def.id);
        }
        if (!dragEl) return;

        const mode = regionPosMode(def, dragEl);
        const pos = elPositionPx(dragEl);
        const pt = stagePoint(e.clientX, e.clientY);
        if (mode !== 'transform' && !def.target) {
            dragEl.style.position = 'absolute';
            dragEl.style.transform = '';
            dragEl.style.left = `${Math.round(pos.left)}px`;
            dragEl.style.top = `${Math.round(pos.top)}px`;
        }
        editor.drag = {
            el: dragEl,
            def,
            mode,
            isTarget: !!def.target,
            startX: pt.x,
            startY: pt.y,
            origLeft: pos.left,
            origTop: pos.top,
            origTranslate: readTranslate(dragEl),
        };
        dragEl.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e) {
        if (!editor.drag) return;
        const pt = stagePoint(e.clientX, e.clientY);
        const dx = Math.round(pt.x - editor.drag.startX);
        const dy = Math.round(pt.y - editor.drag.startY);
        const panel = editor.panel;

        if (editor.drag.mode === 'transform' || editor.drag.isTarget) {
            const x = editor.drag.origTranslate.x + dx;
            const y = editor.drag.origTranslate.y + dy;
            const transform = formatTranslate(x, y);
            if (editor.drag.isTarget && editor.drag.def?.target) {
                findTargetEls(editor.drag.def.target).forEach((node) => {
                    node.style.transform = transform;
                });
            } else {
                editor.drag.el.style.transform = transform;
            }
            const transformInput = panel?.querySelector('[data-field="transform"]');
            if (transformInput) transformInput.value = transform;
        } else {
            editor.drag.el.style.left = `${Math.round(editor.drag.origLeft + dx)}px`;
            editor.drag.el.style.top = `${Math.round(editor.drag.origTop + dy)}px`;
            const leftInput = panel?.querySelector('[data-field="left"]');
            const topInput = panel?.querySelector('[data-field="top"]');
            if (leftInput) leftInput.value = String(Math.round(editor.drag.origLeft + dx));
            if (topInput) topInput.value = String(Math.round(editor.drag.origTop + dy));
        }
        updatePositionReadout(editor.drag.def, editor.drag.el);
    }

    function onPointerUp() {
        editor.drag = null;
        const def = getSelectedDef();
        const el = findRegionEl(def);
        if (def && el) updatePositionReadout(def, el);
    }

    function onKeyDown(e) {
        if (!editor.selectedId || e.target.closest('.vg-layout-panel')) return;
        const def = getSelectedDef();
        if (!def) return;
        const el = findRegionEl(def);
        if (!el) return;

        const step = e.shiftKey ? 10 : 1;
        const mode = regionPosMode(def, el);

        if (mode === 'transform' || def.target) {
            const tr = readTranslate(def.target ? findTargetEls(def.target)[0] || el : el);
            let x = tr.x;
            let y = tr.y;
            if (e.key === 'ArrowLeft') x -= step;
            else if (e.key === 'ArrowRight') x += step;
            else if (e.key === 'ArrowUp') y -= step;
            else if (e.key === 'ArrowDown') y += step;
            else return;
            e.preventDefault();
            const transform = formatTranslate(x, y);
            if (def.target) {
                findTargetEls(def.target).forEach((node) => {
                    node.style.transform = transform;
                });
            } else {
                el.style.transform = transform;
            }
            syncFieldsFromSelection();
            return;
        }

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
            <p>Click any outlined element to select it. ● = on screen, ○ = not found. Drag or arrow keys (Shift = 10px). Header block uses Left/Top; title, kicker, meta, columns, and lanes use Transform.</p>
            <label for="vgLayoutGraphic">Graphic</label>
            <select id="vgLayoutGraphic">
                <option value="title">Title</option>
                <option value="lower">Lower third</option>
                <option value="draw">Draw</option>
                <option value="results">Results</option>
            </select>
            <label for="vgLayoutRegion">Region</label>
            <select id="vgLayoutRegion"></select>
            <p class="vg-layout-pos-mode">Move mode: <span data-field="posMode">—</span></p>
            <p class="vg-layout-live-pos">Position: <span data-field="livePos">—</span></p>
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
            <div class="vg-layout-gt-import">
                <label for="vgGtFile">Import GT template (.gtxml / .gtzip / .gt)</label>
                <input type="file" id="vgGtFile" accept=".gtxml,.gtzip,.gt,.xml" />
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

        const gtInput = editor.panel.querySelector('#vgGtFile');
        if (gtInput) {
            gtInput.addEventListener('change', async () => {
                const file = gtInput.files?.[0];
                if (!file || !global.VmixGtImport) {
                    setStatus('GT import unavailable — load vmix-gt-import.js', true);
                    return;
                }
                try {
                    const result = await global.VmixGtImport.importFileToLayout(
                        file,
                        editor.theme,
                        editor.graphic,
                    );
                    const n = Object.keys(result.regions).length;
                    const u = result.unmapped.length;
                    const t = result.hints.length;
                    setStatus(
                        `GT import: ${n} regions mapped, ${u} unmapped elements, ${t} animation hints. Check console.`,
                    );
                    console.info('[VmixGtImport]', result);
                    previewGraphic(editor.graphic);
                    syncFieldsFromSelection();
                } catch (err) {
                    setStatus(
                        err instanceof Error ? err.message : 'GT import failed',
                        true,
                    );
                }
                gtInput.value = '';
            });
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
        updateRegionSelectHighlight();
    }

    function previewGraphic(graphic) {
        const api = global.VmixGraphics || global.AltitudeHdVmix;
        if (!api?.devPreviewHold) return;
        api.devPreviewHold(graphic);
        global.VmixLayout.apply(editor.theme, graphic);
        updateRegionSelectHighlight();
        const def = getSelectedDef();
        const el = findRegionEl(def);
        if (def && el) updatePositionReadout(def, el);
        else hidePosBadge();
    }

    function boot() {
        if (!isDevMode() || !global.VmixLayout) return;

        editor.theme = global.document.body?.dataset?.vmixTheme || 'kri';
        const params = new URLSearchParams(global.location.search);
        const g = (params.get('g') || params.get('graphic') || 'draw').toLowerCase();
        const aliases = {
            t: 'title',
            l: 'lower',
            d: 'draw',
            r: 'results',
            w: 'leader',
            g: 'speed',
        };
        editor.graphic = aliases[g] || g;

        global.document.body.classList.add('vg-layout-dev');

        const waitInit = () => {
            if (!(global.VmixGraphics || global.AltitudeHdVmix)?.devPreviewHold) {
                global.setTimeout(waitInit, 50);
                return;
            }
            mountPanel();
            previewGraphic(editor.graphic);
            setStatus('Live CSV refresh paused — drag positions stay until you save or reload the page.');

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
