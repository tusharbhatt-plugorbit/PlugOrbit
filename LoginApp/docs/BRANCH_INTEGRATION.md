# Branch integration: `Upgrade` + `22-request-repository-write-access-for-abhishek21-prog`

This branch (`claude-best-merged`) combines two lines of work that grew apart from the same
snapshot (`b5443c9`, the merge of PR #19 on 10 Oct 2026):

| Line | What it added |
|---|---|
| **Upgrade** (`main`) | Redesigned splash / welcome / onboarding / log-in screens, a driver-dashboard Home with the map as its own route, measured keyboard avoidance, Orbit Assist (AI co-driver: backend gateway, device tools, voice, driving mode), Smart Drive GPS origin, QR camera, responsive fixes. |
| **22-request-…** (Codex) | Mobile-number sign-in (Firebase) and Google sign-in, real road routing and Google-Places-only chargers, address search, emergency charging route, PDF receipts, nearby amenities, support tickets with an agent inbox, an appearance (System / Light) setting, refer-a-friend, a help guide, GPS-listener crash fix, tab-switch performance work, Docker / Cloud Run and setup docs. |

The second branch was committed *on top of* `Upgrade`'s tip but built from the older snapshot,
so a plain merge or fast-forward would have **deleted** Orbit Assist, the redesign and the keyboard
work. This branch is a real three-way integration from `b5443c9`; its merge commit has both
branch tips as parents, so history from both is kept and neither original branch was changed.

## What was taken from where

| Area | Decision | Why |
|---|---|---|
| Orbit Assist (`Backend/app/ai`, `src/assistant`, voice, driving mode) | Upgrade, unchanged | The only tool-using, consent-gated, rate-limited assistant; the other branch had a single-shot chat. |
| B2's Gemini chat | Kept as the **help guide**, moved to `/assistant/guide/*` | Same URL prefix as Orbit Assist would collide on `/assistant/status`. The guide works offline and adds online answers only when `GEMINI_API_KEY` is set. |
| Log in / sign-up screens | Upgrade's redesign, plus B2's mobile-number (Firebase SMS) and Google sign-in, and B2's rule that a delivered code must open a Firebase session | Redesign is the newer UI; B2's methods are additive. The session rule matches B2's release guard (a sessionless "login" would be signed out at the next launch anyway). |
| Keyboard handling | Upgrade's measured `KeyboardAware*` | Tested (keyboardAvoider / keyboardNavigation); B2's per-screen approach was removed. |
| Home / Map | Upgrade's dashboard Home and `MapScreen`; B2's Home-map fixes ported into `MapScreen` | B2's edits targeted the screen that became the Map route. |
| Nearby-charger caching | Upgrade's shared 90 s cache **and** B2's `enabled` flag | Complementary: one search shared across screens, and no searching while a screen is hidden (also keeps Home from asking for location behind onboarding). |
| Navigation | Both: Upgrade's reduced-motion / tab-bar-with-keyboard, B2's frozen state for hidden screens | Independent improvements in the same file. |
| QR scanning | Upgrade's live in-app camera, plus B2's Google scanner (no camera permission) as a button, and B2's link / length checks | Both work; B2's validation is stricter. |
| Routing | B2's real road geometry, `chooseStation`, emergency charging, `toCoords`; Upgrade's `avoidStationIds` and GPS origin validation | Both sets of inputs are honoured. |
| Presenter tools | Upgrade's `presenterToolsEnabled()` gate | Debug builds only, instead of removing the row. |
| Appearance (System / Light) | B2's recoloring system, with a dark palette rebuilt for the navy + lime brand | See "Design direction" below. |
| Tests | Both suites; tests that encoded one branch's old UI were rewritten for the merged behaviour | See the report for the list. |

## Needs a decision from you

1. **Design direction.** Upgrade keeps the navy + lime brand, dark header, original welcome art.
   The other branch re-skinned to teal/blue with a light header, glow backdrops and a new welcome
   scene. This branch keeps **lime/navy** (the project README and `main` describe it) and takes
   only the other branch's accessibility fixes (control borders, placeholder contrast, text on
   accent) and token additions. All brand colours live in `src/theme.ts`, so switching is a token
   change. `assets/scenes/charging-night-v3.png` (B2's branded welcome hero) is kept but not
   referenced.
2. **Live vs demo data by default.** Upgrade runs on labelled sample data; B2 runs live (Google
   Places chargers only, real roads, Backend support tickets). The default here follows
   configuration: **live once `GOOGLE_PLACES_API_KEY` is set, demo otherwise**, overridable with
   `SERVICES_MODE=live|demo` (`src/config/servicesMode.ts`). The "demo data" notices follow the
   same switch. Payments, charging sessions and vehicle telemetry are simulated in both modes.
3. **Road routing server.** Live journeys call OSRM's public demo server, which has no service
   guarantee. Set `ROAD_ROUTING_URL` to your own OSRM before a real launch.
4. **AI providers.** Orbit Assist uses Anthropic (`ANTHROPIC_API_KEY`); the help guide and the
   automated first reply on support tickets use Gemini (`GEMINI_API_KEY`). Two vendors is
   probably not what you want long term; the gateway's `LLMProvider` interface is where a single
   provider would go. Neither provider was called with a real key in this environment.
5. **Firebase project.** B2 moved the Backend defaults and docs from `plugorbit-fb178` to
   `plugorbit-783dc` (`Backend/.firebaserc`, `.env.example` sets `FIREBASE_PROJECT_ID`, and the
   Backend now refuses a service-account key from another project). Confirm which project is
   current before anyone copies `.env.example` over a working `.env`.
6. **Sign-in rule.** A real (delivered) code now needs a Firebase session to sign in. Only the
   development code shown on screen can sign in without one (it exists when the Backend's
   `OTP_DEV_FALLBACK` is on, or on-device in debug builds), and a release build signs such a
   login out again at the next launch. Allowing local-only logins in release builds would be a
   deliberate product change; keep the Backend's development fallbacks off in production.

## Not verified here

- Android and iOS native builds (no Android SDK / Xcode in this environment). New native code
  from B2 (`DeviceToolsModule`, `PhoneAuthModule`, `GoogleRequestIdentityModule`, the Firebase and
  ML Kit dependencies) is untested together with Upgrade's vision-camera / voice modules.
  `android/app/google-services.json` is git-ignored; the build now continues without it (with a
  warning) but mobile-number sign-in needs it.
- Live Anthropic, Gemini, Google Places, OSRM, Firebase SMS and Google sign-in calls.
- Microphone / speech on a device.

## Not carried over

- `BrandWordmark` (B2's wordmark) and the header AI button, glow backdrops and light header from
  B2's `Screen`: they belonged to the design that was not adopted. Everything is still in B2's
  commits, which are parents of the merge commit.
