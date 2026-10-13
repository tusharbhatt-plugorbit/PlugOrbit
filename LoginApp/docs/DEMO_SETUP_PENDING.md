# Demo setup status - 13 October 2026

## Confirmed now
- Phone connected; updated release installed.
- Android speech module renamed from RCTVoice to Voice to match the JavaScript adapter. Phone microphone control now enabled. Actual speech recognition still needs a user test/permission.
- Firebase backend credentials require Google reauthentication. Browser sign-in was started with the existing Firebase service-account impersonation preserved.
- Gemini model listing succeeds, but actual generation returns AI_ACCESS_DENIED. Do not use model listing as proof that AI works. Availability now checks a minimal generation request cached for ten minutes.
- Expired Admin credentials return a safe 503 SERVER_CREDENTIALS_EXPIRED instead of raw 500 tracebacks. Orbit displays the setup reason.

## Owner actions
1. Complete the opened Google login as admin@plugorbit.com and Allow. If needed run:
   gcloud auth application-default login --impersonate-service-account=firebase-adminsdk-fbsvc@plugorbit-783dc.iam.gserviceaccount.com
2. Gemini: open https://aistudio.google.com/apikey and inspect the configured key/project access. The actual error says project access was denied; resolve with Google support. Do not create another project to evade the restriction. Never post API keys in support requests.
   Support report: Minimal generateContent request returns HTTP 403: Your project has been denied access. Please contact support. Model listing succeeds. Please review project access.
   Reference: https://ai.google.dev/gemini-api/docs/api-errors
3. SMS: the last observed failure was BILLING_NOT_ENABLED. Link an active billing account/Blaze to plugorbit-783dc, enable Phone in Authentication, allow India SMS region, and check registered SHA-1/SHA-256.
   Console: https://console.firebase.google.com/project/plugorbit-783dc/authentication/providers
   Reference: https://firebase.google.com/docs/auth/limits
4. Google sign-in: the last reported client error was deleted_client. In Google Auth Platform > Clients restore the deleted client if still recoverable (within 30 days); otherwise create an active replacement in the correct project and update Firebase Google provider/app configuration. Download updated google-services.json. Retain com.loginapp and the actual signing certificate.
   Console: https://console.cloud.google.com/auth/clients?project=plugorbit-783dc
   Reference: https://support.google.com/cloud/answer/15549257
5. USB-free testing: deploy the backend behind public HTTPS with Firebase service identity and server-only secrets; configure APK API_BASE_URL to that URL and rebuild. Current APK uses localhost through adb reverse; sharing APK alone does not provide a backend.
6. Charger feeds: Google does not supply all connector/tariff/live-status data. Manual routes exclude unknown connector/hours values. Operator/OCPI credentials are needed for missing accurate data. Official GST invoices need legal invoicing details. Payments need gateway/operator integration.

After owner setup: run Backend scripts.check_firebase and scripts.check_login_flow; then verify actual AI reply, real SMS delivery, Google login and one road route on the phone. An app build passing is not proof these external services are enabled.
