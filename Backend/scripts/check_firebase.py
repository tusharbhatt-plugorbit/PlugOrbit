"""
Check the Backend's Firebase connection end to end, without touching real data.

    cd Backend
    python -m scripts.check_firebase

Initialises Firebase exactly like the server does (key file, FIREBASE_CREDENTIALS_JSON or
Application Default Credentials), then checks each service the Backend depends on and says
what to fix. Firestore is tested with one throwaway document that is deleted again. Nothing
secret and no user data is printed. Exit code 0 only if every check passes.
"""
import sys
import uuid

import firebase_admin
import httpx
from firebase_admin import auth, firestore

from app.config import get_settings
from app.firebase import init_firebase

IDENTITY_LOOKUP = "https://identitytoolkit.googleapis.com/v1/accounts:lookup"
SCRATCH = "_connection_checks"  # emptied again, so Firestore drops the collection


def check_credentials() -> str:
    init_firebase()
    if not firebase_admin._apps:
        raise RuntimeError("No usable Admin credentials. See the startup warning above and Backend/.env.example.")
    app = firebase_admin.get_app()
    token = app.credential.get_access_token()
    if not token.access_token:
        raise RuntimeError("Google did not issue an access token for these credentials.")
    return f"project '{app.project_id}'"


def check_firestore() -> str:
    ref = firestore.client().collection(SCRATCH).document(uuid.uuid4().hex)
    try:
        ref.set({"ok": True, "at": firestore.SERVER_TIMESTAMP})
        if not (ref.get().to_dict() or {}).get("ok"):
            raise RuntimeError("Wrote a test document but could not read it back.")
    finally:
        ref.delete()
    if ref.get().exists:
        raise RuntimeError("Test document was not deleted.")
    return "created, read and deleted a throwaway document"


def check_auth() -> str:
    try:
        auth.list_users(max_results=1)
    except auth.ConfigurationNotFoundError:
        raise RuntimeError(
            "Firebase Authentication is not set up for this project. Firebase Console > Build > "
            "Authentication > Get started, then enable Email/Password under Sign-in method."
        ) from None
    return "Admin Auth API answers"


def check_web_api_key() -> str:
    key = get_settings().firebase_web_api_key
    if not key:
        raise RuntimeError("FIREBASE_WEB_API_KEY is empty. Firebase Console > Project settings > General > "
                           "Your apps > Web app > apiKey (or Project settings > General > Web API Key).")
    # A lookup of a junk token has no side effects: a valid key is answered with an error
    # about the token, an invalid key with "API key not valid".
    resp = httpx.post(IDENTITY_LOOKUP, params={"key": key}, json={"idToken": "not-a-token"}, timeout=15)
    message = str(resp.json().get("error", {}).get("message", ""))
    if message.startswith("API key not valid"):
        raise RuntimeError("Google rejected FIREBASE_WEB_API_KEY. Copy it again from Project settings.")
    if message.startswith("CONFIGURATION_NOT_FOUND"):
        raise RuntimeError("Key accepted, but Firebase Authentication is not set up yet (see the Auth check).")
    return "key accepted"


CHECKS = [
    ("Admin credentials", check_credentials),
    ("Cloud Firestore", check_firestore),
    ("Firebase Authentication", check_auth),
    ("Web API key", check_web_api_key),
]


def main() -> int:
    failed = 0
    credentials_ok = True
    for name, check in CHECKS:
        if not credentials_ok and name != "Web API key":
            print(f"SKIP  {name}: needs working Admin credentials")
            continue
        try:
            detail = check()
            print(f"PASS  {name}: {detail}")
        except Exception as e:  # report every failure; this is a diagnostic, not a request path
            failed += 1
            if name == "Admin credentials":
                credentials_ok = False
            print(f"FAIL  {name}: {e if isinstance(e, RuntimeError) else f'{type(e).__name__}: {e}'}")
    print("\nAll checks passed." if not failed else f"\n{failed} check(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
