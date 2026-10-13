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
