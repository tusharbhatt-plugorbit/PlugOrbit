# Physical phone performance investigation ? 2026-10-13

## Findings
- Motorola connected physical phone recorded two foreground application crashes at 15:12:42 and 15:15:35. Android exit-info classified both as APP CRASH(EXCEPTION), not a foreground low-memory kill.
- Crash: java.lang.NullPointerException: Listener must not be null. The geolocation package passed its mutable single-request callback slot to removeLocationUpdates after another callback had cleared it.
- Baseline memory: PSS approximately 256 MiB, RSS approximately 383 MiB. This snapshot alone does not prove a memory leak.
- Baseline accumulated native-frame stats: 2,531 frames; 37 janky frames (1.46%); p95 20 ms; 1,115 high-input-latency events. This mixed session is not a controlled before/after benchmark or a JS tap-to-screen latency measurement.

## Changes
- GPS callback removes its own listener instance and clears the shared slot only when it still owns it. Duplicate or late callbacks cannot remove a null or newer request listener. Persistent, idempotent postinstall patch fails visibly if the upstream source changes.
- Navigation memoizes screen components and EntryContext values, and scopes hidden-screen navigation state. Inactive tabs keep state without rerendering for unrelated navigation changes.

## Validation
- TypeScript pass. 37 targeted location, Smart Drive screen and hidden-tab render regression tests pass.
- ARM64 release native/JS build passes; installed on the physical phone preserving data.
- Android cold activity launch reported 383 ms (not full React screen readiness).
- New process stayed alive after installation; collected crash buffer contained the old crashes only.
- Phone was locked during attempted physical tab/GPS retest. Repeated foreground GPS and tab switching are still required; no complete device latency improvement is claimed yet.

Upstream related report: https://github.com/michalchudziak/react-native-geolocation/issues/360

## Follow-up device retest
- Six tab actions were followed by UI captures confirming PlugOrbit remained visible; three Home GPS refresh actions completed. Process ID stayed unchanged; no new fatal exception recorded.
- Mixed tab/GPS sample: 106 rendered frames, 14 janky (13.21%), p95 42 ms, p99 97 ms, 55 high-input-latency events.
- Warmed tab sample: 12 additional tab taps, confirmed return to Home, unchanged process; 139 frames, 33 janky (23.74%), p95 36 ms, p99 46 ms, 137 high-input-latency events. Frame stutter remains measurable; do not claim all lag eliminated. Different workloads make these percentages unsuitable for a direct before/after improvement claim.
- A previous unverified capture showed a Truecaller overlay. The guarded retest checked app UI to avoid treating overlays as app failures.
- Home previously destroyed/recreated its native map when leaving/returning, and reloaded station data on every focus. The updated build retains the map and reuses results for the same vehicle for 60 seconds; explicit refresh and vehicle changes still reload.
- 71 targeted tests pass; TypeScript and updated ARM64 release build pass. The cache regression verifies both reuse and expiry. Updated APK installed on phone.
- Temporary screen timeout/USB-awake settings were restored after each profiling run.
