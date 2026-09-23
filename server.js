/**
 * Local Express server that replicates the Vercel deployment:
 *  - Serves public/ as static files
 *  - Routes /api/* to the serverless handler modules
 *
 * Usage:  node server.js            (default port 3000)
 *         PORT=8080 node server.js  (custom port)
 */
import 'dotenv/config';
import express from 'express';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Vercel handler adapter ─────────────────────────────────────────
// Vercel handlers expect (req, res) with req.query already parsed and
// res.status().json()/send()/end() — Express provides all of this natively.
function wrapHandler(relPath) {
  return async (req, res) => {
    try {
      const file = join(__dirname, relPath);
      const mtime = statSync(file).mtimeMs;
      const mod = await import(`${pathToFileURL(file).href}?t=${mtime}`);
      const fn = mod.default || mod;
      await fn(req, res);
    } catch (err) {
      console.error(`[api error] ${req.path}:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  };
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'ahd-livestream',
    hub: `http://localhost:${PORT}`,
  });
});

// ── API routes ──────────────────────────────────────────────────────
app.all('/api/traccar',        wrapHandler('./api/traccar.js'));
app.all('/api/cv-position',    wrapHandler('./api/cv-position.js'));
app.all('/api/warning-alerts', wrapHandler('./api/warning-alerts.js'));
app.all('/api/trial-results',  wrapHandler('./api/trial-results.js'));
app.all('/api/fetch-csv',      wrapHandler('./api/fetch-csv.js'));
app.all('/api/check-csv',      wrapHandler('./api/check-csv.js'));
app.all('/api/drive-archive',  wrapHandler('./api/drive-archive.js'));
app.all('/api/race-cues',      wrapHandler('./api/race-cues.js'));
app.all('/api/race',           wrapHandler('./api/race.js'));
app.all('/api/drone-telemetry/all', wrapHandler('./api/drone-telemetry.js'));
app.all('/api/drone-telemetry', wrapHandler('./api/drone-telemetry.js'));
app.all('/api/config',         wrapHandler('./api/config.js'));

// ── Static files from public/ ───────────────────────────────────────
app.use(express.static(join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (/index\.html$|hub-drive-archive\.js$|hub-archive-sheet-search\.js$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

// SPA fallback — serve index.html for unmatched routes
app.get('/{*splat}', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  AHD LiveStream running locally`);
  console.log(`  Hub:      http://localhost:${PORT}`);
  console.log(`  Overlays: http://localhost:${PORT}/vmix-kri.html`);
  console.log(`  CV API:   http://localhost:${PORT}/api/cv-position\n`);
  console.log(`  API endpoints:`);
  console.log(`    /health`);
  console.log(`    /api/traccar`);
  console.log(`    /api/cv-position`);
  console.log(`    /api/warning-alerts`);
  console.log(`    /api/trial-results`);
  console.log(`    /api/fetch-csv`);
  console.log(`    /api/check-csv`);
  console.log(`    /api/drive-archive`);
  console.log(`    /api/race-cues`);
  console.log(`    /api/race          (Ged World Rowing sim loop)`);
  console.log(`    /api/drone-telemetry`);
  console.log(`    /api/config`);
  console.log();
});
