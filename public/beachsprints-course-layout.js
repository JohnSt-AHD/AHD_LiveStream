/**
 * Beach Sprints course schematic (x–y) → GPS buoys, flags, tide line, start/finish.
 */
(function () {
    const LS_LAYOUT = 'bspCourseLayoutParams_v1';
    const LS_FLAGS = 'bspCourseFlags_v1';

    const DEFAULT_FLAG_DEFS = [
        { id: 'flag_LF', label: 'LF' },
        { id: 'flag_RF', label: 'RF' },
    ];

    let courseFlags = [];
    let layoutParams = null;
    let flagsLayer = null;
    let guideLayer = null;
    const flagMarkersById = new Map();
    let startFinishMarker = null;
    let pickOriginMode = false;
    let chartRedrawBound = false;

    function coastal() {
        return window.BeachSprintsCoastal;
    }

    function api() {
        return window.BspMapApi;
    }

    function venues() {
        return window.BspVenuePresets;
    }

    function defaultLayoutParams() {
        const c = coastal();
        const orewa = venues()?.getDefaultVenue?.()?.layout;
        if (orewa) return { ...orewa };
        const buoys = api()?.getCourseBuoys?.() || c?.DEFAULT_BEACH_BUOYS || [];
        return (
            c?.defaultCourseLayoutParams?.(buoys) || {
                originLat: -36.59205,
                originLng: 174.70355,
                headingDeg: 45,
                laneSpacingA: 25,
                buoySpacingB: 85,
                tideLineC: 50,
            }
        );
    }

    function loadLayoutParams() {
        try {
            const raw = localStorage.getItem(LS_LAYOUT);
            if (raw) {
                const p = JSON.parse(raw);
                if (p && Number.isFinite(p.originLat) && Number.isFinite(p.originLng)) {
                    layoutParams = p;
                    return;
                }
            }
        } catch {
            /* ignore */
        }
        layoutParams = defaultLayoutParams();
    }

    function saveLayoutParams() {
        if (!layoutParams) return;
        try {
            localStorage.setItem(LS_LAYOUT, JSON.stringify(layoutParams));
        } catch (e) {
            console.warn('Could not save course layout params', e);
        }
    }

    function loadCourseFlags() {
        try {
            const raw = localStorage.getItem(LS_FLAGS);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr) && arr.length) {
                    courseFlags = arr.filter(
                        (f) =>
                            f &&
                            typeof f.id === 'string' &&
                            Number.isFinite(f.lat) &&
                            Number.isFinite(f.lng),
                    );
                    return;
                }
            }
        } catch {
            /* ignore */
        }
        courseFlags = [];
    }

    function saveCourseFlags() {
        try {
            localStorage.setItem(LS_FLAGS, JSON.stringify(courseFlags));
        } catch (e) {
            console.warn('Could not save course flags', e);
        }
    }

    function readParamsFromForm() {
        const num = (id) => parseFloat(document.getElementById(id)?.value);
        return {
            originLat: num('bspCourseOriginLat'),
            originLng: num('bspCourseOriginLng'),
            headingDeg: num('bspCourseHeading'),
            laneSpacingA: num('bspCourseLaneA'),
            buoySpacingB: num('bspCourseBuoyB'),
            tideLineC: num('bspCourseTideC'),
        };
    }

    function fillFormFromParams(p) {
        const set = (id, v) => {
            const el = document.getElementById(id);
            if (el && v != null && Number.isFinite(v)) el.value = String(v);
        };
        set('bspCourseOriginLat', p.originLat);
        set('bspCourseOriginLng', p.originLng);
        set('bspCourseHeading', p.headingDeg);
        set('bspCourseLaneA', p.laneSpacingA);
        set('bspCourseBuoyB', p.buoySpacingB);
        set('bspCourseTideC', p.tideLineC);
    }

    function setLayoutStatus(text) {
        const el = document.getElementById('bspCourseLayoutStatus');
        if (el) el.textContent = text || '';
    }

    function flagDivIcon(label) {
        return L.divIcon({
            className: 'bsp-flag-map-icon',
            html: `<span class="bsp-flag-map-icon__pole" aria-hidden="true"></span><span class="bsp-flag-map-icon__banner">${label}</span>`,
            iconSize: [28, 28],
            iconAnchor: [6, 26],
        });
    }

    function startFinishDivIcon() {
        return L.divIcon({
            className: 'bsp-sf-map-icon',
            html: '<span class="bsp-sf-map-icon__label">SF</span>',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        });
    }

    function ensureLayers() {
        const map = api()?.getMap?.();
        if (!map) return;
        if (!flagsLayer) flagsLayer = L.layerGroup().addTo(map);
        if (!guideLayer) guideLayer = L.layerGroup().addTo(map);
    }

    function syncGuideLayer(tideLine, startFinish) {
        ensureLayers();
        if (!guideLayer) return;
        guideLayer.clearLayers();
        if (tideLine?.a && tideLine?.b) {
            L.polyline(
                [
                    [tideLine.a.lat, tideLine.a.lng],
                    [tideLine.b.lat, tideLine.b.lng],
                ],
                { color: '#38bdf8', weight: 3, dashArray: '10, 8', opacity: 0.9 },
            ).addTo(guideLayer);
        }
        if (startFinish && Number.isFinite(startFinish.lat)) {
            startFinishMarker = L.marker([startFinish.lat, startFinish.lng], {
                draggable: api()?.isBuoysDragEnabled?.() ?? false,
                icon: startFinishDivIcon(),
                zIndexOffset: 700,
            }).addTo(guideLayer);
            startFinishMarker.bindPopup(
                '<strong>START / FINISH</strong><br>Course origin (0, 0)',
            );
            startFinishMarker.on('dragend', () => {
                if (!api()?.isBuoysDragEnabled?.()) return;
                const ll = startFinishMarker.getLatLng();
                layoutParams.originLat = ll.lat;
                layoutParams.originLng = ll.lng;
                saveLayoutParams();
                fillFormFromParams(layoutParams);
                applyAutoCourseLayout(false);
            });
        }
    }

    function syncFlagsToMap() {
        ensureLayers();
        if (!flagsLayer) return;
        flagsLayer.clearLayers();
        flagMarkersById.clear();
        const dragOn = api()?.isBuoysDragEnabled?.() ?? false;

        courseFlags.forEach((f) => {
            const marker = L.marker([f.lat, f.lng], {
                draggable: dragOn,
                icon: flagDivIcon(f.label),
                zIndexOffset: 660,
            }).addTo(flagsLayer);
            marker.bindPopup(`<strong>${f.label}</strong> run flag`);
            marker.on('dragend', () => {
                if (!api()?.isBuoysDragEnabled?.()) return;
                const ll = marker.getLatLng();
                f.lat = ll.lat;
                f.lng = ll.lng;
                saveCourseFlags();
                renderFlagsList();
                api()?.onBuoysOrTimingGeometryChanged?.();
                drawCourseChart();
            });
            flagMarkersById.set(f.id, marker);
        });
    }

    function renderFlagsList() {
        const el = document.getElementById('bspFlagsList');
        if (!el) return;
        el.innerHTML = courseFlags
            .map(
                (f) =>
                    `<article class="bsp-buoy-card bsp-flag-card" data-flag-id="${escapeHtml(f.id)}">` +
                    `<h3 class="bsp-buoy-card-label bsp-flag-card-label">${escapeHtml(f.label)}</h3>` +
                    `<label class="bsp-field bsp-buoy-field"><span class="bsp-field-label">Latitude (°)</span>` +
                    `<input type="number" step="any" data-flag-lat="${escapeHtml(f.id)}" value="${f.lat}"></label>` +
                    `<label class="bsp-field bsp-buoy-field"><span class="bsp-field-label">Longitude (°)</span>` +
                    `<input type="number" step="any" data-flag-lng="${escapeHtml(f.id)}" value="${f.lng}"></label>` +
                    `</article>`,
            )
            .join('');
    }

    function applyFlagCoordsFromInputs(flagId) {
        const f = courseFlags.find((x) => x.id === flagId);
        const latEl = document.querySelector(`[data-flag-lat="${flagId}"]`);
        const lngEl = document.querySelector(`[data-flag-lng="${flagId}"]`);
        if (!f || !latEl || !lngEl) return false;
        const lat = parseFloat(latEl.value);
        const lng = parseFloat(lngEl.value);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        f.lat = lat;
        f.lng = lng;
        saveCourseFlags();
        const marker = flagMarkersById.get(flagId);
        if (marker) marker.setLatLng([lat, lng]);
        api()?.onBuoysOrTimingGeometryChanged?.();
        drawCourseChart();
        return true;
    }

    function centerMapOnOrigin() {
        const p = layoutParams || readParamsFromForm();
        if (p && Number.isFinite(p.originLat) && Number.isFinite(p.originLng)) {
            api()?.centerMapOnCourseOrigin?.(p.originLat, p.originLng);
        }
    }

    function populateVenueSelect() {
        const sel = document.getElementById('bspVenueSelect');
        const vp = venues();
        if (!sel || !vp) return;
        const active = vp.getActiveId() || vp.DEFAULT_VENUE_ID;
        sel.innerHTML = vp
            .listVenues()
            .map((v) => {
                const tag = v.builtin ? '' : ' · saved';
                const selected = v.id === active ? ' selected' : '';
                return `<option value="${escapeHtml(v.id)}"${selected}>${escapeHtml(v.name)}${tag}</option>`;
            })
            .join('');
    }

    function applyVenue(venue, options = {}) {
        const vp = venues();
        const c = coastal();
        if (!venue?.layout) {
            setLayoutStatus('Venue not found.');
            return false;
        }
        layoutParams = { ...venue.layout };
        fillFormFromParams(layoutParams);
        saveLayoutParams();

        let ok = false;
        if (venue.buoys?.length) {
            api()?.setCourseBuoys?.(venue.buoys.map((b) => ({ ...b })));
            if (venue.flags?.length) {
                courseFlags = venue.flags.map((f) => ({ ...f }));
            } else {
                const appliedFlags = c?.applyCourseLayout?.(layoutParams);
                if (appliedFlags?.ok) courseFlags = appliedFlags.flags.map((f) => ({ ...f }));
            }
            saveCourseFlags();
            api()?.syncBuoysToMap?.();
            syncFlagsToMap();
            api()?.renderBuoysList?.();
            renderFlagsList();
            const applied = c?.applyCourseLayout?.(layoutParams);
            if (applied?.ok) syncGuideLayer(applied.tideLine, applied.startFinish);
            api()?.onBuoysOrTimingGeometryChanged?.();
            drawCourseChart();
            centerMapOnOrigin();
            ok = true;
        } else {
            ok = applyAutoCourseLayout(options.showStatus !== false);
        }

        if (vp && venue.id) {
            vp.setActiveId(venue.id);
            const nameEl = document.getElementById('bspVenueName');
            if (nameEl) nameEl.value = venue.name || '';
        }
        populateVenueSelect();
        if (ok && options.showStatus !== false) {
            setLayoutStatus(`Loaded venue: ${venue.name}.`);
        }
        return ok;
    }

    function loadSelectedVenue() {
        const sel = document.getElementById('bspVenueSelect');
        const id = sel?.value;
        if (!id) return;
        const venue = venues()?.getVenue(id);
        if (venue) applyVenue(venue);
    }

    function saveCurrentVenue() {
        const vp = venues();
        if (!vp) return;
        const nameEl = document.getElementById('bspVenueName');
        const name = (nameEl?.value || '').trim() || selVenueName() || 'Saved venue';
        layoutParams = readParamsFromForm();
        const id = vp.saveVenueFromCurrent(name, {
            layout: layoutParams,
            buoys: api()?.getCourseBuoys?.() || [],
            flags: courseFlags.map((f) => ({ ...f })),
        });
        if (nameEl) nameEl.value = vp.getVenue(id)?.name || name;
        populateVenueSelect();
        const sel = document.getElementById('bspVenueSelect');
        if (sel) sel.value = id;
        setLayoutStatus(`Saved venue “${name}”.`);
    }

    function selVenueName() {
        const sel = document.getElementById('bspVenueSelect');
        const id = sel?.value;
        return venues()?.getVenue(id)?.name || '';
    }

    function deleteSelectedVenue() {
        const vp = venues();
        const sel = document.getElementById('bspVenueSelect');
        const id = sel?.value;
        if (!vp || !id) return;
        if (vp.isBuiltin(id)) {
            setLayoutStatus('Built-in venues cannot be deleted.');
            return;
        }
        if (!vp.deleteUserVenue(id)) {
            setLayoutStatus('Could not delete venue.');
            return;
        }
        populateVenueSelect();
        setLayoutStatus('Venue deleted.');
        const def = vp.getDefaultVenue();
        if (def) applyVenue(def);
    }

    function applyAutoCourseLayout(showStatus) {
        const c = coastal();
        if (!c?.applyCourseLayout) {
            setLayoutStatus('Coastal analysis module not loaded.');
            return false;
        }
        layoutParams = readParamsFromForm();
        const result = c.applyCourseLayout(layoutParams);
        if (!result.ok) {
            if (showStatus !== false) setLayoutStatus(result.reason || 'Could not apply layout.');
            return false;
        }
        layoutParams = { ...result.params };
        saveLayoutParams();
        fillFormFromParams(layoutParams);

        api()?.setCourseBuoys?.(result.buoys);
        courseFlags = result.flags;
        saveCourseFlags();

        api()?.syncBuoysToMap?.();
        syncFlagsToMap();
        syncGuideLayer(result.tideLine, result.startFinish);
        api()?.renderBuoysList?.();
        renderFlagsList();
        api()?.onBuoysOrTimingGeometryChanged?.();
        drawCourseChart();
        centerMapOnOrigin();
        if (showStatus !== false) {
            setLayoutStatus('Course applied to map from schematic.');
        }
        return true;
    }

    function drawCourseChart() {
        const canvas = document.getElementById('bspCourseChart');
        if (!canvas) return;
        const c = coastal();
        const p = readParamsFromForm();
        if (!c?.buildCourseLayoutSpec) return;

        const wrap = canvas.parentElement;
        const w = Math.max(200, wrap?.clientWidth || 280);
        const h = Math.max(160, wrap?.clientHeight || 200);
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const A = Number(p.laneSpacingA) || 18;
        const B = Number(p.buoySpacingB) || 85;
        const C = Number(p.tideLineC) || 25;
        const spec = c.buildCourseLayoutSpec({
            laneSpacingA: A,
            buoySpacingB: B,
            tideLineC: C,
        });

        const margin = { l: 36, r: 16, t: 16, b: 32 };
        const plotW = w - margin.l - margin.r;
        const plotH = h - margin.t - margin.b;

        const maxY = C + 3 * B + 20;
        const minX = -A / 2 - 15;
        const maxX = A / 2 + 15;
        const minY = -Math.max(12, C * 0.35);

        const sx = plotW / (maxX - minX);
        const sy = plotH / (maxY - minY);
        const scale = Math.min(sx, sy);

        /** Course y: 0 = start/finish, +y seaward. Canvas: +y up on screen = sea. */
        const toPx = (x, y) => ({
            px: margin.l + (x - minX) * scale,
            py: margin.t + plotH - (y - minY) * scale,
        });

        const plotTop = margin.t;
        const plotBottom = margin.t + plotH;
        const tideY = toPx(0, C).py;

        const beachGrad = ctx.createLinearGradient(0, tideY, 0, plotBottom);
        beachGrad.addColorStop(0, 'rgba(253, 230, 138, 0.18)');
        beachGrad.addColorStop(1, 'rgba(253, 230, 138, 0.42)');
        ctx.fillStyle = beachGrad;
        ctx.fillRect(margin.l, tideY, plotW, plotBottom - tideY);

        const seaGrad = ctx.createLinearGradient(0, plotTop, 0, tideY);
        seaGrad.addColorStop(0, 'rgba(12, 74, 110, 0.7)');
        seaGrad.addColorStop(1, 'rgba(8, 47, 66, 0.25)');
        ctx.fillStyle = seaGrad;
        ctx.fillRect(margin.l, plotTop, plotW, tideY - plotTop);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(margin.l, tideY);
        ctx.lineTo(margin.l + plotW, tideY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#7dd3fc';
        ctx.font = '10px system-ui,sans-serif';
        ctx.fillText(`Tide y = C (${C} m)`, margin.l + 4, tideY + 14);

        const sf = toPx(0, 0);
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(sf.px - 8, sf.py - 8, 16, 16);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 9px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SF', sf.px, sf.py + 3);
        ctx.textAlign = 'left';

        const drawPoint = (pt, color, isFlag) => {
            const { px, py } = toPx(pt.x, pt.y);
            ctx.fillStyle = color;
            if (isFlag) {
                ctx.fillRect(px - 2, py - 14, 3, 14);
                ctx.beginPath();
                ctx.moveTo(px + 1, py - 14);
                ctx.lineTo(px + 12, py - 10);
                ctx.lineTo(px + 1, py - 6);
                ctx.closePath();
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.arc(px, py, 7, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.fillStyle = '#e8f4fc';
            ctx.font = 'bold 10px system-ui,sans-serif';
            ctx.fillText(pt.label, px + (isFlag ? 14 : 9), py + 4);
        };

        spec.buoys.forEach((b) => drawPoint(b, '#ff7a18', false));
        spec.flags.forEach((f) => drawPoint(f, '#f472b6', true));

        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px system-ui,sans-serif';
        ctx.fillText('y ↑ sea', margin.l + 2, plotTop + 12);
        ctx.fillText('y < C beach', margin.l + 2, plotBottom - 6);
        ctx.textAlign = 'right';
        ctx.fillText(`SF y=0`, w - margin.r, toPx(0, 0).py + 4);
        ctx.textAlign = 'left';
    }

    function togglePanelExpand() {
        const panel = document.getElementById('bspBuoysPanel');
        const btn = document.getElementById('bspBuoysPanelExpand');
        if (!panel) return;
        const expanded = panel.classList.toggle('bsp-buoys-panel--half');
        document.body.classList.toggle('bsp-buoys-panel-expanded', expanded);
        if (btn) {
            btn.textContent = expanded ? 'Narrow panel' : 'Expand to half page';
            btn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
        }
        api()?.scheduleMapResize?.();
        requestAnimationFrame(() => drawCourseChart());
    }

    function startPickOriginOnMap() {
        const map = api()?.getMap?.();
        if (!map) return;
        pickOriginMode = true;
        setLayoutStatus('Click the map to set start/finish (0, 0).');
        map.getContainer().style.cursor = 'crosshair';
    }

    function onMapClickPickOrigin(e) {
        if (!pickOriginMode) return;
        pickOriginMode = false;
        const map = api()?.getMap?.();
        if (map) map.getContainer().style.cursor = '';
        layoutParams.originLat = e.latlng.lat;
        layoutParams.originLng = e.latlng.lng;
        saveLayoutParams();
        fillFormFromParams(layoutParams);
        applyAutoCourseLayout();
    }

    function wireCourseLayoutPanel() {
        const expandBtn = document.getElementById('bspBuoysPanelExpand');
        if (expandBtn && expandBtn.dataset.bound !== '1') {
            expandBtn.dataset.bound = '1';
            expandBtn.addEventListener('click', togglePanelExpand);
        }

        const autoBtn = document.getElementById('bspAutoSetCourse');
        if (autoBtn && autoBtn.dataset.bound !== '1') {
            autoBtn.dataset.bound = '1';
            autoBtn.addEventListener('click', () => applyAutoCourseLayout());
        }

        const pickBtn = document.getElementById('bspPickOriginMap');
        if (pickBtn && pickBtn.dataset.bound !== '1') {
            pickBtn.dataset.bound = '1';
            pickBtn.addEventListener('click', startPickOriginOnMap);
        }

        const params = ['bspCourseOriginLat', 'bspCourseOriginLng', 'bspCourseHeading', 'bspCourseLaneA', 'bspCourseBuoyB', 'bspCourseTideC'];
        params.forEach((id) => {
            const el = document.getElementById(id);
            if (!el || el.dataset.bound === '1') return;
            el.dataset.bound = '1';
            el.addEventListener('change', () => {
                layoutParams = readParamsFromForm();
                saveLayoutParams();
                drawCourseChart();
                if (id === 'bspCourseOriginLat' || id === 'bspCourseOriginLng') {
                    centerMapOnOrigin();
                }
            });
        });

        const flagsList = document.getElementById('bspFlagsList');
        if (flagsList && flagsList.dataset.bound !== '1') {
            flagsList.dataset.bound = '1';
            flagsList.addEventListener('change', (e) => {
                const input = e.target.closest('[data-flag-lat], [data-flag-lng]');
                if (!input) return;
                const card = input.closest('[data-flag-id]');
                const flagId = card?.getAttribute('data-flag-id');
                if (flagId) applyFlagCoordsFromInputs(flagId);
            });
        }

        const map = api()?.getMap?.();
        if (map && !map._bspLayoutClickBound) {
            map._bspLayoutClickBound = true;
            map.on('click', onMapClickPickOrigin);
        }

        if (!chartRedrawBound) {
            chartRedrawBound = true;
            window.addEventListener('resize', () => drawCourseChart());
        }

        const venueSel = document.getElementById('bspVenueSelect');
        if (venueSel && venueSel.dataset.bound !== '1') {
            venueSel.dataset.bound = '1';
            venueSel.addEventListener('change', () => {
                const v = venues()?.getVenue(venueSel.value);
                const nameEl = document.getElementById('bspVenueName');
                if (nameEl && v) nameEl.value = v.name || '';
            });
        }

        const loadVenueBtn = document.getElementById('bspVenueLoad');
        if (loadVenueBtn && loadVenueBtn.dataset.bound !== '1') {
            loadVenueBtn.dataset.bound = '1';
            loadVenueBtn.addEventListener('click', loadSelectedVenue);
        }

        const saveVenueBtn = document.getElementById('bspVenueSave');
        if (saveVenueBtn && saveVenueBtn.dataset.bound !== '1') {
            saveVenueBtn.dataset.bound = '1';
            saveVenueBtn.addEventListener('click', saveCurrentVenue);
        }

        const delVenueBtn = document.getElementById('bspVenueDelete');
        if (delVenueBtn && delVenueBtn.dataset.bound !== '1') {
            delVenueBtn.dataset.bound = '1';
            delVenueBtn.addEventListener('click', deleteSelectedVenue);
        }
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function init() {
        const vp = venues();
        const hadLayout = !!localStorage.getItem(LS_LAYOUT);
        const activeId = vp?.getActiveId?.();

        loadCourseFlags();
        wireCourseLayoutPanel();
        populateVenueSelect();
        renderFlagsList();

        if (activeId && vp?.getVenue(activeId)) {
            applyVenue(vp.getVenue(activeId), { showStatus: false });
            return;
        }

        if (!hadLayout && vp?.getDefaultVenue()) {
            applyVenue(vp.getDefaultVenue(), { showStatus: false });
            return;
        }

        loadLayoutParams();
        fillFormFromParams(layoutParams);

        const c = coastal();
        const applied = c?.applyCourseLayout?.(layoutParams);
        if (applied?.ok) {
            layoutParams = { ...applied.params };
            saveLayoutParams();
            api()?.setCourseBuoys?.(applied.buoys);
            syncGuideLayer(applied.tideLine, applied.startFinish);
            if (courseFlags.length === 0) {
                courseFlags = applied.flags;
                saveCourseFlags();
            }
            api()?.syncBuoysToMap?.();
        }
        syncFlagsToMap();
        drawCourseChart();
        centerMapOnOrigin();

        const nameEl = document.getElementById('bspVenueName');
        if (nameEl && vp && !nameEl.value) {
            nameEl.value = vp.getVenue(vp.DEFAULT_VENUE_ID)?.name || '';
        }
    }

    function onDragToggleChanged() {
        syncFlagsToMap();
        const c = coastal();
        if (!c || !layoutParams) return;
        const applied = c.applyCourseLayout(layoutParams);
        if (applied.ok) syncGuideLayer(applied.tideLine, applied.startFinish);
    }

    window.BspCourseLayout = {
        init,
        applyAutoCourseLayout,
        applyVenue,
        drawCourseChart,
        syncFlagsToMap,
        syncGuideLayer,
        onDragToggleChanged,
        getLayoutParams: () => layoutParams,
        getCourseFlags: () => courseFlags,
    };
})();
