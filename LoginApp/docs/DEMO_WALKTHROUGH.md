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
   If the phone is far from Delhi/NCR the app shows demo chargers around New
   Delhi and says so ("No chargers near you. Showing demo chargers around New
   Delhi."), so the demo works from any city.
3. First run only: add the car (Vehicle setup → pick Tata Nexon EV) and set the
   battery to about 60% (Current battery).
4. Reset between rehearsals: **Profile → Presenter tools → Reset demo data**.

Charging runs 20× faster than real time (`DEMO_TIME_SCALE` in
`src/domain/charging.ts`), so a full stop takes under a minute.

## The story (happy path, about 3 taps from Home)

| # | Do | What to point out |
|---|----|-------------------|
| 1 | **Home → Chargers around you** (the map): the "Best nearby" card | Only chargers that fit the Nexon are shown. LIVE appears only on PlugOrbit-integrated stations with a feed under 5 minutes old; every other station says Estimated or User-confirmed. Prices always read "(estimated), updated N ago" until an operator price feed exists. |
| 2 | Tap **Directions** | Navigate screen with "Status watch ON": we alert you and move you to the backup if the charger changes. |
| 3 | **I've arrived — scan charger** → **Simulate scan** | The scan picks the exact connector. (No camera module in the prototype; Simulate scan stands in for the decode.) |
| 4 | **Authorise & start** | Remote start only appears because this station is PlugOrbit-integrated and a payment method is validated; a pre-authorisation hold is shown. |
| 5 | **Active session** | Ring, energy, elapsed, cost so far, time to target. Meter is labelled *Estimated meter* until a CMS feed exists. |
| 6 | **Stop charging → Stop & pay** | One bill: energy × rate + 18% GST. |
| 7 | **Pay** | UPI is the default. Receipt shows the same figures. |
| 8 | **Rate this stop** | Did it work? Rating, and "confirm for the next driver". Reliability is organic; sponsorship never changes ranking. |

## The co-driver story (about 4 minutes)

This is the headline demo: PlugOrbit handles the charging while you drive.

1. **Home**: Tata Nexon EV at 72%. One calm line, "You're good to drive."
   Point out that nothing else competes for attention.
2. Tap **Where are we going?**, choose Delhi → Jaipur, then **Find best route**.
3. **Trip summary**: route confidence with reasons, total time (driving +
   charging), total cost, the planned stop *and its backup*. Tap **Start trip**.
4. **Smart Drive** opens. Turn on **Auto-drive** under *Demo controls* (or tap
   **Drive 20 km** / **Skip to the reminder**). The car moves; the screen stays
   calm until it matters.
5. **"Charging stop in N km."** arrives as a quiet reminder with the arrival
   battery and charge-to level. No action needed.
6. Tap **Make my charger occupied**. Within a few seconds PlugOrbit notices the
   planned charger is filling up, checks the backup *from where the car is now*
   and offers **Switch route**. Mention the rule: a short wait would not move you.
   (Alerts → *Switch automatically* does it without asking.)
7. **Switch route**. The trip is kept; the new stop, its status and the reason
   are shown. Tap **Stay with ...** instead to see the choice is remembered.
8. **Drive to the charger** → **Scan charger QR** → **Simulate scan** → start →
   pay → the charging card. At the target: **"You're ready to continue."**
9. Keep driving to the destination: the arrival summary shows stops, energy,
   time charging and cost. **Finish trip**.
10. Optional, any time: **Go offline**. The screen becomes **OFFLINE TRIP MODE**,
    statuses read *Estimated* with "last seen", and the saved plan (stop, backup,
    how to start, who to ask) is one tap away. **Back online** restores it.

Also try **Battery critical** on Home with the battery at 8%: one charger, the
reason, a backup, and price nowhere in the reasoning.

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
50 routes.

**Restart recovery:** start a session, kill the app, reopen it. You land back on
the live session. Same for a stopped session awaiting payment and for a failed
payment. This is the "interrupted flow recovers after restart" rule.

## If something goes wrong on stage

- A switch is left on: Presenter tools → Reset demo switches.
- Map is grey/blank: no Google key, a key restricted to a different package or
  SHA-1, or no network. Chargers still list in Nearby chargers and on the cards;
  carry on from the list.
- Anything odd with saved state: Presenter tools → Reset demo data.
