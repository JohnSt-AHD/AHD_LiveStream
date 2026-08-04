/**
 * RowSafe map — toggle NZ-today GPS traces per device (token colour + speed shade).
 */
(function () {
  const TZ = 'Pacific/Auckland';
  const MAX_POINTS = 500;
  const SPEED_MIN_MPS = 0;
  const SPEED_MAX_MPS = 6;
  const PANE = 'rnzDayTracesPane';

  let enabled = false;
  let loading = false;
  let layer = null;
  let didFitBounds = false;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getMap() {
    return window.RnzRowsafeMap?.getMap?.() || null;
  }

  function getDevices() {
    const list = window.RnzRowsafeMap?.getDevices?.();
    return Array.isArray(list) ? list : [];
  }

  function nzTodayDateKey() {
    return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  }

  function timeZoneOffsetMs(at, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
      hour: 'numeric',
    }).formatToParts(at);
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';
    const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(tzName);
    if (!m) return 0;
    const sign = m[1] === '+' ? 1 : -1;
    return sign * (Number(m[2]) * 60 + Number(m[3] || 0)) * 60 * 1000;
  }

  /** Auckland civil midnight → now (ISO). */
  function nzTodayRangeIso() {
    const dateKey = nzTodayDateKey();
    const [y, mo, d] = dateKey.split('-').map(Number);
    const noonUtc = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    const offset = timeZoneOffsetMs(noonUtc, TZ);
    const fromMs = Date.UTC(y, mo - 1, d, 0, 0, 0) - offset;
    return {
      fromIso: new Date(fromMs).toISOString(),
      toIso: new Date().toISOString(),
      dateKey,
    };
  }

  function positionTimeMs(p) {
    if (!p || typeof p !== 'object') return NaN;
    const raw = p.fixTime ?? p.deviceTime ?? p.serverTime;
    if (raw == null || raw === '') return NaN;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
    }
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  function sortRoutePoints(points) {
    return (points || [])
      .filter(
        (p) =>
          p &&
          typeof p.latitude === 'number' &&
          typeof p.longitude === 'number' &&
          !Number.isNaN(p.latitude) &&
          !Number.isNaN(p.longitude),
      )
      .sort((a, b) => positionTimeMs(a) - positionTimeMs(b));
  }

  function decimateRoutePoints(points, max) {
    if (!points.length || points.length <= max) return points;
    const out = [];
    const step = (points.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) {
      out.push(points[Math.round(i * step)]);
    }
    return out;
  }

  function speedMps(p) {
    if (!p) return 0;
    const s = typeof p.speed === 'number' && Number.isFinite(p.speed) ? p.speed : 0;
    return Math.max(0, s);
  }

  function hexToRgb(hex) {
    const h = String(hex || '')
      .replace('#', '')
      .trim();
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      return { r, g, b };
    }
    if (h.length >= 6) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    }
    return { r: 56, g: 189, b: 248 };
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h / 6, s, l };
  }

  function hslToCss(h, s, l) {
    return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }

  /** Keep token hue; slow → dark, fast → full/bright token shade. */
  function shadeForSpeed(baseHex, speed) {
    const { r, g, b } = hexToRgb(baseHex);
    const hsl = rgbToHsl(r, g, b);
    const t = Math.min(1, Math.max(0, (speed - SPEED_MIN_MPS) / (SPEED_MAX_MPS - SPEED_MIN_MPS)));
    const l = 0.18 + t * (Math.min(0.72, Math.max(0.45, hsl.l + 0.08)) - 0.18);
    const s = hsl.s * (0.45 + 0.55 * t);
    return hslToCss(hsl.h, s, l);
  }

  function colorForDevice(device) {
    const id = device?.id;
    if (window.RnzDeviceColors?.fill) {
      return window.RnzDeviceColors.fill(id);
    }
    return '#38bdf8';
  }

  function labelForDevice(device) {
    const name = device?.name != null ? String(device.name).trim() : '';
    if (name) return name;
    return device?.id != null ? String(device.id) : 'Device';
  }

  function ensureLayer(map) {
    if (!map.getPane(PANE)) {
      map.createPane(PANE);
      map.getPane(PANE).style.zIndex = 390;
    }
    if (!layer) {
      layer = L.layerGroup([], { pane: PANE });
    }
    if (!map.hasLayer(layer)) {
      layer.addTo(map);
    }
    return layer;
  }

  function clearTraces() {
    if (layer) layer.clearLayers();
    didFitBounds = false;
  }

  function setButtonState(pressed, label) {
    const btn = $('rnzDayTracesBtn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    btn.classList.toggle('rnz-map-follow-btn--active', Boolean(pressed));
    btn.disabled = Boolean(loading);
    if (label) btn.textContent = label;
    else if (loading) btn.textContent = 'Loading…';
    else btn.textContent = "Today's traces";
  }

  function renderRoutes(map, routes) {
    const lg = ensureLayer(map);
    lg.clearLayers();
    const bounds = [];

    for (const { device, points } of routes) {
      if (!points || points.length < 2) continue;
      const base = colorForDevice(device);
      const label = labelForDevice(device);

      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        const spd = (speedMps(prev) + speedMps(cur)) / 2;
        const color = shadeForSpeed(base, spd);
        const a = [prev.latitude, prev.longitude];
        const b = [cur.latitude, cur.longitude];
        bounds.push(a, b);
        L.polyline([a, b], {
          color,
          weight: 4,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
          pane: PANE,
          interactive: false,
        }).addTo(lg);
      }

      const last = points[points.length - 1];
      const icon = L.divIcon({
        className: 'rnz-day-trace-label',
        html:
          `<span class="rnz-day-trace-label__chip" style="--rnz-trace-color:${base}">` +
          `${escapeHtml(label)}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 14],
      });
      L.marker([last.latitude, last.longitude], {
        icon,
        pane: PANE,
        interactive: false,
        keyboard: false,
      }).addTo(lg);
    }

    if (!didFitBounds && bounds.length >= 2) {
      try {
        map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 16 });
        didFitBounds = true;
      } catch {
        /* ignore */
      }
    }
  }

  async function loadTraces() {
    const map = getMap();
    if (!map || typeof L === 'undefined') {
      setButtonState(false);
      enabled = false;
      return;
    }

    const devices = getDevices();
    if (!devices.length) {
      clearTraces();
      setButtonState(true, 'No devices');
      setTimeout(() => setButtonState(true), 1600);
      return;
    }

    if (loading) return;
    loading = true;
    setButtonState(true);

    const { fromIso, toIso } = nzTodayRangeIso();
    const fetchRoute = window.AltitudeHdTrackerSource?.fetchRoute;

    try {
      if (typeof fetchRoute !== 'function') {
        throw new Error('Route API unavailable');
      }

      // Keep colour registry aligned with live map.
      if (window.RnzDeviceColors?.sync) {
        window.RnzDeviceColors.sync(devices.map((d) => d.id));
      }

      const settled = await Promise.allSettled(
        devices.map(async (device) => {
          const raw = await fetchRoute(device.id, fromIso, toIso);
          const sorted = sortRoutePoints(raw);
          const points = decimateRoutePoints(sorted, MAX_POINTS);
          return { device, points };
        }),
      );

      if (!enabled) {
        clearTraces();
        return;
      }

      const routes = [];
      let failed = 0;
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          if (result.value.points.length >= 2) routes.push(result.value);
        } else {
          failed += 1;
        }
      }

      renderRoutes(map, routes);

      const btn = $('rnzDayTracesBtn');
      if (btn && routes.length) {
        const note =
          failed > 0
            ? `Today's traces (${routes.length}, ${failed} failed)`
            : `Today's traces (${routes.length})`;
        btn.title = note;
      }
    } catch (err) {
      console.warn('[rowsafe-day-traces]', err);
      clearTraces();
      setButtonState(true, 'Load failed');
      setTimeout(() => {
        if (enabled) setButtonState(true);
      }, 1800);
    } finally {
      loading = false;
      if (enabled) setButtonState(true);
      else setButtonState(false);
    }
  }

  async function setEnabled(next) {
    enabled = Boolean(next);
    if (!enabled) {
      clearTraces();
      setButtonState(false);
      const btn = $('rnzDayTracesBtn');
      if (btn) btn.title = "Show each device's GPS path for today (NZ)";
      return;
    }
    await loadTraces();
  }

  function bind() {
    const btn = $('rnzDayTracesBtn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.title = "Show each device's GPS path for today (NZ)";
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void setEnabled(!enabled);
    });
  }

  function boot() {
    bind();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.RnzDayTraces = {
    isEnabled: () => enabled,
    setEnabled,
    reload: () => (enabled ? loadTraces() : Promise.resolve()),
  };
})();
