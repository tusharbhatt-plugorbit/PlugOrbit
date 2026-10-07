# PlugOrbit showcase: demo walkthrough

A 10-minute script for the showcase. Everything below runs on the mock service
layer, so it behaves the same on every device and with no network.

## Before you start

1. `cd LoginApp && npm install`, then `npm run android` or `npm run ios`.
   - **Add the Google keys from `.env.example` (see the README) and check on the
     actual demo device that the map tiles render.** Without keys the chargers
     still list from built-in demo data, iOS shows Apple Maps, but Android shows
     an empty grey map. A grey map with a key set almost always means the key's
     package name / SHA-1 restriction doesn't match the build you installed.
2. Sign in: any mobile number or email, then any 6-digit code.
3. First run only: add the car (Vehicle setup → pick Tata Nexon EV) and set the
   battery to about 60% (Current battery).
4. Reset between rehearsals: **Profile → Presenter tools → Reset demo data**.

Charging runs 20× faster than real time (`DEMO_TIME_SCALE` in
`src/domain/charging.ts`), so a full stop takes under a minute.

## The story (happy path, about 3 taps from Home)

| # | Do | What to point out |
|---|----|-------------------|
| 1 | **Home**: map and the "Best nearby" card | Only chargers that fit the Nexon are shown. LIVE appears only on PlugOrbit-integrated stations with a feed under 5 minutes old; every other station says Estimated or User-confirmed. Prices always read "(estimated), updated N ago" until an operator price feed exists. |
| 2 | Tap **Directions** | Navigate screen with "Status watch ON": we alert you and move you to the backup if the charger changes. |
| 3 | **I've arrived — scan charger** → **Simulate scan** | The scan picks the exact connector. (No camera module in the prototype; Simulate scan stands in for the decode.) |
| 4 | **Authorise & start** | Remote start only appears because this station is PlugOrbit-integrated and a payment method is validated; a pre-authorisation hold is shown. |
| 5 | **Active session** | Ring, energy, elapsed, cost so far, time to target. Meter is labelled *Estimated meter* until a CMS feed exists. |
| 6 | **Stop charging → Stop & pay** | One bill: energy × rate + 18% GST. |
| 7 | **Pay** | UPI is the default. Receipt shows the same figures. |
| 8 | **Rate this stop** | Did it work? Rating, and "confirm for the next driver". Reliability is organic; sponsorship never changes ranking. |

## Trips

- **Trips → Where to?** (Delhi → Jaipur). At 60% the planner recommends the
  Neemrana stop, arriving at 18% and charging to 70%, with a **backup** station.
- **Energy planner** shows battery at every point against the safety reserve.
- **Backup alert** (Presenter tools → Scenarios → "Make my chosen charger
  occupied") shows the swap to the backup and what changed.
- **Offline highway mode** shows the cached route, chosen stop and backup.
- **Multi-stop**, **Saved routes**, **Reservation**, **Queue** (a wait *range*
  with a confidence label, never a single number).

## Hard states on demand: Profile → Presenter tools

| Switch | What it shows |
|--------|---------------|
| Go offline | Offline banners, cached data kept, retry paths |
| API error | Error state with a Retry that really retries |
| Fail the payment (Next / Always) | Payment failure screen → try another method; the session is not lost |
| Operator link down | "Start at the charger" with the operator's own instructions |
| Location denied | Permission prompt with a manual-search fallback |
| Camera denied | QR screen falls back to manual charger ID |
| No compatible chargers | Honest empty state with ways forward |
| Scenarios → Make my chosen charger occupied | Backup alert and re-route |

Presenter tools also has **Show all screens**, to jump straight to any of the
49 routes.

**Restart recovery:** start a session, kill the app, reopen it. You land back on
the live session. Same for a stopped session awaiting payment and for a failed
payment. This is the "interrupted flow recovers after restart" rule.

## If something goes wrong on stage

- A switch is left on: Presenter tools → Reset demo switches.
- Map is grey/blank: no Google key, a key restricted to a different package or
  SHA-1, or no network. Chargers still list in Nearby chargers and on the cards;
  carry on from the list.
- Anything odd with saved state: Presenter tools → Reset demo data.
