# PlugOrbit mobile (showcase prototype)

React Native + TypeScript app: find a compatible EV charger, plan a route with a
backup stop, start and pay for a charge, and recover cleanly if the app is
interrupted. 48 routes, all navigable, on a typed mock service layer. **Smart Drive**
is the charging co-pilot on top: it picks the stop and a backup, watches the trip
and speaks only when something changes what you should do.

- Demo script: [`docs/DEMO_WALKTHROUGH.md`](docs/DEMO_WALKTHROUGH.md)
- What is real vs mocked, and open decisions: [`docs/HANDOFF.md`](docs/HANDOFF.md)
- How the code is organised: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Smart Drive (the automated charging co-pilot): [`docs/SMART_DRIVE.md`](docs/SMART_DRIVE.md)
- Product spec: [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)

# Google Maps, location & nearby chargers

The **Find a Charger** screen uses:

| What | How |
|---|---|
| Current location | `@react-native-community/geolocation` (Android: Google's Fused Location Provider via Play Services; iOS: Core Location) |
| Map | `react-native-maps` with the Google Maps SDK (Android + iOS) |
| Nearby charging stations | [Places API (New) – Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search), type `electric_vehicle_charging_station`, with connector types, power and availability counts from `evChargeOptions` (labelled Estimated, never LIVE, and with Google's own update time when it provides one) |
| Directions | Opens the Google Maps app/site via the [Maps URLs API](https://developers.google.com/maps/documentation/urls/get-started#directions-action) (no key needed) |

## 1. Create the API keys

In [Google Cloud Console](https://console.cloud.google.com/google/maps-apis) (billing must be enabled), enable **Maps SDK for Android**, **Maps SDK for iOS** and **Places API (New)**, then create **separate keys**. A Google API key can carry only one kind of application restriction, and REST calls (Places) cannot carry an app identity, so one key cannot be locked down for all three uses:

| Key | Used by | Restrict to |
|---|---|---|
| `GOOGLE_MAPS_ANDROID_KEY` | Maps SDK on Android | Android app (`com.loginapp` + SHA-1) and the *Maps SDK for Android* API |
| `GOOGLE_MAPS_IOS_KEY` | Maps SDK on iOS | iOS bundle ID and the *Maps SDK for iOS* API |
| `GOOGLE_PLACES_API_KEY` | Nearby Search from JS | the *Places API (New)* API only, plus a low daily quota |

The Places key ships inside the app bundle, so anyone can extract it. For production, call Places from the `Backend` service and keep that key server-side.

## 2. Configure the app

```sh
cp .env.example .env     # then fill in the keys above
```

`.env` is git-ignored. For quick local work you may set only `GOOGLE_MAPS_API_KEY` (an unrestricted dev key); it is used for any key left empty.

- **JS** (Places requests): inlined at bundle time by `react-native-dotenv`. Restart Metro with `npm start -- --reset-cache` after changing it.
- **Android**: `android/app/build.gradle` reads `.env` into the `com.google.android.geo.API_KEY` manifest entry. Rebuild the app.
- **iOS**: `ios/Podfile` copies the iOS key into the generated `Pods/.../*.xcconfig` as `GOOGLE_MAPS_API_KEY`; `Info.plist` (`GMSApiKey`) and `AppDelegate.swift` pick it up. Run `cd ios && bundle exec pod install` after changing it, then rebuild.

## What you must configure (nothing Google-related is committed)

The Google map needs a **Maps SDK key per platform**, supplied through `LoginApp/.env` (git-ignored). Without one, **Android still shows a working map** (OpenStreetMap, see below) and iOS uses Apple Maps; the Google map, with Google's own look and data, appears once a key is set.

| You want | Set in `.env` | Google Cloud |
|---|---|---|
| Map on **Android** | `GOOGLE_MAPS_ANDROID_KEY` (or the dev-only `GOOGLE_MAPS_API_KEY`) | Enable *Maps SDK for Android*. If you restrict the key: package `com.loginapp` and the SHA-1 of the keystore that signed the build. The committed `android/app/debug.keystore` (also used for release builds for now) has SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`; re-read it with `keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android` |
| Google map on **iOS** | `GOOGLE_MAPS_IOS_KEY` (or `GOOGLE_MAPS_API_KEY`) | Enable *Maps SDK for iOS*; bundle ID `org.reactjs.native.example.LoginApp` |
| Real nearby chargers | `GOOGLE_PLACES_API_KEY` (or `GOOGLE_MAPS_API_KEY`) | Enable *Places API (New)* |

Write `.env` lines as plain `NAME=value`, with no `export`, no spaces around `=` and no trailing `# comment`: the JS side tolerates more, but the Gradle and CocoaPods steps only read that exact form, and a mismatch would leave the native map without a key even though the app believes it has one.

After editing `.env`: `npm start -- --reset-cache`, `cd ios && bundle exec pod install` (iOS), and rebuild the app (the native build reads the key, not Metro).

After pulling a change that adds a native dependency (such as `react-native-webview` for the fallback map): `npm install`, then rebuild (`npm run android`). Reloading JavaScript alone is not enough.

## Behaviour without a key / location

- **Android, no Maps key**: the Google SDK would draw a blank grey rectangle and report nothing (the app checks `GOOGLE_MAPS_ANDROID_KEY` / `GOOGLE_MAPS_API_KEY` itself, see `mapsKeyMissing` in `src/config/google.ts`). So the app draws a **fallback map** instead: Leaflet inside a `react-native-webview` page (`src/components/OsmMap.tsx`, `src/maps/`), on OpenStreetMap tiles, with the same charger pins, route line and "you are here" dot. It is used by the Home map and by the route preview and station mini maps (Trips, Navigation, Backup alert). No key is needed, only a network connection for the tiles. Leaflet is inlined into the page (`src/maps/leafletAsset.ts`, generated by `node scripts/gen-leaflet.js`), so no third-party script is fetched.
  - **Tiles**: the default is the public `tile.openstreetmap.org`, fine for development and demos. Its [usage policy](https://operations.osmfoundation.org/policies/tiles/) rules out heavy or commercial use, so for a real launch either set a Google Maps key (this fallback then isn't used) or point `MAP_TILE_URL` / `MAP_TILE_ATTRIBUTION` in `.env` at a tile provider you have an agreement with. The page is loaded with an https base URL (`MAP_TILE_REFERER`, default this project's GitHub page) because OSM's tile servers refuse requests that carry no `Referer`; without it the map would stay blank. Set `MAP_TILE_REFERER` to your own site for a real launch.
  - **If the fallback cannot start** (the app was updated but `npm install` and a rebuild were not run, so the native WebView is missing, or the page failed to load): the Home screen shows **"Map isn't available"** with a *View chargers as a list* button, and the small maps show a short note. In a development build the panel says to run `npm install` and rebuild.
  - **Tiles cannot load** (offline, blocked): a *Couldn't load the map* notice with **Reload**.
- **iOS, no Maps key**: the app falls back to Apple Maps, which works without configuration. Places results only appear when a Places key is set; otherwise the built-in demo chargers around New Delhi are used.
- **Grey/blank map on Android with a key set**: the key's application restriction (package name + SHA-1) doesn't match the keystore that signed the installed build, or "Maps SDK for Android" isn't enabled for it. Google reports this only in the log: `adb logcat | grep -i "Google Maps"`. The app cannot detect it.
- **Map never starts** (Google Play services missing or out of date on the device or emulator): after 15 seconds the Home screen says the map is taking too long, with a **Reload** button. Use an emulator image with *Google Play*.
- **Location permission denied**: a *Location access needed* card explains it. On Android the first refusal offers **Allow location** (asks again); after one more refusal, and always on iOS (which never asks twice), **Open settings** leads. A dismiss button hides the card. Coming back from Settings re-checks location by itself. The map keeps working around New Delhi in the meantime.
- **Location services off**: *Location is turned off*, with **Open settings** (Android opens the device's location switch; iOS opens the app's settings page) and **Try again**.
- **Services on but no position in time** (indoors, weak signal): *Couldn't find your location* with **Try again** only; Settings cannot help here.
- **Search failed** (quota, key restrictions, offline): the notice shows Google's message with **Retry**.

## Notes

- Places returns up to 20 stations within 10 km, nearest first. Panning more than 2 km away offers **Search this area**. Tune `SEARCH_RADIUS_M` / `MAX_RESULTS` in `src/config/google.ts`.
- Google doesn't publish tariffs, so price per kWh is only shown for demo data. Availability shows "Status unknown" when Google doesn't report it.
- Requesting `places.evChargeOptions` makes each Nearby Search bill at the Places *Enterprise + Atmosphere* SKU (the opening-hours fields alone would be Enterprise); see the [data-fields page](https://developers.google.com/maps/documentation/places/web-service/data-fields) and current pricing before enabling it for many users.
- `ChargerMap` takes an optional `route` (a list of coordinates) and draws it as a polyline under the markers, so turn-by-turn style routes can be added without touching the map again. Directions still open in the Google Maps app.
- Native changes (Podfile, manifest, Gradle, AppDelegate) were written without access to Xcode/Android SDK. Please build both platforms once and report anything that doesn't compile.

# Brand assets

The logo is a P with a charge bolt, circled by an orbit route, in the app palette (navy, lime, white). `assets/brand/logo-mark.svg` is the source; everything else is exported from it:

| File | Use |
|---|---|
| `assets/brand/logo-mark.png`, `@2x`, `@3x` (96/192/288 px) | In-app mark (`src/ui/BrandLogo.tsx`): rounded tile, transparent corners |
| `assets/icon/app-icon-1024.png`, `ios/.../AppIcon.appiconset/*` | Store and iOS icons: full-bleed square, no alpha (the OS rounds it) |
| `android/app/src/main/res/mipmap-*/ic_launcher*.png` | Android launcher: rounded square and circle |

To change the logo, edit the SVG and re-export those files at the same names and sizes; no imports change.

# Login OTP (development)

Sign In and Sign Up ask for an email or a mobile number and then a 6-digit code. The code comes from the `Backend` (`POST /auth/otp/send`, `POST /auth/otp/verify`), which emails it, texts it, or, when it can do neither, hands it back so the app can show it on screen. Configure email (SMTP) and SMS (Twilio) in `Backend/.env`, see `Backend/.env.example`.

1. **Run the Backend so the app can reach it.** From this folder (`LoginApp`), the first time:

   ```sh
   cd ../Backend
   python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   cp .env.example .env                           # Windows: copy .env.example .env
   ```

   then start it:

   ```sh
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

   The OTP endpoints do not need a Firebase key, so the "credentials file not found" startup warnings can be ignored here. `--host 0.0.0.0` is needed for a real phone (the default `127.0.0.1` is only reachable from the computer itself); the Android emulator reaches your computer's loopback through `10.0.2.2`. If Windows Firewall asks whether to allow Python, allow it on private networks.

2. **Point the app at it** with `API_BASE_URL` in `.env` (see `.env.example`), then restart Metro with `npm start -- --reset-cache`:

   | Where the app runs | `API_BASE_URL` |
   |---|---|
   | Android emulator | not needed (default `http://10.0.2.2:8000`; `10.0.2.2` is the emulator's name for your computer) |
   | iOS simulator | not needed (default `http://localhost:8000`) |
   | Real phone on the same Wi-Fi | `http://<your computer's LAN IP>:8000` |

   Debug builds may use plain `http` (Android debug builds set `usesCleartextTraffic` to true via the React Native Gradle plugin, and iOS allows local-network `http`). Release builds need `https`.

What the user sees after tapping **Send Verification Code**:

| Outcome | On the verify step |
|---|---|
| Delivered by email or SMS | An alert "Code Sent" and a "Sent by email" / "Sent by SMS" line. |
| The Backend could not deliver (provider not configured or failed) and `OTP_DEV_FALLBACK=true` | A **DEV MODE** card showing "Your code is 123456" with a **Tap to fill** button, plus a "Dev Code" alert. |
| The Backend cannot be reached at all (debug builds only) | The same DEV MODE card with "Backend unreachable, code generated on this device". That code is checked on the device and never leaves it. |

The Backend's own errors (for example "wait 20 seconds before requesting another code", or a failed delivery when `OTP_DEV_FALLBACK=false`) are shown as they are and never replaced by an on-device code. In a release build an unreachable Backend is reported as an error. `OTP_DEV_FALLBACK` is for development only: anyone who can reach the API can read the code.

This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
