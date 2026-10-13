# PlugOrbit mobile: architecture & screen-building guide

This is the contract every screen is built against. Read it before touching a screen.

## 1. Visual rule (non-negotiable)

Login/Welcome and Home are approved. Every other screen reuses *exactly* their language:

* Frame: `Screen` (dark `colors.bg` header with back arrow, centred 18/700 title, logo tile; light `colors.body` rounded-top body).
* Colours/spacing/radii/type come only from `src/theme.ts` (`colors`, `spacing`, `radii`, `sizes`, `type`, `elevation()`).
  **No raw hex colours, no new font sizes, no emoji icons** in screens. If a token is missing, add it to `theme.ts` with a comment, don't inline it.
* Primary CTA = `PrimaryButton` (dark, white label) — same as Home's "Directions". `variant="lime"` only on dark surfaces.
* Cards are white, radius 20, `elevation(1)`; selected/recommended cards use `tone="lime"`.
* Icons: `<Icon name="..."/>` from `src/ui/Icon.tsx` (SVG, generated set in `iconData.ts`; add names in `scripts/gen-icons.js` and run `node scripts/gen-icons.js`).
* The reference PNGs only give **information hierarchy**; never copy their colours.

## 2. Folders

```
src/theme.ts            design tokens (extend, never fork)
src/ui/                 the component kit (import everything from '../../ui')
src/navigation/         params.ts (all routes + params), registry.ts, AppNavigator
src/screens/<group>/    one file per route: <Route>Screen.tsx, default export
src/domain/             pure types + rules (trust, compatibility, charging maths)
src/intelligence/       Smart Drive engines: pure functions, no React/store/service imports
src/utils/path.ts       route geometry shared by the route and Smart Drive services
src/services/           interfaces (types.ts) + mock implementations (mock/)
src/store/              appStore (persisted), demoStore (presenter switches)
src/dev/                fixtures + test harness used by the crawl test
docs/                   this file
```

Replace the placeholder body of your assigned `src/screens/**/<Route>Screen.tsx`. Do **not** rename files or change default exports; the registry already imports them.

## 3. Navigation

```ts
const nav = useNavigation();            // navigate(name, params) | replace | goBack | popToTop | reset | popTo | switchTab
const {params} = useRoute<'StationDetail'>();   // typed from src/navigation/params.ts
const focused = useIsFocused();         // false while a screen is kept alive underneath another
```

* All routes/params are declared in `params.ts`. Params are typed; pass exactly those.
* Tab roots: Home, Trips, Charge, Activity, Profile. `nav.navigate('Trips')` switches tab.
* `nav.reset('Home')` ends a flow (receipt/feedback/onboarding done).
* Screens stay mounted underneath: pause timers/polling when `!useIsFocused()`; never put side effects in render.
* Hardware back is handled by the navigator.

## 4. Data rules

* **Read persisted user data from the store**: `useApp(selector)` (history, tickets, favourites, session, battery, vehicles, filters, prefs, notifications, paymentMethods…). Helpers: `selectActiveVehicle`.
* **Read discovery data and perform every action through services**: `const {station, route, session, payment, support, vehicle, preferences, notification} = useServices()`. Interfaces live in `src/services/types.ts`; mocks in `src/services/mock/`. UI must only depend on the interfaces so a real backend can replace the mocks.
* Async reads: `useResource(() => station.get(id), [id])` + `<AsyncView resource=... render=... isEmpty=... empty=... />` gives you loading/error/offline/stale handling for free. Actions: `try/await/catch` and show `showToast(...)` or an inline `Notice`.
* Every service can throw `OfflineError`, `ApiError`, `IntegrationUnavailableError` (and in `sessionService`: `PaymentRequiredError`, `ConnectorUnavailableError`). Handle them with human wording.
* Mutating the store directly (`appStore.set`) is for the mock layer only; screens call services. Exception: pure UI preferences like `filters`.
* `useNow()` gives a ticking clock; pass it to `ConfidenceBadge`/`timeAgo` so labels age honestly.

## 5. Product-truth rules (enforced in code and tests)

1. **Compatibility**: incompatible chargers are hidden unless `filters.includeIncompatible` is on. Use `applyFilters`, `isCompatible`, `compatibleConnectors`. Never list a connector the vehicle can't use as selectable.
2. **LIVE**: only `ConfidenceBadge` prints it, derived from `dataTrust(feed, now)` (fresh `operator_feed` only). Otherwise Estimated / User-confirmed / Unknown. Never hand-write "LIVE".
3. **Last updated**: every status and price shows its age (`ConfidenceBadge`, `PriceLine`, `timeAgo`).
4. **Backups**: every `RouteStop` has a `backup`: a nearby, reachable, compatible alternative (short detour, reachable on the arrival battery). Render it with `StopBackup` / `BackupChargerCard`. Only when no charger qualifies is `backup` null with a `backupNote`; `StopBackup` then shows an explicit warning, never a far-away station and never nothing.
5. **Remote start** needs a validated payment method + successful pre-authorisation, and only on `integration === 'integrated'` stations with the link up. For `external` stations show `station.operatorInstructions` and never pretend PlugOrbit controls the charger.
6. **Waits**: always a range + confidence (`waitLabel`, `ConfidencePill`). Never a single minute count as a wait.
7. **Sponsorship** never affects order/reliability (`rankOrganic` ignores it). Show a "Sponsored" pill, nothing more.
8. **Recovery**: the active session lives in the store and is recomputed from `startedAt` (`computeSessionMetrics`), so it survives a restart (`src/app/initialStack.ts`).
9. Don't fake live data: anything that needs an operator/payment/OEM backend is a service call with a `TODO(integration)` in the mock.

## 6. States every screen handles

loading (`ListSkeleton`/`CardSkeleton`), empty (`EmptyState`), success, stale (`Notice`/Stale pill), offline (`OfflineBanner` is automatic in `Screen`; use `OfflineState`), permission denied (`PermissionPrompt`), API error (`ErrorState` with retry), integration unavailable (operator instructions), station became occupied/offline (switch to backup), payment failure (PaymentFailure flow), no compatible vehicle (guide to Vehicle setup). Use the presenter switches (`demoStore`) to exercise them.

## 7. Accessibility & polish

* Tap targets >= 44 (`sizes.tap`); every `Pressable` has `accessibilityRole` and `accessibilityLabel` or visible text (the crawl test fails otherwise).
* Don't rely on colour alone (badges carry text).
* Keep Find -> Navigate -> Pay within ~3 taps from Home.
* Use the kit; if you need a new reusable piece, add it to `src/ui/` and export it from `ui/index.ts` (don't copy-paste styles into screens). Screen-specific styles go in a `StyleSheet.create` at the bottom of the file and use tokens.

## 8. Verifying your work

```sh
npx tsc --noEmit
npx eslint src __tests__
npx prettier --no-bracket-spacing --bracket-same-line --write <your files>
npx jest __tests__/crawl -t "<RouteName>"      # presses every button on your screen
```

Add a focused test next to the crawl for any non-trivial logic (`__tests__/<screen>.test.tsx`), using `src/dev/testHarness.tsx` (`seedSignedIn`, `TestApp`, `probe`).

### Visual check (browser preview)

A react-native-web harness renders any screen in headless Chromium at 390x844 (iPhone-like safe areas).
Use YOUR OWN agent name so concurrent builds don't collide:

```sh
WEB=/tmp/claude-0/-home-user-PlugOrbit/0f7584b7-4273-5ae7-83d2-96022426ee59/scratchpad/web
$WEB/preview.sh <your-name> <out.png> "route=StationDetail&params=%7B%22stationId%22%3A%22st-chargezone-neemrana%22%7D" 1800
```

Then Read the PNG and look at it critically (spacing, hierarchy, truncation, contrast, alignment, empty space). Iterate until it looks polished.

Query options: `route`, `params` (URL-encoded JSON), `session=active|payment_due|payment_failed` (+ `elapsed=<seconds>`), `soc=NN`, `novehicle=1`, `fresh=1`,
`demo=offline,apiError,paymentFail,stationOccupied,integrationDown,locationDenied,cameraDenied,noCompatible` (comma list),
`click=Label1|Label2` (clicks by accessible name / text, in order, before the screenshot). The web preview uses a fake map and the same mock services as the app.
Reference layouts (information hierarchy only): `/tmp/claude-0/-home-user-PlugOrbit/0f7584b7-4273-5ae7-83d2-96022426ee59/scratchpad/refpack/mobile/NN_*.png`.

## 9. Conventions

* TypeScript strict; no `any` (use the domain types).
* Prettier flags above; single quotes, no bracket spacing.
* Comments explain *why*. Leave `TODO(integration): ...` only where a real operator/payment/OEM backend is needed.
