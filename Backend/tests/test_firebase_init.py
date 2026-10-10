"""Credential loading: key file, FIREBASE_CREDENTIALS_JSON (raw or base64), Application Default Credentials."""
import base64
import json
import logging

import firebase_admin
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app import firebase as fb
from app.config import Settings

MARKER = "TOP-SECRET-MARKER-123"


def make_key_info(project="demo-project") -> dict:
    """A structurally valid service-account key with a throwaway private key (never a real one)."""
    pem = rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    return {
        "type": "service_account", "project_id": project, "private_key_id": "kid", "private_key": pem,
        "client_email": f"sa@{project}.iam.gserviceaccount.com", "client_id": "1",
        "token_uri": "https://oauth2.googleapis.com/token",
    }


def settings(tmp_path, **overrides) -> Settings:
    # A missing key file by default, so only the source under test is configured.
    base = {"firebase_credentials_path": str(tmp_path / "missing.json")}
    return Settings(_env_file=None, **{**base, **overrides})


@pytest.fixture
def initialised(monkeypatch):
    """No real app: capture what init_firebase hands to initialize_app."""
    monkeypatch.setattr(firebase_admin, "_apps", {})
    calls = []

    def fake_initialize(cred, options=None):
        calls.append((cred, options))
        return type("App", (), {"project_id": (options or {}).get("projectId", "from-key")})()

    monkeypatch.setattr(fb.firebase_admin, "initialize_app", fake_initialize)
    return calls


def use(monkeypatch, s):
    monkeypatch.setattr(fb, "get_settings", lambda: s)


def test_key_file_is_used_first(tmp_path, monkeypatch, initialised):
    key = tmp_path / "key.json"
    key.write_text(json.dumps(make_key_info("from-file")))
    use(monkeypatch, settings(tmp_path, firebase_credentials_path=str(key),
                              firebase_credentials_json=json.dumps(make_key_info("from-env"))))
    fb.init_firebase()
    cred, _ = initialised[0]
    assert cred.project_id == "from-file"


def test_raw_json_env_var(tmp_path, monkeypatch, initialised):
    use(monkeypatch, settings(tmp_path, firebase_credentials_json=json.dumps(make_key_info("from-env"))))
    fb.init_firebase()
    assert initialised[0][0].project_id == "from-env"


def test_base64_json_env_var(tmp_path, monkeypatch, initialised):
    encoded = base64.b64encode(json.dumps(make_key_info("from-b64")).encode()).decode()
    use(monkeypatch, settings(tmp_path, firebase_credentials_json=encoded))
    fb.init_firebase()
    assert initialised[0][0].project_id == "from-b64"


def test_application_default_credentials_with_project_id(tmp_path, monkeypatch, initialised):
    use(monkeypatch, settings(tmp_path, firebase_use_adc=True, firebase_project_id="my-project"))
    fb.init_firebase()
    cred, options = initialised[0]
    assert type(cred).__name__ == "ApplicationDefault"
    assert options == {"projectId": "my-project"}


def test_nothing_configured_starts_without_firebase(tmp_path, monkeypatch, initialised, caplog):
    use(monkeypatch, settings(tmp_path))
    with caplog.at_level(logging.WARNING):
        fb.init_firebase()
    assert initialised == []
    assert "No Firebase Admin credentials found" in caplog.text


@pytest.mark.parametrize("bad", [f"{{not json {MARKER}", f"%%%{MARKER}%%%", "[1, 2]"])
def test_unusable_env_credentials_never_leak_into_the_log(tmp_path, monkeypatch, initialised, caplog, bad):
    use(monkeypatch, settings(tmp_path, firebase_credentials_json=bad))
    with caplog.at_level(logging.DEBUG):
        fb.init_firebase()  # must not raise: the API still starts, Firebase features answer 503
    assert initialised == []
    assert "unusable" in caplog.text
    assert MARKER not in caplog.text


def test_get_db_without_initialisation_explains_the_options(monkeypatch):
    monkeypatch.setattr(firebase_admin, "_apps", {})
    with pytest.raises(RuntimeError, match="FIREBASE_CREDENTIALS_JSON"):
        fb.get_db()
