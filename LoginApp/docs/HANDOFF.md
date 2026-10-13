# PlugOrbit prototype: handoff report

Status of the 40-screen showcase build against `docs/PRODUCT_SPEC.md`.

## What exists

- **48 routes, all with real screens** (`src/navigation/registry.ts`; adding a
  route without a screen is a compile error). Screens 01–40 plus the five tab
  roots, Notifications, Alerts, Presenter tools and the support/ticket screens.
- **Login and Home are the visual source of truth.** Welcome/Login kept that
  look (restyled in the Dev_Phase1 pass below); Home was rebuilt on the shared station data with the approved look.
  Every new screen uses the tokens in `src/theme.ts` and the kit in `src/ui`.
- **Navigation:** typed stack + 5 tabs (Home, Trips, Charge, Activity, Profile),
  hardware back, keep-alive tab hosts, owning-tab highlight on stack screens.
- **Service layer:** typed interfaces in `src/services/types.ts`, mock
  implementations in `src/services/mock` (vehicle, station, route, session,
  payment, support, notification, preferences) with latency, offline and API
  error injection. UI never imports a mock directly.
- **Product-truth rules in code (`src/domain`) with tests:** incompatible
  chargers hidden by default; LIVE only for a fresh (≤5 min) operator feed; last
  updated on every status/price; a backup for every recommended stop; remote
  start only with validated payment + pre-auth on a PlugOrbit-controlled
  charger, otherwise the operator's instructions; wait times as range +
  confidence; organic ranking ignores sponsorship; interrupted
  charging/payment flows recover after restart.
- **Google location + Maps + Places (nearby chargers)** with separate keys, see
  the README.

## Smart Drive (automated charging co-pilot)

Added on the `Automated_App_mode` branch. Full reference:
[`SMART_DRIVE.md`](SMART_DRIVE.md). Two routes (`SmartDrive`, `SmartDriveStop`),
plus a calm co-pilot line on Home and Smart Drive settings in Trip preferences.

- `src/intelligence/` is a pure package (no React, store or service imports):
  safety rules, recommendation scoring with reason codes, primary + backup,
  charge target, total stop time and cost, the trip monitor reducer, the
  notification policy, offline honesty, explanations, preference suggestions and
  the prediction-vs-reality record.
- `SmartDriveService` (`src/services/types.ts`) is the seam. The mock keeps
  the world (charger status over time) and simulates the drive; a real backend
  would implement the same interface and run the same engines.
- **Real and tested:** all of the above, as deterministic code.
- **Mock:** charger status over time and queue length, vehicle position (a
  simulated drive, no GPS), the monitor loop (runs on the device only while the
  app is open), delivery (in-app only, no push), route/traffic, battery (the
  model's own estimate, labelled as such), payment.
- **Not built:** any server-side trip monitoring (the FastAPI backend is
  unchanged), push notifications, learned availability/wait/energy models.
- Open product decisions are listed in `SMART_DRIVE.md` §11 (reserve and
  thresholds, auto-switch permission, quiet-mode default, where the monitor
  runs, queue-length sources, parking data).

## Dev_Phase1 UI pass

Simplification and polish on top of the showcase build; no service, store or
domain contract changed.

- **Logo and icons** redrawn (`assets/brand/logo-mark.svg`), launcher and iOS icons regenerated; one shared `BrandLogo`.
- **Welcome** is a local vector scene (road, roadside charger, lime horizon; no remote image), one headline, one supporting line, two actions. Login has a single icon back arrow.
- **Vehicle setup** shows each plug as a picture card (`ConnectorSelectionCard`, `ConnectorImage`), with the chosen plugs summarised above Save and on car cards (`ConnectorTag`).
- **Maps**: a missing Android key is detected and explained instead of a blank map; permission-denied and services-off have their own card (`LocationPermissionState`); a map that never starts gets a Reload notice; `ChargerMap` accepts a `route`.
- **Charger cards** lead with name, availability and distance, then speed, price and reliability; trust and age sit underneath. The primary Energy Plan action is a 64 px `PrimaryButton large`.

Still open from this pass:

- The Google keys themselves (see README "What you must configure"). Nothing was verified on a device or emulator: no Android SDK or Xcode here, only Jest and a browser preview.
- Connector pictures are simplified drawings of the plug faces; have product/design confirm them (especially GB/T and LECCS) before release.
- `reliabilityPct` has no real source yet (demo data only), so "Reliable" appears only for demo chargers.
- An invalid or restricted Android key still shows grey tiles: Google exposes that only in the log.

## Verification

- `npx tsc --noEmit`, `npx eslint src __tests__`, `npx jest` all clean
  (374 tests after the Dev_Phase1 pass; 613 with Smart Drive, of which 173 are
  engine tests and 54 cover the Smart Drive service and screens).
- `__tests__/crawl.test.tsx` mounts every route, presses every button, requires
  an accessible label on each, checks each press navigates somewhere valid, and
  checks every route is reachable from Home. Payment and PaymentFailure need a
  stopped session and are covered by `__tests__/charge.flow.test.tsx`
  (scan → start → stop → pay → receipt → feedback, plus failure and restart
  recovery).
- Visual QA was done by rendering the real screens with react-native-web in
  headless Chromium (see ARCHITECTURE.md §8). It is a layout check, not a
  substitute for a device pass.

## Independent review

Before handoff the app went through a read-only adversarial review (six
lenses: native setup, security/keys, races and restart recovery, product-truth
rules, dead ends and states, domain correctness; two skeptical verifiers per
finding). 33 findings survived verification and are fixed, each with a
regression test. The ones that mattered most:

- Reset demo data stopped persistence for the rest of the run; resuming an
  unpaid or failed session from the banner/tabs crashed; a second start could
  overwrite an open session; a failed pre-authorisation could leave a phantom
  session.
- "No wait expected" was claimed for estimated feeds; Forecast said "Live now"
  for any station; backups could be 100+ km away; "Switch to backup" went to a
  different station than the one shown; route stops invented a price.
- Google Places chargers appeared on Home but could not be opened, and carried
  invented connector/rating data.
- On Android the Play Services location request could hang or collide.
- With the phone far from the demo data (Delhi/NCR) there were no chargers at
  all. It now falls back to demo chargers around New Delhi and says so.
- WCAG AA text contrast and 44 px touch targets across all 48 routes.

Known limits left on purpose:

- Some routes legitimately have a stop with **no backup** (for example Jaipur to
  Delhi starting at Shahpura, and the Nissan Leaf): the screen shows a warning
  rather than recommending a far-away or unreachable backup.
- Google Places chargers are cached in memory only. A *saved* Google charger
  shows "not available right now" after a restart until it is found again
  nearby. Fetching a single place by id would fix it.
- JS and native decide "iOS has a Maps key" from the same `.env` at different
  times: re-run `pod install` and rebuild after changing keys.
- Privacy switches other than "Vehicle battery data" are saved but not
  enforced until there is a backend; the screen says so.

## Integrations still mocked (every one is marked `TODO(integration)`)

| Area | Where | Needed for real |
|------|-------|-----------------|
| Charger status/price feed | `services/mock/stationService.ts` | Operator / CMS feed. Until then nothing is LIVE except demo "integrated" stations |
| Remote start/stop, meter values | `sessionService`, `ActiveSessionScreen` | OCPP CMS. The charging curve is simulated and labelled *Estimated meter* |
| Payment pre-auth + capture | `paymentService`, `domain/paymentForm.ts` | Payment gateway with tokenised cards/UPI |
| GST invoice PDF | `ReceiptScreen`, `SessionDetailScreen` | Backend invoice generation |
| QR decode | `ScanQrScreen` | Camera module (e.g. react-native-vision-camera); the screen already takes a charger code |
| Reservation, queue | `ReservationScreen`, `QueueScreen` | Operator APIs |
| OEM battery read | `AutoSocScreen` | OEM cloud account or Bluetooth OBD |
| Occupancy forecast | `ForecastScreen` | Operator occupancy history model |
| Roadside dispatch | `RoadsideScreen`, `config/support.ts` | Partner API and real support contacts |
| Plus billing | `PlusScreen` | Billing backend (nothing is charged) |
| Privacy switches | `PrivacyScreen` | Backend enforcement |
| Login OTP | `App.tsx`, `services/otpApi.ts` | Wired to the Backend's `/auth/otp/*` for development: the code is emailed or texted, or shown on screen when that is not possible (README "Login OTP (development)"). A verified code also opens a Firebase session when the Backend has Firebase configured, and the app then backs its data up to that account (README "Cloud backup (Firebase)"). Still needed: a production email/SMS provider, a shared OTP store, account linking (email and phone are separate accounts), and Keychain/Keystore storage for the session tokens |
| Problem-report photos | `ReportProblemScreen` | Image picker + upload |

## Not verified in this environment

- **Native builds.** No Android SDK or Xcode was available. The Android
  manifest/gradle and iOS Podfile/Info.plist/AppDelegate changes for Google
  Maps keys were reviewed by reading and API-level checks only. Do a clean
  `./gradlew assembleDebug` and `pod install && npm run ios` before the day.
- Behaviour on a physical device (location prompts, keyboard, safe areas,
  hardware back).

## Decisions needed

1. **Trust badge wording:** Estimated / User-confirmed / Unknown wording is
   mine; confirm with product and legal.
2. **Data freshness:** LIVE threshold is 5 minutes and "stale" is
   `STALE_AFTER_MS` in `domain/trust.ts`. Confirm both.
3. **Pre-auth amount rule:** target energy + GST, +10% buffer, rounded up to the
   next ₹50 (`estimatePreauthInr`). Confirm with the payment provider.
4. **Demo time scale:** 20× in `domain/charging.ts`. Set to 1 for any
   non-showcase build.
5. **Presenter tools** ship in the Profile tab. Hide them behind a build flag
   for anything beyond the showcase.
6. **Places key handling:** Places (New) is called straight from the app. Proxy
   it through the backend before release so the key stays server-side.
