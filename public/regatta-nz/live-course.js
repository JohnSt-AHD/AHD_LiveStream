/**
 * Phone-sized Ged-style course graphic from /api/race (GED CV sim).
 * Logo above each boat dot; multi-line ticket below in-lane.
 * Start/finish pockets keep logos + tickets on-screen; unofficial CV results at finish.
 */

import { prepareLogoCutout } from './logo-cutout.js';

const COURSE_M = 2000;
const LANE_COUNT = 8;
const LOGO_SIZE = 40;
/** Extra water beyond start/finish so logo + ticket stay on-screen. */
const END_POCKET = 88;
const FINISH_BANNER_H = 28;
const TICKET_GAP = 5;
const LOGO_GAP = 5;

function ordinal(n) {
  const p = Number(n);
  if (!Number.isFinite(p) || p < 1) return '—';
  const v = p % 100;
  if (v >= 11 && v <= 13) return `${p}th`;
  switch (p % 10) {
    case 1:
      return `${p}st`;
    case 2:
      return `${p}nd`;
    case 3:
      return `${p}rd`;
    default:
      return `${p}th`;
  }
}

export function createLiveCourse(canvas) {
  const ctx = canvas.getContext('2d');
  let followedLane = null;
  /** @type {Map<string, { code: string, logoUrl?: string|null }>} */
  let laneMeta = new Map();
  /** @type {Map<string, HTMLImageElement>} */
  const logoImgs = new Map();
  let paintQueued = null;

  function requestPaint() {
    if (paintQueued) return;
    paintQueued = requestAnimationFrame(() => {
      paintQueued = null;
      canvas.dispatchEvent(new Event('logo-ready'));
    });
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 360;
    const h = canvas.clientHeight || 560;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function setFollowedLane(lane) {
    followedLane = lane == null ? null : Number(lane);
  }

  function setLaneLabels(map) {
    const next = new Map();
    const entries = map instanceof Map ? map.entries() : Object.entries(map || {});
    for (const [k, v] of entries) {
      if (v && typeof v === 'object') next.set(String(k), v);
      else next.set(String(k), { code: String(v || '') });
    }
    laneMeta = next;
    for (const [lane, meta] of laneMeta) {
      const url = meta.logoUrl;
      if (!url || logoImgs.has(lane)) continue;
      const img = new Image();
      logoImgs.set(lane, img);
      prepareLogoCutout(url).then((dataUrl) => {
        if (!dataUrl) return;
        img.onload = () => requestPaint();
        img.src = dataUrl;
      });
    }
  }

  function roundRect(c, x, y, rw, rh, r) {
    const rr = Math.min(r, rw / 2, rh / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + rw, y, x + rw, y + rh, rr);
    c.arcTo(x + rw, y + rh, x, y + rh, rr);
    c.arcTo(x, y + rh, x, y, rr);
    c.arcTo(x, y, x + rw, y, rr);
    c.closePath();
  }

  function drawLogo(img, x, y, size) {
    if (!img || !img.complete || !img.naturalWidth) return false;
    const aspect = img.naturalHeight / img.naturalWidth;
    const dw = size;
    const dh = size * Math.min(1.25, Math.max(0.9, aspect));
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x - dw / 2, y - dh / 2, dw, dh, 5);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x - dw / 2, y - dh / 2, dw, dh);
    ctx.drawImage(img, x - dw / 2, y - dh / 2, dw, dh);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x - dw / 2, y - dh / 2, dw, dh, 5);
    ctx.stroke();
    return true;
  }

  function rankedBoats(boats, race) {
    const finished = String(race?.race_phase || '') === 'finished';
    if (finished) {
      const rows = race?.splits?.by_mark?.['2000'] || race?.splits?.by_mark?.[2000] || [];
      const placeByLane = new Map(
        rows.map((r) => [Number(r.lane), Number(r.place ?? r.placing) || 999]),
      );
      return [...boats].sort((a, b) => {
        const pa = placeByLane.get(Number(a.lane)) ?? 999;
        const pb = placeByLane.get(Number(b.lane)) ?? 999;
        if (pa !== pb) return pa - pb;
        return (Number(a.lane) || 0) - (Number(b.lane) || 0);
      });
    }
    return [...boats].sort((a, b) => (b.chainage_m || 0) - (a.chainage_m || 0));
  }

  function splitTimeForLane(race, lane) {
    const rows = race?.splits?.by_mark?.['2000'] || race?.splits?.by_mark?.[2000];
    if (!Array.isArray(rows)) return null;
    const hit = rows.find((r) => Number(r.lane) === Number(lane));
    return hit?.time || null;
  }

  /** Multi-line in-lane ticket below the boat dot. */
  function drawTicket(x, topY, lines, opts = {}) {
    const { lead = false, followed = false, maxW } = opts;
    const padX = 4;
    const padY = 5;
    const lineGap = 2;
    const fonts = [
      '700 12px Barlow Condensed, sans-serif',
      '600 9px Outfit, sans-serif',
      '700 11px Barlow Condensed, sans-serif',
      '600 10px Outfit, sans-serif',
    ];
    let maxTw = 0;
    for (let i = 0; i < lines.length; i++) {
      ctx.font = fonts[i] || fonts[fonts.length - 1];
      maxTw = Math.max(maxTw, ctx.measureText(lines[i]).width);
    }
    const bw = Math.min(maxW, Math.max(maxTw + padX * 2, 34));
    const lineH = [13, 11, 12, 12];
    const contentH = lineH.reduce((a, b) => a + b, 0) + lineGap * (lines.length - 1);
    const bh = contentH + padY * 2;
    const bx = x - bw / 2;
    const by = topY;

    roundRect(ctx, bx, by, bw, bh, 6);
    if (lead) {
      ctx.fillStyle = 'rgba(232,163,23,0.95)';
    } else if (followed) {
      ctx.fillStyle = 'rgba(8,70,78,0.94)';
    } else {
      ctx.fillStyle = 'rgba(8,49,59,0.9)';
    }
    ctx.fill();
    if (followed && !lead) {
      ctx.strokeStyle = 'rgba(127,212,192,0.85)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, bx, by, bw, bh, 6);
      ctx.stroke();
    }

    let ty = by + padY;
    const textColor = lead ? '#0c1c22' : '#f5faf8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) {
      ctx.font = fonts[i] || fonts[fonts.length - 1];
      ctx.fillStyle = textColor;
      let text = lines[i];
      while (ctx.measureText(text).width > bw - padX * 2 && text.length > 3) {
        text = `${text.slice(0, -2)}…`;
      }
      ctx.fillText(text, x, ty);
      ty += lineH[i] + lineGap;
    }
    ctx.textBaseline = 'alphabetic';
    return bh;
  }

  function paint(race) {
    const { w, h } = resize();
    ctx.clearRect(0, 0, w, h);

    const padX = 22;
    const padTop = 36;
    const padBot = 28;
    const courseW = w - padX * 2;
    const courseH = h - padTop - padBot;
    const finishY = padTop + END_POCKET;
    const startY = padTop + courseH - END_POCKET;
    const trackH = Math.max(40, startY - finishY);
    const laneW = courseW / LANE_COUNT;
    const logoSize = Math.min(LOGO_SIZE, Math.max(32, laneW - 2));
    const ticketMaxW = Math.max(32, laneW - 3);

    const water = ctx.createLinearGradient(0, padTop, 0, padTop + courseH);
    water.addColorStop(0, '#1a6b7c');
    water.addColorStop(1, '#0b3d4a');
    ctx.fillStyle = water;
    roundRect(ctx, padX - 8, padTop - 8, courseW + 16, courseH + 16, 16);
    ctx.fill();

    ctx.strokeStyle = 'rgba(245, 250, 248, 0.22)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= LANE_COUNT; i++) {
      const x = padX + (courseW * i) / LANE_COUNT;
      ctx.beginPath();
      ctx.moveTo(x, finishY);
      ctx.lineTo(x, startY);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(245, 250, 248, 0.55)';
    ctx.font = '600 10px Outfit, sans-serif';
    for (const mark of [0, 500, 1000, 1500, 2000]) {
      const y = startY - (mark / COURSE_M) * trackH;
      ctx.beginPath();
      ctx.strokeStyle = mark === 2000 ? 'rgba(232,163,23,0.55)' : 'rgba(245, 250, 248, 0.18)';
      ctx.lineWidth = mark === 2000 ? 2 : 1;
      ctx.moveTo(padX, y);
      ctx.lineTo(padX + courseW, y);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(245, 250, 248, 0.55)';
      ctx.fillText(mark === 0 ? 'Start' : mark === 2000 ? 'Finish' : `${mark}m`, 4, y + 3);
    }

    const boats = Array.isArray(race?.boats) ? race.boats : [];
    const ranked = rankedBoats(boats, race);
    const placeOf = new Map(ranked.map((b, i) => [Number(b.lane), i + 1]));
    const leaderCh = Number(race?.leader_chainage_m);
    const finished = String(race?.race_phase || '') === 'finished';
    const logoMinY = finished
      ? padTop + FINISH_BANNER_H + logoSize / 2 + 4
      : padTop + logoSize / 2 + 2;
    const courseBottom = padTop + courseH - 4;
    const ticketHApprox = 5 * 2 + 13 + 11 + 12 + 12 + 2 * 3;

    if (Number.isFinite(leaderCh) && !finished) {
      const y = startY - (Math.min(COURSE_M, leaderCh) / COURSE_M) * trackH;
      ctx.strokeStyle = '#e8a317';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(padX + courseW, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (finished) {
      const bx = padX - 4;
      const by = padTop - 2;
      roundRect(ctx, bx, by, courseW + 8, FINISH_BANNER_H, 8);
      ctx.fillStyle = 'rgba(232, 163, 23, 0.92)';
      ctx.fill();
      ctx.fillStyle = '#0c1c22';
      ctx.font = '700 12px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Unofficial results · CV tracking', bx + (courseW + 8) / 2, by + 18);
      ctx.textAlign = 'left';
    }

    for (const b of boats) {
      const lane = Number(b.lane);
      if (!Number.isFinite(lane) || lane < 1 || lane > LANE_COUNT) continue;
      const chain = Math.max(0, Math.min(COURSE_M, Number(b.chainage_m) || 0));
      const x = padX + ((lane - 0.5) / LANE_COUNT) * courseW;
      const y = startY - (chain / COURSE_M) * trackH;
      const place = placeOf.get(lane) || '—';
      const isLead = place === 1;
      const isFollowed = followedLane != null && lane === followedLane;
      const meta = laneMeta.get(String(lane)) || {};
      const label = meta.code || b.shortLabel || b.label || `L${lane}`;
      const img = logoImgs.get(String(lane));
      const dotR = isLead || isFollowed ? 8 : 6;

      // Logo centred in lane, sitting just above the crew dot
      let logoY = y - dotR - LOGO_GAP - logoSize / 2;
      logoY = Math.max(logoMinY, logoY);
      const drewLogo = drawLogo(img, x, logoY, logoSize);
      if (!drewLogo) {
        ctx.fillStyle = '#f5faf8';
        ctx.font = '700 11px Barlow Condensed, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(label).slice(0, 5), x, logoY + 4);
      }

      // Crew dot
      ctx.beginPath();
      ctx.fillStyle = isLead ? '#e8a317' : isFollowed ? '#7fd4c0' : 'rgba(245,250,248,0.95)';
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();
      if (isLead) {
        ctx.strokeStyle = 'rgba(232,163,23,0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      let gapLine = '—';
      if (finished) {
        gapLine = splitTimeForLane(race, lane) || '—';
      } else if (isLead) {
        gapLine = 'Lead';
      } else if (Number.isFinite(leaderCh)) {
        gapLine = `+${Math.max(0, Math.round(leaderCh - chain))}m`;
      }

      const lines = [ordinal(place), `Lane ${lane}`, String(label), gapLine];
      let ticketTop = y + dotR + TICKET_GAP;
      if (ticketTop + ticketHApprox > courseBottom) {
        ticketTop = courseBottom - ticketHApprox;
      }
      drawTicket(x, ticketTop, lines, {
        lead: isLead,
        followed: isFollowed,
        maxW: ticketMaxW,
      });
    }

    ctx.fillStyle = 'rgba(245,250,248,0.95)';
    ctx.font = '700 17px Barlow Condensed, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(race?.eventType || 'Live race', padX, 22);

    if (!finished) {
      ctx.font = '500 11px Outfit, sans-serif';
      ctx.fillStyle = 'rgba(245,250,248,0.65)';
      const phase = race?.race_phase || '';
      const toGo = Number.isFinite(leaderCh)
        ? `${Math.max(0, Math.round(COURSE_M - leaderCh))} m to go`
        : '';
      ctx.fillText(
        [phase, toGo, race?.sim ? 'GED sim' : ''].filter(Boolean).join(' · '),
        padX,
        h - 12,
      );
    }
  }

  return { paint, setFollowedLane, setLaneLabels, resize };
}

export async function fetchRaceSnapshot(apiBase = '', opts = {}) {
  const base = String(apiBase || '').replace(/\/$/, '');
  const mode = opts.mode === 'live' ? 'live' : 'sim';
  const streamId = String(opts.streamId || 'ged-sim').trim() || 'ged-sim';
  const res = await fetch(`${base}/api/race`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Race API ${res.status}`);
  const snap = await res.json();
  snap.feedMode = mode;
  snap.streamId = snap.streamId || streamId;
  if (mode === 'sim') {
    // Prefer GED sim positions when hub asks for simulation.
    try {
      const cvRes = await fetch(
        `${base}/api/cv-position?streamId=${encodeURIComponent(streamId)}&sim=1`,
        { cache: 'no-store' },
      );
      if (cvRes.ok) {
        const cv = await cvRes.json();
        snap.cv = cv;
      }
    } catch {
      /* race payload is enough for the course graphic */
    }
  } else {
    try {
      const cvRes = await fetch(
        `${base}/api/cv-position?streamId=${encodeURIComponent(streamId)}`,
        { cache: 'no-store' },
      );
      if (cvRes.ok) {
        const cv = await cvRes.json();
        snap.cv = cv;
        if (cv && !cv.sim && cv.stale === false) snap.liveCv = true;
      }
    } catch {
      /* ignore */
    }
  }
  return snap;
}

/** Build unofficial CV placings for the HTML panel under the tracker. */
export function unofficialPlacings(snap, laneMetaMap) {
  const boats = Array.isArray(snap?.boats) ? snap.boats : [];
  const rows2000 = snap?.splits?.by_mark?.['2000'] || snap?.splits?.by_mark?.[2000] || [];
  const timeByLane = new Map(rows2000.map((r) => [Number(r.lane), r.time]));
  const placeByLane = new Map(
    rows2000.map((r) => [Number(r.lane), Number(r.place ?? r.placing) || null]),
  );
  const ranked = [...boats].sort((a, b) => {
    const pa = placeByLane.get(Number(a.lane));
    const pb = placeByLane.get(Number(b.lane));
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    if (pa != null && pb == null) return -1;
    if (pa == null && pb != null) return 1;
    return (b.chainage_m || 0) - (a.chainage_m || 0);
  });
  return ranked.map((b, i) => {
    const meta = laneMetaMap?.get?.(String(b.lane)) || {};
    return {
      place: placeByLane.get(Number(b.lane)) || i + 1,
      lane: b.lane,
      code: meta.code || b.shortLabel || b.label || `L${b.lane}`,
      logoUrl: meta.logoUrl || null,
      time: timeByLane.get(Number(b.lane)) || null,
      chainage_m: b.chainage_m,
    };
  });
}
