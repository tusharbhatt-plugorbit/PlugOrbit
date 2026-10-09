# PlugOrbit Smart Drive

> **You drive. We handle the charge.**
> Internally: *PlugOrbit thinks ahead so the driver doesn't have to.*

Smart Drive turns PlugOrbit from a charger finder into a charging co-pilot. The
driver adds a car, says where they are going and drives. PlugOrbit decides
**whether** to charge, **where**, **how much**, and **what to do when the plan
breaks**, and speaks only when something changes what the driver should do.

This document is the reference for the feature: what it does, how it is built,
what is real today, and what still needs a backend, an operator or a model.

- Code: [`src/intelligence/`](../src/intelligence) (the engines),
  [`src/services/mock/smartDriveService.ts`](../src/services/mock/smartDriveService.ts) (the mock service),
  [`src/screens/smartdrive/`](../src/screens/smartdrive) and [`src/ui/smartdrive.tsx`](../src/ui/smartdrive.tsx) (the UI).
- Tests: [`__tests__/intelligence/`](../__tests__/intelligence), [`__tests__/smartDrive.service.test.ts`](../__tests__/smartDrive.service.test.ts), [`__tests__/smartDrive.screens.test.tsx`](../__tests__/smartDrive.screens.test.tsx).
- Demo: **Profile → Presenter tools → "Smart Drive: Delhi to Jaipur at 72%"**.

---

## 1. The experience

```
72% battery, Tata Nexon EV, Delhi → Jaipur.

  "You're good to drive.
   No charging needed right now. We'll tell you before you need to stop."

  ...60 km of silence. It is still checking, and keeps count...

  "Charging stop coming up in 29 km.
   We've selected ChargeZone • Neemrana. Expected battery on arrival: 30%.
   Recommended charge: 30% → 74%, ~16-20 min. Your backup is ready."

  ...Neemrana fills up, a queue forms...

  "We've found a better charging stop.      [ Switch route ]
   Your original charger may still be busy when you arrive. Statiq • Kotputli
   is 72 km ahead on your route, and should save about 32 min."

  ...plugs in...   "Charging started."
  ...at 58%...     "You're at 58%. That's enough for the rest of your trip."
  ...unplugs...    "You're ready to continue."
  ...arrives...    "You've arrived."          (prediction vs reality is saved)
```

Over that whole 282 km trip the driver hears from PlugOrbit about a dozen times
and from the engines hundreds of times. **Silence is part of the product**: the
dashboard shows *"Checked 35 times • told you 3 times"* and a ledger of what the
co-pilot noticed and chose not to say.

### The screens

| Screen | Route | What it does |
|---|---|---|
| Home | `Home` | Approved layout unchanged. One new calm line under the filter chips: the trip's status, or the battery's. Turns red only when the battery is low. |
| Smart Drive | `SmartDrive` | Before a trip: *"Where are we going?"*. During one: the dashboard (status, ETA, journey bar, the one stop and its backup, the ledger). |
| Your charging stop | `SmartDriveStop` | Why this charger, time and cost breakdowns, how it fits **this** car, when you'd arrive, the backup, other safe options, and *Ask PlugOrbit*. |
| Trips | `Trips` | Smart Drive card above the existing planner. |
| Trip preferences | `TripPreferences` | "Smart Drive on", quiet mode, and reviewable preference suggestions. |
| Offline trip mode | `OfflineMode` | Shows the Smart Drive plan with every status honestly aged. |
| Notifications | `Notifications` | Smart Drive messages carry a level pill (*Coming up / Plan changed / Needs attention*). |

Everything reuses `theme.ts`, `Screen`, `Card`, `Pill`, `KeyValue`,
`ConfidenceBadge` and the other kit components. The one addition to the theme is
`amberOnDark` (a token for an amber that already existed as a raw hex).

---

## 2. Architecture: five layers, kept apart

> *Do not build one giant AI function.* No `runEverythingWithAI()`.

```
 Mobile app (collects inputs, shows decisions, receives notifications)
        │  location · battery · destination · events
        ▼
 ┌───────────────────────────── SmartDriveService (the seam) ─────────────────────────────┐
 │  LAYER 1  REAL DATA        domain/ + the World (stations, feeds) a service supplies    │
 │  LAYER 2  SAFETY           safety.ts          deterministic rules, run FIRST           │
 │  LAYER 3  RECOMMENDATION   recommendation.ts  explainable weighted score + reasons     │
 │           + planning       chargingPlan.ts, backup.ts, stopMetrics.ts, battery.ts      │
 │  LAYER 4  AUTOMATION       monitor.ts · notifications.ts · offline.ts · sessionBridge  │
 │  LAYER 5  EXPLANATION      explain.ts         explains, never decides                  │
 └────────────────────────────────────────────────────────────────────────────────────────┘
        ▲                                   │
        └──────── notifications / plan ◄────┘
```

`src/intelligence/` imports **no** React, store or service. Every engine is a
pure function of its input, so the same code can run on the phone, in a
background task or on a server watching thousands of trips. The phone/server
boundary is the `SmartDriveService` interface in
[`services/types.ts`](../src/services/types.ts); today a mock implements it.

### Module map

| Module | Role | Key exports |
|---|---|---|
| `battery.ts` | **BatteryPredictionService** | `socAfterKm` (a band), `safeReachKm`, `socNeededFor`, `driveMinutes` |
| `safety.ts` | **SafetyRuleEngine** | `evaluateStation`, `evaluateArrival`, `evaluateStop`, `evaluateRemoteStart`, `mayClaimLive` |
| `recommendation.ts` | **RecommendationEngine** | `rankStops`, `weightsFor`, `tripImpactMid`, reason codes |
| `chargingPlan.ts` | **ChargingPlanService** | `planCharging` (the one place the engines meet) |
| `backup.ts` | **BackupSelectionService** | `selectBackup` |
| `stopMetrics.ts` | stop time, cost, target, kW | `computeStopMetrics`, `chargeTargetFor`, `stopCostFor` |
| `confidence.ts` | the two confidences | `dataConfidenceOf`, `chargeConfidenceOf` |
| `wait.ts` | wait + availability at arrival | `expectedWait`, `outlookAtArrival`, `AvailabilityModel` |
| `monitor.ts` | **TripMonitorService** | `createTrip`, `processEvent`, `deriveWorldEvents` |
| `notifications.ts` | **ProactiveNotificationService** | `decideNotifications` |
| `offline.ts` | **OfflineTripService** | `buildOfflineView`, `offlineTrust` |
| `explain.ts` | conversation layer | `answerQuestion` |
| `preferences.ts` | **DriverPreferenceModel** | `suggestionsFrom`, `leansOf` |
| `analytics.ts` | **AnalyticsService** | `buildOutcome`, `accuracyOf` |
| `sessionBridge.ts` | existing charging flow → events | `sessionEvents` |
| `status.ts`, `copy.ts` | the headline and the voice | `tripStatus`, `idleStatus`, `PHRASES` |
| `config.ts` | every threshold and weight | `DEFAULT_SMART_DRIVE_CONFIG` |

---

## 3. Layer 2: the Safety Rule Engine

Some decisions must not be left to scoring. These run **before** any ranking, and
the recommendation engine only optimises inside the safe set. A clever score can
never talk the app into an unsafe charger.

| Rule | Code | Notes |
|---|---|---|
| Connector must be known | `CONNECTOR_UNCONFIRMED` | Google Maps chargers with no connector data are never "compatible". |
| Vehicle must fit a connector | `INCOMPATIBLE_CONNECTOR` | |
| Known-offline chargers are never recommended | `CHARGER_OFFLINE` | One dead bay among working ones is fine. |
| Must be reachable, keeping the reserve | `BELOW_RESERVE` / `UNREACHABLE` | Judged on the **pessimistic** edge of the battery band. |
| Must be open on arrival | `CLOSED_AT_ARRIVAL` | Unknown hours are a warning, never assumed open or closed. |
| Backups must be reachable too | (backup.ts) | From the primary, using the reserve but never the last of the battery. |
| Remote start needs valid payment | `evaluateRemoteStart` | Validated method **and** successful pre-authorisation; never on a charger PlugOrbit doesn't control. |
| Stale data is never "LIVE" | `mayClaimLive` | Judged from the feed and the current time, never from a label cached at plan time. |

**Battery-critical mode** (current charge ≤ 15%, or no charger reachable while
keeping the reserve) relaxes only the arrival floor, from the 12% reserve to an
absolute 5%, and swaps the weights to *reachability, reliability, availability,
distance, speed, price*. Preferences are ignored entirely: cheaper never beats
safer.

---

## 4. Layer 3: choosing the stop

### 4.1 Not nearest, not fastest, not cheapest

```
PlugOrbitScore = Σ weight × component          (each component 0-1, shown /100)
components = compatibility · reachability · reliability · availability · freshness
           · routeFit · stopTime · speed · cost · backup · amenities · timing
           · proximity · continuation
```

Weights are configurable (`config.ts`) and reshaped, never overridden, by the
driver's profile (*fastest, cheapest, reliable, comfort*) and the "prefer
amenities" switch. Every pick keeps its components and carries **reason codes**
(`REASON_LIVE_AVAILABILITY`, `REASON_FEWER_STOPS`, ...) which the UI turns into
*"Why this charger?"*; the codes never reach the driver.

### 4.2 Things the testing forced (and why they exist)

These are not tuning knobs; each came from a concrete failure found by running
the scenario on the mock corridor, and each has a regression test.

| Problem found | Fix | Where |
|---|---|---|
| The pick was Manesar at km 45 (arrive 57%): a quick top-up that forces a second stop. | Stops are compared on **whole-trip impact**: their own time plus the stops they force later. | `tripImpactMid` |
| A 7 kW, two-hour stop at the start line with 71% won for a Leaf, outvoted by many small advantages (cheap, close, always free). | A **necessity rule**, not a weight: when charging is required, a stop that adds < 15 points is "too early" while a better-timed safe one exists. It restricts only the *primary*; any safe charger may still be a backup. | `planCharging` (`tooEarly`) |
| Stop time scored against the field let a 248-minute outlier compress everything. | Stop time is scored on an **absolute** scale. | `stopTimeFloorMin/SpanMin` |
| Plans flipped A → B → A on a flickering feed. | **Stability policy**: switch only if a *comparable-quality* charger saves ≥ 10 min (≥ 20 within 5 km), or is clearly better; going back to a charger just left needs twice the bar for 30 min. | `planCharging` |
| Backup churned between near-equal chargers. | A good backup is kept unless another is clearly stronger. | `BACKUP_SWAP_MARGIN` |
| The look-ahead and the charge target disagreed (target 84% on a "can't finish" stop). | Both use the same margin; charging past the 80% comfort cap is allowed only as a flagged last resort. | `estimateStopsAfter` |
| "High charge confidence" on a reading two hours old. | "High" needs fresh evidence; an estimate is at most Medium. | `confidence.ts` |
| "Currently available" said from a cached label. | Derived from the feed and `now`. | `availabilityLine` |
| "Enough charge" fired two points before the target we'd told the driver. | "Enough" uses the same comfort buffer as the target. | `notifications.ts` |
| Screens read a simulated trip against the wall clock ("too far ahead" 5 min from the stop). | `useTripNow` reads trip data against trip time. | `ui/useNow.ts` |

### 4.3 Primary + backup, always

Every planned stop has a backup chosen as a **Plan B**, not "second best": safe
on its own, reachable from the primary, little extra time (≤ 30 min), and ideally
**independent** (different operator and site) so one outage can't take out both.
When none qualifies the UI says so plainly ("No backup nearby, so we're watching
this one closely") rather than hiding it.

### 4.4 Charge just enough

The target is **trip-based**: enough to finish with the reserve and a 4-point
buffer, capped at the 80% comfort cap when another stop follows. The stop screen
quantifies it: *"Stopping at 74% instead of 80% saves about 3 min."* Smart Drive
hands the number to the existing Start charging screen, replacing its default 80.

### 4.5 Total stop time and total cost

```
total stop time = detour + expected wait + charging + back to route      (a range)
total cost      = energy + parking + idle + platform fee + GST           (null if unpriced)
```

Never a partial sum presented as the whole: with no published price the total is
"Price not published". Parking is unknown (no source publishes it), not zero.

### 4.6 Two confidences, kept separate

| | Question | Values |
|---|---|---|
| **Data confidence** | How trustworthy is the status itself? | LIVE · Estimated · User-confirmed · Unknown (exactly `dataTrust`, the app's one gatekeeper of "LIVE") |
| **Charge confidence** | How likely is a smooth stop for this driver? | High · Medium · Low (words, not invented percentages) |

A live feed showing every bay busy is *certain* data and a *low* chance of a
smooth stop.

---

## 5. Layer 4: automation

### 5.1 TripMonitor: events in, plan and messages out

```ts
processEvent(trip, event, {vehicle, world, config}) → {trip, notifications, decisions, events}
```

A pure reducer. Events: `TRIP_STARTED`, `TICK`, `BATTERY_UPDATED`,
`LOCATION_UPDATED`, `CHARGER_STATUS_CHANGED`, `CHARGER_BECAME_OFFLINE`,
`PRIMARY_CHARGER_OCCUPIED`, `BACKUP_BECAME_BETTER`, `ROUTE_CHANGED`,
`USER_NEAR_CHARGER`, `SESSION_STARTED`, `TARGET_SOC_REACHED`, `SESSION_ENDED`,
`PAYMENT_FAILED`, `NETWORK_LOST`, `NETWORK_RESTORED`, `USER_SWITCHED_CHARGER`,
`USER_KEPT_ORIGINAL`, `DESTINATION_REACHED`. Some are inputs; the monitor
derives others by comparing snapshots of the chargers the plan relies on.

On every event it updates state, **re-plans from the new reality**, applies the
stability policy, and asks the notification service whether anyone needs to know.

The `ActiveTrip` model carries the fields in the brief (`tripId … lastRecalculatedAt`),
plus bookkeeping (phase, network, pinned/visited stops, the ledger, counters,
prediction vs actuals, trip clock). It is plain JSON and persists.

### 5.2 Proactive notifications: a calm co-driver

```
internal change → does it change what the driver should DO?
                    no  → stay silent (and write down that we chose to)
                    yes → how urgent? → one message
```

| Level | Meaning | Examples |
|---|---|---|
| INFO | nothing to do | "You're good to drive.", "Your planned charger is getting busy." |
| ACTION | something is coming up | "Charging stop coming up in 29 km.", "You're 5 minutes away." |
| IMPORTANT | the plan changed | "We've found a better charging stop." |
| CRITICAL | safety; rare, capped at 3 per trip | "Battery is getting low." |

Rules that keep it calm: one message per event (the most important wins); each
news item once (dedupe keys and cooldowns); a plan change suppresses the
chatter that would repeat it; nothing about "options are limited" while parked
at the charger; "quiet mode" lets only IMPORTANT and CRITICAL through. What was
suppressed is recorded in the ledger, so nothing is hidden.

Wording is honest: "Your selected connector is **currently** available" only on a
fresh operator feed, otherwise "last reported free 11 min ago".

### 5.3 Offline highway mode

The trip already carries everything needed (route, destination, stop and backup
with connector, hours, last-known price and status). Offline, the plan is
untouched and the monitor holds its choice instead of churning on stale data.
**A cached status is never shown as LIVE**, however fresh the cache.

### 5.4 Availability now vs. at arrival

`outlookAtArrival` answers "likely free when you get there?". It is **rules,
not a model**, and says so: it gets less sure the further ahead it looks and
declines past an hour ("Too far ahead to say"). `AvailabilityModel` is the plug
point for a real model; nothing is predicted before one exists.

---

## 6. Layer 5: the conversation explains

`explainerAnswer`/`answerQuestion` builds answers from the plan's own numbers:

- *Why are we stopping here?* "This station is slightly farther than the closest option, but it has better live availability and ... It should get you back on the road about 12 minutes sooner."
- *Can I skip this charger?* "You can, but the next reliable option would put you at an estimated 8% battery on arrival. I recommend keeping this stop."
- *Find me something cheaper.* "I found an option ₹70 cheaper, but it adds around 18 minutes to your trip. Want me to switch?" (with a one-tap switch)

Today these are templates. A language model can later rephrase the same facts,
but the facts and the safe set stay deterministic: an answer can only offer a
charger that is already in the safe set.

---

## 7. Learning and the feedback loop

- **DriverPreferenceModel**: records which charger you pick versus the
  recommendation. After enough evidence it **proposes** a change ("You usually
  pick faster chargers, make Fastest your default?"). It never applies one: the
  proposal lands in the Trip preferences form for review. It does not touch the
  safety rules.
- **AnalyticsService**: every finished trip stores what was **predicted** at the
  charger next to what **happened** (arrival battery, wait, charge time, cost,
  start success, payment, rating). `accuracyOf` summarises how good the
  predictions are. This is the scoreboard and training data for Phase 3.

---

## 8. What is real, what is mocked, what is future

### Real today (pure, deterministic, tested)

Battery band prediction, the safety rules, the weighted scorer with reason codes,
primary + backup selection, trip-based charge targets, total stop time and cost,
the monitor/event model, the notification policy, the stability policy, offline
honesty, the explanation templates, preference suggestions, the prediction-vs-
reality record, and all UI.

### Mock for now (marked `TODO(integration)`)

| Area | Where | Needed for real |
|---|---|---|
| Charger status over time, queue length | `services/mock/smartDriveService.ts` (`worldAt`) | Operator / CMS feeds; `Station.queueLength` must come from a live feed |
| Where the car is | `SmartDriveService.advance` (simulated drive) | Phone GPS → progress along the route |
| The monitor loop | `app/useSmartDriveRuntime.ts` (on-device timer) | **A backend trip service.** It must keep watching when the app is closed. |
| Delivery of messages | in-app notifications + toast | Push (FCM / APNs) from the backend |
| Route + traffic + weather + elevation | straight-line / Delhi-Jaipur corridor, no traffic | Google Routes (or similar) |
| Battery reading | the model's own estimate, labelled "Estimated on your trip" | OEM cloud or OBD (see `AutoSocScreen`) |
| Payment | existing mock gateway | Gateway pre-authorisation and capture |
| Account id | `userId: 'local-user'` | Signed-in account |

### Future ML (interfaces exist; nothing is faked)

Availability at ETA (`AvailabilityModel`), wait/queue, energy use, charging
duration (a per-car `chargingCurve`), charger reliability, and re-routing. Each
replaces one component or function without changing the contracts.

### Server contract

The service is already shaped as a server API. Sketch:

```
POST /trips                 {from, to, vehicleId, startSoc, prefs}   → ActiveTrip
POST /trips/{id}/events     {type, at, ...}   (location, battery, session)  → TripUpdate
GET  /trips/{id}                                                          → ActiveTrip
POST /trips/{id}/switch     {stationId} · /keep-original · /end
POST /trips/{id}/ask        {question}                                    → CopilotAnswer
```

The backend runs `processEvent` on a schedule and on each event, and pushes
`TripUpdate.notifications`. The engines port as-is (they are pure); the Backend
service (FastAPI) does not yet have these endpoints.

---

## 9. What makes this different

1. **It decides; it doesn't list.** One stop, one backup, chosen for the smoothest stop, not the nearest.
2. **Silence is a feature**, and it is visible: *"Checked 35 times • told you 3 times"* plus a ledger of what it chose not to say.
3. **It thinks about the whole trip**, not one stop: it won't pick a quick top-up that forces another stop.
4. **Honesty is enforced by code**: LIVE only from a fresh feed, ranges not false precision, no prediction before a model exists, cached status never live, and a rule engine no score can override.
5. **A real Plan B**: independent of the primary, reachable from it, and proven so.
6. **It shows its work**: reason codes, what it ruled out and why, a time and cost breakdown, and answers to "why?" built from the same numbers.
7. **It charges just enough**, and tells you the minute you have enough, with the minutes saved.
8. **It learns by asking**, never silently.
9. **It measures itself**: every trip records prediction versus reality.

---

## 10. Running and testing

```sh
npx tsc --noEmit
npx eslint src __tests__
npx jest --maxWorkers=3                 # the full suite (~70 s)
npx jest __tests__/intelligence         # the engines only (fast)
npx jest __tests__/intelligence/scenario.test.ts   # the 25-step scenario
```

The scenario test (`ScenarioDriver` in `src/dev/`) walks the product's first
scenario end to end on mock data: Tata Nexon EV, 72%, Delhi to Jaipur.

Visual QA was done by rendering the real screens with react-native-web in
headless Chromium at 390×844 (see ARCHITECTURE.md §8). That is a layout check,
not a device pass.

## 11. Decisions needed

1. **Thresholds and weights are engineering defaults**, not product-approved
   values: the 12% reserve, 15% critical level, 80% comfort cap, 10-minute switch
   threshold, 25-minute cost of an extra stop, and the weights in `config.ts`.
   They are all in one file; please review.
2. **Auto-switch.** Today a plan change is announced with a one-tap undo. Whether
   PlugOrbit may switch the route without asking (with permission) is a founder call.
3. **Quiet mode default** (`calm` vs `minimal`) and which messages may interrupt.
4. **Where the monitor runs.** The on-device loop is a prototype; production should
   be server-side. This decides the backend roadmap.
5. **Charger-status and queue sources.** `Station.queueLength` is only honoured on a
   live operator feed; which operators can supply it?
6. **Parking fees** are shown as "Not published" until a source exists.

## 12. Known limits

- The route is the mock Delhi-Jaipur corridor; other city pairs are straight lines with no traffic.
- Chargers on the corridor are mock data; the Leaf (CHAdeMO) correctly gets "limited options" there.
- The battery model is coarse (range at 100%, with optional speed/temperature/elevation factors). Real consumption varies.
- Preference learning only records choices made through *Switch* and *Keep*.
- Not verified on a device or emulator (no Android SDK / Xcode here).
