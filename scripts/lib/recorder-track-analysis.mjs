/** Shared GPS ingest analysis for KRI field-test reports. */

export function ms(v) {
  if (v == null) return NaN;
  if (typeof v === 'number' && v < 1e12) return v * 1000;
  return new Date(v).getTime();
}

export function nzTime(iso, { withSec = false } = {}) {
  return new Date(iso).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSec ? { second: '2-digit' } : {}),
    hour12: false,
  });
}

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function p90(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.9)];
}

export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function analyzePoints(points, { activeGapMaxSec = 15 } = {}) {
  if (!points?.length) return null;
  const sorted = [...points].sort(
    (a, b) => ms(a.fixTime || a.deviceTime || a.t) - ms(b.fixTime || b.deviceTime || b.t),
  );
  const gaps = [];
  const accs = [];
  let dist = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const lat = p.latitude ?? p.lat;
    const lon = p.longitude ?? p.lon;
    const acc = p.accuracy ?? p.acc;
    if (Number.isFinite(acc)) accs.push(acc);
    if (i > 0) {
      const prev = sorted[i - 1];
      const t = ms(p.fixTime || p.deviceTime || p.t);
      const pt = ms(prev.fixTime || prev.deviceTime || prev.t);
      gaps.push((t - pt) / 1000);
      const plat = prev.latitude ?? prev.lat;
      const plon = prev.longitude ?? prev.lon;
      if (lat != null && lon != null && plat != null && plon != null) {
        dist += haversineM(plat, plon, lat, lon);
      }
    }
  }
  const spanSec =
    sorted.length > 1
      ? (ms(sorted.at(-1).fixTime || sorted.at(-1).deviceTime || sorted.at(-1).t) -
          ms(sorted[0].fixTime || sorted[0].deviceTime || sorted[0].t)) /
        1000
      : 0;
  const activeGaps = gaps.filter((g) => g <= activeGapMaxSec);
  const activeMedianGap = median(activeGaps);
  const bytesEst = sorted.length * 900;

  return {
    count: sorted.length,
    startIso: sorted[0].fixTime || sorted[0].deviceTime,
    endIso: sorted.at(-1).fixTime || sorted.at(-1).deviceTime,
    durationMin: spanSec / 60,
    durationH: spanSec / 3600,
    spanSec,
    distanceKm: dist / 1000,
    fixRateHz: spanSec > 0 ? sorted.length / spanSec : null,
    medianGapSec: median(gaps),
    p90GapSec: p90(gaps),
    maxGapSec: gaps.length ? Math.max(...gaps) : null,
    gapsOver15s: gaps.filter((g) => g > 15).length,
    gapsOver30s: gaps.filter((g) => g > 30).length,
    gapsOver60s: gaps.filter((g) => g > 60).length,
    activeMedianGapSec: activeMedianGap,
    activeRateHz: activeMedianGap != null && activeMedianGap > 0 ? 1 / activeMedianGap : null,
    medianAccM: median(accs),
    p90AccM: p90(accs),
    maxAccM: accs.length ? Math.max(...accs) : null,
    estDataMb: bytesEst / 1024 / 1024,
    estDataMbPerH: spanSec > 0 ? bytesEst / 1024 / 1024 / (spanSec / 3600) : null,
  };
}

export function filterPointsByNzWindow(points, dateYmd, startHour, endHour) {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const startUtc = Date.UTC(y, m - 1, d, startHour - 12, 0, 0);
  const endUtc = Date.UTC(y, m - 1, d, endHour - 12, 0, 0);
  return points.filter((p) => {
    const t = ms(p.fixTime || p.deviceTime || p.t);
    return t >= startUtc && t <= endUtc;
  });
}

export async function fetchHistory(deviceId, fromIso, toIso, recorder) {
  const url = `${recorder}/api/history?uniqueId=${encodeURIComponent(deviceId)}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  const data = await r.json();
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return Array.isArray(data) ? data : [];
}
