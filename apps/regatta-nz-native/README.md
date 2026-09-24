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

## Play Store (release AAB)

Requires a local upload keystore under `keystore/` (gitignored — never commit `.jks`, passwords, or `keystore.properties`).

```powershell
cd apps/regatta-nz-native
npm run aab
```

Output: `apps/regatta-nz-native/install/Regatta-NZ-release.aab`

Back up `keystore/README-BACKUP.txt` + `regatta-nz-upload.jks` in a password manager / offline vault. Losing them means you cannot update the Play listing with the same upload key.

Upload the `.aab` in [Play Console](https://play.google.com/console) → your app → **Production** (or testing track) → **Create new release** → upload the AAB.
