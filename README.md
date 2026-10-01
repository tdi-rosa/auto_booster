# WikiMaster Auto Opener

Tiny Android proof-of-concept for automatically checking WikiMasters booster stock.

## Current behavior

- ON/OFF switch in the app.
- Android WorkManager check roughly every 95 minutes.
- If the WikiMasters API reports 10 boosters, the worker is designed to open them.
- Local Android notification for pulls at `SUPER_RARE` or above.
- GitHub Actions builds a debug APK on every push to `main`.

## Important: one missing integration

The Android app, scheduler and notifications are implemented, but `WikiMastersClient.kt` intentionally contains placeholders because the actual WikiMasters API endpoints, authentication/session format and rarity payload still need to be observed from a real logged-in session.

Once those requests are known, only `WikiMastersClient.kt` should need major changes.

## How to inspect WikiMasters

On desktop Chrome/Chromium:

1. Log in to WikiMasters.
2. Open DevTools (`F12`).
3. Open **Network** and filter to **Fetch/XHR**.
4. Note the request that fetches your booster count.
5. Open one booster manually.
6. Note the request URL, HTTP method, request body, relevant headers/cookies and JSON response.
7. Do **not** publish session cookies/tokens in this repository.

## Build locally

You need Android SDK + JDK 17 + Gradle 8.9.

```bash
gradle assembleDebug
```

APK output:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## GitHub / Obtainium

Push this project to GitHub. The workflow uploads the APK as a GitHub Actions artifact. For a smooth Obtainium flow, the next step is adding a signed release workflow that attaches a release APK whenever a version tag is pushed.

## Disclaimer

This project automates interaction with a third-party game. Automation may violate that service's rules and may result in account restrictions or bans.
