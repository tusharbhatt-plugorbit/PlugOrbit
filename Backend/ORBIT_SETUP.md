# Online Orbit

1. Create a Gemini API key in https://aistudio.google.com/apikey using your account.
2. Add `GEMINI_API_KEY=your_key` to Backend/.env only. Never add this key to LoginApp/.env or the APK.
3. Set `GEMINI_MODEL=gemini-flash-latest` (or a model available to your account).
4. Restart the backend. GET /assistant/status reports configured=true when a key is set; a real chat is needed to verify the key/model/quota.
5. Open Orbit after Firebase login and ask a PlugOrbit/EV question. The app supplies vehicle, battery and current trip information for context when you send a message. No conversation is stored by this backend.

Provider outages are shown as errors; offline guide answers remain explicitly labelled offline. Orbit cannot confirm bookings/payments or invent live charger availability. An active billing/quota setup may be needed for your provider account. Check the provider console.

Phone sign-in: enabled on plugorbit-783dc, SMS allowed for India, existing APK SHA256 registered. Verify real SMS delivery manually; no real SMS was sent by setup checks.
Google sign-in: Google provider is enabled, but Firebase Android config has no Android OAuth client for com.loginapp and the existing signer. Resolve the existing package/SHA1 client ownership conflict in Google Cloud/Firebase; enabling the provider alone does not fix native OAuth.
