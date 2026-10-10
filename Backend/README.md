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

### Data model (Firestore)

```
users/{uid}                  profile: email, name, createdAt           (written at signup)
users/{uid}/state/{slice}    one document per synced app-data slice:
                               json       the slice's JSON, as a string
                               bytes      its size
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
| `GET /users/me/state` | all stored slices with their `updated_at` |
| `PUT /users/me/state` | `{"slices": {name: value}}` replaces the named slices, all or nothing |
| `DELETE /users/me` | deletes the account **and** everything under `users/{uid}` |

All of them need `Authorization: Bearer <Firebase ID token>`.

### Security rules

`firestore.rules` is deny-all and matches what is already live. It is only applied when you run
`firebase deploy --only firestore:rules` from this folder; nothing in this repo deploys it.
