/**
 * RowSafe map ↔ Manager course view bridge (timing lines + live positions).
 */
(function () {
  const API = '/api/traccar';
  const SOURCE = 'rowing';
  const LS_COURSE = 'rnz_course_view_course';
  const DEFAULT_COURSE = '2 km course';

  /** @type {object[]} */
  let timingLines = [];
  /** @type {object[]} */
  let latestMapPositions = [];
  /** @type {L.LayerGroup|null} */
  let mainMapCourseLayer = null;
  /** @type {Promise<void>|null} */
  let timingLinesReady = null;

  function timingLinesApiUrl(id) {
    const base = `${window.location.origin}${API}?action=timing-lines&source=${SOURCE}`;
    return id ? `${base}&id=${encodeURIComponent(id)}` : base;
  }

  window.RNZ_courseViewTimingUrl = timingLinesApiUrl;
  window.dashboardApiBase = () => window.location.origin;
  window.dashboardHeaders = () => ({ Accept: 'application/json' });
  window.dashboardGetTimingLines = () => timingLines.slice();

  window.dashboardGetTimingCourseGroups = () => {
    const groups = new Set();
    for (const line of timingLines) {
      if (line.enabled === false) continue;
      groups.add(line.courseGroup || 'Other');
    }
    return [...groups].sort();
  };

  window.dashboardGetLatestPositions = () => latestMapPositions.slice();

  function notifyTimingLinesLoaded() {
    if (typeof window.dashboardOnTimingLinesLoaded === 'function') {
      window.dashboardOnTimingLinesLoaded();
    }
    window.dispatchEvent(
      new CustomEvent('rowsafe:timing-lines', {
        detail: { lines: timingLines.slice() },
      }),
    );
    drawMainMapCourse(pickCourseGroup());
  }

  async function loadTimingLines() {
    const res = await fetch(timingLinesApiUrl(), {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Timing lines HTTP ${res.status}`);
    }
    timingLines = Array.isArray(data.lines) ? data.lines : [];
  }

  function ensureTimingLinesLoaded() {
    if (timingLines.length) return Promise.resolve();
    if (!timingLinesReady) {
      timingLinesReady = loadTimingLines()
        .then(() => {
          notifyTimingLinesLoaded();
        })
        .catch((e) => {
          timingLinesReady = null;
          throw e;
        });
    }
    return timingLinesReady;
  }

  window.dashboardEnsureTimingLinesLoaded = ensureTimingLinesLoaded;

  window.dashboardRefreshTimingLines = () => {
    timingLinesReady = loadTimingLines()
      .then(() => {
        notifyTimingLinesLoaded();
      })
      .catch((e) => {
        timingLinesReady = null;
        console.warn('[rowsafe-course-bridge] timing lines refresh failed:', e);
      });
    return timingLinesReady;
  };

  function pickCourseGroup() {
    const groups = window.dashboardGetTimingCourseGroups();
    if (!groups.length) return '';
    let saved = '';
    try {
      saved = localStorage.getItem(LS_COURSE) || '';
    } catch {
      saved = '';
    }
    if (saved && groups.includes(saved)) return saved;
    if (groups.includes(DEFAULT_COURSE)) return DEFAULT_COURSE;
    return groups[0];
  }

  function linesForCourse(group) {
    if (!group) return [];
    return timingLines
      .filter((l) => l.enabled !== false && (l.courseGroup || 'Other') === group)
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
          (a.distanceM ?? 0) - (b.distanceM ?? 0),
      );
  }

  function getMainMap() {
    return window.RnzRowsafeMap?.getMap?.() ?? null;
  }

  function drawMainMapCourse(group) {
    const map = getMainMap();
    if (!map || typeof L === 'undefined') return;
    const lines = linesForCourse(group);
    if (!mainMapCourseLayer) {
      if (!map.getPane('rnzCoursePane')) {
        map.createPane('rnzCoursePane');
        map.getPane('rnzCoursePane').style.zIndex = 410;
      }
      mainMapCourseLayer = L.layerGroup([], { pane: 'rnzCoursePane' }).addTo(map);
    }
    mainMapCourseLayer.clearLayers();
    if (!lines.length) return;

    for (const line of lines) {
      const lat1 = Number(line.lat1);
      const lon1 = Number(line.lon1);
      const lat2 = Number(line.lat2);
      const lon2 = Number(line.lon2);
      if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) continue;
      const style =
        line.lineType === 'start'
          ? { color: '#22c55e', weight: 3, opacity: 0.95 }
          : line.lineType === 'finish'
            ? { color: '#ef4444', weight: 3, opacity: 0.95 }
            : { color: '#38bdf8', weight: 2, opacity: 0.9, dashArray: '8 6' };
      const label =
        line.distanceM != null && line.lineType !== 'start'
          ? `${line.name} (${Math.round(line.distanceM)} m)`
          : line.name;
      L.polyline(
        [
          [lat1, lon1],
          [lat2, lon2],
        ],
        style,
      )
        .bindTooltip(label, { sticky: true })
        .addTo(mainMapCourseLayer);
    }
  }

  function positionsObjectToArray(devices, positionsById) {
    const out = [];
    const list = Array.isArray(devices) ? devices : [];
    for (const d of list) {
      const pos = positionsById[d.id];
      if (!pos) continue;
      const lat = pos.latitude;
      const lon = pos.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const deviceId = d.uniqueId || d.name || String(d.id);
      const attrs = pos.attributes || {};
      const athleteRaw = d.athleteId ?? attrs.athleteId ?? attrs.athlete ?? '';
      const athleteId = String(athleteRaw || '').trim() || null;
      let online = false;
      if (pos.fixTime) {
        const ageMin = (Date.now() - new Date(pos.fixTime).getTime()) / 60000;
        online = ageMin < 5;
      }
      const rowing = d.rowing || attrs.rowing || {};
      out.push({
        deviceId,
        athleteId,
        latitude: lat,
        longitude: lon,
        speed: pos.speed,
        displaySpeedMps: pos.attributes?.displaySpeedMps ?? pos.displaySpeedMps ?? null,
        pathSpeedMps: pos.attributes?.pathSpeedMps ?? pos.pathSpeedMps ?? null,
        attributes: attrs,
        strokeRate:
          rowing.strokeRate ?? attrs.strokeRate ?? attrs.stroke_rate ?? null,
        strokeRateValid:
          rowing.strokeRateValid ?? attrs.strokeRateValid ?? attrs.stroke_rate != null,
        online,
      });
    }
    return out;
  }

  function onSnapshot(detail) {
    latestMapPositions = positionsObjectToArray(detail?.devices, detail?.positions || {});
    if (typeof window.dashboardOnPollUpdate === 'function') {
      window.dashboardOnPollUpdate({
        positions: latestMapPositions,
        devices: detail?.devices || [],
        polledAt: detail?.polledAt || Date.now(),
      });
    }
  }

  window.addEventListener('rowsafe:snapshot', (ev) => {
    onSnapshot(ev.detail);
  });

  window.addEventListener('rowsafe:course-selected', (ev) => {
    const group = ev.detail?.courseGroup;
    if (group) drawMainMapCourse(group);
  });

  async function init() {
    if (typeof window.dashboardInitCourseView === 'function') {
      window.dashboardInitCourseView();
    }
    wireMapToolbarClicks();
    try {
      await ensureTimingLinesLoaded();
    } catch (e) {
      console.warn('[rowsafe-course-bridge] timing lines load failed:', e);
    }
  }

  function wireMapToolbarClicks() {
    if (document.documentElement.dataset.rnzToolbarBound === '1') return;
    document.documentElement.dataset.rnzToolbarBound = '1';

    const handleToolbarAction = (target) => {
      if (!target) return false;
      if (target.closest('#courseViewBtn')) {
        window.RnzCourseView?.open?.();
        return true;
      }
      if (target.closest('#rnzMapMobileExpandBtn')) {
        window.RnzMapFullscreen?.enter?.();
        return true;
      }
      if (target.closest('#rnzMapFullscreenExitBtn')) {
        window.RnzMapFullscreen?.exit?.();
        return true;
      }
      return false;
    };

    const onPointer = (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      if (!handleToolbarAction(target)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener('click', onPointer, true);
    document.addEventListener('touchend', onPointer, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void init();
    });
  } else {
    void init();
  }
})();
