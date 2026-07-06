/**
 * RowSafe map ↔ Manager course view bridge (timing lines + live positions).
 */
(function () {
  const API = '/api/traccar';
  const SOURCE = 'rowing';

  /** @type {object[]} */
  let timingLines = [];
  /** @type {object[]} */
  let latestMapPositions = [];

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

  window.dashboardRefreshTimingLines = () => {
    void loadTimingLines().catch(() => {});
  };

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

  function init() {
    void loadTimingLines().catch((e) => {
      console.warn('[rowsafe-course-bridge] timing lines load failed:', e);
    });
    if (typeof window.dashboardInitCourseView === 'function') {
      window.dashboardInitCourseView();
    }
    wireMapToolbarClicks();
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
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
