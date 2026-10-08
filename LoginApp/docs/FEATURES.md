# PlugOrbit: feature guide

**You drive. We handle the charge.**

PlugOrbit is an EV charging co-driver for India. It is not a charger map. It
looks after the whole journey: it checks your battery, plans where to charge,
keeps a backup ready, watches the charger while you drive, tells you only when
you need to act, and keeps working in a dead zone.

This guide describes every feature in the app, how it behaves, which parts are
real code and which run on mock data, and what is still waiting on an outside
system. For how the code is organised see `ARCHITECTURE.md`; for what changed in
each build see `HANDOFF.md`; for a rehearsal script see `DEMO_WALKTHROUGH.md`.

> **Everything runs on the mock service layer.** No charger operator, payment
> gateway, OEM or push service is connected. The logic is real and tested; the
> data underneath it is demo data. Section 12 lists exactly what each service
> needs before it can go live.

Contents

1. [The product in one minute](#1-the-product-in-one-minute)
2. [Truth rules the app never breaks](#2-truth-rules-the-app-never-breaks)
3. [Home: intent first](#3-home-intent-first)
4. [Plan a trip](#4-plan-a-trip)
5. [Smart Drive](#5-smart-drive)
6. [The decision engine](#6-the-decision-engine)
7. [Confidence and transparency](#7-confidence-and-transparency)
8. [Backup chargers and switching](#8-backup-chargers-and-switching)
9. [Charging, paying and the receipt](#9-charging-paying-and-the-receipt)
10. [Offline trip mode](#10-offline-trip-mode)
11. [Notifications](#11-notifications)
12. [Services: real, mocked, pending](#12-services-real-mocked-pending)
13. [Every screen](#13-every-screen)
14. [Edge cases and what the driver sees](#14-edge-cases-and-what-the-driver-sees)
15. [Tunable numbers](#15-tunable-numbers)
16. [Known limits](#16-known-limits)
17. [How it is tested](#17-how-it-is-tested)

---

## 1. The product in one minute

A driver opens the app and sees one calm sentence about their car, such as
**“You’re good to drive.”** They say where they are going. PlugOrbit works out
whether they need to charge, picks the stop and a backup, and starts watching.

While driving, the app stays quiet. If the planned charger fills up or goes
offline, PlugOrbit works out whether the backup is better *from where the car
is now*, and if so asks for one tap: **Switch route**. At the charger it hands
over to scan, pay and charge, then tells the driver when they have enough to
continue.

The design rule behind every screen: **the driver should not have to think about
charging.** Fewer taps, fewer numbers, plain words, and no alarm unless it is
warranted.

## 2. Truth rules the app never breaks

These are enforced in code (`src/domain`) and covered by tests. They exist so
the app can be trusted at 80 km/h.

| Rule | How it shows up |
|------|-----------------|
| **LIVE only from a fresh operator feed.** | The LIVE badge needs a PlugOrbit-integrated station whose feed is under 5 minutes old. Everything else is *Estimated*, *User confirmed* or *Unknown*, with its age. |
| **Cached is never live.** | Offline, even an operator’s last status is shown as *Estimated* with “last seen N ago”. |
| **Every status and price shows when it was last updated.** | `ConfidenceBadge`, `PriceLine`, `timeAgo`. |
| **No invented numbers.** | No fake percentages, no made-up predictions, no invented phone numbers or parking fees. Where we do not know, the screen says so. |
| **Charge Confidence is a level, not a percentage.** | High / Medium / Low with the reasons. A percentage is only allowed after 30 real sessions exist, and none do yet. |
| **Wait times are a range with a confidence label.** | Never a single false-precise minute count. |
| **Every recommended stop has a backup.** | If no compatible charger is close enough, the screen shows an explicit warning instead of a far-away or empty backup. |
| **Incompatible chargers are hidden** for the active car by default. | Charger kW and car kW are compared; the slower one wins. |
| **Sponsorship never changes ranking.** | It is not an input to any score. A “Sponsored” pill is the only effect. |
| **Price never beats reaching a working charger.** | Price is not part of the battery-critical weights at all. |
| **Remote start needs a validated payment method and pre-authorisation, on a PlugOrbit-controlled charger.** | On any other charger the app shows the operator’s own start instructions and never pretends to control it. |
| **Raw errors never reach the driver.** | `describeError` turns failures into plain sentences with a next step. |
| **Interrupted flows recover after a restart.** | The active trip, session, payment and offline snapshot are persisted and restored. |

## 3. Home: intent first

`screens/home/HomeScreen.tsx`

Home is a decision surface, not a map. The map is one tap away (**Chargers
around you**).

* **Car card**: the active vehicle and battery level, with where the reading
  came from (you set it, or an estimate along a trip).
* **Status sentence**: calm and specific, from `domain/battery.ts` and
  `domain/tripStatus.ts`. By battery: “You’re good to drive.”, “You’re good for
  now.”, “Charging recommended before your trip.”, “Battery is low. We’ve found
  the safest charging option.” During a trip: “Your trip is on track.”,
  “Charging stop in 38 km.”, “You’re at <charger>.”, “Charging at <charger>.”,
  “You’ve arrived in <city>.” It appears once on the screen, not repeated in the
  cards below it.
* **Where are we going?** A single field that opens Plan a trip.
* **Quick actions**: **Plan a trip**, **Charge nearby**, **Battery critical**.
  Each one is an *intent*, and the decision engine weighs factors differently
  for each (section 6).
* **Trip in progress**: when a trip is active, Home shows the live Smart Drive
  card instead of asking where to go.
* **Recent trip**: “Plan it again” in one tap.
* **Notifications bell** with an unread dot.

Home covers the empty states too: no car yet (add one), no battery reading (set
it), and location denied (search by place).

## 4. Plan a trip

### Plan a trip (`RoutePlanner`)

From, To, current battery and a safety reserve. The planner works out the stops
needed, the battery on arrival at each, how long to charge, and a backup for each
stop. Errors are specific: unknown battery, no compatible charger on the way,
route not found.

### Trip summary (`TripSummary`)

The “should I go?” screen, before the trip starts:

* **Route confidence** (High / Medium / Low) with up to four reasons: battery
  margins at each stop, whether every stop has a backup, the longest gap between
  chargers, how trustworthy the stop statuses are.
* **Total trip impact**: driving time + charging time + any wait = total time,
  and how much longer than a charge-free drive. One number the driver can plan
  around.
* **Total cost breakdown**: energy and GST from the connector’s published
  ₹/kWh, the expected idle fee (₹0 only because the plan assumes you unplug at
  the target), and the total. Parking is **not in any feed we have**, so where a
  station lists parking it reads *Not published*, never ₹0. A connector with no
  published price reads “Price not published.”
* **Each stop** with its backup, arrival battery and charge target.
* A comparison of **fastest / cheapest / PlugOrbit’s pick** appears only when the
  options really differ. When they are the same, there is no table.
* **Start trip** begins Smart Drive. If a trip is already running, the app asks
  before replacing it.

### Also in Trips

Route result (the full map and stop list), Energy planner (battery at every point
against the reserve), Multi-stop, Saved routes, Trip preferences (safety
reserve, route strategy, avoid paid parking, prefer stops with amenities),
Reservation, Queue, and Cost calculator.

## 5. Smart Drive

`screens/trip/SmartDriveScreen.tsx`, `domain/tripEngine.ts`, `app/TripMonitorHost.tsx`

Smart Drive is the trip in progress. It is on by default when a trip starts and
can be switched off in one tap.

**What it monitors**

* Route progress and the battery along it.
* The planned charging stop: its status, queue and trust.
* The backup for that stop.
* Connectivity. With no signal the trip flips to offline mode and keeps its plan.

**What the screen shows** (one primary item at a time)

| Situation | The screen leads with |
|-----------|-----------------------|
| Driving, plan holds | A calm status, the next stop and distance, the backup, “Smart Drive is on”. |
| Stop coming up | “Charging stop coming up”, with the reminder distance you chose. |
| A better stop is waiting | The switch card: what changed, what it costs, **Switch route**, **Stay with <charger>**. |
| At the charger | Scan QR / Open charging, and “Status differs? Use my backup”. |
| Charging | The charging card, with the energy added and time left. |
| Enough battery | **“You’re ready to continue.”** with the battery and what it is enough for. |
| Destination | Arrival summary: stops, energy added, time charging, charging cost. |
| Offline | **OFFLINE TRIP MODE**: “You’re offline. We’ve kept your charging plan available. Last updated N ago.” |

**Controls**: Smart Drive on/off, correct the battery (“Battery not right?”),
saved plan for dead zones, alert settings, End trip.

**How the app watches.** `TripMonitorHost` refreshes statuses every 8 seconds
while a trip is open. It lives at the top of the app, so watching continues
whichever tab you are on. It does nothing when no trip exists.

**Demo controls** (Smart Drive screen and Presenter tools): *Auto-drive* moves
the car along the route by itself; *Drive 20 km*, *Skip to the reminder*, *Drive
to the charger*, *Make my charger occupied*, *Go offline*. A real GPS feed would
call the same `trip.advance(km)` method.

**The ActiveTrip model** (`domain/activeTrip.ts`) holds: route, vehicle, phase
(`driving` / `at_charger` / `charging` / `arrived` / `ended`), monitoring status
(`monitoring` / `switch_available` / `offline` / `idle`), position, projected
battery, each stop with its backup, any pending switch, declined switches, the
event log, and the delivery bookkeeping. It is plain data, so it persists and
survives an app restart.

**The engine is pure.** `tripEngine.ts` takes `(trip, event)` and returns
`(new trip, events)`. The service layer is only I/O around it, and screens read
the store. That is why the whole journey is testable without a UI.

## 6. The decision engine

`domain/recommendation.ts` (the engine), `services/mock/recommendationService.ts` (the service)

PlugOrbit answers “which charger should *this driver* use *right now*?”, not
“what is nearby?”.

**Hard gates first.** A charger is dropped, with a recorded reason, if it is:
incompatible with the car, has unconfirmed connectors, is out of service, will
be closed on arrival, cannot be reached on the battery, or cannot actually
charge this car.

**Then the PlugOrbitScore**: a weighted sum of 0–1 factors, scaled to 0–100.
The weights depend on what the driver is doing:

| Factor | Plan a trip | Charge nearby | Battery critical |
|--------|:-----------:|:-------------:|:----------------:|
| Reach (arrive safely) | gate | gate | **30** |
| Reliability | **22** | 18 | **22** |
| Detour | **18** | 8 | – |
| Availability | 16 | **20** | 18 |
| Distance | – | 14 | 14 |
| Speed (car kW vs charger kW) | 12 | 14 | 8 |
| Freshness of data | 8 | 8 | 6 |
| Wait | 8 | 8 | – |
| Price | 6 | 6 | **absent** |
| Faults | 5 | 4 | 2 |
| Amenities | 3 | – | – |
| Opening hours | 2 | – | – |

In **Battery critical** the order is *Reachability → Reliability → Availability
→ Distance → Speed*, and price is not considered. The arrival floor is also
lower (2%) so a charger a little further away is still reachable.

**Vehicle-specific charging** (`vehicleCharging.ts`): the real charge rate is the
lower of the charger’s kW and the car’s own curve, which slows above roughly 80%.
A 120 kW charger does not make a 50 kW car faster, so it is not scored as if it
did. Charge time and average kW come from integrating that curve, not from a flat
guess.

**Output**: one primary, one backup, the ranking, the exclusions with reasons,
and a short plain-language reason built from the strongest factors that actually
favoured the pick (so it is always true of the data, never boilerplate).

## 7. Confidence and transparency

### Charge Confidence (`chargeConfidence.ts`)

“How sure are we a charge here will simply work?” A level (**High / Medium /
Low**) and up to four reasons, strongest first, for example *“Status confirmed
live 2 min ago”*, *“Operator link is integrated”*, *“One bay out of service”*.
Inputs are things the station record actually carries: status trust and age,
reliability and successful-session figures, bays out of service, how the charger
is started, and recent driver confirmations. Whether a bay is free is a separate
fact and is **not** an input.

### Route confidence (`routeConfidence.ts`)

Same idea for the whole trip. High reads “You’re set for this trip.”, Medium
“This trip works, with a few things to watch.”, Low “This trip is tight. Charge a
little first if you can.”

### Status transparency

Every charger status carries a source and an age: **LIVE** (fresh operator
feed), **ESTIMATED**, **USER CONFIRMED**, or **UNKNOWN**. A stale LIVE feed is
demoted. On the map and in lists, grey means unknown, amber occupied, red
offline.

### Predicted availability at arrival (`arrivalOutlook.ts`)

“Is it free now?” and “will it be free when I get there?” are different
questions. Phase 1 answers the first and adds a rule-based **risk note** when
“free now” is fragile (one bay left, a feed that is not live, a long drive). It
is not a probability and is never worded like one.

For the second, the data model has a `PredictedAvailabilityAtArrival` slot
(probability, ETA, basis, confidence) and a pluggable `AvailabilityPredictor`,
but **no predictor ships**: the default returns nothing, so no screen can claim a
forecast that does not exist. A real occupancy model replaces that one default
and nothing else changes. The Forecast screen says “Not enough history yet” and
“We only forecast when we have past sessions for this charger.”

## 8. Backup chargers and switching

**A backup for every stop.** `pickBackup` chooses a compatible, reachable
charger within 40 km of the primary and no more than 30 minutes extra. If two are
close in score it prefers a **different operator**, so one operator’s outage
cannot take out both. If none qualifies, the stop says so.

**When PlugOrbit suggests a switch** (`decideSwitch`)

| Primary is… | Backup is… | Result |
|-------------|------------|--------|
| Fine | – | Stay. |
| Offline | Usable and reachable | Suggest the switch. |
| Occupied, no queue information | Usable and reachable | Suggest the switch (an unsized wait is a gamble). |
| Occupied, wait **under 8 min** | – | **Stay.** A short wait never justifies moving. |
| Occupied, long wait | Cheaper to reach plus wait by 2+ min | Suggest the switch, saying how many minutes it saves. |
| Unconfirmed / unreliable | **Live** status, hop of 10 min or less | Suggest the switch. |
| Anything | Itself unusable or unreachable | Stay. A bad backup is never offered. |

The cost of switching is worked out **from where the car is now**
(`switchCost`), not the planner’s worst case. A backup still ahead on the road
costs almost nothing; one already passed costs the detour back, and the battery
and km are re-anchored accordingly.

**The switch flow**: the notification and Smart Drive card say what changed, the
Backup Charger screen compares the two, and **Switch route** moves the trip to
the backup without losing it. The driver can also choose **Stay with <charger>**;
PlugOrbit remembers and does not offer the same move again.

**Automatic switching** is off by default. If the driver turns it on (Alerts →
*Switch automatically*), Smart Drive moves to the backup without asking and tells
the driver straight away. If the move cannot be made safely it falls back to
asking.

## 9. Charging, paying and the receipt

The classic flow, kept, and now connected to the trip:

1. **Scan charger QR** (`ScanQr`) picks the exact connector. A manual charger ID
   is the fallback when the camera is denied. *Simulate scan* stands in for QR
   decoding in this build.
2. **Start charging** (`StartCharging`): connector and payment confirmed. If
   PlugOrbit controls the charger, remote start runs after pre-authorisation. If
   not, the operator’s start instructions are shown.
3. **Active session**: ring, energy, elapsed time, cost so far, time to target.
   The meter is labelled *Estimated meter* until an operator feed exists. When
   the session belongs to a trip, the trip’s phase moves to `charging` and then,
   at the target, to “You’re ready to continue.”
4. **Stop and pay**: one bill, energy × rate + GST. UPI is the default.
5. **Payment failure** keeps the session and offers another method.
6. **Receipt**, **Session detail**, **Feedback** (“Did it work?”), and **Report a
   problem** for anything that went wrong.

**Payments without a mandatory wallet.** The driver never has to top up. UPI
(the default), cards (Luhn-checked, brand detected) and an optional wallet are
supported methods, with a pre-authorisation hold shown before remote start. The
Plus plan is optional.

## 10. Offline trip mode

`screens/trip/OfflineModeScreen.tsx`, `domain/offlineTrip.ts`

When a trip starts, PlugOrbit saves a **snapshot on the phone**: the route, the
primary stop and the backup, and for each of them:

* connector to use and its power;
* last-known status and its age;
* last-known price and its age;
* **how to start** (the operator’s QR / app / card instructions);
* **who to ask**: “use the helpline printed on the charger” plus the operator’s
  name, and where PlugOrbit support lives once there is signal. No phone number is
  ever invented;
* coordinates, so any maps app can give directions.

When the network drops, Smart Drive shows **OFFLINE TRIP MODE**, “You’re offline.
We’ve kept your charging plan available. Last updated N ago.” Statuses are shown
as *Estimated* with “when last seen”, never LIVE. The screen retries every 15
seconds (switchable) and says when signal returns. If the planned charger turns
out to be unusable and the phone has no signal, switching waits for signal rather
than guessing.

The snapshot is refreshed whenever statuses refresh, and cleared when the trip
ends.

## 11. Notifications

`domain/coDriver.ts`, `store/tripDelivery.ts`, `store/tripEvents.ts`

Every message PlugOrbit can say during a trip is built in one place, so the tone
is calm and testable.

| Level | Meaning | Examples |
|-------|---------|----------|
| **Informational** | Nice to know; never interrupts | “You’re good to drive.” |
| **Action** | A decision is useful soon | “Charging stop in 38 km.” with the arrival battery, charge-to level and time |
| **Important** | Your plan changed | “<Charger> is filling up. We’re checking your backup.”, “<Charger> just went offline.” |
| **Critical** | Rare and urgent | A very low battery: “About N% left. We’re guiding you to the closest working charger.” |

**Delivery** depends on level and the driver’s *How much should we tell you?*
setting (Alerts):

| Mode | Informational | Action / Important | Critical |
|------|---------------|--------------------|----------|
| **Calm** (default) | stays on the trip screen | inbox + brief message | inbox + message |
| **Everything** | inbox only, never pops up | inbox + brief message | inbox + message |
| **Urgent only** | nothing | nothing | inbox + message |

An event is delivered **once** (its key is remembered), and a second critical
alert inside **5 minutes** reaches the inbox but does not pop up again. The
reminder distance (20 / 40 / 60 km) is also a setting.

Events: trip started, stop upcoming, approaching, availability changed, switch
suggested, stop changed, charging started, enough charge, ready to continue,
destination arrived, battery critical, no reliable charger, offline, back online,
plan updated.

> Notifications appear **in the app** in this build. Delivering them while the
> app is closed or the phone is locked needs the push service (APNs / FCM),
> which is not connected. The Alerts screen says so.

## 12. Services: real, mocked, pending

Screens never import a mock. They call the typed interfaces in
`src/services/types.ts`; `services/index.tsx` supplies the implementation.

| Service | What is real | Mocked | Needed to go live |
|---------|--------------|--------|-------------------|
| **vehicle** | Catalogue, compatibility, charge curves, battery edit | Catalogue data | OEM / telematics API for live battery (Auto SoC screen explains) |
| **battery** (`domain/battery`, `socEstimate`) | Levels, estimate along a trip, source tracking | – | Real vehicle connection |
| **station** | Nearby search through **Google Places** when a key is set; compatibility; trust | Status, price, bays, reliability | Operator / CMS feeds or OCPI |
| **route** | Planner, stop selection, geometry, arrival battery, cost | Road distances (straight line × road factor) | Google Routes / Directions |
| **recommendation** | The whole PlugOrbitScore engine, backup choice, comparisons | – | Real reliability history to feed the factors |
| **chargingPlan** | Target, time, energy, 80% cap, headroom | – | – |
| **backup** | Backup choice and switch decision | – | – |
| **tripMonitor** (`trip`) | State machine, watch loop, auto-switch, persistence | Position (demo drive) | A GPS / navigation feed calling `trip.advance(km)` |
| **notification** | Levels, delivery policy, dedupe, inbox, toast | – | APNs / FCM for closed-app delivery |
| **session** | Metering, bill, recovery | The charger link, remote start | OCPP / operator remote start |
| **payment** | Methods, pre-auth flow, failure handling, UPI default | The gateway | Razorpay / PayU or similar |
| **support** | Tickets, report-a-problem | Ticket backend | A helpdesk integration |
| **offlineTrip** | Snapshot, restore, retry | – | – |
| **preferences** | Alerts, Smart Drive, trip, language, privacy | – | Account sync |
| **Maps** | Google Maps SDK and Places wiring, key detection and explanations | – | **Your Google keys** (see README) |

“Real” means the code is the production logic and is tested. It still depends on
real data to be useful on the road.

## 13. Every screen

50 routes, each with a real screen (`navigation/registry.ts`; adding a route
without a screen is a compile error).

**Tabs**: Home, Trips, Charge, Activity, Profile.

**Co-driver (new in this build)**: `Home` (rebuilt, intent first), `Map` (the old
map home, now secondary), `SmartDrive`, `TripSummary`, `ChargePick`.

**Vehicle**: `VehicleSetup`, `Vehicles`, `ManualSoc`, `AutoSoc`.

**Find a charger**: `StationList`, `Filters`, `StationDetail`, `Compare`,
`Saved`, `Community`, `Forecast`, `CostCalculator`.

**Trips**: `RoutePlanner`, `RouteResult`, `BackupAlert`, `Navigation`,
`EnergyPlanner`, `MultiStop`, `TripPreferences`, `OfflineMode`, `Reservation`,
`Queue`.

**Charge**: `ScanQr`, `StartCharging`, `ActiveSession`, `Payment`,
`PaymentFailure`, `Receipt`, `Feedback`.

**Activity**: `SessionDetail`, `Notifications`, `Alerts`, `ReportProblem`,
`Support`, `TicketDetail`, `Roadside`.

**Profile**: `PaymentMethods`, `Language`, `Plus`, `Privacy`, `PresenterTools`.

`ChargePick` is the **Charge nearby / Battery critical** flow: one recommended
charger and a backup, with the reason, instead of a list to read.

## 14. Edge cases and what the driver sees

| Situation | What happens |
|-----------|--------------|
| Maps unavailable / key missing | A clear card explains it and the charger list still works. |
| Location denied | A permission card with search-by-place as the way forward. |
| Weak or no internet | Offline banner; cached plan used; statuses downgraded to Estimated; retry. |
| No compatible charger | An honest empty state with ways forward (widen search, add another connector). |
| Primary becomes occupied | Wait vs backup is compared; a short wait stays, a long one suggests the switch. |
| Primary offline | Suggest the switch at once; critical if there is no reachable alternative. |
| Backup also unusable | Never offered; the driver is told plainly. |
| Charger closed or inaccessible | Excluded by the hard gates, or flagged on the stop. |
| Battery critical | Reachability first; price ignored; the nearest working charger leads. |
| No reliable charger in reach | A critical, plain message; the closest working option is shown first. Roadside assistance is one tap away on the Charge pick screen and in Profile. |
| Remote start fails / link down | Falls back to the operator’s own start instructions. |
| Payment fails | Session is kept; try another method. |
| Trip already running | Asks before replacing it. |
| App killed mid-trip | Reopens into the trip, phase and battery intact. |
| Battery reading is wrong | “Battery not right?” corrects it and re-checks the plan. |
| Declined a switch | Remembered; the same move is not offered again unless the charger goes offline. |

## 15. Tunable numbers

All in code, with the reason beside each. Change them in one place.

| Constant | Value | File |
|----------|-------|------|
| Battery critical / low / watch | 10 / 20 / 35 % | `domain/battery.ts` |
| Max charge-to | 80 % | `domain/chargingPlan.ts` |
| Short wait that never justifies a switch | 8 min | `domain/tripEngine.ts` |
| Backup battery floor on arrival | 5 % | `domain/tripEngine.ts` |
| Approaching radius / arrive radius | 8 km / 0.4 km | `domain/tripEngine.ts` |
| Trip speed used for time estimates | 66 km/h | `domain/tripEngine.ts` |
| Backup max apart / max extra / operator-independence bonus | 40 km / 30 min / 5 pts | `domain/recommendation.ts` |
| Sessions needed before a Charge Confidence % | 30 | `domain/chargeConfidence.ts` |
| Charge Confidence High / Medium thresholds | 72 / 48 | `domain/chargeConfidence.ts` |
| Critical alert cooldown | 5 min | `domain/coDriver.ts` |
| Default reminder distance | 40 km | `domain/coDriver.ts` |
| Watch interval | 8 s | `app/TripMonitorHost.tsx` |
| Offline auto-retry | 15 s | `screens/trip/OfflineModeScreen.tsx` |
| LIVE freshness | 5 min | `domain/trust.ts` |

## 16. Known limits

Honest list of what this build does **not** do.

* **No real data.** Statuses, prices, queues and bays are demo data. Nothing is
  connected to a charger operator.
* **No closed-app notifications.** Alerts work inside the app only.
* **No real GPS or turn-by-turn.** Trip progress is simulated through
  `trip.advance(km)`; navigation hands off to the maps app.
* **No real payment gateway** and no QR decoding (Simulate scan stands in).
* **No predicted availability.** The architecture is there; the numbers are not,
  and the app does not pretend.
* **Charge Confidence has no percentage** by design until real sessions exist.
* **Parking fees and idle fees** are shown only when an operator publishes them.
* **Switching needs signal.** Offline, the app keeps the plan and waits.
* **Native builds were not run here.** The Android and iOS JavaScript bundles
  compile, and everything is tested in Jest and a browser preview, but there was
  no Android SDK or Xcode in the build environment. Test on a device and check
  that map tiles render with your keys.
* **Connector pictures** are simplified drawings; have design confirm them.
* **Phase 2 and 3** (automatic vehicle connection, AI occupancy forecast,
  roadside dispatch, reservation payments) have screens and service interfaces
  but no live backend.

## 17. How it is tested

```sh
npx tsc --noEmit                 # types, strict
npx eslint src __tests__         # lint
npx jest                         # 25 suites, 536 tests
```

| Suite | What it proves |
|-------|----------------|
| `engine.test.ts` | Scoring, gates, weights, battery-critical order, backup choice, vehicle charging, confidence, impact, cost, wording, trust rules |
| `trip.flow.test.ts` | The full journey on the mock services: start, reminder, primary occupied, switch, charge, continue, arrive, offline, restart, declined switch |
| `coDriver.screens.test.tsx` | Home, Trip summary, Smart Drive, Charge pick, Backup alert, Alerts as the driver sees them |
| `coDriver.more.test.tsx` | Cost consistency across routes, backtracking battery cost, unreachable backup, offline snapshot, map pins, the monitor host |
| `crawl.test.tsx` | Every route mounts, every button has an accessible label and goes somewhere valid |
| `theme.contrast.test.ts` | WCAG AA contrast for every text/background pair the screens use |

Beyond Jest, both `react-native bundle --platform android` and `--platform ios`
produce a bundle, and the screens were reviewed as screenshots through a
react-native-web harness (see `ARCHITECTURE.md`).
