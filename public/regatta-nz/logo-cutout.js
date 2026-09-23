/**
 * Club/school logo cutouts — same pipeline as Ged / Karāpiro vMix graphics
 * (crop singlet, punch white paper, trim alpha).
 */

const cache = new Map();
const inflight = new Map();

function isPaper(r, g, b, a) {
  if (a < 40) return true;
  return r > 250 && g > 250 && b > 250;
}

function sourceSize(src) {
  return {
    width: src.naturalWidth || src.width,
    height: src.naturalHeight || src.height,
  };
}

function dilateMask(src, w, h, r) {
  const out = new Uint8Array(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}

function erodeMask(src, w, h, r) {
  const out = new Uint8Array(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      let keep = 1;
      for (let dy = -r; dy <= r && keep; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !src[ny * w + nx]) {
            keep = 0;
            break;
          }
        }
      }
      if (!keep) out[y * w + x] = 0;
    }
  }
  return out;
}

function punchPaper(src) {
  const w = src.width;
  const h = src.height;
  const n = w * h;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const wall = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (!isPaper(data[p], data[p + 1], data[p + 2], data[p + 3])) wall[i] = 1;
  }
  const sealed = erodeMask(dilateMask(wall, w, h, 1), w, h, 1);
  const outside = new Uint8Array(n);
  const stack = [];
  const tryPush = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (outside[i] || sealed[i]) return;
    const p = i * 4;
    if (!isPaper(data[p], data[p + 1], data[p + 2], data[p + 3])) return;
    outside[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    tryPush(x, 0);
    tryPush(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tryPush(0, y);
    tryPush(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const yy = (i / w) | 0;
    tryPush(x - 1, yy);
    tryPush(x + 1, yy);
    tryPush(x, yy - 1);
    tryPush(x, yy + 1);
  }
  for (let i = 0; i < n; i++) {
    if (outside[i]) data[i * 4 + 3] = 0;
  }
  const neighbor = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return true;
    return data[(y * w + x) * 4 + 3] < 16;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (data[p + 3] < 16) continue;
      if (!isPaper(data[p], data[p + 1], data[p + 2], data[p + 3])) continue;
      if (neighbor(x - 1, y) || neighbor(x + 1, y) || neighbor(x, y - 1) || neighbor(x, y + 1)) {
        data[p + 3] = 0;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return src;
}

function trimAlpha(src) {
  const w = src.width;
  const h = src.height;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 16) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) return src;
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function cropSinglet(src) {
  const { width, height } = sourceSize(src);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  const occ = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!isPaper(data[i], data[i + 1], data[i + 2], data[i + 3])) occ[y]++;
    }
  }
  const minRow = Math.max(1, Math.round(width * 0.002));
  const runs = [];
  let y = 0;
  while (y < height) {
    while (y < height && occ[y] < minRow) y++;
    const start = y;
    while (y < height && occ[y] >= minRow) y++;
    if (y > start) runs.push({ start, end: y });
  }
  let yLimit = height;
  const last = runs[runs.length - 1];
  if (runs.length >= 2 && last.start > height * 0.5) yLimit = last.start;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let row = 0; row < yLimit; row++) {
    for (let x = 0; x < width; x++) {
      const i = (row * width + x) * 4;
      if (isPaper(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (row < minY) minY = row;
      if (row > maxY) maxY = row;
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('No garment');
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

function cutOriginal(src) {
  const copy = document.createElement('canvas');
  copy.width = src.width;
  copy.height = src.height;
  copy.getContext('2d').drawImage(src, 0, 0);
  return trimAlpha(punchPaper(copy));
}

function loadLogoImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('missing'));
    img.src = url;
  });
}

/** @returns {Promise<string>} data URL of cutout, or original url on failure */
export function prepareLogoCutout(url) {
  if (!url) return Promise.resolve('');
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (inflight.has(url)) return inflight.get(url);
  const job = loadLogoImage(url)
    .then((img) => cutOriginal(cropSinglet(img)).toDataURL('image/png'))
    .then((dataUrl) => {
      cache.set(url, dataUrl);
      return dataUrl;
    })
    .catch(() => {
      cache.set(url, url);
      return url;
    })
    .finally(() => {
      inflight.delete(url);
    });
  inflight.set(url, job);
  return job;
}

/** Apply cutouts to <img data-logo-src="…"> in a root element. */
export function enhanceLogoImages(root) {
  if (!root) return;
  for (const img of root.querySelectorAll('img[data-logo-src]')) {
    const src = img.dataset.logoSrc;
    if (!src || img.dataset.cutout === '1') continue;
    img.dataset.cutout = '1';
    prepareLogoCutout(src).then((dataUrl) => {
      if (dataUrl) img.src = dataUrl;
    });
  }
}
