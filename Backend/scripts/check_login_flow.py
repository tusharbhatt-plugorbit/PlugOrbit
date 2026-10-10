"""
End-to-end check of "OTP login -> Firebase session -> synced app data", against the real project.

    cd Backend
    python -m scripts.check_login_flow

Needs Firebase Authentication set up and FIREBASE_WEB_API_KEY (run `python -m scripts.check_firebase`
first). Runs the API in-process and signs in with a throwaway address (plugorbit-check-<random>@example.com;
no email is sent), then writes, reads and updates app data with the Firebase token it got, and finally
deletes the throwaway account and everything stored for it. Nothing else is touched. It temporarily
allows on-screen codes to open a session (OTP_DEV_FALLBACK_SESSIONS) for this process only.
"""
import sys
import uuid

import firebase_admin
from fastapi.testclient import TestClient
from firebase_admin import auth

from app.config import get_settings
from app.firebase import get_db, init_firebase
from app.services import delivery


def main() -> int:
    init_firebase()
    settings = get_settings()
    if not firebase_admin._apps or not settings.firebase_web_api_key:
        print("FAIL  Firebase is not configured. Run `python -m scripts.check_firebase` and fix what it reports.")
        return 1

    # This process only: never email the throwaway address, hand its code back, allow the session.
    settings.otp_dev_fallback = True
    settings.otp_dev_fallback_sessions = True
    delivery.deliver = lambda *args, **kwargs: None

    from app.main import app  # imported late so the settings above are already in place

    client = TestClient(app)
    email = f"plugorbit-check-{uuid.uuid4().hex[:12]}@example.com"
    uid: str | None = None
    failed = 0

    def step(name, fn):
        nonlocal failed
        try:
            print(f"PASS  {name}: {fn()}")
            return True
        except Exception as e:  # a diagnostic: report and keep going where possible
            failed += 1
            print(f"FAIL  {name}: {e}")
            return False

    headers: dict = {}

    def send_code():
        r = client.post("/auth/otp/send", json={"identifier": email})
        assert r.status_code == 200, r.text
        send_code.code = r.json()["dev_code"]
        return "code issued"

    def verify_code():
        nonlocal uid, headers
        r = client.post("/auth/otp/verify", json={"identifier": email, "code": send_code.code})
        assert r.status_code == 200, r.text
        body = r.json()
        if body.get("session_status") != "ready":
            raise AssertionError(
                f"verified, but no Firebase session (session_status={body.get('session_status')!r}). "
                "Is Authentication set up and the Web API key right? See `python -m scripts.check_firebase`.")
        uid = body["session"]["user"]["uid"]
        headers = {"Authorization": f"Bearer {body['session']['id_token']}"}
        return "Firebase account created and signed in"

    def token_is_accepted():
        r = client.get("/users/me", headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["uid"] == uid
        return "Backend verified the Firebase ID token"

    def write_state():
        r = client.put("/users/me/state", headers=headers, json={
            "slices": {"vehicles": [{"id": "check-1"}], "favouriteStationIds": ["st-1"]}, "schema_version": 1})
        assert r.status_code == 200, r.text
        write_state.revs = {k: v["rev"] for k, v in r.json()["slices"].items()}
        assert set(write_state.revs) == {"vehicles", "favouriteStationIds"}, r.text
        return "saved 2 slices to Firestore"

    def read_state():
        r = client.get("/users/me/state", headers=headers)
        assert r.status_code == 200, r.text
        slices = r.json()["slices"]
        assert slices["vehicles"]["value"] == [{"id": "check-1"}], slices
        assert slices["vehicles"]["schema_version"] == 1
        assert slices["vehicles"]["rev"] == write_state.revs["vehicles"], "write and read disagree on the revision"
        return "read the same data back"

    def update_state():
        r = client.put("/users/me/state", headers=headers, json={"slices": {"vehicles": []}})
        assert r.status_code == 200, r.text
        got = client.get("/users/me/state", headers=headers).json()["slices"]
        assert got["vehicles"]["value"] == [] and got["favouriteStationIds"]["value"] == ["st-1"]
        return "updated one slice, left the other alone"

    def rejects_bad_data():
        r = client.put("/users/me/state", headers=headers, json={"slices": {"paymentMethods": []}})
        assert r.status_code == 422, r.text
        assert client.get("/users/me/state").status_code == 401
        return "rejects unknown slices and anonymous requests"

    step("Send code", send_code) and step("Verify code -> Firebase session", verify_code) \
        and step("ID token accepted", token_is_accepted) \
        and step("Create data", write_state) and step("Read data", read_state) \
        and step("Update data", update_state) and step("Validation and auth", rejects_bad_data)

    # Cleanup always runs. Deleting the account removes its Firestore data too.
    def cleanup():
        if uid is None:
            try:
                uid_found = auth.get_user_by_email(email).uid
            except Exception:  # not found, or Auth not reachable/set up: either way nothing was created
                return "nothing was created, nothing to clean up"
        else:
            uid_found = uid
        r = client.delete("/users/me", headers=headers) if headers else None
        if r is None or r.status_code != 200:
            get_db().recursive_delete(get_db().collection("users").document(uid_found))
            auth.delete_user(uid_found)
        try:
            auth.get_user(uid_found)
            raise AssertionError("account still exists")
        except auth.UserNotFoundError:
            pass
        assert not list(get_db().collection("users").document(uid_found).collection("state").stream())
        return "deleted the throwaway account and its data"

    step("Clean up", cleanup)
    print("\nAll checks passed." if not failed else f"\n{failed} check(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
