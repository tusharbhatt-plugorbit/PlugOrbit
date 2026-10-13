# PlugOrbit Android phone test

## Install
This APK is for ARM64 Android phones (not the x86 emulator). It bundles JavaScript and does not need Metro.
The test build uses the existing debug certificate for com.loginapp.

1. Connect one Android phone to this PC by USB.
2. Enable Developer options > USB debugging and accept the authorization prompt on the phone.
3. Keep the PlugOrbit Backend running on this PC at 127.0.0.1:8000.
4. From the project root, run:
   `powershell -ExecutionPolicy Bypass -File .\LoginApp\scripts\install-phone.ps1`
   This installs PlugOrbit-phone-test.apk, forwards the backend port, and opens PlugOrbit.
5. Keep USB connected for email OTP and Firebase-backed app data.

If the backend is stopped, open a separate terminal in Backend and run:
`python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`

## What to test
- Welcome: photo, wordmark and buttons visible without cropping the charger.
- Sign In using email; enter the inbox code. SMS is not configured.
- Finish vehicle setup without an Android app-not-responding dialog.
- Home: allow location, load Google Maps and nearby charging stations.
- Home sun/moon shortcut: toggle Light and Midnight.
- Profile > Appearance: choose System, Light or Midnight. Restart the app and confirm the preference remains.
- Plan a fresh Delhi to Gurgaon trip. The blue line should follow roads.
- Existing saved demo routes are estimates until refreshed; they must not look like verified road directions.
- Open station details and charging flow; check small-screen text, touch targets and bottom navigation.

## Routing
Fresh route planning fetches driving geometry, distance and duration from OSRM using OpenStreetMap roads.
Battery planning uses the returned road distance; drive time remains an estimate and is not live traffic.
The public OSRM endpoint is used for this test build. Use a dedicated routing service before a public launch.
Offline/network failures return a clear error instead of a fabricated straight-line route.
API reference: https://project-osrm.org/docs/v26.6.1/http

## Limits
This is a locally connected test APK, not a production deployment. Login/cloud API needs this PC and USB forwarding.
Native appearance, map tile rendering and ANR behavior still require a physical-phone test.


Google sign-in setup: Enable Google under Firebase Authentication > Sign-in method. Set GOOGLE_SIGN_IN_WEB_CLIENT_ID in LoginApp/.env to the Web client ID (ending apps.googleusercontent.com), then rebuild the APK. Register com.loginapp with SHA-1 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25. An API key cannot replace the OAuth client ID.

The installer checks backend health and starts a hidden USB mapping helper. It restores port 8000 after reconnection. Email login requires the PC/backend and USB connection; SMS still requires a configured SMS provider.

## Address selection update
Plan a trip now supports Google Places address search and Use current location.
Type at least three characters, then tap the full address result. Selected coordinates are used for road routing and retained in saved trips.
Allow location permission on the phone when using current location. If unavailable, search a starting address instead.
Address search was checked against the configured Places key: HTTP 200.

## Google sign-in status
The supplied Web client ID is set in the ignored .env file. Firebase Google provider is enabled and its ID matches.
The debug SHA registration is blocked by Firebase HTTP 409: an Android OAuth client for com.loginapp and this certificate exists in another Google project.
Identify that older project and resolve the duplicate Android OAuth registration before expecting native Google login to work.
Do not delete an unidentified OAuth client or uninstall the phone app merely to bypass the conflict.

## SMS login status
Email delivery uses Brevo SMTP. Phone OTP delivery currently uses Twilio and requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in Backend/.env.
These SMS settings are not configured, so real SMS login remains unavailable. Restart the backend after adding valid provider credentials.


## October 11 UI and phone sign-in update

- Welcome scene: moved down by 2% of screen height; improved gloss and charger logo.
- Appearance choices: System and Light; old Midnight preference migrates to System.
- Address fields support full Google Maps addresses; selected coordinates remain attached to trip plans and saved routes. Google chargers saved by place ID are retrieved directly after a restart, even outside the current nearby search.
- Support email defaults to admin@plugorbit.com. Configure SUPPORT_PHONE_NUMBER, SUPPORT_WHATSAPP_NUMBER and optionally SUPPORT_EMAIL_ADDRESS in LoginApp/.env. Use real international numbers; no dummy phone number is dialed.
- Android mobile sign-in now uses Firebase Phone Authentication, with native secure refresh. Enable Phone under Authentication > Sign-in method in plugorbit-783dc, allow the required SMS region and register the APK SHA-1 and SHA-256. Live SMS delivery is not verified until the provider and billing/quota configuration are confirmed.
- Google sign-in still requires resolving the existing Android OAuth package/certificate conflict. The app does not merge separate Google and phone accounts automatically.
- Local backend Google ADC must remain authenticated. The latest live check required gcloud application-default reauthentication; network retry does not repair expired credentials.

Hero asset: assets/scenes/charging-night-v3.png, edited using the built-in imagegen tool.
Prompt: Preserve the existing car/charger composition, navy gradients and portrait framing; subtly increase glossy cyan/blue reflections, and insert the supplied PlugOrbit P/orbit logo as an illuminated badge on the upper charger face. Add no text.

Phone test APK SHA-256:
FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C

Validation for this update:
- TypeScript and ESLint checks pass.
- 257 frontend regressions were run across login, themes, saved places, account sync and all registered screens. The one ticket contact failure was fixed and its two screen checks pass on rerun.
- The additional native Android mobile-login UI test passes, including saving a real Firebase-shaped session without a development code.
- Phone verification/session tests use a mocked native SDK; real SMS delivery remains pending Firebase project setup.
- The current live backend sign-in check is blocked by expired Google ADC requiring manual reauthentication.
- Physical keyboard and light-theme visual verification awaits an unlocked phone.


## Route charger search fix (11 October 2026)

Production trip planning now searches Google Places in overlapping 25 km areas along the road polyline, including the departure and destination. Requests run with at most three concurrent searches, results are deduplicated and remembered for station details. Trips exceeding the bounded search coverage must be split into shorter legs. Failed searches are reported explicitly rather than converted into an empty station list. Chargers without confirmed compatible connector details are not recommended. Release startup no longer restores presenter simulation controls.

Validation: TypeScript and changed-file ESLint passed; route planner/discovery 17 tests passed, Places/station lookup suites passed in the affected run. Live configured-key request near Muzaffarnagar returned HTTP 200 and 20 chargers, 8 with published connector aggregations. This checks a corridor area, not the user's exact current location or final route.


## Light and System theme visibility

Shared cards are now opaque, with stronger input/card boundaries. Selected mint controls use a dedicated dark foreground that remains dark when System appearance follows a dark OS theme. Selected segmented tabs use a separate active fill and readable foreground. Light icon-tile backgrounds now map to dark input surfaces, and list-row icon colors follow the actual appearance. Header secondary labels have a separate color from input placeholders. Navigation, connector/vehicle choices, booking slots, support options, and ticket status checkmarks use consistent selection colors.

Verification: 41 palette, appearance and rendered-control tests cover Light and System dark; text contrast is checked at 4.5:1 and input/card boundary contrast at 3:1. TypeScript and changed-file lint pass.

Phone visual QA: Light Profile screen shows readable account cards, icon tiles, appearance options and navigation. A white-heading conversion issue was found on the System-dark Trips hero and fixed with a regression check that keeps white text unchanged when white card backgrounds become dark.

System-dark Trips phone QA confirms white hero headings, readable secondary text and visible route-card/navigation boundaries. Home selected filter tabs now use the contrast-tested active control fill; dark hero cards also have an explicit outline.


## Three blue-theme pages

Charging cost and Trips now have visible blue primary actions. Percentage-slider handles use a bright foreground with a contrasting ring. Orbit assistant uses theme-aware opaque message bubbles, suggestions, input and composer, with blue sent messages/actions and readable disabled send state. Its notice now says EV guide / Offline answers; it remains an offline guide. Validation: TypeScript and changed-file lint pass; 44 targeted theme and three-screen crawl checks pass.
