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
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Vercel handler adapter ─────────────────────────────────────────
// Vercel handlers expect (req, res) with req.query already parsed and
// res.status().json()/send()/end() — Express provides all of this natively.
function wrapHandler(handlerModule) {
  return async (req, res) => {
    try {
      const mod = await handlerModule();
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

// ── API routes ──────────────────────────────────────────────────────
app.all('/api/traccar',        wrapHandler(() => import('./api/traccar.js')));
app.all('/api/cv-position',    wrapHandler(() => import('./api/cv-position.js')));
app.all('/api/warning-alerts', wrapHandler(() => import('./api/warning-alerts.js')));
app.all('/api/trial-results',  wrapHandler(() => import('./api/trial-results.js')));
app.all('/api/fetch-csv',      wrapHandler(() => import('./api/fetch-csv.js')));
app.all('/api/check-csv',      wrapHandler(() => import('./api/check-csv.js')));

// ── Static files from public/ ───────────────────────────────────────
app.use(express.static(join(__dirname, 'public')));

// SPA fallback — serve index.html for unmatched routes
app.get('/{*splat}', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  traccar-overlay running locally`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  API endpoints:`);
  console.log(`    /api/traccar`);
  console.log(`    /api/cv-position`);
  console.log(`    /api/warning-alerts`);
  console.log(`    /api/trial-results`);
  console.log(`    /api/fetch-csv`);
  console.log(`    /api/check-csv`);
  console.log();
});
