# PlugOrbit client demo readiness

## Required account setup
- HTTPS backend hosting and deployment account access. Current APK uses http://127.0.0.1:8000 and USB reverse; it cannot authenticate on another phone without a reachable backend.
- Cloud Run: active project billing, deployment access, runtime service account with Firestore/Auth/custom-token signing access. Store SMTP/Gemini secrets in Secret Manager; use runtime ADC, never ship credentials in APK.
- Cloud Run demo must use one instance/one worker because browser sign-in handoff is currently in memory; configure max instances 1. Reverse proxy headers must preserve HTTPS origin.
- Firebase SMS: Blaze billing, Phone provider, India SMS region, installed APK certificate fingerprints, real OTP test and quota. Billing failure is unresolved until owner setup is verified.
- Google: restore deleted Web OAuth client or provide replacement public Client ID. Update Firebase Google provider credentials and authorize hosted browser domain. Configure authorized redirect URI https://plugorbit-783dc.firebaseapp.com/__/auth/handler. Keep secret server-side.
- Gemini: Google denied access to the configured project. Resolve project access with Google; verify a successful real response before declaring Orbit online.
- Google Places: active API/billing/restrictions. Unpublished connectors/status cannot be invented; operator API required for reliable coverage.

## Distribution
After deployment set LoginApp/.env API_BASE_URL to the HTTPS URL, rebuild signed release APK, install on two phones, verify email/SMS/Google/AI over mobile data with USB disconnected. Share the resulting APK using Drive or a download link. Android recipients enable Install unknown apps for their browser/files app. A local APK path is not a public download URL.

## App changes
Manual route station choice must validate published compatible connectors, opening hours and actual road reachability before replacing first stop. Incomplete onward charging coverage stays visible. Post-charge payment is unknown until verified by an operator/payment callback. Production artificial service waits have been removed; route search and road requests still take real network time.
