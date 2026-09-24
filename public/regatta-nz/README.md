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
- **Results** — event dropdown (all or followed), round chips (Heats → … → **Finals** as one chip with A/B/C listed), expandable heat results + progression.
- **Follow** — **Athlete** or **Club** mode. Club: pick a school/club (crew count only), then follow all or narrow Gender → Age/level → Class from the daysheet; live “Crews you’ll follow” preview. Athlete: search → confirm crew(s). Removable chips for whole clubs, scoped club follows, and crews. Persisted in `localStorage` (`regattaNzFollows_v1`).
- **My day** — live countdown to the next followed race, plus matching heats.
- **Live** — sim track via `/api/race`.
- **Notifications** — toggle on My day only (`regattaNzNotify_v1`). When on, the app schedules **local** alerts ~10 minutes before followed races from the daysheet (Capacitor Local Notifications on APK; optional Web Notification mirror in browser). No FCM server for v1. Turning off cancels pending schedules. Scheduling still refreshes when follows change.

Home race buckets use the phone’s real time of day against the daysheet.

### Follow schema (`regattaNzFollows_v1`)

```json
{
  "clubs": ["welc"],
  "clubScopes": [
    {
      "id": "waka|female|U15|2X",
      "clubId": "waka",
      "genders": ["female"],
      "ageGroups": ["U15"],
      "classes": ["2X"],
      "label": "Waka · Female · U15 · 2X",
      "crewCount": 2
    }
  ],
  "athletes": [],
  "ageGroups": [],
  "genders": [],
  "crews": [
    {
      "id": "81 (E)#31|3",
      "label": "WAKA GU15 2X",
      "raceId": "81 (E)#31",
      "raceKey": "81 (E)",
      "lane": 3,
      "clubId": "waka",
      "athleteName": "Jane Doe"
    }
  ]
}
```

Matching is OR across whole clubs, `clubScopes` (club + optional gender/age/class), confirmed crews, legacy athletes, and any leftover global age/gender. Whole-club follow uses `clubs: [id]`; filtered follows use `clubScopes`. Athlete search ticks boat labels then confirms (crew allocation may change if entries change).

Event tags (age, gender, boat class) are parsed from RowIT `Event Type` strings (e.g. `B U17 1X`, `W Mst C 2X`, `Mx G-M 2X`, `M Clb 2X`).

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

**Web:** open `/regatta-nz/`, Follow → **Club** → pick a club → follow all or narrow Gender / Age / Class → confirm; or **Athlete** → confirm crews. Open My day — countdown updates every second. Enable Notifications — browser may prompt; foreground nudges fire when a match enters start blocks / live. Scheduled OS alerts need the APK.

**APK:** install build, enable Notifications (Android 13+ permission prompt), follow a crew with an upcoming start, background the app — expect a local alert ~10 min before start.