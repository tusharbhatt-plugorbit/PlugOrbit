# Orbit Assist

> **You choose the destination. PlugOrbit plans the charging.**

Orbit Assist is the product name for what the code calls **Smart Drive**
(`src/intelligence/`, `SmartDriveService`, routes `SmartDrive` / `SmartDriveStop`).
The route and type names stay as they are so no import, test or saved data
changed; only what people read became "Orbit Assist". The engine design is in
[`SMART_DRIVE.md`](SMART_DRIVE.md).

This page says what is real, what is simulated, and what still needs an
integration. Nothing here is a mock-up presented as live.

## The two modes

| | **Guided** | **Orbit Assist** (default) |
|---|---|---|
| Plans the route's charging, picks a stop and a backup | yes | yes |
| Tells you when the stop is coming up, when a charger is unusable, when the battery is low, about payment and going offline | yes | yes |
| Volunteers "we found a better charger", "your charger is getting busy", "options are limited" | **no** (held back, and written to the "what we chose not to say" ledger) | yes |
| Changes your plan, pays or starts charging without you | never | never |

The difference is implemented in the pure engine (`GUIDED_HOLDS_BACK` in
`src/intelligence/notifications.ts`) and covered by scenario tests
(`__tests__/intelligence/mode.test.ts`): the same events produce the same plan in
both modes, and only what is *volunteered* differs. Preferences saved before modes
existed have no `mode` and behave as Orbit Assist, exactly as before.

Where to choose: the Orbit Assist planner ("How should we help?") and
**Profile → Trip preferences**. Home shows the current mode and links to it.

## Where it shows up

| Place | What you see |
|---|---|
| **Home** | Orbit Assist panel: state (Ready / Active / Setup needed / Off / Battery low), the one calm line, the mode, one button |
| **Home → "Where are we going?"** | The destination you type is handed to the planner |
| **Trips** | Orbit Assist card (plan a journey, or open the trip in progress) |
| **Orbit Assist** (`SmartDrive`) | Before a trip: mode, destination, battery, reserve, **Start journey**. During: status, ETA, arrival battery, whether charging is needed, the stop and its backup, "Why this charger?" |
| **Map** | While a trip is on, a compact panel over the map; tap to expand, tap "Open trip" |
| **Notifications** | Orbit Assist messages with their level (*Coming up / Plan changed / Needs attention*) |

## Capability map (brief §7.4)

| Capability | Status | Data it runs on | Needs for real use |
|---|---|---|---|
| Battery-aware charging recommendations | **Built** (deterministic engine) | Battery you typed or the model's estimate; mock chargers | Real charger feed; real battery (OEM/OBD) |
| Smart charging stop + backup | **Built** | Mock charger world | Operator/CMS availability feed |
| Recalculation when things change | **Built** for the *charging plan* along a fixed route | Mock charger status over time | Live route/traffic: **not integrated** (the route is a fixed polyline) |
| Alternative charger recommendations | **Built** (`better_charger`, "other safe options") | Mock | Operator feed |
| Low-battery warnings | **Built** (`battery_critical`, Home alert) | Battery reading | none beyond a trustworthy battery source |
| Charging reminders | **Built** (`stop_approaching`, `stop_imminent`, `near_charger`) | Simulated position | **GPS/background location**: not integrated |
| Estimated arrival battery | **Built** (as a band, never a single false-precise number) | Battery + consumption model | Real consumption data would sharpen it |
| Charging-completion notices | **Built** (`enough_charge`, `ready_to_continue`) from the existing charging flow | Simulated meter | OCPP/CMS meter values |
| Missed charging stop | **Partly**: planning continues from your new position and the passed charger drops out. There is **no dedicated "you missed it" message** | Simulated position | GPS to detect it for real |
| Trip summary / history | **Partly**: each finished trip stores prediction vs reality, and Home shows the latest. There is **no trip-history list screen yet** | Stored on the phone | A history screen |
| Push notifications | **Not built**: messages are in-app only | — | Push provider + a server watching trips |
| Background monitoring | **Not built**: the monitor runs only while the app is open | — | Foreground service / backend |

## What is simulated in this build

Every service is the mock layer (`createMockServices`). Concretely:

- **Charger status, queues and prices** are sample data. Some sample chargers
  carry a fresh "operator feed" so the **LIVE** label can be demonstrated; it is
  not a real feed. The app says so: **"Demo data"** on the map and Home, and
  **"Preview data"** on the planner. One flag controls this:
  `RUNS_ON_DEMO_DATA` in `src/services/index.tsx`. Set it to `false` only when
  real services replace the mock ones.
- **Your position during a trip** is a simulated drive (labelled *Demo drive
  (simulated)* on the trip screen), not GPS.
- **Navigation** opens Google Maps through a URL. There is no in-app turn-by-turn.
- **Vehicle connection** is not live: see the integrity note in the project
  report. By default connecting a car reports that it is not available yet;
  battery is entered by hand.

## Rules that do not change

- You approve every plan change, payment and charging start. Remote start still
  requires a validated payment method and a successful pre-authorisation, and only
  on a charger PlugOrbit controls.
- "LIVE" appears only from a fresh operator feed; everything else is Estimated,
  User-confirmed or Unknown, with its age.
- Every recommended stop has a backup, or says plainly that it has none.

## Integration checklist for real operation

1. Charger status/price feed with timestamps (OCPI/OCPP CMS, or operator APIs).
2. Real routing and traffic (Directions/Routes API) feeding `routeService`.
3. Background location and a place to run the monitor (device service or server).
4. Push delivery (FCM/APNs) for the notifications the engine already decides on.
5. A battery source: OEM cloud account or Bluetooth OBD.
6. A trip-history screen over `smartDrive.outcomes`.
