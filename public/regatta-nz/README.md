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
- **Follow** — club/school (all crews), athlete, multi-select **age groups** (U15–U18, Masters, Open, etc.) and optional **gender** filter. Persisted in `localStorage` (`regattaNzFollows_v1`).
- **My day** — live countdown to the next followed race, plus matching heats.
- **Live** — sim track via `/api/race`.
- **Notifications** — toggle on Follow / My day (`regattaNzNotify_v1`). When on, the app schedules **local** alerts ~10 minutes before followed races from the daysheet (Capacitor Local Notifications on APK; optional Web Notification mirror in browser). No FCM server for v1. Turning off cancels pending schedules.

Home race buckets use the phone’s real time of day against the daysheet.

### Follow schema (`regattaNzFollows_v1`)

```json
{
  "clubs": ["welc"],
  "athletes": ["Jane Doe"],
  "ageGroups": ["U17", "Masters"],
  "genders": ["female"]
}
```

Matching is OR across clubs, athletes, and age/gender. Age groups alone match any gender; if genders are also set, both must match. Gender alone matches all races of that gender.

Event tags are parsed from RowIT `Event Type` strings (e.g. `B U17 1X`, `W Mst C 2X`, `Mx G-M 2X`, `M Clb 2X`).

## Hub configuration

Operators configure this app from the AHD hub **Setup** view → **Regatta NZ · Spectator app**:

- Regatta code (shared with RowIT CSV setup via `altitudeHdRegattaCode_v1`)
- Livestream URL / label for the Live tab
- Simulation vs live feed mode
- Health checks for `/api/race`, `/api/cv-position`, `/api/drone-telemetry`, and RowIT CSVs

Settings are stored in `localStorage` on the hub browser **and** posted to
`/api/regatta-nz-config` so the phone APK (production URL) can read the same
regatta code / livestream / mode. Open with `?regatta=CODE` to override for a
session.

## Android APK

Sideload install: [install-native.html](./install-native.html) · Capacitor shell in `apps/regatta-nz-native/` (loads this production URL).

After pulling changes that add `@capacitor/local-notifications`:

```bash
cd apps/regatta-nz-native
npm install
npx cap sync android
npm run apk
```

### How to test

**Web:** open `/regatta-nz/`, Follow → pick Masters + Female (or a club), open My day — countdown updates every second. Enable Notifications — browser may prompt; foreground nudges fire when a match enters start blocks / live. Scheduled OS alerts need the APK.

**APK:** install build, enable Notifications (Android 13+ permission prompt), follow a crew with an upcoming start, background the app — expect a local alert ~10 min before start.