# PlugOrbit — Master Build Prompt (verbatim product spec)

You are extending an EXISTING PlugOrbit React Native + TypeScript app.

## NON-NEGOTIABLE VISUAL RULE
The existing LOGIN and HOME screens are already approved and are the visual source of truth.
Before writing new UI:
1. Inspect the current Login and Home code.
2. Extract the exact current design tokens/components: colours, typography, font weights, spacing, border radii, card styles, button styles, shadows, icon treatment, input fields, bottom navigation, safe-area behaviour and responsive rules.
3. Reuse those exact tokens and components across every new screen.
4. DO NOT redesign Login or Home.
5. The PNGs I provide are information-hierarchy / layout references only. Do NOT copy their colours if they differ from the current app CSS.
6. Keep the current CSS/style architecture unless refactoring creates reusable components without visually changing existing pages.

## PRODUCT TRUTH RULES
- Hide incompatible chargers by default for the active vehicle.
- Show "LIVE" only from a current operator/CMS feed. Otherwise display Estimated, User-confirmed or Unknown.
- Every charger status and price must show last-updated information.
- Every recommended charging stop must have a backup.
- Remote start requires successful payment pre-authorisation/validated payment method when PlugOrbit controls the session.
- On non-integrated stations, show the operator's own start/payment instructions. Never pretend PlugOrbit controls that charger.
- Never show false-precise wait times. Use a range + confidence label.
- Organic ranking/reliability must never be changed by sponsorship.
- An interrupted charging/payment flow must recover safely after app restart.

## BUILD THESE MOBILE SCREENS

### V1 / MVP
01 Vehicle Setup · 02 Manual Battery / SoC · 03 Extend existing Home / Map · 04 Nearby Charger List · 05 Filters · 06 Station Detail · 07 Compare Chargers · 08 Route Planner · 09 Route Result / Recommended Charging Stop · 10 Backup Charger Alert · 11 Navigation Handoff · 12 Scan Charger QR · 13 Start Charging Confirmation · 14 Active Charging Session · 15 Payment · 16 Failed Payment Recovery · 17 Receipt · 18 Session History · 19 Session Detail · 20 Post-session Feedback · 21 Report a Problem · 22 Support Center · 23 Ticket Detail · 24 Profile & Vehicles

### Phase 2
25 Favourites / Saved Stations & Routes · 26 Reservation · 27 Queue + Wait Estimate · 28 Trip Energy Planner · 29 Charging Alerts · 30 PlugOrbit Plus Subscription

### Later
31 Roadside Assistance · 32 Automatic SoC / Vehicle Connection · 33 AI Occupancy Forecast

### Extra Product Improvements
34 Charging Cost Calculator · 35 Offline Highway Mode · 36 Community Station Updates · 37 Notifications Center · 38 Trip Preferences / Safety Reserve · 39 Multi-stop Trip · 40 Privacy & Connected Data Controls

## NAVIGATION MODEL
Home → Search/Map → Station → Navigate → Scan/select connector → Start → Active Session → Payment → Receipt → Feedback.
Trips contains route planning, saved routes, energy plans, reservations, multi-stop routes.
Activity contains charging history, receipts, support tickets.
Profile contains vehicles, payment methods, language, privacy, subscription and support.

## REUSABLE COMPONENTS
AppHeader, SearchField, ChargerMapPin, ChargerCard, StatusBadge, ConfidenceBadge, ConnectorChip, ReliabilityBar, RouteSummary, BackupChargerCard, PrimaryButton, SecondaryButton, BottomSheet, PaymentMethodCard, SessionMetricCard, OfflineBanner, EmptyState, ErrorState, PermissionPrompt, SupportTicketCard, VehicleSelector.

## EVERY RELEVANT SCREEN MUST HANDLE
loading, empty, success, stale data, offline, permission denied, API error, integration unavailable, station becomes occupied/offline, payment failure, no compatible vehicle.

## MOCK / SERVICE LAYER
Typed service interfaces so mock data can later be replaced without rewriting UI:
vehicleService, stationService, routeService, sessionService, paymentService, supportService, notificationService, preferencesService.

## IMPLEMENTATION DISCIPLINE
- TypeScript strict mode.
- Reuse current app styles/components instead of duplicate inline styles.
- Accessible tap targets and readable contrast.
- Keep Find → Navigate → Pay within ~3 taps from Home wherever possible.
- Cache active route, chosen station and backup station for weak highway networks.
- Do not fake live data.
- Leave explicit TODOs only where charger-operator/payment/OEM backend integration is genuinely required.

## Additional direction from the product owner
Every button must work and be navigable. This is a showcase prototype that must work perfectly, with a perfect theme, optimised and beautiful, extending (not redesigning) the current PlugOrbit UI.
