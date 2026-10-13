# PlugOrbit integration notes (October 2026)

## Android Maps
1. Rotate the Google API key previously posted in chat. Never commit an unrestricted key.
2. In `LoginApp/.env`, replace `REPLACE_WITH_RESTRICTED_ANDROID_MAPS_KEY` with a newly generated key restricted to `com.loginapp` and the actual signing SHA-1; enable Maps SDK for Android and billing.
3. Verify SHA-1 with `keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android`.
4. Run `npm install`, then `npm start -- --reset-cache`, and in another terminal `npm run android`. Rebuilding is required for native manifest key changes.
5. If tiles do not load check Google Cloud quota/restrictions and `adb logcat -d -s "Google Maps" AndroidRuntime`.

## Features in this bundle
- Fluent-inspired translucent panels on login and common in-app cards/surfaces. This uses semi-transparent backgrounds (not real-time backdrop blur).
- `Profile → Orbit help guide`: usable offline guided FAQ plus a shortcut to the trip planner and to Orbit Assist. With `GEMINI_API_KEY` set on the Backend it can also answer online (`/assistant/guide/*`); otherwise it says it is offline. Provider secrets stay on the Backend, never in the mobile `.env`. The conversational co-driver is `Profile → Orbit Assist`.
- `Profile → Refer a friend`: native share sheet with invitation. App store URL and referral reward backend are not configured, and no rewards are claimed.
- Maps key placeholder is set in `.env`. A working map depends on external Cloud SDK/billing/key restriction setup.

## Checks
Run `npx tsc --noEmit` and `npm test -- --runInBand` in LoginApp after dependency install. Android emulator build requires Android SDK/Java on the development machine.
