# PlugOrbit five-phone pilot

Deployed 13 October 2026 to project plugorbit-783dc, region asia-south1.

Backend URL: https://plugorbit-backend-212387544491.asia-south1.run.app
Health URL: https://plugorbit-backend-212387544491.asia-south1.run.app/health

Runtime identity: plugorbit-backend@plugorbit-783dc.iam.gserviceaccount.com. Firebase Auth Admin, Datastore User, and self-scoped Service Account Token Creator are configured. SMTP password, Firebase Web API key and Gemini key are Secret Manager references; no private service-account key is used.

The service uses one warm instance and one worker because OTP codes, browser Google flows and AI sessions are process-local. Restarts/revisions discard pending codes/conversations. Move these to shared storage before enabling multiple instances.

Public Cloud Run access uses the documented invoker-IAM-disabled mode for domain-restricted organizations. Account endpoints still verify Firebase tokens; anonymous account reads return 401. Reference: https://docs.cloud.google.com/run/docs/authenticating/public

Verification passed: public health; anonymous account rejection; authenticated hosted Firestore write/read and temporary account cleanup; runtime keyless Firebase custom-token/session signing; runtime SMTP authentication without sending mail. Temporary verification job removed.

APK: LoginApp/PlugOrbit-colleague-test.apk, ARM64 Android 7+. The hosted URL is embedded in the bundle and the old localhost URL is absent. This build has not been installed on a phone yet because no USB device was connected at final verification. Share through a restricted Google Drive link for the five testers, then install and test on Wi-Fi/mobile data without USB. Existing installations should update without clearing data when signed with the same key.

Orbit Assist now uses Vertex AI through the Cloud Run runtime identity (`plugorbit-backend@plugorbit-783dc.iam.gserviceaccount.com`) with `gemini-3.8-flash` in the global location. Vertex AI is enabled and the runtime identity has `roles/aiplatform.user`; no Gemini API key is required for this production path. The authenticated hosted chat endpoint returned an online response in a live check, and its temporary Firebase test account was deleted. Model usage is billable under the Google Cloud project. Google sign-in still needs a valid Firebase OAuth client and Android package/SHA-1 registration; SMS still needs a real phone delivery test.

Source uploads are restricted by Backend/.gcloudignore and Dockerfile. Never upload .env, local ADC credentials, SMTP keys, or service-account keys. Gradle tracks LoginApp/.env as a bundle input so API_BASE_URL changes regenerate release assets.
