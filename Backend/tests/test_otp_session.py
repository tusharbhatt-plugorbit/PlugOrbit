"""
OTP verify -> Firebase session. The Admin SDK and Google's token exchange are fully mocked;
the live path is checked by `python -m scripts.check_login_flow`.
"""
from types import SimpleNamespace

import firebase_admin
import httpx
import pytest
from fastapi.testclient import TestClient
from firebase_admin import auth

from app.config import Settings
from app.main import app
from app.routes import otp as otp_routes
from app.schemas import UserOut
from app.services import delivery, firebase_auth as fb, identity
from app.services import otp as otp_service

EMAIL = "asha@example.com"
PHONE = "98765 43210"  # normalises to +919876543210
TOKENS = {"idToken": "ID-TOKEN", "refreshToken": "REFRESH-TOKEN", "expiresIn": "3600"}


def record(uid="uid-1", email=EMAIL, verified=True, disabled=False, name=""):
    return SimpleNamespace(uid=uid, email=email, email_verified=verified, disabled=disabled, display_name=name)


class FakeAdmin:
    """Records every Admin SDK call and plays a tiny user table."""

    def __init__(self):
        self.users: dict[str, SimpleNamespace] = {}  # lookup key (email or E.164) -> record
        self.calls: list[tuple] = []
        self.create_error: Exception | None = None

    def _lookup(self, key):
        self.calls.append(("lookup", key))
        if key not in self.users:
            raise auth.UserNotFoundError("no such user")
        return self.users[key]

    def get_user_by_email(self, email):
        return self._lookup(email)

    def get_user_by_phone_number(self, phone):
        return self._lookup(phone)

    def create_user(self, **kwargs):
        self.calls.append(("create", kwargs))
        if self.create_error:
            raise self.create_error
        key = kwargs.get("email") or kwargs.get("phone_number")
        self.users[key] = record(uid=f"new-{len(self.users) + 1}", email=kwargs.get("email"),
                                 verified=kwargs.get("email_verified", False))
        return self.users[key]

    def update_user(self, uid, **kwargs):
        self.calls.append(("update", uid, kwargs))

    def revoke_refresh_tokens(self, uid):
        self.calls.append(("revoke", uid))

    def create_custom_token(self, uid):
        self.calls.append(("custom_token", uid))
        return f"custom-for-{uid}".encode()

    def names(self):
        return [c[0] for c in self.calls]


@pytest.fixture
def admin(monkeypatch):
    fake = FakeAdmin()
    for name in ("get_user_by_email", "get_user_by_phone_number", "create_user", "update_user",
                 "revoke_refresh_tokens", "create_custom_token"):
        monkeypatch.setattr(identity.auth, name, getattr(fake, name))
    monkeypatch.setitem(firebase_admin._apps, "[DEFAULT]", object())
    return fake


@pytest.fixture
def settings(monkeypatch):
    """Defaults only (no .env), with a Web API key so Firebase counts as configured."""
    s = Settings.model_construct(firebase_web_api_key="test-key")
    for module in (otp_service, delivery, otp_routes, identity, fb):
        monkeypatch.setattr(module, "get_settings", lambda: s)
    otp_service.reset()
    yield s
    otp_service.reset()


@pytest.fixture
def google(monkeypatch):
    """Answer the signInWithCustomToken exchange; `requests` collects what the app sent."""
    state = SimpleNamespace(requests=[], status=200, body=TOKENS)

    def handler(request: httpx.Request):
        state.requests.append(request)
        return httpx.Response(state.status, json=state.body)

    real_client = httpx.Client
    monkeypatch.setattr(fb.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    return state


@pytest.fixture(autouse=True)
def profile(monkeypatch):
    """users.get_profile talks to Firestore; answer from the uid instead."""
    def get_profile(uid):
        return UserOut(uid=uid, email=EMAIL, name="Asha", email_verified=True)

    monkeypatch.setattr(identity.users, "get_profile", get_profile)


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def sign_in(client, identifier=EMAIL, *, delivered=False):
    """Request a code and verify it. With no SMTP/Twilio configured the code comes back on
    screen (dev fallback), i.e. exposed; `delivered=True` pretends it was emailed instead."""
    sent = client.post("/auth/otp/send", json={"identifier": identifier}).json()
    code = sent["dev_code"]
    if delivered:
        otp_service._store[otp_service.normalize_identifier(identifier)[1]].exposed = False
    return client.post("/auth/otp/verify", json={"identifier": identifier, "code": code})


# --- a verified code becomes a Firebase session -------------------------------------

def test_first_sign_in_creates_a_verified_account_and_returns_tokens(client, admin, settings, google):
    r = sign_in(client, delivered=True)
    assert r.status_code == 200
    body = r.json()
    assert body["verified"] is True
    assert body["session_status"] == "ready"
    assert body["session"]["id_token"] == "ID-TOKEN"
    assert body["session"]["refresh_token"] == "REFRESH-TOKEN"
    assert body["session"]["expires_in"] == 3600
    assert body["session"]["user"]["uid"] == "new-1"
    assert ("create", {"email": EMAIL, "email_verified": True}) in admin.calls
    # the custom token minted for that uid is what Google is asked to exchange
    assert admin.calls[-1] == ("custom_token", "new-1")
    sent = google.requests[0]
    assert sent.url.params["key"] == "test-key"
    assert sent.url.path.endswith("accounts:signInWithCustomToken")
    assert sent.read() == b'{"token":"custom-for-new-1","returnSecureToken":true}'


def test_returning_user_is_reused_not_recreated(client, admin, settings, google):
    admin.users[EMAIL] = record(uid="uid-7")
    body = sign_in(client, delivered=True).json()
    assert body["session"]["user"]["uid"] == "uid-7"
    assert "create" not in admin.names()


def test_mobile_number_uses_the_e164_form(client, admin, settings, google):
    body = sign_in(client, PHONE, delivered=True).json()
    assert body["session_status"] == "ready"
    assert ("create", {"phone_number": "+919876543210"}) in admin.calls
    assert ("lookup", "+919876543210") in admin.calls


def test_losing_a_creation_race_falls_back_to_the_existing_user(client, admin, settings, google, monkeypatch):
    def lose_race(**kwargs):
        admin.users[EMAIL] = record(uid="uid-raced")
        raise auth.EmailAlreadyExistsError("exists", None, None)

    monkeypatch.setattr(identity.auth, "create_user", lose_race)
    body = sign_in(client, delivered=True).json()
    assert body["session"]["user"]["uid"] == "uid-raced"


# --- nothing changes when Firebase is not configured ---------------------------------

def test_without_a_web_api_key_the_response_is_exactly_what_it_was_before(client, admin, settings, google):
    settings.firebase_web_api_key = ""
    r = sign_in(client, delivered=True)
    assert r.json() == {"verified": True, "message": "Code verified."}
    assert admin.calls == [] and google.requests == []


def test_without_an_admin_app_the_response_is_unchanged(client, admin, settings, google, monkeypatch):
    monkeypatch.setattr(firebase_admin, "_apps", {})
    assert sign_in(client, delivered=True).json() == {"verified": True, "message": "Code verified."}
    assert admin.calls == []


# --- a code shown on screen must not open a cloud session ----------------------------

def test_dev_fallback_code_signs_in_locally_but_opens_no_session(client, admin, settings, google):
    r = sign_in(client)  # SMTP/Twilio unset -> code returned in the response -> exposed
    assert r.json() == {"verified": True, "message": "Code verified.", "session_status": "dev_code"}
    assert admin.calls == [] and google.requests == []


def test_dev_fallback_sessions_can_be_allowed_on_a_dev_machine(client, admin, settings, google):
    settings.otp_dev_fallback_sessions = True
    assert sign_in(client).json()["session_status"] == "ready"


# --- failures --------------------------------------------------------------------------

def test_disabled_account_is_refused_not_signed_in(client, admin, settings, google):
    admin.users[EMAIL] = record(disabled=True)
    r = sign_in(client, delivered=True)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "USER_DISABLED"
    assert google.requests == [] and "custom_token" not in admin.names()


def test_google_outage_still_verifies_the_code_but_reports_no_session(client, admin, settings, google):
    google.status, google.body = 500, {"error": {"message": "BACKEND_ERROR"}}
    r = sign_in(client, delivered=True)
    assert r.status_code == 200
    assert r.json() == {"verified": True, "message": "Code verified.", "session_status": "unavailable"}


def test_admin_failure_degrades_the_same_way(client, admin, settings, google):
    admin.create_error = RuntimeError("Auth not configured")
    assert sign_in(client, delivered=True).json()["session_status"] == "unavailable"


def test_a_firestore_outage_does_not_lose_the_session(client, admin, settings, google, monkeypatch):
    def boom(uid):
        raise RuntimeError("firestore down")

    monkeypatch.setattr(identity.users, "get_profile", boom)
    admin.users[EMAIL] = record(uid="uid-9", name="Asha K")
    body = sign_in(client, delivered=True).json()
    assert body["session_status"] == "ready"
    assert body["session"]["user"] == {"uid": "uid-9", "email": EMAIL, "name": "Asha K",
                                      "email_verified": True}  # null fields are omitted


def test_the_code_is_single_use_even_when_the_session_failed(client, admin, settings, google):
    google.status, google.body = 500, {}
    sent = client.post("/auth/otp/send", json={"identifier": EMAIL}).json()
    otp_service._store[EMAIL].exposed = False
    first = client.post("/auth/otp/verify", json={"identifier": EMAIL, "code": sent["dev_code"]})
    again = client.post("/auth/otp/verify", json={"identifier": EMAIL, "code": sent["dev_code"]})
    assert first.status_code == 200
    assert again.status_code == 400 and again.json()["detail"]["code"] == "OTP_EXPIRED"


def test_a_wrong_code_never_touches_firebase(client, admin, settings, google):
    client.post("/auth/otp/send", json={"identifier": EMAIL})
    r = client.post("/auth/otp/verify", json={"identifier": EMAIL, "code": "000000"})
    assert r.status_code in (400, 429)
    assert admin.calls == [] and google.requests == []


# --- pre-registered, unverified email ---------------------------------------------------

def test_an_unverified_preregistered_email_loses_its_password_and_sessions(client, admin, settings, google):
    """/auth/signup never verifies the address, so a stranger may already hold this account
    with a password they know. Proving the inbox must take it over, not share it."""
    admin.users[EMAIL] = record(uid="squatted", verified=False)
    body = sign_in(client, delivered=True).json()
    assert body["session"]["user"]["uid"] == "squatted"
    update = next(c for c in admin.calls if c[0] == "update")
    assert update[1] == "squatted"
    assert update[2]["email_verified"] is True
    assert len(update[2]["password"]) >= 32  # random, nobody knows it
    names = admin.names()
    assert names.index("update") < names.index("revoke") < names.index("custom_token")
    assert ("revoke", "squatted") in admin.calls


def test_a_verified_account_is_left_untouched(client, admin, settings, google):
    admin.users[EMAIL] = record(uid="uid-1", verified=True)
    sign_in(client, delivered=True)
    assert "update" not in admin.names() and "revoke" not in admin.names()
