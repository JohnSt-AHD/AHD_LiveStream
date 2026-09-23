# Regatta NZ (MVP)

Spectator web app for NZ Masters 2026 sample data + GED CV/drone sim.

## Run

```bash
node server.js
```

Open [http://localhost:3000/regatta-nz/](http://localhost:3000/regatta-nz/).

## Features

- **Home** — races in start blocks (next 10 min), live on course, just finished (RowIT result within last 10 min). Tap to expand draw or results; club/school logos when available.
- **Schedule** — full day list with Day 1 / Day 2 switcher.
- **Follow / My day / Live** — as before (sim track via `/api/race`).

Use the **Demo clock** chips to scrub the sample daysheet when you are outside race-day hours.

## Hub configuration

Operators configure this app from the AHD hub **Setup** view → **Regatta NZ · Spectator app**:

- Regatta code (shared with RowIT CSV setup via `altitudeHdRegattaCode_v1`)
- Livestream URL / label for the Live tab
- Simulation vs live feed mode
- Health checks for `/api/race`, `/api/cv-position`, `/api/drone-telemetry`, and RowIT CSVs

Settings are stored in `localStorage` key `altitudeHdRegattaNz_v1` (same browser origin). Open with `?regatta=CODE` to override the code for a session.

## Android APK

Sideload install: [install-native.html](./install-native.html) · Capacitor shell in `apps/regatta-nz-native/` (loads this production URL).
