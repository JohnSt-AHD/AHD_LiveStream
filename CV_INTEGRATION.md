# CV leader line → Vercel overlay

Link the laptop computer-vision system (`CV Improvements DEV`) to the transparent vMix browser overlay in this repo.

## Architecture

```
NDI / webcam → Python (YOLO) ──POST──► /api/cv-position (Vercel KV)
                                              │
vMix Browser ◄── poll GET ────────────────────┘
  vmix-cv-leader.html?streamId=...
```

Local TouchDesigner still receives OSC on port `10022` as before. Cloud POST is additive.

## Vercel setup

1. Deploy this repo to Vercel (project: **AHD - LiveStream**, `ahd-livestream.vercel.app`).
2. Add **Vercel KV** to the project (Storage → KV) if not already linked.
3. Optional env vars:
   - `CV_INGEST_TOKEN` — shared secret; Python sends `Authorization: Bearer …` on POST.

Redeploy after adding env vars.

## Pages

### vMix overlay (transparent leader line)

```
https://ahd-livestream.vercel.app/vmix-cv-leader.html?streamId=f83ef29e-ae42-4c16-a4b3-dcf23a998936
```

Layer as a transparent browser input over the drone feed (1920×1080).

### Position monitor (debug / ops)

```
https://ahd-livestream.vercel.app/cv-position-monitor.html?streamId=f83ef29e-ae42-4c16-a4b3-dcf23a998936
```

Shows live x/y, overlay mapping, age, and stale status. Useful for checking the laptop → API link without vMix.

Use the same `streamId` as TouchDesigner **GPS ID** / livestream ID.

Query params:

| Param | Purpose |
|-------|---------|
| `streamId` | Required — ties POST and GET together |
| `poll` | Poll interval ms (default `200` on overlay, `500` on monitor) |
| `api` | Override API origin for testing |

### Vercel usage (defaults tuned for Hobby limits)

| Source | Default rate | ~6 h race day |
|--------|----------------|---------------|
| Python POST (`CV_POST_HZ`) | 5/sec | ~108k |
| vMix overlay poll | 5/sec (200 ms) | ~108k |
| Monitor poll | 2/sec (500 ms) | ~43k |

Close the monitor tab when not debugging. For smoother overlay motion at a regatta, raise rates temporarily:

```powershell
$env:CV_POST_HZ = "10"
```

```
.../vmix-cv-leader.html?streamId=...&poll=100
```

Layer as a transparent browser input over the drone feed (1920×1080).

## Laptop Python setup

In `CV Improvements DEV`:

```powershell
$env:CV_STREAM_ID = "f83ef29e-ae42-4c16-a4b3-dcf23a998936"
$env:CV_API_URL = "https://ahd-livestream.vercel.app/api/cv-position"
# optional:
$env:CV_INGEST_TOKEN = "your-secret"
$env:CV_CLOUD_ENABLED = "1"
$env:CV_POST_HZ = "5"   # optional; 5 is the default

python karapiro.py   # or twizel.py
```

Or launch via TouchDesigner **Open PYTHON** from `LIVE_2.0_DEV.toe` (set env vars in the PowerShell profile or a wrapper script).

### Disable cloud POST

```powershell
$env:CV_CLOUD_ENABLED = "0"
```

## API

### POST `/api/cv-position`

```json
{
  "streamId": "f83ef29e-ae42-4c16-a4b3-dcf23a998936",
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

## Files added

| File | Role |
|------|------|
| `api/cv-position.js` | POST/GET handler |
| `api/lib/cv-position.mjs` | KV storage + validation |
| `public/vmix-cv-leader.html` | vMix transparent overlay |
| `public/cv-position-monitor.html` | Live position monitor page |
| `public/cv-position-client.js` | Poll + position line |
| `public/vmix-cv-leader.css` | Overlay styles |
| `public/cv-position-monitor.css` | Monitor page styles |

Laptop side: `cv_cloud.py` + changes to `karapiro.py` / `twizel.py` in `CV Improvements DEV`.
