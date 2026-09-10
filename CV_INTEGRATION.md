# CV leader line → overlay API

Link the laptop computer-vision system (`cv-improvements`) to the transparent vMix browser overlay in this repo.

## Race day (local)

On the broadcast PC:

1. Double-click `start-race-day.bat` (or `setup-local.bat` the first time).
2. Open **http://localhost:3000** if the browser does not appear.
3. Point vMix Web Browser inputs at the overlay cards on that hub.

```
NDI / webcam → Python (YOLO) ──POST──► http://127.0.0.1:3000/api/cv-position
                                              │
vMix Browser ◄── poll GET ────────────────────┘
  http://localhost:3000/vmix-cv-leader.html?streamId=kri-live
```

In-memory store is used when Vercel KV env vars are unset. Positions go `stale` after 2.5s, so Python must POST continuously.

Laptop config (`cv_config.json` → `cloud.api_url`) defaults to that local API. Copy-overlay buttons on the CV hub use `http://127.0.0.1:3000`.

TouchDesigner still receives OSC on port `10022` as before.

Daysheet, weather, and Traccar still need internet. Overlays and CV position do not.

## Cloud fallback (Vercel)

If the local Node process is down, vMix can load `https://ahd-livestream.vercel.app/…` instead. Python then needs:

```powershell
$env:CV_API_URL = "https://ahd-livestream.vercel.app/api/cv-position"
```

1. Project: **AHD - LiveStream**, `ahd-livestream.vercel.app`.
2. Optional **Vercel KV** for multi-instance persistence.
3. Optional `CV_INGEST_TOKEN` — Python sends `Authorization: Bearer …` on POST.

## Pages

### vMix overlay (transparent leader line)

```
http://localhost:3000/vmix-cv-leader.html?streamId=kri-live
```

Layer as a transparent browser input over the drone feed (1920×1080).

### Position monitor (debug / ops)

```
http://localhost:3000/cv-position-monitor.html?streamId=kri-live
```

Shows live x/y, overlay mapping, age, and stale status.

Use the same `streamId` as TouchDesigner **GPS ID** / livestream ID (`kri-live` by default).

Query params:

| Param | Purpose |
|-------|---------|
| `streamId` | Required — ties POST and GET together |
| `poll` | Poll interval ms (default `200` on overlay, `500` on monitor) |
| `api` | Override CV position API base (default same origin) |
| `cvLaptop` | CV setup server (default `http://127.0.0.1:8790`) |

Close the monitor tab when not debugging.

## Laptop Python setup

`launch_cv.ps1` / Analysis preview posts using `cv_config.json`. To override:

```powershell
$env:CV_STREAM_ID = "kri-live"
$env:CV_API_URL = "http://127.0.0.1:3000/api/cv-position"
$env:CV_CLOUD_ENABLED = "1"
$env:CV_POST_HZ = "5"
```

### Disable overlay POST

```powershell
$env:CV_CLOUD_ENABLED = "0"
```

## API

### POST `/api/cv-position`

```json
{
  "streamId": "kri-live",
  "x": 824,
  "y": 356,
  "frame": 42,
  "auto": 1,
  "venue": "karapiro",
  "refW": 1280,
  "refH": 720
}
```

### GET `/api/cv-position?streamId=…`

Returns latest position plus `stale: true` if older than 2.5s.

Venue offsets (match TouchDesigner):

- **karapiro** — x +140, y −50
- **twizel** — x −140, y −50

## Files

| File | Role |
|------|------|
| `start-race-day.bat` | Local graphics + optional CV/DJI launch |
| `api/cv-position.js` | POST/GET handler |
| `public/vmix-cv-leader.html` | vMix transparent overlay |
| `public/cv-position-monitor.html` | Live position monitor page |
| `public/cv-position-client.js` | Poll + position line |

Laptop side: `cv_cloud.py` in `cv-improvements`.
