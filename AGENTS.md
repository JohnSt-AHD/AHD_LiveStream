# AGENTS.md

## Cursor Cloud specific instructions

AHD LiveStream is a **Vercel static site + serverless API**, not a long-running server. `public/` holds the static broadcast/overlay pages (hub, fleet maps, RowSafe, vMix overlays, CV monitor); `api/*.js` are Vercel **ESM handlers** (`export default async function handler(req, res)`). `npm run build` is a no-op (`exit 0`) and `npm test` fails by design (no test suite, no linter).

Dependencies are installed by the startup update script (`npm install`).

### Running locally (headless VM)
- `npx vercel dev` requires Vercel credentials (not available in the cloud VM), so it cannot serve here.
- For static-only pages: `npx --yes serve public -l 3000` (or `python3 -m http.server -d public 3000`). Pages that call `/api/*` will 404 without the API.
- To run `public/` + `api/` together without Vercel, run a small Node **ESM** harness that serves `public/` statically and routes `/api/<name>` to `import('api/<name>.js')`, providing `res.status/json` + `req.query/body` helpers.
- Self-contained demo with no secrets/internet: the **CV overlay pipeline**. `POST /api/cv-position` then `GET /api/cv-position?streamId=...` — `api/cv-position.js` uses an in-memory `Map` fallback when `KV_REST_API_URL`/`KV_REST_API_TOKEN` are unset. Visualize it at `/cv-position-monitor.html?streamId=<id>` (positions go `stale` after 2.5s, so post continuously to see live data). See `CV_INTEGRATION.md`.

### External dependencies (need secrets or internet)
- Traccar fleet maps, warning-alert email (Resend), and KV-backed state need env vars (`TRACCAR_*`, `RESEND_API_KEY`, `KV_REST_API_*`, etc. — see the `api/` and `api/lib/` sources). `api/fetch-csv.js`/`check-csv.js` proxy allowlisted RowIT hosts and need outbound internet.

### Optional tooling
- PDF proposal/report scripts use Playwright: `npx playwright install chromium`, then run e.g. `SKIP_DRIVE_UPLOAD=1 npm run proposals:crewsight` (set `SKIP_DRIVE_UPLOAD=1` to skip the Google Drive upload).
- Python scripts: `scripts/export-ahd-lookup.py` needs `openpyxl`; `scripts/convert-milford-videos.py` needs `ffmpeg`.
