"""Tests for the login/signup OTP routes. SMTP and Twilio are fully mocked, Firebase is not configured."""
import base64
import logging
import re
import smtplib
from urllib.parse import parse_qs

import firebase_admin
import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main as app_main
from app.config import Settings
from app.deps import require_firebase
from app.main import app
from app.routes import otp as otp_routes
from app.services import delivery
from app.services import otp as otp_service

EMAIL = "asha@example.com"
PHONE = "98765 43210"  # normalises to +919876543210
CODE_RE = re.compile(r"\b(\d{6})\b")
REAL_HTTPX_CLIENT = httpx.Client  # captured before the no_network guard replaces it


class Clock:
    def __init__(self):
        self.t = 1000.0

    def advance(self, seconds):
        self.t += seconds


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    """Defaults only, built without reading .env or the environment, so a developer's real
    SMTP/Twilio credentials can never leak into a test run. Tests change fields on it."""
    s = Settings.model_construct()
    for module in (otp_service, delivery, otp_routes):
        monkeypatch.setattr(module, "get_settings", lambda: s)
    otp_service.reset()
    yield s
    otp_service.reset()


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(otp_service, "_now", lambda: c.t)
    return c


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Any test that reaches SMTP or Twilio without installing its own fake fails."""
    attempts = []

    def blocked(*args, **kwargs):
        attempts.append((args, kwargs))
        raise ConnectionError("network access is blocked in tests")

    monkeypatch.setattr(delivery.smtplib, "SMTP", blocked)
    monkeypatch.setattr(delivery.httpx, "Client", blocked)
    yield
    assert attempts == [], "a test tried to reach the network"


# --- helpers -----------------------------------------------------------------------

def send(client, identifier):
    return client.post("/auth/otp/send", json={"identifier": identifier})


def verify(client, identifier, code):
    return client.post("/auth/otp/verify", json={"identifier": identifier, "code": code})


def detail(response):
    return response.json()["detail"]


def wrong_code(code):
    return "000000" if code != "000000" else "111111"


def configure_email(settings, **overrides):
    settings.smtp_host = "smtp.test"
    settings.smtp_username = "sender@example.com"
    settings.smtp_password = "app-pass"
    for name, value in overrides.items():
        setattr(settings, name, value)


def configure_sms(settings):
    settings.twilio_account_sid = "ACtest"
    settings.twilio_auth_token = "tok"
    settings.twilio_from_number = "+15005550006"
    settings.twilio_api_base = "https://twilio.test"


@pytest.fixture
def smtp(monkeypatch):
    """Fake SMTP server: a list with one entry per connection the app opened."""
    sessions = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            self.host, self.port, self.timeout = host, port, timeout
            self.tls = False
            self.credentials = None
            self.sent = []
            sessions.append(self)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def starttls(self, context=None):
            self.tls = True

        def login(self, user, password):
            self.credentials = (user, password)

        def send_message(self, msg):
            self.sent.append(msg)

    monkeypatch.setattr(delivery.smtplib, "SMTP", FakeSMTP)
    return sessions


def twilio_replies(monkeypatch, handler):
    """Route the app's outgoing httpx calls to `handler` instead of Twilio."""
    monkeypatch.setattr(
        delivery.httpx, "Client",
        lambda **kw: REAL_HTTPX_CLIENT(transport=httpx.MockTransport(handler), **kw),
    )


@pytest.fixture
def twilio(monkeypatch):
    """Fake Twilio that accepts every message; a list of the requests it received."""
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(201, json={"sid": "SM1", "status": "queued"})

    twilio_replies(monkeypatch, handler)
    return requests


# --- delivery: email -----------------------------------------------------------------

def test_email_code_is_sent_over_smtp_with_starttls(client, settings, smtp):
    configure_email(settings)
    r = send(client, "  Asha@Example.com ")
    assert r.status_code == 200
    body = r.json()
    assert body["identifier_type"] == "email"
    assert body["channel"] == "email"
    assert body["delivered"] is True
    assert body["dev_code"] is None
    assert (body["expires_in"], body["resend_in"]) == (300, 30)

    (session,) = smtp
    assert (session.host, session.port, session.timeout) == ("smtp.test", 587, 5)
    assert session.tls is True
    assert session.credentials == ("sender@example.com", "app-pass")
    (msg,) = session.sent
    assert msg["To"] == EMAIL
    assert msg["From"] == "sender@example.com"
    code = CODE_RE.search(msg.get_content()).group(1)

    ok = verify(client, EMAIL, code)
    assert ok.status_code == 200
    assert ok.json() == {"verified": True, "message": "Code verified."}


def test_smtp_from_overrides_the_username_as_sender(client, settings, smtp):
    configure_email(settings, smtp_from="PlugOrbit <no-reply@example.com>")
    assert send(client, EMAIL).status_code == 200
    assert smtp[0].sent[0]["From"] == "PlugOrbit <no-reply@example.com>"


def test_smtp_without_starttls_or_login(client, settings, smtp):
    settings.smtp_host = "localhost"
    settings.smtp_port = 1025
    settings.smtp_use_tls = False
    settings.smtp_from = "dev@example.com"
    r = send(client, EMAIL)
    assert r.json()["channel"] == "email"
    (session,) = smtp
    assert (session.host, session.port) == ("localhost", 1025)
    assert session.tls is False
    assert session.credentials is None


# --- delivery: SMS -------------------------------------------------------------------

def test_sms_code_is_sent_through_twilio(client, settings, twilio):
    configure_sms(settings)
    r = send(client, PHONE)
    assert r.status_code == 200
    body = r.json()
    assert body["identifier_type"] == "phone"
    assert body["channel"] == "sms"
    assert body["delivered"] is True
    assert body["dev_code"] is None

    (request,) = twilio
    assert request.method == "POST"
    assert str(request.url) == "https://twilio.test/2010-04-01/Accounts/ACtest/Messages.json"
    assert request.headers["authorization"] == "Basic " + base64.b64encode(b"ACtest:tok").decode()
    form = parse_qs(request.content.decode())
    assert form["To"] == ["+919876543210"]
    assert form["From"] == ["+15005550006"]
    code = CODE_RE.search(form["Body"][0]).group(1)

    assert verify(client, PHONE, code).json()["verified"] is True


def test_each_identifier_type_uses_its_own_provider(client, settings, twilio):
    # Only SMS is configured, so an email address cannot be delivered and Twilio must stay untouched.
    configure_sms(settings)
    body = send(client, EMAIL).json()
    assert body["channel"] == "screen"
    assert twilio == []


# --- fallback to the screen ----------------------------------------------------------

def test_nothing_configured_falls_back_to_the_screen(client):
    for identifier in (EMAIL, PHONE):
        r = send(client, identifier)
        assert r.status_code == 200
        body = r.json()
        assert body["channel"] == "screen"
        assert body["delivered"] is False
        assert re.fullmatch(r"\d{6}", body["dev_code"])
        assert verify(client, identifier, body["dev_code"]).json()["verified"] is True


def test_email_failure_falls_back_to_the_screen(client, settings, monkeypatch):
    configure_email(settings)

    def down(*args, **kwargs):
        raise smtplib.SMTPConnectError(421, "service not available")

    monkeypatch.setattr(delivery.smtplib, "SMTP", down)
    body = send(client, EMAIL).json()
    assert (body["channel"], body["delivered"]) == ("screen", False)
    assert verify(client, EMAIL, body["dev_code"]).status_code == 200


def test_email_without_a_sender_address_falls_back_to_the_screen(client, settings):
    settings.smtp_host = "smtp.test"  # no SMTP_FROM and no SMTP_USERNAME
    assert send(client, EMAIL).json()["channel"] == "screen"


@pytest.mark.parametrize("handler", [
    lambda request: httpx.Response(401, json={"code": 20003, "message": "Authenticate"}),
    lambda request: httpx.Response(500, text="boom"),
    lambda request: (_ for _ in ()).throw(httpx.ConnectError("network down", request=request)),
], ids=["twilio-401", "twilio-500", "network-down"])
def test_sms_failure_falls_back_to_the_screen(client, settings, monkeypatch, handler):
    configure_sms(settings)
    twilio_replies(monkeypatch, handler)
    body = send(client, PHONE).json()
    assert (body["channel"], body["delivered"]) == ("screen", False)
    assert verify(client, PHONE, body["dev_code"]).status_code == 200


def test_delivery_failure_without_fallback_is_a_503_and_the_code_is_discarded(client, settings, monkeypatch):
    settings.otp_dev_fallback = False
    configure_email(settings)
    monkeypatch.setattr(delivery.smtplib, "SMTP", lambda *a, **kw: (_ for _ in ()).throw(OSError("down")))
    r = send(client, EMAIL)
    assert r.status_code == 503
    assert detail(r)["code"] == "OTP_DELIVERY_FAILED"
    assert "dev_code" not in r.text
    assert otp_service._store == {}
    # Nothing was sent, so there is no cooldown to wait out and no code to guess.
    assert send(client, EMAIL).status_code == 503
    assert detail(verify(client, EMAIL, "123456"))["code"] == "OTP_EXPIRED"


def test_nothing_configured_without_fallback_is_a_503(client, settings):
    settings.otp_dev_fallback = False
    r = send(client, PHONE)
    assert r.status_code == 503
    assert detail(r)["code"] == "OTP_DELIVERY_FAILED"
    assert otp_service._store == {}


def test_real_delivery_still_works_without_fallback(client, settings, smtp):
    settings.otp_dev_fallback = False
    configure_email(settings)
    body = send(client, EMAIL).json()
    assert (body["channel"], body["delivered"], body["dev_code"]) == ("email", True, None)


# --- verify -------------------------------------------------------------------------

def test_verify_consumes_the_code(client):
    code = send(client, EMAIL).json()["dev_code"]
    assert verify(client, EMAIL, code).status_code == 200
    again = verify(client, EMAIL, code)
    assert again.status_code == 400
    assert detail(again)["code"] == "OTP_EXPIRED"


def test_verify_without_a_requested_code_is_expired(client):
    r = verify(client, EMAIL, "123456")
    assert r.status_code == 400
    assert detail(r)["code"] == "OTP_EXPIRED"


def test_verify_ignores_whitespace_around_the_code(client):
    code = send(client, EMAIL).json()["dev_code"]
    assert verify(client, EMAIL, f" {code}\n").status_code == 200


def test_codes_do_not_work_for_another_identifier(client):
    code = send(client, EMAIL).json()["dev_code"]
    assert detail(verify(client, "someone.else@example.com", code))["code"] == "OTP_EXPIRED"
    assert verify(client, EMAIL, code).status_code == 200


def test_wrong_code_reports_the_attempts_left(client):
    code = send(client, EMAIL).json()["dev_code"]
    for left in (4, 3, 2):
        r = verify(client, EMAIL, wrong_code(code))
        assert r.status_code == 400
        assert detail(r)["code"] == "OTP_INVALID"
        assert detail(r)["attempts_left"] == left
    # Wrong guesses do not burn the real code.
    assert verify(client, EMAIL, code).status_code == 200


@pytest.mark.parametrize("junk", ["", "abc", "12", "1234567890"])
def test_malformed_codes_are_just_wrong_codes(client, junk):
    send(client, EMAIL)
    r = verify(client, EMAIL, junk)
    assert r.status_code == 400
    assert detail(r)["code"] == "OTP_INVALID"


def test_code_is_locked_after_too_many_wrong_attempts(client, clock):
    code = send(client, EMAIL).json()["dev_code"]
    for _ in range(4):
        assert verify(client, EMAIL, wrong_code(code)).status_code == 400
    r = verify(client, EMAIL, wrong_code(code))
    assert r.status_code == 429
    assert detail(r)["code"] == "OTP_TOO_MANY_ATTEMPTS"
    # Even the right code is refused now.
    assert detail(verify(client, EMAIL, code))["code"] == "OTP_TOO_MANY_ATTEMPTS"

    # Locking must not reset the resend cooldown, or a guesser could mint endless fresh codes.
    assert detail(send(client, EMAIL))["code"] == "OTP_RATE_LIMITED"
    clock.advance(30)
    fresh = send(client, EMAIL).json()["dev_code"]
    assert verify(client, EMAIL, fresh).status_code == 200


def test_max_attempts_is_configurable(client, settings):
    settings.otp_max_attempts = 2
    code = send(client, EMAIL).json()["dev_code"]
    assert detail(verify(client, EMAIL, wrong_code(code)))["attempts_left"] == 1
    assert verify(client, EMAIL, wrong_code(code)).status_code == 429


# --- expiry --------------------------------------------------------------------------

def test_code_is_valid_until_the_ttl(client, clock):
    code = send(client, EMAIL).json()["dev_code"]
    clock.advance(299)
    assert verify(client, EMAIL, code).status_code == 200


def test_code_expires_after_the_ttl(client, clock):
    code = send(client, EMAIL).json()["dev_code"]
    clock.advance(300)
    r = verify(client, EMAIL, code)
    assert r.status_code == 400
    assert detail(r)["code"] == "OTP_EXPIRED"


def test_ttl_is_configurable_and_reported(client, settings, clock):
    settings.otp_ttl_seconds = 60
    body = send(client, EMAIL).json()
    assert body["expires_in"] == 60
    clock.advance(60)
    assert detail(verify(client, EMAIL, body["dev_code"]))["code"] == "OTP_EXPIRED"


def test_expired_entries_are_purged_when_the_next_code_is_issued(client, clock):
    send(client, EMAIL)
    clock.advance(301)
    send(client, PHONE)
    assert list(otp_service._store) == ["+919876543210"]


# --- resend cooldown and replacement ---------------------------------------------------

def test_resending_too_soon_is_rate_limited(client, clock):
    first = send(client, EMAIL).json()["dev_code"]
    r = send(client, EMAIL)
    assert r.status_code == 429
    assert detail(r)["code"] == "OTP_RATE_LIMITED"
    assert detail(r)["retry_after"] == 30
    clock.advance(10)
    assert detail(send(client, EMAIL))["retry_after"] == 20
    # The refused request must not have replaced the active code.
    assert verify(client, EMAIL, first).status_code == 200


def test_resending_after_the_cooldown_replaces_the_old_code(client, clock, monkeypatch):
    codes = iter(["111111", "222222"])
    monkeypatch.setattr(otp_service, "generate_code", lambda: next(codes))
    assert send(client, EMAIL).json()["dev_code"] == "111111"
    clock.advance(30)
    assert send(client, EMAIL).json()["dev_code"] == "222222"
    assert detail(verify(client, EMAIL, "111111"))["code"] == "OTP_INVALID"
    assert verify(client, EMAIL, "222222").status_code == 200


def test_cooldown_only_applies_per_identifier(client):
    assert send(client, EMAIL).status_code == 200
    assert send(client, PHONE).status_code == 200


def test_cooldown_can_be_disabled(client, settings):
    settings.otp_resend_seconds = 0
    assert send(client, EMAIL).status_code == 200
    again = send(client, EMAIL)
    assert again.status_code == 200
    assert again.json()["resend_in"] == 0


# --- identifier normalisation ----------------------------------------------------------

@pytest.mark.parametrize("typed", [
    "98765 43210", "+91 98765-43210", "09876543210", "(98765) 43210", "98765.43210",
    "919876543210", "0091 98765 43210", "+919876543210",
])
def test_phone_spellings_normalise_to_one_identity(typed):
    assert otp_service.normalize_identifier(typed) == ("phone", "+919876543210")


@pytest.mark.parametrize("typed,expected", [
    ("+1 (415) 555-2671", "+14155552671"),
    ("+44 20 7946 0958", "+442079460958"),
    ("004420 7946 0958", "+442079460958"),
    ("1234567", "+911234567"),
])
def test_phone_normalisation_examples(typed, expected):
    assert otp_service.normalize_identifier(typed) == ("phone", expected)


def test_default_country_code_is_configurable(settings):
    settings.default_country_code = "+1"
    assert otp_service.normalize_identifier("415 555 2671") == ("phone", "+14155552671")


def test_email_is_trimmed_and_lower_cased():
    assert otp_service.normalize_identifier("  Asha@Example.COM ") == ("email", EMAIL)


@pytest.mark.parametrize("typed", [
    "", "   ", "abc", "a@b", "@b.co", "a@@b.co", "a b@c.co", "123456", "+1234567890123456",
    "++919876543210", "98765a43210", "9876-5+43210", "+0123456789", "0000000", "x" * 300,
    "٩٨٧٦٥٤٣٢١٠",  # Arabic-Indic digits
    "９８７６５４３２１０",  # fullwidth digits
])
def test_invalid_identifiers_are_rejected_by_both_endpoints(client, typed):
    for r in (send(client, typed), verify(client, typed, "123456")):
        assert r.status_code == 400
        assert detail(r)["code"] == "INVALID_IDENTIFIER"
    assert otp_service._store == {}


def test_send_and_verify_share_the_same_phone_identity(client):
    code = send(client, PHONE).json()["dev_code"]
    assert verify(client, "+91 98765-43210", code).status_code == 200


def test_send_and_verify_share_the_same_email_identity(client):
    code = send(client, "Asha@Example.com").json()["dev_code"]
    assert verify(client, "  asha@EXAMPLE.com", code).status_code == 200


# --- code generation and secrecy ------------------------------------------------------

def test_codes_are_zero_padded_to_the_configured_length(settings, monkeypatch):
    monkeypatch.setattr(otp_service.secrets, "randbelow", lambda n: 42)
    assert otp_service.generate_code() == "000042"
    settings.otp_length = 8
    assert otp_service.generate_code() == "00000042"


def test_the_store_never_holds_the_plain_code(client):
    code = send(client, EMAIL).json()["dev_code"]
    (entry,) = otp_service._store.values()
    assert code.encode() not in entry.digest
    assert code not in repr(entry)


def test_dev_code_is_never_returned_when_really_delivered(client, settings, smtp, twilio):
    configure_email(settings)
    configure_sms(settings)
    for identifier in (EMAIL, PHONE):
        r = send(client, identifier)
        assert r.json()["dev_code"] is None
        for sent in [m.get_content() for s in smtp for m in s.sent] + [q.content.decode() for q in twilio]:
            assert CODE_RE.search(sent).group(1) not in r.text


def test_the_code_is_not_logged_when_really_delivered(client, settings, smtp, caplog):
    caplog.set_level(logging.DEBUG)
    configure_email(settings)
    send(client, EMAIL)
    code = CODE_RE.search(smtp[0].sent[0].get_content()).group(1)
    assert code not in caplog.text


def test_the_code_is_not_logged_when_delivery_fails_without_fallback(client, settings, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    settings.otp_dev_fallback = False
    configure_email(settings)
    monkeypatch.setattr(otp_service, "generate_code", lambda: "424242")
    monkeypatch.setattr(delivery.smtplib, "SMTP", lambda *a, **kw: (_ for _ in ()).throw(OSError("down")))
    assert send(client, EMAIL).status_code == 503
    assert "424242" not in caplog.text


def test_the_dev_fallback_logs_the_code_as_a_warning(client, caplog):
    caplog.set_level(logging.DEBUG)
    code = send(client, EMAIL).json()["dev_code"]
    (record,) = [r for r in caplog.records if code in r.getMessage()]
    assert record.levelno == logging.WARNING


# --- startup and Firebase independence -------------------------------------------------

def test_startup_warns_loudly_while_the_dev_fallback_is_on(caplog):
    caplog.set_level(logging.DEBUG)
    delivery.log_startup_notice()
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "OTP_DEV_FALLBACK is ON" in warnings[0].getMessage()


def test_startup_is_quiet_when_the_dev_fallback_is_off(settings, caplog):
    settings.otp_dev_fallback = False
    caplog.set_level(logging.DEBUG)
    delivery.log_startup_notice()
    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []


def test_the_app_lifespan_logs_the_startup_notice(monkeypatch, caplog):
    monkeypatch.setattr(app_main, "init_firebase", lambda: None)
    caplog.set_level(logging.DEBUG)
    with TestClient(app):
        pass
    assert any("OTP_DEV_FALLBACK is ON" in r.getMessage() for r in caplog.records)


def test_endpoints_work_without_firebase(client, monkeypatch):
    monkeypatch.setattr(firebase_admin, "_apps", {})
    with pytest.raises(HTTPException):  # the Firebase-backed routes would answer 503 here
        require_firebase()
    code = send(client, EMAIL).json()["dev_code"]
    assert verify(client, EMAIL, code).status_code == 200
