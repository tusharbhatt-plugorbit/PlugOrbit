# PlugOrbit Firebase setup

Confirmed project: plugorbit-783dc; project number: 212387544491.
Android application ID: com.loginapp. Console nickname: PlugOrbit.

The mobile app uses the FastAPI backend for Firebase authentication and cloud data.
Android app registration alone does not configure backend login.

1. Register the Android app with package name com.loginapp.
2. Download google-services.json to LoginApp/android/app/google-services.json.
   The current backend-based login does not consume this file or require a native Firebase SDK.
3. In Backend/.env, set FIREBASE_WEB_API_KEY from this project. FIREBASE_PROJECT_ID is already set.
4. Save this project's Admin service-account credentials as Backend/serviceAccountKey.json.
5. Enable Firebase Authentication and Email/Password for the password login endpoints; create Firestore.
6. Configure SMTP or Twilio for delivery of real login codes. On-screen development codes do not open cloud sessions by default.
7. Run python -m scripts.check_firebase and python -m scripts.check_login_flow from Backend.

Google Maps has separate setup: the Android Maps key is in LoginApp/.env.
Enable Maps SDK for Android and restrict its Android key to com.loginapp and the signing certificate SHA-1.
GOOGLE_PLACES_API_KEY is currently unset, so nearby station discovery uses demo data.
Restart Metro with --reset-cache after .env edits and rebuild Android after native key changes.

Orbit currently provides offline guidance. No live AI provider is connected.

## Organization blocks service-account key creation

The local configuration now uses FIREBASE_USE_ADC=true and an explicit
FIREBASE_SERVICE_ACCOUNT_ID for IAM custom-token signing. No private key file is required
once Application Default Credentials are available.

Install the Google Cloud CLI on your development machine. Your Google Cloud administrator
must grant your signed-in Google user Service Account Token Creator on
firebase-adminsdk-fbsvc@plugorbit-783dc.iam.gserviceaccount.com.
The impersonated service account also needs signBlob permission on the signing account
(itself here), plus Firebase Authentication and Firestore access. Enable the IAM Service
Account Credentials API in plugorbit-783dc.

Run in your local terminal:

```powershell
gcloud auth login
gcloud config set project plugorbit-783dc
gcloud auth application-default login --impersonate-service-account=firebase-adminsdk-fbsvc@plugorbit-783dc.iam.gserviceaccount.com
cd Backend
python -m pip install -r requirements-dev.txt
python -m scripts.check_firebase
```

Complete the browser Google sign-in using an account with the permissions above.
For a deployed backend, attach an authorized service account to Cloud Run and use ADC
without local login.

References:
- https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation
- https://firebase.google.com/docs/auth/admin/create-custom-tokens
