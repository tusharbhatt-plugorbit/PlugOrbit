# PlugOrbit prototype: handoff report

Status of the 40-screen showcase build against `docs/PRODUCT_SPEC.md`.

## What exists

- **49 routes, all with real screens** (`src/navigation/registry.ts`; adding a
  route without a screen is a compile error). Screens 01–40 plus the five tab
  roots, Notifications, Alerts, Presenter tools and the support/ticket screens.
- **Login and Home are the visual source of truth.** Welcome/Login are
  untouched; Home was rebuilt on the shared station data with the approved look.
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

## Verification

- `npx tsc --noEmit`, `npx eslint src __tests__`, `npx jest` all clean
  (186 tests).
- `__tests__/crawl.test.tsx` mounts every route, presses every button, requires
  an accessible label on each, checks each press navigates somewhere valid, and
  checks every route is reachable from Home. Payment and PaymentFailure need a
  stopped session and are covered by `__tests__/charge.flow.test.tsx`
  (scan → start → stop → pay → receipt → feedback, plus failure and restart
  recovery).
- Visual QA was done by rendering the real screens with react-native-web in
  headless Chromium (see ARCHITECTURE.md §8). It is a layout check, not a
  substitute for a device pass.

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
| Login OTP | `App.tsx` | OTP endpoints (pre-existing, unchanged) |
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
