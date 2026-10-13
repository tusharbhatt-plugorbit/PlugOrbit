"""The credential probe must only pass on the expected invalid-token response."""
from types import SimpleNamespace

import httpx
import pytest

from scripts import check_firebase as checks


@pytest.mark.parametrize("status, body", [
    (403, {"error": {"message": "PERMISSION_DENIED"}}),
    (503, {"error": {"message": "UNAVAILABLE"}}),
    (200, {}),
    (400, {"error": {"message": "API key not valid. Please pass a valid API key."}}),
    (400, {"error": {"message": "CONFIGURATION_NOT_FOUND"}}),
])
def test_unconfirmed_key_never_passes(monkeypatch, status, body):
    monkeypatch.setattr(checks, "get_settings", lambda: SimpleNamespace(firebase_web_api_key="test-key"))
    monkeypatch.setattr(checks.httpx, "post", lambda *args, **kwargs: httpx.Response(status, json=body))
    with pytest.raises(RuntimeError):
        checks.check_web_api_key()


def test_expected_token_rejection_confirms_key(monkeypatch):
    monkeypatch.setattr(checks, "get_settings", lambda: SimpleNamespace(firebase_web_api_key="test-key"))
    monkeypatch.setattr(checks.httpx, "post", lambda *args, **kwargs: httpx.Response(
        400, json={"error": {"message": "INVALID_ID_TOKEN"}}))
    assert checks.check_web_api_key() == "key accepted"


def test_non_json_response_does_not_pass(monkeypatch):
    monkeypatch.setattr(checks, "get_settings", lambda: SimpleNamespace(firebase_web_api_key="test-key"))
    monkeypatch.setattr(checks.httpx, "post", lambda *args, **kwargs: httpx.Response(502, text="Bad Gateway"))
    with pytest.raises(RuntimeError, match="unreadable response"):
        checks.check_web_api_key()
