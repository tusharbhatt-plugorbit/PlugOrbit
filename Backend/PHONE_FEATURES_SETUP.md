# Phone test setup

## Google sign-in
The updated APK uses GOOGLE_SIGN_IN_MODE=browser. Its button opens the local backend's Google browser page. Tap Continue with Google, select your account and approve the Google prompt. Close the browser page and return to PlugOrbit. The app polls with a secret that is never exposed to the browser and accepts only a backend-verified Firebase session. The flow expires after 4 minutes. Keep USB connected and tcp:8000 reverse active for the current local setup.

Firebase authorizedDomains contains localhost and 127.0.0.1. Firebase issued a Google web authorization URL successfully. Actual account approval still requires a manual phone test. The old Android OAuth collision remains for native mode; no package or signer was changed. Production must use a hosted HTTPS backend and authorize that browser domain.

## SMS
Phone auth and India SMS are enabled, and SHA256 is registered. BILLING_NOT_ENABLED still requires the project owner to link an active Cloud Billing account / upgrade Firebase to Blaze. The current server service account cannot read billing configuration. This task did not create or reopen a billing account. SMS sending is billed; set appropriate quotas in Firebase/Cloud Console.

## Gemini
The provided key is kept only in Backend/.env. A real generateContent test returned HTTP 403: Your project has been denied access. Please contact support. Google must restore access for that project before online Orbit can answer. The app provides an explicitly offline guide instead of fabricating live AI answers.

## Tickets
Production support tickets are saved in Firestore support_tickets, scoped by Firebase UID. Orbit gives clearly labelled automated initial guidance immediately; if Gemini is available, an AI response follows. A real human must reply from Support center > Support agent inbox. admin@plugorbit.com is configured as a support agent only when the Firebase ID token confirms the email is verified. Other staff can be added to SUPPORT_AGENT_EMAILS or granted the Firebase support_agent custom claim. Agent replies are labelled separately and customer tickets refresh every 15 seconds while open.

## Receipts
Both receipt buttons open Android Files to save a real PDF. Cancellation is not reported as success. Current records contain no verified operator GSTIN/legal invoice information, so the PDF is an app-generated session summary with a GST calculation, not an official operator tax invoice. Supply verified operator invoice data to support official GST invoices.

## QR / places
Scan QR opens the Google Play native camera scanner. It downloads its scanner module on first use if needed. Registered connector codes are checked for compatibility. HTTPS operator QR links are shown for explicit opening; no payment/start action is automatic. Nearby cafe/food/parking lists query Google Places within 5 km and show full available addresses. Verify business hours and access.
