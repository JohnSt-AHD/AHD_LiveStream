/**
 * KRI 2 km × 8-lane rowing course overlay for the safety map.
 * Start/finish from main fleet map custom pins (live-map.html / app.js).
 */
(function (global) {
    const LS_CUSTOM_MAP_PINS = 'altitudeHdMainMapCustomPins_v1';

    const DEFAULT_START = { lat: -37.943356, lng: 175.556788 };
    const DEFAULT_FINISH = { lat: -37.929223, lng: 175.542716 };

    const LANE_COUNT = 8;
    const LANE_SPACING_M = 12.5;
    const COURSE_LENGTH_M = 2000;
    const DISTANCE_MARKS_M = [500, 1000, 1500];
    const EARTH_R = 6371000;

    const COLORS = {
        boundary: '#1e40af',
        divider: 'rgba(59, 130, 246, 0.55)',
        startLine: '#2563eb',
        markerLine: 'rgba(29, 78, 216, 0.85)',
        checkerA: '#1e40af',
        checkerB: '#ffffff',
        checkerBorder: '#0f172a',
    };

    let mapRef = null;
    let layerRef = null;

    function toRad(deg) {
        return (deg * Math.PI) / 180;
    }

    function toDeg(rad) {
        return (rad * 180) / Math.PI;
    }

    function normalizeBearing(deg) {
        return ((deg % 360) + 360) % 360;
    }

    function haversineM(lat1, lng1, lat2, lng2) {
        const φ1 = toRad(lat1);
        const φ2 = toRad(lat2);
        const Δφ = toRad(lat2 - lat1);
        const Δλ = toRad(lng2 - lng1);
        const a =
            Math.sin(Δφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
        return 2 * EARTH_R * Math.asin(Math.sqrt(a));
    }

    function bearingDeg(lat1, lng1, lat2, lng2) {
        const φ1 = toRad(lat1);
        const φ2 = toRad(lat2);
        const Δλ = toRad(lng2 - lng1);
        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x =
            Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        return normalizeBearing(toDeg(Math.atan2(y, x)));
    }

    function destination(lat, lng, brgDeg, distM) {
        const φ1 = toRad(lat);
        const λ1 = toRad(lng);
        const θ = toRad(brgDeg);
        const δ = distM / EARTH_R;
        const sinφ1 = Math.sin(φ1);
        const cosφ1 = Math.cos(φ1);
        const sinδ = Math.sin(δ);
        const cosδ = Math.cos(δ);
        const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
        const φ2 = Math.asin(sinφ2);
        const y = Math.sin(θ) * sinδ * cosφ1;
        const x = cosδ - sinφ1 * sinφ2;
        const λ2 = λ1 + Math.atan2(y, x);
        return { lat: toDeg(φ2), lng: normalizeLng(toDeg(λ2)) };
    }

    function normalizeLng(lng) {
        return ((lng + 540) % 360) - 180;
    }

    function offsetPerpendicular(lat, lng, courseBearing, offsetM) {
        return destination(lat, lng, courseBearing + 90, offsetM);
    }

    function laneCenterOffsetM(laneNum) {
        return (laneNum - (LANE_COUNT + 1) / 2) * LANE_SPACING_M;
    }

    function courseHalfWidthM() {
        return (LANE_COUNT * LANE_SPACING_M) / 2;
    }

    function loadStartFinish() {
        let pins = [];
        try {
            const raw = global.localStorage.getItem(LS_CUSTOM_MAP_PINS);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) pins = arr;
            }
        } catch {
            /* ignore */
        }

        const findPin = (name) => {
            const needle = name.toLowerCase();
            const hit = pins.find(
                (p) =>
                    p &&
                    typeof p.name === 'string' &&
                    p.name.trim().toLowerCase() === needle &&
                    Number.isFinite(p.lat) &&
                    Number.isFinite(p.lng),
            );
            return hit ? { lat: Number(hit.lat), lng: Number(hit.lng) } : null;
        };

        const start = findPin('start') || { ...DEFAULT_START };
        const finish = findPin('finish') || { ...DEFAULT_FINISH };
        return { start, finish };
    }

    function latLngPair(pt) {
        return [pt.lat, pt.lng];
    }

    function crossWidthPoints(anchor, courseBearing, halfWidthM) {
        const left = offsetPerpendicular(anchor.lat, anchor.lng, courseBearing, -halfWidthM);
        const right = offsetPerpendicular(anchor.lat, anchor.lng, courseBearing, halfWidthM);
        return { left, right };
    }

    function drawCheckerFinish(left, right, courseBearing, layer) {
        const numSquares = 24;
        const thicknessM = 10;
        const brgAcross = courseBearing + 90;
        const halfThick = thicknessM / 2;

        for (let i = 0; i < numSquares; i++) {
            const t0 = i / numSquares;
            const t1 = (i + 1) / numSquares;
            const a0 = {
                lat: left.lat + (right.lat - left.lat) * t0,
                lng: left.lng + (right.lng - left.lng) * t0,
            };
            const a1 = {
                lat: left.lat + (right.lat - left.lat) * t1,
                lng: left.lng + (right.lng - left.lng) * t1,
            };
            const b0 = destination(a0.lat, a0.lng, brgAcross, halfThick);
            const b1 = destination(a1.lat, a1.lng, brgAcross, halfThick);
            const c0 = destination(a0.lat, a0.lng, brgAcross, -halfThick);
            const c1 = destination(a1.lat, a1.lng, brgAcross, -halfThick);
            const fill = i % 2 === 0 ? COLORS.checkerA : COLORS.checkerB;
            L.polygon([latLngPair(c0), latLngPair(c1), latLngPair(b1), latLngPair(b0)], {
                color: COLORS.checkerBorder,
                weight: 0.6,
                fillColor: fill,
                fillOpacity: 0.95,
                interactive: false,
            }).addTo(layer);
        }
    }

    function addLineLabel(lat, lng, text, className) {
        const icon = L.divIcon({
            className: `kri-course-label ${className}`,
            html: `<span>${text}</span>`,
            iconSize: undefined,
            iconAnchor: [0, 0],
        });
        L.marker([lat, lng], { icon, interactive: false, keyboard: false }).addTo(layerRef);
    }

    function renderCourse() {
        if (!mapRef || !layerRef) return;
        layerRef.clearLayers();

        const { start, finish } = loadStartFinish();
        const courseBearing = bearingDeg(start.lat, start.lng, finish.lat, finish.lng);
        const halfWidth = courseHalfWidthM();

        const laneEndpoints = [];
        for (let lane = 1; lane <= LANE_COUNT; lane += 1) {
            const offset = laneCenterOffsetM(lane);
            const startPt = offsetPerpendicular(start.lat, start.lng, courseBearing, offset);
            const finishPt = offsetPerpendicular(finish.lat, finish.lng, courseBearing, offset);
            laneEndpoints.push({ lane, startPt, finishPt, offset });

            L.polyline([latLngPair(startPt), latLngPair(finishPt)], {
                color: COLORS.divider,
                weight: 1.2,
                opacity: 0.85,
                dashArray: '6 8',
                interactive: false,
            }).addTo(layerRef);

            const labelPt = destination(
                startPt.lat,
                startPt.lng,
                courseBearing + 180,
                35,
            );
            addLineLabel(labelPt.lat, labelPt.lng, `Lane ${lane}`, 'kri-course-label--lane');
        }

        const outerOffsets = [-halfWidth, halfWidth];
        for (const offset of outerOffsets) {
            const startPt = offsetPerpendicular(start.lat, start.lng, courseBearing, offset);
            const finishPt = offsetPerpendicular(finish.lat, finish.lng, courseBearing, offset);
            L.polyline([latLngPair(startPt), latLngPair(finishPt)], {
                color: COLORS.boundary,
                weight: 2.4,
                opacity: 0.95,
                interactive: false,
            }).addTo(layerRef);
        }

        const startWidth = crossWidthPoints(start, courseBearing, halfWidth);
        L.polyline(
            [latLngPair(startWidth.left), latLngPair(startWidth.right)],
            {
                color: COLORS.startLine,
                weight: 3.5,
                opacity: 1,
                interactive: false,
            },
        ).addTo(layerRef);
        addLineLabel(
            start.lat,
            start.lng,
            'Start',
            'kri-course-label--endpoint kri-course-label--start',
        );

        const finishWidth = crossWidthPoints(finish, courseBearing, halfWidth);
        drawCheckerFinish(finishWidth.left, finishWidth.right, courseBearing, layerRef);
        addLineLabel(
            finish.lat,
            finish.lng,
            'Finish',
            'kri-course-label--endpoint kri-course-label--finish',
        );

        for (const distM of DISTANCE_MARKS_M) {
            const anchor = destination(start.lat, start.lng, courseBearing, distM);
            const width = crossWidthPoints(anchor, courseBearing, halfWidth);
            L.polyline([latLngPair(width.left), latLngPair(width.right)], {
                color: COLORS.markerLine,
                weight: 2,
                opacity: 0.9,
                dashArray: '10 6',
                interactive: false,
            }).addTo(layerRef);
            const labelPt = offsetPerpendicular(anchor.lat, anchor.lng, courseBearing, halfWidth + 18);
            addLineLabel(labelPt.lat, labelPt.lng, `${distM} m`, 'kri-course-label--distance');
        }

        const pinDist = haversineM(start.lat, start.lng, finish.lat, finish.lng);
        if (Math.abs(pinDist - COURSE_LENGTH_M) > 80) {
            const mid = destination(start.lat, start.lng, courseBearing, COURSE_LENGTH_M / 2);
            addLineLabel(
                mid.lat,
                mid.lng,
                `Pins ${Math.round(pinDist)} m apart (course ${COURSE_LENGTH_M} m)`,
                'kri-course-label--hint',
            );
        }
    }

    function mount(map, layerGroup) {
        mapRef = map;
        layerRef = layerGroup;
        renderCourse();

        if (!global.__kriCourseStorageBound) {
            global.__kriCourseStorageBound = true;
            global.addEventListener('storage', (e) => {
                if (e.key === LS_CUSTOM_MAP_PINS) renderCourse();
            });
        }
    }

    global.KriRowingCourseOverlay = {
        mount,
        renderCourse,
        loadStartFinish,
        COURSE_LENGTH_M,
        LANE_COUNT,
        LANE_SPACING_M,
    };
})(typeof window !== 'undefined' ? window : globalThis);
