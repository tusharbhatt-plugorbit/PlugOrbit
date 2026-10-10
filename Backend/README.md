# PlugOrbit Backend

FastAPI service. Firebase project: `plugorbit-fb178`.

```sh
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                                  # then fill it in
uvicorn app.main:app --reload --host 0.0.0.0
python -m pytest
```

## Firebase

| Service | Used for | Where |
|---|---|---|
| Cloud Firestore | user profile and synced app data | `app/services/users.py`, `app/services/app_state.py` |
| Firebase Authentication | accounts, ID-token verification | `app/routes/auth.py`, `app/deps.py` |

**The mobile app never talks to Firebase directly.** It calls this API; the API uses the Firebase
Admin SDK. The Firestore rules (`firestore.rules`) deny every client, and the Admin SDK bypasses
them, so a leaked app bundle exposes nothing.

### Credentials (secrets)

The Admin service-account key is a secret: never commit it, never put it in the mobile app. See
`.env.example`. `*firebase-adminsdk*.json` and `serviceAccountKey.json` are git-ignored.

1. Firebase Console > Project settings > Service accounts > **Generate new private key**.
2. Save it as `Backend/serviceAccountKey.json` (local development), **or** set
   `FIREBASE_CREDENTIALS_JSON` (hosted: the JSON or its base64), **or** use Application Default
   Credentials with `FIREBASE_USE_ADC=true` on Google Cloud.
3. Set `FIREBASE_WEB_API_KEY` (Project settings > General > Web API Key).

### Check the connection

```sh
python -m scripts.check_firebase
```

Initialises Firebase like the server does and reports PASS/FAIL for the Admin credentials,
Firestore (one throwaway document, deleted again), Authentication and the Web API key, with what
to fix for each failure. It prints no secrets and no user data.

Optional live test of the data layer against the real project (writes only under a throwaway
`users/it-<random>` id and deletes it):

```sh
RUN_LIVE_FIREBASE_TESTS=1 python -m pytest tests/test_live_firestore.py -v
```

### Login with a one-time code becomes a Firebase sign-in

`POST /auth/otp/verify` still answers `{"verified": true, "message": ...}`. When Firebase is
configured here (Admin credentials **and** `FIREBASE_WEB_API_KEY`) it also returns `session`
(`id_token`, `refresh_token`, `expires_in`, `user`) and `session_status` (`ready`,
`unavailable` or `dev_code`). With no Firebase the response is byte-for-byte what it was before.

1. The code proves control of the email / number. The Firebase user for it is found or created
   (`services/identity.py`; an email address is marked verified, a number is stored as E.164).
2. The Admin SDK mints a custom token and the Backend exchanges it for ID + refresh tokens
   (`accounts:signInWithCustomToken`), so the app needs no Firebase client SDK.
3. Every later call is authorised by that ID token (`Authorization: Bearer ...`);
   the app refreshes it with `POST /auth/refresh`.

Safety rules in that flow:

- **Disabled accounts** are refused (`403 USER_DISABLED`), not signed in locally either.
- **Pre-registered, unverified email**: `/auth/signup` never verifies the address, so a stranger
  may already hold an account for it with a password they know. Proving the inbox replaces that
  password with a random one and revokes their sessions before the real owner is signed in.
- **Codes shown on screen** (`OTP_DEV_FALLBACK`) never open a session unless
  `OTP_DEV_FALLBACK_SESSIONS=true` (development only), because anyone reaching the API could
  read the code for any address. `session_status` is then `dev_code`.
- **Firebase down or misconfigured**: the code is still consumed and verified, `session` is
  omitted and `session_status` is `unavailable`; the app signs in on the device only.
- With Application Default Credentials (no key file) minting custom tokens needs the service
  account to be allowed to sign (`roles/iam.serviceAccountTokenCreator` on itself). A key file
  signs locally and needs nothing extra.
- Accounts are per identifier: the same person signing in by email and by phone gets two accounts.

Check it end to end against the real project (creates and deletes a throwaway account):

```sh
python -m scripts.check_login_flow
```

### Data model (Firestore)

```
users/{uid}                  profile: email, name, createdAt           (written at signup)
users/{uid}/state/{slice}    one document per synced app-data slice:
                               json       the slice's JSON, as a string
                               bytes      its size
                               schema     the app's store version that wrote it
                               rev        random token, new on every write
                               updatedAt  server timestamp
```

Syncable slices (`SLICE_TYPES` in `app/services/app_state.py`): `vehicles`, `activeVehicleId`,
`filters`, `tripPrefs`, `alertPrefs`, `privacy`, `language`, `plus`, `favouriteStationIds`,
`savedRoutes`, `history`, `tickets`, `notifications`, `feedbackDone`. The server rejects unknown
slices, a wrong outer JSON type, non-JSON numbers and oversized payloads (413). Not synced on
purpose: in-flight session, reservation, queue, Smart Drive trip state, battery/vehicle link, and
`paymentMethods` (financial data, decide explicitly before syncing).

| Endpoint | |
|---|---|
| `GET /users/me/state` | all stored slices: `value`, `rev`, `schema_version`, `updated_at` |
| `PUT /users/me/state` | `{"slices": {name: value}, "schema_version": n}` replaces the named slices, all or nothing; answers `{"slices": {name: {"rev", "updated_at"}}}` |
| `DELETE /users/me` | deletes the account **and** everything under `users/{uid}` |

All of them need `Authorization: Bearer <Firebase ID token>`. Clients compare `rev` (not
`updated_at`) to learn whether a slice changed: Firestore resolves a server timestamp at request
time but reports the commit time as the write's update time, so those two differ by milliseconds.
Concurrent edits are last-write-wins per slice; the app pulls before it pushes to keep that rare.

### Security rules

`firestore.rules` is deny-all and matches what is already live. It is only applied when you run
`firebase deploy --only firestore:rules` from this folder; nothing in this repo deploys it.
