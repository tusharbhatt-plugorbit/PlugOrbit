# Orbit Assist: the conversational AI co-pilot

Orbit Assist can now be talked to. A driver says *"Orbit, Jaipur jaana hai, at least 20%"*;
a language model works out what they mean, calls the app's own verified services to check
the battery, the route, the chargers and the cost, and answers in one or two spoken
sentences. It can propose actions (open the route, switch charger, start the journey), but
the driver approves each one, and it never pays, books or starts charging.

This page is the design, the setup, the costs and, just as important, what is **not**
finished. [`ORBIT_ASSIST.md`](ORBIT_ASSIST.md) describes the deterministic planner this is
built on; [`SMART_DRIVE.md`](SMART_DRIVE.md) is its engine reference.

> **Status in one paragraph.** Everything below is implemented and tested in Jest and
> pytest (1,012 app tests, 200 backend tests). Two things have **not** been exercised in
> this environment and need a real device and a real key before anyone relies on them:
> the live model call (no API key here; the Anthropic adapter was tested through the
> official SDK against a simulated Messages API, not against the real service) and the
> native speech libraries on a phone (no Android SDK or Xcode here). See
> [§12](#12-what-is-not-done-or-not-verified).

---

## 1. What I found in the audit (Phase 1)

| Area | Reality in `main` |
|---|---|
| Backend (`Backend/`) | FastAPI with Firebase auth, OTP login and synced app data. No routing, charger, vehicle or AI code. |
| Chargers, status, prices, queues | **Mock layer** (`src/services/mock`), labelled "Demo data" in the UI. Google Places supplies nearby chargers on the map, with no connectors or reliability. |
| Route planning | Mock planner over a real Delhi–Jaipur corridor; places are a fixed list of eight cities. |
| Vehicle | Car profiles and a typed battery. No OEM/OBD link (the Connect button honestly says so). |
| Orbit Assist (Smart Drive) | A **deterministic engine in TypeScript** on the phone (`src/intelligence`): safety rules, scoring, backup charger, charge target, monitor, notifications with dedupe, plain-language explanations. Well tested. |
| Voice / AI | None. |

Consequences for the design:

1. The data and the deterministic engines live **on the phone**, not in Python. Re-implementing
   them server-side would create a second copy of the battery and charging maths to keep in
   step. So the model's tools run on the phone.
2. Everything is sample data today. The assistant carries that through: tool results are
   labelled `demo`, and the model is told to say "this is preview data" once early on.

## 2. Architecture

```
 Driver ─ speaks / types ─┐
                          ▼
 ┌──────────────── React Native app (LoginApp/src/assistant) ────────────────┐
 │ Voice: mic → OS speech-to-text → partial words → silence endpointing       │
 │ AssistantController  (state machine: idle · listening · thinking · speaking)│
 │   │  POST /assistant/turn  (NDJSON stream, Firebase ID token)               │
 │   │◀── text deltas ──▶ SentenceSplitter ──▶ OS text-to-speech (sentence by  │
 │   │                                         sentence, as they arrive)       │
 │   │◀── tool_requests ──▶ Device tools ──▶ existing services + Smart Drive   │
 │   │──── tool_results ───▶ (explicit ok / unavailable / unknown / error,     │
 │   │                        with source + trust label + assumptions)         │
 │   └◀── actions ──▶ cards the driver approves ──▶ existing screens/services │
 │ ProactiveCoordinator: relays Smart Drive alerts, dedupe, caps, no replays   │
 └────────────────────────────────────────────────────────────────────────────┘
                          │ HTTPS
 ┌──────────── Python AI gateway (Backend/app/ai, additive) ─────────────────┐
 │ auth (existing Firebase dep) · validation · per-user rate limits ·         │
 │ daily token budget · sessions (memory, TTL) · usage metering               │
 │ AssistantEngine: the tool-use loop                                         │
 │   Claude via the official Anthropic SDK (key lives only here)              │
 │   gateway tools: propose_action, update_journey_memory                     │
 │   device tools: handed to the phone, answered in the next request          │
 └────────────────────────────────────────────────────────────────────────────┘
```

**The rule that makes it trustworthy:** the model explains and compares; it never calculates.
Battery, price, availability, route and the charging plan only ever come from a tool result,
and the tools are thin adapters over the same deterministic services the rest of the app
uses. Each result says where it came from (`deterministic_engine`, `device_store`,
`device_gps`, `sample_data`), how far to trust it (`live` / `estimated` / `user` /
`unknown`, using the app's own `dataTrust`), and which assumptions it made (for example
"traffic, weather and elevation are not included").

### Why two HTTP calls per tool round

A plain HTTP stream cannot carry the phone's answer back. So a turn is: the app posts the
driver's words; the gateway streams text and, when the model needs the phone, ends the
stream with `tool_requests`; the app runs them and posts `tool_results` for the same
`turn_id`; the stream continues. The model's own content blocks (including its thinking)
are kept verbatim in server memory for exactly the length of that turn. After the turn only
plain text (what the driver said, what Orbit said) is kept, so every request replays a clean,
append-only history and old tool data is re-checked rather than trusted.

### File map

| Where | What |
|---|---|
| `Backend/app/ai/settings.py` | env configuration, key never leaves here |
| `…/schemas.py` | wire protocol (strict: unknown fields rejected, sizes capped) |
| `…/tools.py` | the tool catalogue, argument and action validation |
| `…/prompt.py` | the fixed system prompt (personality, truth rules, safety rules) |
| `…/providers/` | `LLMProvider` interface, Anthropic adapter |
| `…/engine.py` | the loop: limits, sessions, tool rounds, errors, history compaction |
| `…/router.py` | `/assistant/status`, `/turn`, `/sessions`, `/usage` |
| `LoginApp/src/assistant/gateway.ts` | streaming client |
| `…/tools/` | the 15 device tools |
| `…/controller.ts` | the conversation state machine |
| `…/actions.ts` | what an approved button actually does |
| `…/proactive.ts` | relays engine alerts with dedupe and caps |
| `…/store.ts` | settings, journey memory, remembered preferences |
| `…/voice/` | ports, sentence splitter, endpointing, speech pipeline, native adapters |
| `src/ui/assistant.tsx` | orb, bubbles, action cards, composer, consent |
| `src/screens/assistant/` | full screen, driving mode, settings |
| `src/app/FloatingAssistant.tsx` | floating button and bottom sheet |

## 3. The tools

Only operations backed by real, existing code are exposed. All are read-only. Where
something cannot be known the tool says so (`unknown` / `unavailable`) instead of guessing.

| Tool | Backed by | Honest limits today |
|---|---|---|
| `get_vehicle_status`, `get_battery_level`, `get_vehicle_compatibility` | store, `domain/rules` | Battery is typed by the driver or the app's trip estimate; there is no live car link. A sample vehicle reading is never called live. |
| `get_current_location` | `resolveOrigin` (device GPS) | Rounded to ~1 km. Respects the Privacy switch. The planner needs a *named* start, so GPS does not choose it (the assumption is stated). |
| `get_route_options` | `route.plan` × fastest / cheapest / reliable | Eight known cities; mock chargers. |
| `get_chargers_along_route`, `recommend_charging_stops`, `estimate_route_energy`, `calculate_trip_cost` | `route.plan` / `route.energyPlan` | No traffic, weather or elevation. Prices only where published; unpublished stops are counted separately, never guessed. `avoid_station_ids` and `max_stops` are real inputs/checks. |
| `get_charger_details`, `get_charger_availability` | `station.get`, `waitEstimate`, `dataTrust` | Nothing is called "live" unless a fresh operator feed says so. Waits are ranges with confidence. |
| `get_active_charging_session` | store + `computeSessionMetrics` | The meter is simulated and labelled estimated. |
| `get_user_preferences` | store | Saved settings are kept apart from "remembered" assistant preferences. |
| `get_active_trip`, `explain_plan` | the Smart Drive trip and `answerQuestion` | Position is simulated in this build (stated as an assumption). |
| `propose_action` *(gateway)* | validated server-side | Creates a button. Cannot do anything. |
| `update_journey_memory` *(gateway)* | validated server-side | Stores what the driver *said* about the journey. |

There is deliberately no payment, booking, start/stop-charging, set-destination or
vehicle-control tool. A test asserts the catalogue contains none.

## 4. Reasoning and recommendation logic

* **Intent** is the model's job: "Can I reach Jaipur", "I don't want to stop more than
  once", "change my route to avoid that charger", "why did you pick this station", Hindi and
  Hinglish phrasings.
* **Decisions** are the engine's job. `recommend_charging_stops` returns the stops, the
  battery on arrival at each (against the driver's reserve), charge target and time, detour,
  cost, wait range, a backup, and a `why_this_charger` list built from the stop's own numbers.
  `max_stops` is checked and, if violated, the other priorities' stop counts are returned
  so the model can offer a real alternative.
* **Assumptions are exposed** on every plan-based result (starting battery and its age,
  reserve and where it came from, start place, the consumption model, what is *not*
  included) and shown under the answer ("Based on the trip planner. Preview data.").
* **Follow-ups need no repetition**: the conversation history, the journey memory the model
  records (destination, reserve, priority, stop limit, chosen charger) and the driver's
  remembered preferences travel with each question.
* **Remembered ≠ verified.** Remembered preferences and the journey memory arrive in a block
  labelled unverified; the model is instructed to get battery, location, prices and
  availability from tools every time.

## 5. Voice (Phase 4)

### Provider decision

| | Option 1: speech-to-text → agent → text-to-speech | Option 2: real-time speech-to-speech |
|---|---|---|
| React Native fit | Two small native modules; no audio stack to run | WebRTC/WebSocket audio streaming (`react-native-webrtc` or similar), echo cancellation, a media server relationship |
| Security | No audio ever reaches our servers; the key stays on the gateway | Needs short-lived ephemeral tokens minted by the backend; audio goes to the vendor |
| Tool use | Same Claude loop and the same verified tools | Tools would run through a *different* vendor's model, splitting reasoning across two LLMs |
| Latency | Sentence-streamed speech starts after the first sentence; typically 1–3 s to first word | Lower (sub-second) and natively interruptible |
| Hindi / Hinglish | OS recognisers handle `hi-IN` and `en-IN`; quality is the platform's | Vendor-dependent, unverified |
| Cost | No per-minute fee; only LLM tokens | Audio billed per minute in each direction on top of reasoning |

**Chosen for this release: Option 1.** It is simpler, testable, cheaper, keeps one model and
one set of verified tools, and puts no audio on our servers. Option 2 is the right next step
if first-word latency or true hands-free barge-in becomes the priority, and the seams are
ready for it: `SpeechRecognizerPort` / `SpeechSynthesizerPort` in `voice/ports.ts`, and the
gateway's `LLMProvider`.

| Piece | Library | Notes |
|---|---|---|
| Speech to text | `@react-native-voice/voice` 3.2.4 | Android `SpeechRecognizer`, iOS `SFSpeechRecognizer`. Partial results, volume. **The package is marked deprecated** in favour of `expo-speech-recognition`; see §12. |
| Text to speech | `react-native-tts` 4.1.1 | Android `TextToSpeech`, iOS `AVSpeechSynthesizer`. Ducking of other audio is on. |
| Permissions | `PermissionsAndroid` (RECORD_AUDIO); iOS prompts on first listen | `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` added. |

Both are loaded lazily and defensively. If either is missing or misbehaves, voice reports
"unavailable" and Orbit carries on in text. A watchdog treats a recogniser that says nothing
for six seconds as broken.

### Behaviour

* **Push-to-talk**: tap the microphone to start, tap again (or pause) to send. Nothing
  listens until the driver taps.
* **Live transcription**: partial words appear as they are recognised.
* **End of speech**: the OS may end by itself; Orbit also ends the utterance after 1.4 s of
  silence following speech, and after 25 s regardless.
* **Streaming speech output**: the model's text is split into sentences as it arrives and
  each is spoken at once, so the answer starts before it has finished being written. Text is
  normalised for speech ("12%" → "12 percent", "₹1,200" → "1,200 rupees", "CCS2" → "C C S 2").
  Devanagari text is read with a `hi-IN` voice, everything else with `en-IN`.
* **Interruption**: tapping the microphone (or Stop) while Orbit is thinking or speaking
  cancels the request, stops speech instantly, and (for the mic) starts listening. This is
  tap-based by design: detecting a spoken interruption would need the microphone open while
  Orbit talks, which is the always-listening behaviour the brief says must not happen
  without consent, platform support and an indicator.
* **Controls**: Mute (silence Orbit; replay still works), Text only (never speaks), Replay,
  End conversation, visible microphone permission state with a link to phone settings.
* **Audio session**: ducking of navigation prompts and music while speaking; speech and
  listening stop when the app leaves the foreground; a cancelled utterance (a call, another
  app taking audio focus) drops the rest of the answer instead of reading it out later; a
  recogniser "busy" error is explained. Finer control (explicit `AVAudioSession` categories)
  needs a native module and is **not** implemented; `AudioSessionPort` is the seam.
* **Languages**: *Auto* (follows the driver), *English*, *हिन्दी* (recogniser `hi-IN`, answers in
  Devanagari so the Hindi voice pronounces them), *Hinglish* (recogniser `hi-IN`, answers in
  Roman-script Hinglish; read by the English voice, which handles it passably). Quality is the
  phone's speech engines' and needs checking on real devices.

### "Hey Orbit" wake word: evaluated, not built

It would need the microphone to stay open continuously. That is acceptable only with all of:
explicit opt-in consent, a platform mechanism designed for it, and an always-visible
indicator. Findings:

* **Android**: background microphone use requires a foreground service with a persistent
  notification (visible indicator ✓) and a `microphone` foreground-service type; the stock
  `SpeechRecognizer` is not meant to run continuously. A wake-word engine (on-device, e.g.
  Picovoice Porcupine, which has a React Native SDK and a commercial licence) is the sound
  approach, with the foreground service as the indicator. Battery cost is real.
* **iOS**: background recording needs the audio background mode and shows the system
  recording indicator, is reviewed closely, and is not designed for a wake word that works with
  the screen locked. Siri Shortcuts / App Intents ("Hey Siri, ask Orbit…") is the supported
  route; a foreground-only "Hey Orbit" is feasible.
* **Privacy/consent**: needs its own consent screen, a toggle, a persistent indicator, and
  on-device detection only (no audio leaves the phone until the wake word fires).
* **Recommendation**: ship push-to-talk (done); add an opt-in foreground-only "Hey Orbit"
  using an on-device engine behind the existing `SpeechRecognizerPort` once there is a
  licensing decision and a device test plan. Not started.

## 6. Proactive assistance (Phase 5)

The *what* and *when* of a travel alert is decided by the Smart Drive engine
(`intelligence/notifications.ts`), which already owns thresholds, reserve checks, stop
proximity, charger status, per-trip dedupe, the Guided/Assist split and quiet mode. Orbit
relays those alerts in conversation (`assistant/proactive.ts`) and adds its own policy on
top:

| Event (engine) | Orbit |
|---|---|
| Battery below the reserve at the destination / critical | Speaks it (level `critical`/`important`), with a link to the trip |
| Charger unavailable, backup lost, plan changed | Speaks it, with the engine's own wording ("…Your new stop is …"), link to the stop |
| Approaching / arriving at the planned stop | Short reminder (`action`) |
| Charging target reached | Announced once, **labelled as the app's estimated meter** (the integration is simulated, so it is not described as confirmed) |
| Destination changed | Announced with the new plan; the journey memory follows the trip |

Policy: only `action`/`important`/`critical` are spoken; the same alert is not repeated within
a cooldown (2 min critical, 5 important, 10 action), including across restarts; at most six
spoken alerts an hour (critical exempt); alerts already in the store at start-up or older
than two minutes are never replayed; nothing talks over a conversation in progress (it
queues, and drops after two minutes). The wording is the engine's, built from verified
numbers; no model rewrites a safety alert. A follow-up such as "what are my options?" is
answered by the model, which sees the alert in its context.

The monitor only runs while the app is open: there is no server-side watching and no push
notification yet (see §12).

## 7. Memory and privacy

| What | Where | Kept | Control |
|---|---|---|---|
| Conversation (this session) | Phone (transcript), gateway memory (text only, 30 min TTL) | Not written to disk or Firestore; gone on restart | *Clear this conversation* wipes both; *End conversation* forgets the server copy |
| Journey memory (destination, reserve, priority, stop limit, chosen charger) | Phone, persisted | Forgotten after 6 h without mention | Erase in settings |
| Remembered preferences | Phone, persisted | Only if "Remember my preferences" is on | See, forget one, forget all, switch off |
| Raw microphone audio | Never stored by the app | — | The phone's own speech service may send audio to Google/Apple; the consent text says so |
| AI consent | Phone | Until revoked | "Turn off Orbit's AI" |

Nothing is sent to the AI service until the driver turns it on (first-use consent card). The
assistant store is separate from the app store: none of it joins cloud backup, and no backend
schema or Firestore collection was added. Precise location and car battery data respect the
existing Privacy switches. The usage log records only a hashed user id, token counts and
outcomes, never message text.

## 8. Permissions and autonomy (Phase 8)

| Orbit may | Orbit may not |
|---|---|
| Read the app's own data through tools | Pay, or start a payment |
| Propose a button (`propose_action`) | Start or stop charging |
| Explain, compare, recommend | Book or reserve a charger |
| Remember what the driver says about the journey | Change the destination without a tap |
| Open an existing screen after a tap | Control the car, or claim an unsupported action worked |

Each action card shows exactly one of: **Suggestion** (opens a screen), **Needs your OK**
(changes something: start journey, switch charger, save preference), **Done**, **Didn't
work** or **Not available**. The last three are written by the app *after it tried*, from
what the service really reported, never by the model. Approvals are guarded against
double taps. "Open charging screen" only opens the existing start screen, where the
payment and pre-authorisation guards still apply; for a charger PlugOrbit does not control
it opens the operator's instructions and says so.

## 9. Reliability matrix (Phase 7)

| Condition | Behaviour |
|---|---|
| Offline / poor network | Plain message, **Plan a route** and **Open the map** buttons, status line says offline. A 30 s silence from the gateway times out. |
| Not signed in to the cloud account | Says so; the planner and map still work (see §10) |
| AI service not configured / down / rate-limited / daily limit | Clear message with retry time; planner still works |
| Model timeout / error mid-answer | Words already received are kept and marked stopped; error shown; session stays usable |
| Gateway forgot the conversation (restart, expiry) | Retries once as a new conversation; journey memory carries the context |
| Microphone denied / blocked | Explained, with a link to settings; typing works |
| No speech recogniser / TTS engine / language voice missing | Voice reported unavailable; typing and on-screen answers work |
| Recogniser silent for 6 s | Treated as unavailable |
| App backgrounded, call, another app takes audio | Listening and speaking stop; rest of an answer is not read out later |
| No car / unknown battery / unknown place | The tool says `unavailable` / `unknown`; the model asks for the missing piece |
| Charger API errors | Tool returns `error`/`unavailable`; no invented data |
| Location denied or stale | `unavailable`; the position is rounded and the planner start is stated |

## 10. Setup

### Backend

```sh
cd Backend
pip install -r requirements-dev.txt          # adds the `anthropic` SDK
# .env (see .env.example, "Orbit Assist"):
ANTHROPIC_API_KEY=sk-ant-...                 # secret. Never put it in the app.
# optional: ASSISTANT_MODEL, ASSISTANT_EFFORT, ASSISTANT_TURNS_PER_MINUTE, ASSISTANT_DAILY_TOKEN_BUDGET
uvicorn app.main:app --reload --host 0.0.0.0
```

Without the key `/assistant/status` reports `enabled: false` and every other endpoint behaves
exactly as before.

**The assistant needs a Firebase session** (it identifies the caller for limits and
isolation). In local development the login code is normally shown on screen and signs the app
in *on the device only*, with no Firebase session, so the assistant says "sign in to your
account". For development set `OTP_DEV_FALLBACK_SESSIONS=true` (see `Backend/.env.example`), or
configure real email/SMS delivery. There is deliberately no auth bypass.

New endpoints (all need `Authorization: Bearer <Firebase ID token>`):

| Endpoint | |
|---|---|
| `GET /assistant/status` | enabled?, model, tool names, limits |
| `POST /assistant/turn` | one driver turn, streams `application/x-ndjson` events |
| `DELETE /assistant/sessions/{id}`, `DELETE /assistant/sessions` | forget conversations |
| `GET /assistant/usage` | this user's tokens and estimated cost today |

### App

```sh
cd LoginApp
npm install                                  # adds @react-native-voice/voice, react-native-tts
cd ios && pod install                        # iOS
# Android: nothing extra; RECORD_AUDIO and the speech/TTS <queries> are in the manifest
npm run android   # or: npm run ios
```

**Rebuild the native app** after installing; the speech libraries are native modules. On a
physical phone set `API_BASE_URL` in `LoginApp/.env` to the host's LAN IP.

Try it: open the app, tap **Talk to Orbit** on Home, accept the one-time consent card, tap the
microphone and say *"Orbit, Jaipur jaana hai"*. With the key set, the answer comes from the
model; the numbers come from the planner.

## 11. Costs (approximate)

Measured from the real artifacts: system prompt ≈ 1,500 tokens, tool schemas ≈ 3,500, so a
fixed ≈ 5,000-token prefix (cached after the first call); tool results 150–900 tokens each;
a typical route question is two model calls and ≈ 1,200 tokens of tool data. Estimates, at
list prices cached 2026-10-06 ($/M tokens in / out, cache read): Opus 5.5 4 / 20 / 0.20,
Sonnet 5.5 2 / 10 / 0.20, Haiku 5.5 0.10 / 0.50 / 0.01.

| Model (`ASSISTANT_MODEL`) | Per spoken turn, prefix cached | Prefix not cached | Per 1,000 turns |
|---|---|---|---|
| `claude-opus-5-5` (default) | ≈ $0.02 | ≈ $0.06 | $20–60 |
| `claude-sonnet-5-5` | ≈ $0.01 | ≈ $0.03 | $10–30 |
| `claude-haiku-5-5` | ≈ $0.0005 | ≈ $0.002 | $0.5–2 |

Output includes the model's reasoning tokens (effort defaults to `low`). Caching lasts five
minutes, so a conversation with pauses pays the prefix write again. Speech to text and text to
speech cost nothing in API fees (on-device engines). The default daily budget is 300,000
tokens per user. Real figures come from `GET /assistant/usage` and the structured
`assistant_turn` log line. Option 2 (speech-to-speech) would add per-minute audio billing;
check the vendor's current rates before relying on any number here.

The default is Opus because that is the highest-quality default; for a voice product the
Sonnet or Haiku settings are the obvious cost and latency levers. Haiku has not been tried
for tool use or Hindi quality.

## 12. What is not done, or not verified

**Verified only against fakes (needs a device and a key before release)**

* The live model call. The adapter is exercised through the real SDK's stream parsing and
  error types against a simulated API; no real request was made. First-turn behaviour,
  prompt quality in Hindi/Hinglish, and the cache hit rate are unmeasured.
* The speech libraries on a phone. `@react-native-voice/voice` is **deprecated** and a
  classic (non-TurboModule) native module, and this app runs React Native 0.87, so it relies on
  React Native's compatibility layer for older native modules, which was not exercised here. If it misbehaves on a device, the
  replacement is `expo-speech-recognition` (needs the Expo modules runtime) or another
  maintained module, swapped in `voice/native.ts` only. A watchdog and the text fallback
  make a broken module non-fatal, not invisible.
* Android/iOS permission flows, TTS voice availability for `hi-IN`, and ducking.

**Not built**

* Real data. Chargers, status, prices, queues, the route and the drive are the app's sample
  data; the assistant says so. Real operation needs the integration checklist in
  [`ORBIT_ASSIST.md`](ORBIT_ASSIST.md): an operator/CMS feed, real routing and traffic,
  GPS-driven progress, an OEM battery source.
* Server-side trip monitoring and push notifications: alerts are spoken only while the app is
  open.
* Hands-free interruption and the "Hey Orbit" wake word (evaluated in §5).
* Speech-to-speech (Option 2).
* A shared session store. Sessions and limits are in memory per server process; with several
  processes use a shared store (Redis) behind `SessionStore` and a shared counter for the limits.
* Free-form places. The planner knows eight cities; other destinations are refused with the list.
* Conversation history across devices or restarts (by design).
* Planner starts from a named place (default Delhi), not from GPS.

## 13. Testing and regression (Phase 7)

| Suite | Result |
|---|---|
| App (Jest), baseline on `main` | 47 suites, 787 tests |
| App (Jest), now | 56 suites, 1,012 tests, all passing (includes the crawl test, which opens the new route and presses every button) |
| Backend (pytest), baseline on `main` | 130 passed, 1 skipped (live Firestore) |
| Backend (pytest), now | 200 passed, 1 skipped |
| `tsc --noEmit` | clean |
| ESLint | 0 errors; the same 5 warnings as `main` |

New tests cover: the gateway engine (streaming, device and gateway tool round-trips, limits,
isolation, expiry, injection, failures), the Anthropic adapter against a simulated Messages
API through the real SDK, the HTTP layer, the 15 device tools against the real planner and
Smart Drive engine (including that an "avoid this charger" test fails if the planner ignores
it), the controller (typed and spoken turns, interruption, errors, approvals, notices), the
speech pipeline and adapters, proactive relay with the real engine, the approved-action
performer against real services, the screens, sheet and driving mode, and a **two-sided
protocol lock**: the gateway records a real event stream, the app plays it through its real
client, controller and tools, and records what it sends back; the Python tests validate and
replay those bodies, and also validate every result the real device tools produce against the
gateway's strict schema (`Backend/tests/fixtures`, regenerate with `UPDATE_FIXTURES=1`).

Preserved: auth, the map and its provider and configuration, route and vehicle flows,
charging and payment flows and their guards, backend endpoints and Firestore schema are
untouched; every change outside the new modules is additive and listed below.

Additive edits outside the new modules: `Backend/app/main.py` (one `include_router`),
`Backend/requirements.txt` and `.env.example`; `RouteRequest.avoidStationIds` (optional) and its
use in the mock planner; the `Assistant` route (params, names, registry, fixtures); a
**Talk to Orbit** button on Home and Trips; a button in the Map's control stack; the overlay
slot in `MainApp`; microphone and speech permissions in the Android manifest and iOS
`Info.plist`; seven icons.
