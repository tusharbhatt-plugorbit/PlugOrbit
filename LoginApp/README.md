# Google Maps, location & nearby chargers

The **Find a Charger** screen uses:

| What | How |
|---|---|
| Current location | `@react-native-community/geolocation` (Android: Google's Fused Location Provider via Play Services; iOS: Core Location) |
| Map | `react-native-maps` with the Google Maps SDK (Android + iOS) |
| Nearby charging stations | [Places API (New) – Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search), type `electric_vehicle_charging_station`, with live connector counts from `evChargeOptions` |
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

## Behaviour without a key / location

- **No keys**: the app still runs on its built-in demo chargers around New Delhi and iOS uses Apple Maps instead of Google; Places results only appear when a Places key is set.
- **Location denied or unavailable**: the app explains why, searches around New Delhi instead, and the notice has a **Retry** button (the locate button also retries).
- **Search failed** (quota, key restrictions, offline): the notice shows Google's message with **Retry**.

## Notes

- Places returns up to 20 stations within 10 km, nearest first. Panning more than 2 km away offers **Search this area**. Tune `SEARCH_RADIUS_M` / `MAX_RESULTS` in `src/config/google.ts`.
- Google doesn't publish tariffs, so price per kWh is only shown for demo data. Availability shows "Status unknown" when Google doesn't report it.
- Requesting `places.evChargeOptions` makes each Nearby Search bill at the Places *Enterprise + Atmosphere* SKU (the opening-hours fields alone would be Enterprise); see the [data-fields page](https://developers.google.com/maps/documentation/places/web-service/data-fields) and current pricing before enabling it for many users.
- Native changes (Podfile, manifest, Gradle, AppDelegate) were written without access to Xcode/Android SDK. Please build both platforms once and report anything that doesn't compile.

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
