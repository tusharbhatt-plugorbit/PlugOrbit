# PlugOrbit redesign: report

What was asked for, what was found, what was changed, how it was checked, and what is
**not** done or **not verified**. Written against the repository as it was at
`08d392a` and the branch `claude/lucid-allen-5zvsxs`.

> **Read this first.** Nothing here was run on a phone or emulator: this
> environment has no Android SDK, Xcode or device. Layout and keyboard behaviour
> were verified with Jest and with the real screens rendered in headless Chromium
> through `react-native-web` (a throw-away harness kept outside the repository), at
> 320, 360, 390 and 430 px wide. That is a strong layout check and a weak
> substitute for a device pass. Section 9 lists what a device pass must confirm.

## 0. The brief against the repository

The brief described an app with an email-and-password login, a hidden map, and no
automation. The repository was different, and several requests changed shape:

| The brief assumed | What the repository actually had | What was done |
|---|---|---|
| Email + password login, show/hide password, Forgot Password | **Passwordless one-time-code login** (`/auth/otp/send`, `/auth/otp/verify`), one field for mobile or email | Kept the backend contract. **No password field was added** (the brief forbids showing sign-in methods that do not exist). Show/hide password and Forgot Password are not applicable |
| "Sign in with Google" might be real | A button that only said "coming soon" | **Removed.** It was exactly the fake sign-in option the brief rules out. Reinstate when implemented |
| A Home dashboard to improve | **Home was the charger map** | Home is now a dashboard; the map moved, logic untouched, to a `Map` route |
| Orbit Assist is a new feature | A complete engine already existed as **Smart Drive** (pure engine, ~230 tests, service seam, two screens) | Surfaced and renamed to Orbit Assist; added a real mode choice. No second copy was built |
| Terms / Privacy links "where configured" | None configured | Not rendered |
| "Logo assets supplied by me" | No files were attached to this session | The repository's existing mark is used everywhere through the single `BrandLogo` component. Drop new files into `assets/brand/` to replace it |
| Existing payment integration to preserve | Payments are a **mock** (`TODO(integration)`); there is no gateway in the repository | Nothing to break; the screens were hardened (see §6) |
| Docs said Login and Home were "approved, do not redesign" | An earlier instruction | Superseded by your current brief; design tokens and the product-truth rules were kept |

## 1. UI/UX audit (screen by screen)

49 routes. "Verified" means rendered at 320, 390 and 430 px (147 renders): **0
horizontal overflow, 0 unlabelled controls, 0 clipped text**; text-entry screens were
also keyboard-checked (§2).

| Area | Routes | Treatment |
|---|---|---|
| **Entry** | Splash, Welcome, Onboarding (new), Login, Sign up, Enter code | **Rebuilt** (`src/screens/auth/`). Inline errors, keyboard-safe, pinned CTAs, 3 skippable intro slides |
| **Home** | `Home` | **Rebuilt** as the driver dashboard |
| **Map & discovery** | `Map` (new route), `StationList`, `Filters`, `StationDetail`, `Compare`, `Saved`, `Forecast`, `Community`, `CostCalculator` | `Map`: moved, plus Back, List control, collapsible station card. `StationDetail`: demo-data line. Others: verified, unchanged |
| **Trips & Orbit Assist** | `Trips`, `RoutePlanner`, `RouteResult`, `EnergyPlanner`, `MultiStop`, `OfflineMode`, `BackupAlert`, `Navigation`, `SmartDrive`, `SmartDriveStop`, `TripPreferences` | `SmartDrive`: mode choice, "Start journey", preview-data notice. `TripPreferences`: mode choice, optional setup step. Strings renamed. Others: verified, unchanged |
| **Vehicle** | `VehicleSetup`, `ManualSoc`, `AutoSoc`, `Vehicles` | Setup is now 3 steps. `AutoSoc` made **honest** (§6). Others verified |
| **Charging & payment** | `ScanQr`, `StartCharging`, `ActiveSession`, `Payment`, `PaymentFailure`, `Receipt`, `Feedback`, `Reservation`, `Queue` | Double-submit guards on `Payment`, `PaymentFailure`, `StartCharging`. Others verified, unchanged |
| **Activity & support** | `Activity`, `SessionDetail`, `Notifications`, `Alerts`, `Support`, `TicketDetail`, `ReportProblem`, `Roadside` | Verified; keyboard-checked where there are inputs |
| **Profile** | `Profile`, `PaymentMethods`, `Language`, `Privacy`, `Plus`, `PresenterTools` | `Profile`: developer tools hidden in release builds. Others verified |

**What was not redesigned, deliberately.** Most product screens were already built
on one shared kit and one token file. They were improved through that kit (keyboard
handling, input alignment and contrast, button loading label, section spacing)
rather than restyled one by one; a restyle would have been churn without a defect to
fix. I did not find overflow, clipped text or unlabelled controls on them.

**Issues found and not fixed** (in the 49 routes):

- Touch targets: several icon controls render below 44 px and reach it through
  `hitSlop`. A browser cannot see `hitSlop`, so this is only checkable on a device.
  (The repository's own crawl test enforces the 44 px rule and passes.)
- On station cards a favourite button sits inside a pressable card. Valid on
  native; on the web it produces a nested-`<button>` warning. Not an app defect.
- Only the sign-in sheet has a light/dark switch; there is no app-wide dark theme.
- There is no trip-history list screen (§5).
- "Demo data" lines are on Home, the map, station details and the planner, but not
  on every list card.

## 2. Critical bug report: login typing and keyboard

**Reproduced** (in the harness, on a 360x640 phone, in both Android window modes):
tap the email field and the keyboard either covers the field and the Login button
(window not resized) or the focused field ends up below the fold with nothing
scrolling it into view (window resized).

**Causes, from reading the code** (not confirmed on a device, which I could not do):

1. `KeyboardAvoidingView behavior="height"` on Android, in `App.tsx`, `Screen.tsx`
   (every form screen) and `BottomSheet.tsx`, together with `windowSoftInputMode=
   adjustResize` and `edgeToEdgeEnabled=true`. `height` mode assumes the window is
   not resized; whether it is depends on the OS version and edge-to-edge, so the
   avoidance could be doubled or absent.
2. In `App.tsx` the avoider added `frame.y` (relative to its parent) to a
   `keyboardVerticalOffset` that was relative to the screen, which counts the 48 dp
   top bar twice on iOS.
3. **Nothing scrolled the focused field into view.**
4. The code-sent and dev-code `Alert` popups opened as the code field auto-focused,
   taking focus from the keyboard.
5. Text alignment: no `includeFontPadding={false}` / `textAlignVertical`, so Android
   sat text low; the placeholder was **truncated** ("...name@examp") and only about
   2.6:1 contrast on white.

**Fix** (`src/ui/KeyboardAware.tsx`, `src/ui/keyboardMath.ts`):

- `KeyboardAvoider` pads by the *measured* overlap between the keyboard and the
  view. If the window already resized, the overlap is 0, so nothing is compensated
  twice. It works whichever mode the device is in.
- `KeyboardAwareScrollView` scrolls the focused field (and, for the code boxes, the
  button under them) above the keyboard, including when moving from one field to
  the next with the keyboard open.
- Used by the sign-in screens, `Screen` (all forms) and `BottomSheet`.
- Inputs: Android alignment props, `maxFontSizeMultiplier`, a placeholder colour that
  clears WCAG AA (new token, contrast-tested), short placeholder.
- Popups replaced with inline `role="alert"` messages. Added a missing guard so a
  second tap on **Verify** cannot cancel the first request and spend another attempt.

**Verified** (harness): on sign-in the field, the primary button and the error stay
above the keyboard in both window modes at 360x640; on the code step the code boxes
*and* the Verify button do too (360x640 with the window not resized, 320x568 with it
resized). Beyond sign-in, the lowest text field was checked on **9 other
screens** (Feedback, Report a problem, Ticket detail, Station list, Orbit Assist
planner, Route planner, Vehicle setup, Home, Map) in both window modes (18 checks),
and on **4 sheet forms** (Add payment method, Enter charger ID, Add destination,
Support ticket) in the faithful mode. Every one ended above the keyboard. A fifth sheet
(Roadside) has no text field. The harness cannot resize a web modal, so sheets were
checked only with the window *not* resized. 21 unit tests cover the maths and the
components, including "window already resized, do not pad again".

**Not verified:** a real device or emulator. The native Android config was left
untouched on purpose (`adjustResize`, edge-to-edge); the JavaScript fix is meant to
work in either state.

## 3. Feature visibility report

| Feature | Before | Now |
|---|---|---|
| Orbit Assist (Smart Drive) | A strip under the map's chips; Trips card | Home panel with state and mode; quick action; Trips; panel over the map during a trip |
| Battery and vehicle state | Only a chip on the map | Home vehicle card: battery, source and age, range, connection status, *Set battery*, *Connect car* |
| Where am I going | Trips tab only | Home: "Where are we going?" then *Plan my journey* (destination carried into Orbit Assist) |
| Find chargers / map | Was Home | Home quick action, header location pill, "See map"; Back returns to Home |
| Charging history | Activity tab | Home quick action |
| Saved stations | Profile, then Saved | Home quick action |
| Plan trip | Trips tab | Home quick action |
| My vehicle | Profile, then Vehicles | Home quick action |
| Notifications / Profile | Bell on the map header; Profile tab | Home header: bell and profile button |
| Charging in progress | Banner | Banner, plus a row on the Home vehicle card |
| Orbit Assist mode | (did not exist) | Planner, Trip preferences, Home ("Mode: ... Change") |
| Developer tools | Profile, for everyone | Hidden in release builds |

Each is on Home itself or one tap from it. Separately, the repository's crawl test
presses every button on every route and checks that every route is reachable from
Home (it passes).

## 4. Home, map and navigation

- **Home dashboard**: vehicle and battery (the battery's *source* and *age* are shown;
  a reading is "Read from your car" only when it really is and the link is up), a
  range worked out from the battery, destination field, Orbit Assist panel, six
  quick actions, latest trip or saved route, nearest charger with loading, location
  off, offline and empty states, pull to refresh.
- **Map**: same logic (`ChargerMap`, `OsmMap`, markers are unchanged files). Added a Back
  arrow, a List control, and a **collapsible** station card that always keeps the
  status *and how fresh it is* in view. The co-pilot strip moved to Home.
- `useNearbyStations` now shares a 90 second device-centred result, so opening the
  map from Home does not locate and call Places a second time (tested, and the test
  was shown to fail without the cache). Errors and "search this area" are never
  cached.

## 5. Orbit Assist

See [`ORBIT_ASSIST.md`](ORBIT_ASSIST.md) for the capability map. In short:

- **Real:** the planning engine, stop and backup, recalculation of the charging plan,
  alerts, arrival battery, the two modes (Guided holds back unsolicited suggestions;
  verified in the pure engine on identical events).
- **Simulated:** charger status, queues, prices and the drive. Labelled "Demo data" /
  "Preview data" through one flag (`RUNS_ON_DEMO_DATA`).
- **Not built / needs an integration:** live charger feed, real routing and traffic,
  GPS and background monitoring, push notifications, a trip-history screen, and a
  dedicated "you missed your stop" message.

## 6. Integrity fixes found along the way

1. **Fabricated vehicle connection.** Tapping *Connect with OEM account* waited 1.4 s,
   then invented a **58%** battery marked `source: 'vehicle'`, set the car to
   "Connected" and the UI called it "Read from your car". There is no integration.
   Now it reports "not available yet", manual entry is the way forward, and the old
   simulation exists only behind a Presenter switch where it is labelled *Demo
   reading*. Tested at the service and screen level.
2. **Double payments.** Two quick taps could send two payment requests; the
   payment-retry handler had no guard at all. Synchronous guards added to
   `Payment`, `PaymentFailure` and `StartCharging`. The tests deliver both taps in
   one frame and fail without the guards.
3. **A selected radio for an unavailable option** (the connection screen) fixed.

## 7. Integration preservation

Proved from git, not asserted: since `08d392a` **no file changed** in `Backend/`,
`android/`, `ios/`, `package.json`, `package-lock.json`, `.env.example`, `app.json`,
`otpApi.ts`, `session.ts`, `stateApi.ts`, `backend.ts`, `places.ts`, `location.ts`,
`cloudSync.ts`, `syncedKeys.ts`, `ChargerMap.tsx`, `OsmMap.tsx`, `ChargerMarker.tsx`,
or the payment, session and station mock services. `src/config` gained one new file.

| Integration | Status |
|---|---|
| Login / registration (OTP send, verify) | Code unchanged. Same requests and bodies asserted by 39 tests (abort on leave, no double send, local fallback, rate limits, errors). **Not run against a live backend** |
| Session and cloud backup | Code unchanged; 3 cloud-login tests pass |
| Map rendering, markers, fallback map | Files unchanged; 26 map tests, 20 fallback-map tests pass. **Native map not run on a device** |
| Location permission and nearby chargers | `location.ts` unchanged; denied, services-off, no-fix, demo-area tests pass. The hook gained the shared cache |
| Charger filtering, compatibility | Domain code unchanged; tests pass |
| Route generation / Orbit Assist | Engine extended (mode); all 179 engine tests pass. Routes are the mock service |
| Payments | Mock service unchanged; payment flow, failure and recovery tests pass. **No real gateway exists in the repository** |
| Charging sessions | Mock service unchanged; scan, start, stop, pay, receipt and restart-recovery tests pass |
| Vehicle / battery | Manual entry unchanged. The simulated connection was removed from the default path (§6) |
| Notifications | Unchanged except the Guided gate |
| Profile | Unchanged |

## 8. File changes

75 files, +5,970 / -1,983 (excluding screenshots). New, by purpose:

- **Auth** `src/screens/auth/{Splash,Welcome,Onboarding,Auth}Screen.tsx`, `authLogic.ts`;
  `src/store/onboarding.ts` (own storage key, outside the synced store).
- **Keyboard** `src/ui/KeyboardAware.tsx`, `keyboardMath.ts`.
- **UI** `src/ui/illustrations.tsx`, `battery.tsx`, `useReducedMotion.ts`.
- **Navigation** `src/screens/discover/MapScreen.tsx` (moved from `home/HomeScreen.tsx`,
  history kept), `Map` route in `params.ts`, `routeNames.ts`, `registry.ts`, fixtures.
- **Config** `src/config/presenter.ts`.
- **Docs** `ORBIT_ASSIST.md`, this report, `screenshots/`.
- **Tests** `keyboardAvoider`, `homeDashboard`, `paymentGuards`, `vehicleConnection`,
  `vehicleOnboarding`, `intelligence/mode`; `HomeScreen.test` became `MapScreen.test`.
- **Rewritten:** `App.tsx` (from 1,196 lines to a 104-line router), `HomeScreen.tsx`.
- **Changed in place:** the shared kit (`Screen`, `BottomSheet`, `Fields`, `Buttons`,
  `Card`, `station`, `smartdrive`), `theme.ts` (two tokens), the Orbit Assist and
  vehicle screens, `Profile`, the engine's notification gate, the demo store, and
  `useNearbyStations`.
- **Removed:** the Google button and the login dark-mode emoji toggle (replaced by an
  icon switch). Nothing else.

## 9. Testing report

| Check | Before | After |
|---|---|---|
| `tsc --noEmit` | clean | clean |
| `eslint` | 0 errors, 5 warnings | 0 errors, the **same** 5 warnings |
| `jest` | 41 suites, **690 / 692** (2 failing) | 47 suites, **787 / 787** |

- The 2 failures that existed *before* any change were stale tests: buttons had been
  moved from `height` to `minHeight` (so large text can grow them) but two tests still
  asserted `height`. The tests were corrected; the code was right.
- Existing auth tests were **rewritten to assert the same behaviours** (request
  counts and bodies, abort, no double send, fallbacks) through the new inline UI.
  Where a test used to assert an `Alert`, it asserts the inline message; where it
  asserted "no alert" after a dropped request, it also asserts no message.
- Several new tests were **mutation-checked** (the guard, the cache, the unavailable
  connection): the code was reverted and the test confirmed to fail.
- Harness: 147 renders (49 routes at 320/390/430), large-text (1.3x) on six key
  screens, and the keyboard checks in §2.

**Must be confirmed on a device:** keyboard behaviour on real Android (several OS
versions, with and without edge-to-edge) and iOS; safe areas; Google Maps and Places
with real keys; the camera and QR scan; hardware back; touch targets that depend on
`hitSlop`; text scaling with the real system setting; dark/light display modes.

**Not tested here:** the Python backend's own tests, push notifications (not built),
anything needing credentials or hardware.

## 10. Decisions for you

1. **Google sign-in removed.** Restore when it is implemented.
2. **Presenter tools hidden in release builds.** For a showcase release set
   `FORCE_PRESENTER_TOOLS = true` in `src/config/presenter.ts`.
3. **Vehicle connection** reports "not available yet" by default; the sample 58% is
   behind a Presenter switch. Confirm that is what you want for demos.
4. **"LIVE" on demo chargers.** The trust model prints LIVE for a fresh operator feed,
   and the mock data includes simulated ones. I labelled the demo surfaces rather than
   change the trust model. Say if you want it stricter.
5. **Backend and data work is needed** for real operation (list in `ORBIT_ASSIST.md`).
   None was started: the brief asked for approval first.
6. **Terms and Privacy URLs** and **new logo files**, if you have them.
