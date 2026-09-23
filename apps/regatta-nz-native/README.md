# Regatta NZ — Android (Capacitor)

Thin Capacitor shell that opens the production spectator app:

**https://ahd-livestream.vercel.app/regatta-nz/**

Same release pattern as CrewSight in Rowing_App: debug APK → GitHub release asset → hub Apps card.

## Build APK (local)

Requires JDK 17+ and Android SDK (Android Studio once is enough).

```powershell
cd apps/regatta-nz-native
npm install
npx cap add android   # first time only
npm run apk
```

Output: `apps/regatta-nz-native/install/Regatta-NZ.apk`

## CI

Workflow `.github/workflows/regatta-nz-apk.yml` builds on push to paths under this app and publishes:

`https://github.com/JohnSt-AHD/AHD_LiveStream/releases/download/android-apk-regatta-nz-latest/Regatta-NZ.apk`

Install page: `/regatta-nz/install-native.html`

## Play Store

Sideload builds are **debug-signed**. For Play Store you need a release keystore + `assembleRelease` (do not commit the keystore).
