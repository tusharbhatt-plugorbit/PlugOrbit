# PlugOrbit quality and integration review

Review date: 12 October 2026. Branch: `feature/plugorbit-quality-assist`, from
`01adacd`. This review supplements `REDESIGN_REPORT.md` and `ASSISTANT_AI.md`;
their historical test counts and web previews are not current native-device evidence.

## What was inspected

The existing application already contains a shared navy/lime design system,
passwordless authentication, onboarding, a dashboard, Google Maps with an OSM
fallback, deterministic journey planning, and an LLM tool-use implementation.
The work improves those implementations rather than replacing them.

React Native uses a typed custom navigation registry, appStore and assistantStore,
AsyncStorage persistence, shared Screen/BottomSheet/Fields components, and safe-area
and keyboard helpers. FastAPI supplies OTP authentication, Firebase-backed cloud
state and an isolated AI gateway. Environment files, credentials, existing backend
contracts and database schemas were not changed.

## Screen inventory and audit

These are the complete registered product routes, grouped by their existing
navigation journeys. Authentication screens are outside the product registry.
The automated crawl renders registered screens and follows navigation; this is
not equivalent to checking every integration on a physical phone.

| Screens | Findings and treatment | Entry point |
|---|---|---|
| Splash, Welcome, introductory onboarding | Existing branding and three-step introduction retained; completion persistence unchanged | App entry |
| Login, Signup, OTP verification | Passwordless email/mobile OTP, not password login. Fixed synchronous duplicate requests and stale completion after cancellation; corrected keyboard timer cleanup | Welcome |
| Home | Large assistant panel delayed discovery of six shortcuts. Moved shortcuts earlier; narrow-screen floating assistant covered the destination field and is now suppressed below 360 dp | Home tab |
| Map, StationList, Filters, StationDetail, Compare | Google provider, markers, permissions and Places services retained. Native map rendering checked. Operator occupancy is not established by a Places result | Home Find chargers / map controls |
| Saved, Forecast, Community, CostCalculator | Existing screens preserved; shared layout/accessibility fixes apply. Forecast and sample prices remain preview data | Discovery and Trips actions |
| Trips, RoutePlanner, RouteResult, EnergyPlanner, MultiStop, OfflineMode | Existing deterministic planner retained; no external routing replacement. Regression suite covers route variants | Trips tab / Home Plan trip |
| Navigation, BackupAlert | Existing active-trip guidance retained. Charging-completion fallback now opens the charging session rather than the planner | Journey result / active journey |
| SmartDrive, SmartDriveStop, TripPreferences | Existing Orbit planning UI retained. Starting an approved assistant journey now retains its reserve and strategy without overwriting saved defaults | Trips / Home journey panel |
| Assistant, assistant sheet, settings and driving mode | Fixed microphone permission/background race, late TTS after stop, rejected playback recovery and bounded status requests. Consent no longer competes with disabled controls or auto-scrolls out of view | Home Orbit Assist shortcut; Map and trip assistant entries |
| VehicleSetup, ManualSoc, Vehicles, AutoSoc | Existing setup/manual fallback retained. OEM/OBD telemetry must not be presented as connected without an integration | Home My vehicle / battery controls / Profile |
| Charge, ScanQr, StartCharging, ActiveSession | Existing camera/session flows preserved; no native camera/provider replacement. Actual QR recognition and charger hardware need physical testing | Charge tab |
| Payment, PaymentFailure, Receipt, PaymentMethods | Existing guarded simulated payment flow retained. No real gateway transaction claimed | Charging flow / Profile |
| Reservation, Queue | Existing preview functionality retained; no autonomous booking exposed to AI | Station details |
| Activity, SessionDetail, Feedback | Shared forms, keyboard handling and inline alert semantics reviewed; sample history distinguished from real operator receipts | Activity tab |
| Notifications, Alerts | Existing UI and foreground event monitoring retained; completion links corrected | Home bell / Profile |
| Support, TicketDetail, ReportProblem, Roadside | Existing forms/routes retained; shared keyboard cleanup improves unmount safety | Profile / station actions |
| Profile, Language, Privacy, Plus, PresenterTools | Existing controls retained; developer tools remain release-gated. No paid subscription integration added | Profile tab |

The app already offers the five primary tabs Home, Trips, Charge, Activity and
Profile. No duplicate navigation stack or alternative authentication was added.
Home shortcuts now directly expose Find chargers, Plan trip, My vehicle, Charging
history, Saved stations and the conversational Assistant. These require one tap
after scrolling to the clearly labelled Quick actions section on smaller phones.
The map keeps its own assistant entry, preserving map state when its sheet opens.

## Critical defects fixed

* Keyboard-aware forms captured an obsolete timer array in their cleanup. Pending
  focus measurements could run after unmount. Cleanup now cancels the current
  timers, and mounting while the keyboard is already visible schedules a measure.
  Existing measured-overlap avoidance, Android resizing, safe areas and input
  alignment remain in place; no nested blanket KeyboardAvoidingView was added.
* React state alone did not prevent two OTP submissions in the same render.
  Submission now uses the existing synchronous pending ref. Completion checks
  cancellation again after asynchronous session storage before navigation.
* Microphone permission could resolve after backgrounding and begin recording.
  Foreground, consent and request generation are checked after permission awaits.
* TTS initialization/language setup could finish after Stop and speak anyway.
  A generation guard invalidates pending speech; rejected native playback now
  releases the speech pipeline rather than leaving it stuck.
* Assistant status/token refresh could hang indefinitely. Status and history
  requests have a bounded timeout with a recoverable TIMEOUT result.
* Approved journeys dropped conversational reserve/strategy. Optional local
  planning inputs now preserve these values without changing backend contracts.
* Native voice dependencies used obsolete Gradle configuration incompatible with
  this project's Android toolchain. A version-checked, idempotent postinstall
  script applies namespaces, current SDK configuration and repository settings.
  Native module source APIs and dependency versions are unchanged.
* Shared sheet/navigation transitions respect reduced motion. Inline form errors
  now expose alert semantics. A Windows-only UTF-8 fixture failure was corrected.

## AI architecture and actual capabilities

The existing `src/assistant` controller coordinates consent, conversation,
push-to-talk, streaming text, sentence playback, interruption and action approval.
`Backend/app/ai` authenticates Firebase users, limits requests and usage, manages
temporary conversation sessions, calls Anthropic, and streams NDJSON responses.
Provider secrets stay on the server. There are 15 read-only device tool adapters
covering vehicle/battery/preferences, location, route options, chargers, energy,
charging stops, costs, active trip/session and plan explanations. Tool envelopes
include provenance and unavailable/error states. Client-supplied data is not an
authoritative payment or telemetry record.

Journey calculations run through the existing deterministic planning services;
the model explains results rather than inventing energy or live occupancy.
Action cards require approval and invoke existing navigation/planning actions.
The AI tool set does not expose payments, booking or charging control.

Speech uses the existing OS recognizer -> server LLM -> OS TTS pipeline. Text
streams from the gateway and complete sentences enter the playback queue; this is
not realtime speech-to-speech or streamed audio synthesis. English/Hindi selection
depends on installed recognition/voice services; Hinglish recognition quality must
be measured on devices. Push-to-talk is supported; no always-listening wake word.
OS recognition may send audio to Google/Apple; the consent copy explains this.
The app does not store raw recordings by default.

Existing proactive monitoring uses foreground events, timestamps and deduplication
for battery/journey/charging guidance. It cannot create reliable occupancy alerts
without operator data or claim background delivery without platform integration.
Conversation/preferences clearing and explicit long-term preference consent remain.

## Integration preservation and test status

| Integration | Status / limits |
|---|---|
| Authentication and registration OTP | API/state/race tests pass; no external OTP email/SMS sent during review; valid live credentials and session expiry need an end-to-end account test |
| FastAPI / Firebase cloud sync | Backend tests pass; local backend health checked. Production Firebase round-trip not claimed |
| Google Maps / OSM / Places | Existing provider/config untouched; Google native map renders in emulator. Service and fallback tests pass. No live charger availability inferred |
| Location / marker / filter UI | Automated coverage retained; emulator map inspected. Physical GPS accuracy and permission variants still need device QA |
| Routing and energy calculations | Deterministic tests pass; current demo/service boundaries retained. Production traffic/elevation/weather routing is not added |
| Vehicle / battery | Manual and existing connection-service tests retained; no physical OEM/OBD hardware validated |
| Charging / payment / reservation | Regression tests retained; current simulated service boundaries unchanged. No paid transaction or real charger session performed |
| Camera / QR | Existing native dependency unchanged; tests cover permission/fallback. Camera feed and real QR scanning require hardware |
| Assistant LLM gateway | Protocol, tool-loop, auth, failure and safety tests pass with test doubles. **No AI key is configured locally; real provider responses are unverified** |
| Voice / proactive notifications | Lifecycle/interruption/queue/deduplication tests pass; Android build succeeds. Physical microphone, Hindi/Hinglish, Bluetooth, calls and navigation audio focus unverified |

## Setup, cost and external dependencies

Use the existing backend requirements and startup instructions in `ASSISTANT_AI.md`.
Run `npm ci` in LoginApp; its postinstall applies the two pinned native voice
compatibility patches. Rebuild the Android binary after native dependency changes;
Metro reload alone cannot register missing native modules.

An administrator must configure the existing server-side Anthropic credential and
Firebase authentication before live conversation. No credential was created or
changed by this review. The current default model was preserved.

Published list rates checked against [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing):
Opus 5.5 $4/$20 and Sonnet 5.5 $2/$10 per million input/output tokens. A 3,000-input,
400-output-token call is approximately $0.020 or $0.010 respectively, excluding
additional tool rounds/history. Sonnet cache-read accounting was corrected to
$0.10 per million tokens. These are estimates, not invoices; verify rates before
deployment. OS speech has no separately integrated paid speech API in this app.

Remaining dependencies: production route/charger price and occupancy feeds,
operator session/payment/booking APIs, OEM/OBD telemetry, physical-device speech
validation, robust audio-focus handling during calls/navigation, background push
delivery and iOS/Xcode validation. Maximum-stop and avoidance constraints must
only be advertised to the extent the current deterministic planner enforces them.

## Verification and previews

Backend: **203 passed, 1 skipped**. Android x86_64 debug assembly: **passed**.
TypeScript: **passed**. Frontend: **56 suites, 1,026 tests passed**; final consent,
Home and keyboard changes also passed a focused rerun of **78 tests**. ESLint:
**0 errors**, five existing `no-bitwise` warnings in the contrast test.
Earlier baseline had a route sweep timeout (and two cascading state failures);
its exhaustive sweep now receives a 30-second test budget. An intermediate
keyboard cleanup assertion failed because clearTimeout receives extra forEach
arguments; the assertion was corrected and its focused suite passes.

Native previews are in [quality/screenshots](quality/screenshots). Captured in a
read-only emulator session, including 320 dp Home, Welcome, Login (keyboard open),
Signup, map and Profile, plus 430 dp authentication layouts. Login input and its
submission button remained above the keyboard; closing it restored the form.
No verification message was sent. Assistant previews captured before the final
consent-layout correction are excluded from the final preview set.
They are actual screenshots, not design mockups. Screens without a native preview
must not be assumed physically tested. Emulator API 37 software rendering can
produce a black first launch/Fast Refresh frame; cold boot and app restart recovered
the UI. This is a remaining environment limitation, not proof of universal stability.

## File changes

Updated authentication, shared keyboard/sheet/field/navigation primitives, Home,
assistant screen/floating entry/controller/gateway/voice/proactive/action handling,
local journey input types/service and targeted regression tests. Added reproducible
native voice postinstall, emulator-only labelled UI capture helper, this report and
native previews. Updated package lock install metadata, UTF-8 backend fixture test
and isolated AI usage pricing/test. No product feature or source file was removed.
