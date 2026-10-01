"""Regression tests for the auth routes. Firebase and Google are fully mocked."""
from types import SimpleNamespace

import firebase_admin
import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routes import auth as auth_routes
from app.schemas import UserOut
from app.services import firebase_auth as fb

BAD_KEY = {"error": {"message": "API key not valid. Please pass a valid API key."}}
SIGNUP = {"name": "Asha", "email": "asha@example.com", "password": "secret1"}
TOKENS = {"localId": "u1", "idToken": "IDT", "refreshToken": "RT", "expiresIn": "3600"}


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def firebase_ready(monkeypatch):
    """Pretend the Admin SDK was initialised, and that a web API key is configured."""
    monkeypatch.setitem(firebase_admin._apps, "[DEFAULT]", object())
    monkeypatch.setattr(fb, "get_settings", lambda: SimpleNamespace(firebase_web_api_key="test-key"))


def google_replies(monkeypatch, handler):
    """Route the app's outgoing httpx calls to `handler` instead of Google."""
    real_client = httpx.Client
    monkeypatch.setattr(
        fb.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)
    )


def json_reply(status, body):
    return lambda request: httpx.Response(status, json=body)


# --- forgot-password -------------------------------------------------------------

def test_forgot_password_success(client, monkeypatch):
    google_replies(monkeypatch, json_reply(200, {"email": "asha@example.com"}))
    r = client.post("/auth/forgot-password", json={"email": "asha@example.com"})
    assert r.status_code == 200


def test_forgot_password_hides_unknown_email(client, monkeypatch):
    google_replies(monkeypatch, json_reply(400, {"error": {"message": "EMAIL_NOT_FOUND"}}))
    r = client.post("/auth/forgot-password", json={"email": "nobody@example.com"})
    assert r.status_code == 200
    assert "If an account exists" in r.json()["message"]


def test_forgot_password_surfaces_invalid_api_key(client, monkeypatch):
    google_replies(monkeypatch, json_reply(400, BAD_KEY))
    r = client.post("/auth/forgot-password", json={"email": "asha@example.com"})
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "AUTH_MISCONFIGURED"


def test_forgot_password_surfaces_outage(client, monkeypatch):
    def down(request):
        raise httpx.ConnectError("network down", request=request)

    google_replies(monkeypatch, down)
    r = client.post("/auth/forgot-password", json={"email": "asha@example.com"})
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "AUTH_UNAVAILABLE"


def test_forgot_password_surfaces_rate_limit(client, monkeypatch):
    google_replies(monkeypatch, json_reply(400, {"error": {"message": "TOO_MANY_ATTEMPTS_TRY_LATER"}}))
    r = client.post("/auth/forgot-password", json={"email": "asha@example.com"})
    assert r.status_code == 429


# --- missing FIREBASE_WEB_API_KEY ------------------------------------------------

def test_missing_web_api_key_fails_fast_without_calling_google(client, monkeypatch):
    monkeypatch.setattr(fb, "get_settings", lambda: SimpleNamespace(firebase_web_api_key=""))

    def must_not_be_called(request):
        raise AssertionError("Google must not be called without an API key")

    google_replies(monkeypatch, must_not_be_called)
    r = client.post("/auth/forgot-password", json={"email": "asha@example.com"})
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "AUTH_NOT_CONFIGURED"


def test_invalid_api_key_is_a_server_error_on_login_too(client, monkeypatch):
    google_replies(monkeypatch, json_reply(400, BAD_KEY))
    r = client.post("/auth/login", json={"email": "asha@example.com", "password": "x"})
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "AUTH_MISCONFIGURED"


# --- signup ------------------------------------------------------------------------

def stub_signup_steps(monkeypatch, *, create_profile=None, get_profile=None):
    monkeypatch.setattr(fb, "sign_up", lambda email, password: TOKENS)
    monkeypatch.setattr(fb, "send_email_verification", lambda token: None)
    monkeypatch.setattr(auth_routes.auth, "update_user", lambda *a, **kw: None)
    monkeypatch.setattr(auth_routes.users, "create_profile", create_profile or (lambda *a: None))
    monkeypatch.setattr(auth_routes.users, "get_profile", get_profile or (lambda uid: None))


def test_signup_happy_path(client, monkeypatch):
    profile = UserOut(uid="u1", email=SIGNUP["email"], name="Asha", email_verified=False)
    stub_signup_steps(monkeypatch, get_profile=lambda uid: profile)
    r = client.post("/auth/signup", json=SIGNUP)
    assert r.status_code == 201
    assert r.json()["id_token"] == "IDT"
    assert r.json()["user"]["uid"] == "u1"


def test_signup_still_succeeds_when_profile_readback_fails(client, monkeypatch):
    def flaky(uid):
        raise RuntimeError("firestore hiccup")

    stub_signup_steps(monkeypatch, get_profile=flaky)
    r = client.post("/auth/signup", json=SIGNUP)
    assert r.status_code == 201
    body = r.json()
    assert (body["id_token"], body["refresh_token"]) == ("IDT", "RT")
    assert body["user"] == {
        "uid": "u1", "email": SIGNUP["email"], "name": "Asha",
        "email_verified": False, "created_at": None,
    }


def test_signup_rolls_back_the_auth_user_when_profile_write_fails(client, monkeypatch):
    deleted = []

    def broken(*args):
        raise RuntimeError("firestore down")

    stub_signup_steps(monkeypatch, create_profile=broken)
    monkeypatch.setattr(auth_routes.auth, "delete_user", deleted.append)
    r = client.post("/auth/signup", json=SIGNUP)
    assert r.status_code == 500
    assert r.json()["detail"]["code"] == "SIGNUP_FAILED"
    assert deleted == ["u1"]
