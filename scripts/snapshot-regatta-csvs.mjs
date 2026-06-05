#!/usr/bin/env node
/**
 * Snapshot RowIT altitude CSVs into public/data/archives/{code}/.
 * Run daily via GitHub Actions or: node scripts/snapshot-regatta-csvs.mjs
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const ARCHIVES_DIR = path.join(PUBLIC, 'data', 'archives');
const MANIFEST_PATH = path.join(PUBLIC, 'data', 'regatta-archives.json');
const CONFIG_PATH = path.join(__dirname, 'regatta-archive-codes.json');

const ROWIT_BASES = [
  'https://l.rowit.nz/altitude',
  'https://rowit.nz/altitude',
];
const CSV_FILES = ['events', 'daysheet', 'results', 'competitors'];

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function isCsvLike(text) {
  const t = String(text || '').trim();
  return t.length > 20 && t.includes(',') && !/nothing published/i.test(t);
}

async function fetchCsvFromRowit(code, fileId) {
  let lastErr = null;
  for (const base of ROWIT_BASES) {
    const url = `${base}/${code}/${fileId}.csv`;
    try {
      const res = await fetch(url, {
        headers: { Accept: 'text/csv,text/plain,*/*' },
        signal: AbortSignal.timeout(25000),
      });
      const text = await res.text();
      if (res.ok && isCsvLike(text)) {
        return { text, url, bytes: Buffer.byteLength(text, 'utf8') };
      }
      lastErr = new Error(`HTTP ${res.status} or empty CSV from ${url}`);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr || new Error(`No CSV for ${code}/${fileId}`);
}

function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const only = process.argv.includes('--all')
    ? raw.regattas
    : raw.regattas.filter((r) => r.snapshot !== false);
  const codes = process.argv
    .find((a) => a.startsWith('--codes='))
    ?.slice('--codes='.length)
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (codes?.length) {
    return raw.regattas.filter((r) => codes.includes(r.code));
  }
  return only;
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { updated: null, regattas: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return { updated: null, regattas: {} };
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

async function snapshotRegatta(entry, date, manifest) {
  const code = entry.code;
  const regDir = path.join(ARCHIVES_DIR, code);
  const latestDir = path.join(regDir, 'latest');
  const dailyDir = path.join(regDir, 'daily', date);
  const result = {
    code,
    name: entry.name || code,
    date,
    files: {},
    errors: {},
  };

  if (!manifest.regattas[code]) {
    manifest.regattas[code] = { name: entry.name || code, daily: [], latest: {}, files: {} };
  }
  const reg = manifest.regattas[code];

  for (const fileId of CSV_FILES) {
    try {
      const { text, url, bytes } = await fetchCsvFromRowit(code, fileId);
      const hash = sha256(text);
      const relLatest = `data/archives/${code}/latest/${fileId}.csv`;
      const relDaily = `data/archives/${code}/daily/${date}/${fileId}.csv`;

      writeText(path.join(PUBLIC, relLatest), text);
      writeText(path.join(PUBLIC, relDaily), text);

      const prev = reg.files?.[fileId];
      const changed = !prev || prev.sha256 !== hash;

      reg.latest[fileId] = relLatest;
      reg.files = reg.files || {};
      reg.files[fileId] = {
        sha256: hash,
        bytes,
        sourceUrl: url,
        archivedAt: new Date().toISOString(),
        changed,
      };
      result.files[fileId] = { bytes, changed, sourceUrl: url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors[fileId] = msg;
      if (reg.latest?.[fileId]) {
        result.files[fileId] = { kept: reg.latest[fileId], error: msg };
      }
    }
  }

  if (!reg.daily.includes(date)) {
    reg.daily.push(date);
    reg.daily.sort();
  }

  return result;
}

async function main() {
  const date = todayUtc();
  const regattas = loadConfig();
  const manifest = loadManifest();

  console.log(`Snapshot ${regattas.length} regatta(s) for ${date}…`);

  const summary = [];
  for (const entry of regattas) {
    process.stdout.write(`  ${entry.code}… `);
    const row = await snapshotRegatta(entry, date, manifest);
    const ok = Object.keys(row.files).filter((k) => !row.files[k].error && !row.files[k].kept).length;
    const err = Object.keys(row.errors).length;
    console.log(`${ok} saved, ${err} skipped/failed`);
    summary.push(row);
  }

  manifest.updated = new Date().toISOString();
  manifest.snapshotDate = date;
  manifest.configSource = 'scripts/regatta-archive-codes.json';
  writeJson(MANIFEST_PATH, manifest);

  const publicConfig = path.join(PUBLIC, 'data', 'regatta-archive-codes.json');
  fs.copyFileSync(CONFIG_PATH, publicConfig);

  const reportPath = path.join(ARCHIVES_DIR, `_snapshot-${date}.json`);
  writeJson(reportPath, { date, summary });

  console.log(`Manifest: ${path.relative(ROOT, MANIFEST_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
