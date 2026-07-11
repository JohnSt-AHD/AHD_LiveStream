#!/usr/bin/env node
/** Quick ingest analysis for a recorder device. Usage: node scripts/analyze-device-session.mjs A5 */
const RECORDER = 'https://rowing-app-recorder-pwa.vercel.app';
const deviceId = process.argv[2] || 'A5';

function ms(v) {
  if (v == null) return NaN;
  if (typeof v === 'number' && v < 1e12) return v * 1000;
  return new Date(v).getTime();
}

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function p90(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length * 0.9)];
}

function haversineM(a, b, c, d) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(c - a);
  const dLon = rad(d - b);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nz(iso) {
  return new Date(iso).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

async function main() {
  const devRes = await fetch(`${RECORDER}/api/devices?onlineSec=86400&windowSec=86400`).then((r) =>
    r.json(),
  );
  const dev = (devRes.devices || []).find((d) => d.deviceId === deviceId);
  if (!dev) {
    console.log(JSON.stringify({ error: `Device ${deviceId} not found in last 24h` }));
    process.exit(1);
  }

  const from = new Date(dev.firstSeenMs).toISOString();
  const to = new Date(dev.lastSeenMs + 120000).toISOString();
  const pts = await fetch(
    `${RECORDER}/api/history?uniqueId=${encodeURIComponent(deviceId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  ).then((r) => r.json());

  const arr = (Array.isArray(pts) ? pts : []).sort(
    (a, b) => ms(a.fixTime || a.deviceTime || a.t) - ms(b.fixTime || b.deviceTime || b.t),
  );

  const gaps = [];
  const accs = [];
  const speeds = [];
  let dist = 0;

  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    const lat = p.latitude ?? p.lat;
    const lon = p.longitude ?? p.lon;
    const acc = p.accuracy ?? p.acc;
    const spd = p.speed ?? p.spd;
    if (Number.isFinite(acc)) accs.push(acc);
    if (Number.isFinite(spd)) speeds.push(spd);
    if (i > 0) {
      const prev = arr[i - 1];
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
    arr.length > 1
      ? (ms(arr.at(-1).fixTime || arr.at(-1).deviceTime || arr.at(-1).t) -
          ms(arr[0].fixTime || arr[0].deviceTime || arr[0].t)) /
        1000
      : 0;
  const activeGaps = gaps.filter((g) => g <= 15);
  const bytesEst = arr.length * 900;

  const result = {
    device: deviceId,
    handset: 'Samsung Galaxy A06 (Spark M2M)',
    sessionStartNz: arr.length ? nz(arr[0].fixTime || arr[0].deviceTime || from) : nz(from),
    sessionEndNz: arr.length
      ? nz(arr.at(-1).fixTime || arr.at(-1).deviceTime || to)
      : nz(dev.lastSeenMs),
    durationMin: Number((spanSec / 60).toFixed(1)),
    totalSamples: arr.length,
    deviceReportedSamples: dev.totalSamples,
    fixRateHz: spanSec > 0 ? Number((arr.length / spanSec).toFixed(2)) : null,
    medianGapSec: median(gaps) != null ? Number(median(gaps).toFixed(1)) : null,
    p90GapSec: p90(gaps) != null ? Number(p90(gaps).toFixed(1)) : null,
    maxGapSec: gaps.length ? Number(Math.max(...gaps).toFixed(1)) : null,
    gapsOver15s: gaps.filter((g) => g > 15).length,
    gapsOver30s: gaps.filter((g) => g > 30).length,
    gapsOver60s: gaps.filter((g) => g > 60).length,
    activeMedianGapSec: median(activeGaps) != null ? Number(median(activeGaps).toFixed(1)) : null,
    activeRateHz:
      median(activeGaps) != null && median(activeGaps) > 0
        ? Number((1 / median(activeGaps)).toFixed(2))
        : null,
    distanceKm: Number((dist / 1000).toFixed(2)),
    medianAccM: median(accs) != null ? Number(median(accs).toFixed(1)) : null,
    p90AccM: p90(accs) != null ? Number(p90(accs).toFixed(1)) : null,
    maxAccM: accs.length ? Number(Math.max(...accs).toFixed(1)) : null,
    lastFixAccM: dev.gps?.last?.acc != null ? Number(dev.gps.last.acc.toFixed(1)) : null,
    lastFix: dev.gps?.last ?? null,
    batteryPctNow: dev.battery?.pct ?? null,
    batteryAgeSec: dev.battery?.ageSec ?? null,
    lastSeenAgoMin: dev.lastSeenAgoSec != null ? Number((dev.lastSeenAgoSec / 60).toFixed(1)) : null,
    capsizeEvents: arr.filter((p) => p.capsize || p.attributes?.capsize).length,
    estUploadKb: Math.round(bytesEst / 1024),
    estUploadMb: Number((bytesEst / 1024 / 1024).toFixed(2)),
    estUploadMbPerHour:
      spanSec > 0 ? Number(((bytesEst / 1024 / 1024) / (spanSec / 3600)).toFixed(2)) : null,
    rowing: dev.rowing ?? null,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
