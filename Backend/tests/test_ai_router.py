"""HTTP layer: auth, streaming format, error shapes, and that nothing else changed."""
import json

import pytest
from ai_fakes import Reply, call, make_engine
from fastapi.testclient import TestClient

from app.ai.router import get_engine
from app.deps import get_current_user
from app.main import app

ENGINE_REPLIES = [Reply("Hello driver.")]


@pytest.fixture
def client():
    engine, provider = make_engine([Reply("Hello driver.")])
    app.dependency_overrides[get_engine] = lambda: engine
    app.dependency_overrides[get_current_user] = lambda: {"uid": "u1"}
    yield TestClient(app), engine, provider
    app.dependency_overrides.clear()


def lines(resp):
    return [json.loads(line) for line in resp.text.splitlines() if line]


def test_turn_streams_ndjson(client):
    c, engine, _ = client
    r = c.post("/assistant/turn", json={"message": "hi"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/x-ndjson")
    assert r.headers["cache-control"] == "no-store"
    events = lines(r)
    assert [e["type"] for e in events][0] == "session" and events[-1]["type"] == "done"
    assert "".join(e["delta"] for e in events if e["type"] == "text") == "Hello driver."


def test_full_tool_round_trip_over_http(client):
    c, engine, provider = client
    provider.replies[:] = [Reply("", [call("t1", "get_battery_level")]), Reply("42 percent.")]
    first = lines(c.post("/assistant/turn", json={"message": "battery?"}))
    req = next(e for e in first if e["type"] == "tool_requests")
    second = lines(
        c.post(
            "/assistant/turn",
            json={
                "session_id": first[0]["session_id"],
                "turn_id": req["turn_id"],
                "tool_results": [{"tool_use_id": "t1", "status": "ok", "data": {"percent": 42}}],
            },
        )
    )
    assert second[-1]["type"] == "done"


def test_requires_a_signed_in_user():
    app.dependency_overrides.clear()
    r = TestClient(app).post("/assistant/turn", json={"message": "hi"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "MISSING_TOKEN"
    assert TestClient(app).get("/assistant/status").status_code == 401


def test_errors_before_streaming_use_the_api_error_shape(client):
    c, engine, _ = client
    r = c.post("/assistant/turn", json={"message": ""})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "EMPTY_MESSAGE"
    r = c.post("/assistant/turn", json={"message": "x", "surprise": 1})
    assert r.status_code == 422  # unknown fields are rejected
    r = c.post("/assistant/turn", json={"session_id": "s", "turn_id": "t", "tool_results": []})
    assert r.json()["detail"]["code"] == "SESSION_NOT_FOUND" and r.status_code == 404


def test_rate_limit_answers_429_with_retry_after():
    engine, _ = make_engine([Reply("a"), Reply("b")], assistant_turns_per_minute=1)
    app.dependency_overrides[get_engine] = lambda: engine
    app.dependency_overrides[get_current_user] = lambda: {"uid": "u1"}
    try:
        c = TestClient(app)
        assert c.post("/assistant/turn", json={"message": "one"}).status_code == 200
        r = c.post("/assistant/turn", json={"message": "two"})
        assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
        assert r.json()["detail"]["code"] == "RATE_LIMITED"
    finally:
        app.dependency_overrides.clear()


def test_status_reports_availability_and_tools(client):
    c, engine, _ = client
    body = c.get("/assistant/status").json()
    assert body["enabled"] is True and body["model"] == "claude-opus-5-5" and body["protocol"] == 1
    for name in ("get_battery_level", "recommend_charging_stops", "propose_action"):
        assert name in body["tools"]


def test_status_when_no_key_is_configured_is_not_an_error():
    from app.ai.engine import AssistantEngine
    from ai_fakes import make_settings

    off = AssistantEngine(make_settings(anthropic_api_key=""), None)
    app.dependency_overrides[get_engine] = lambda: off
    app.dependency_overrides[get_current_user] = lambda: {"uid": "u1"}
    try:
        c = TestClient(app)
        body = c.get("/assistant/status").json()
        assert body["enabled"] is False and body["provider"] == "none"
        r = c.post("/assistant/turn", json={"message": "hi"})
        assert r.status_code == 503 and r.json()["detail"]["code"] == "ASSISTANT_UNAVAILABLE"
    finally:
        app.dependency_overrides.clear()


def test_clear_history_and_usage(client):
    c, engine, provider = client
    first = lines(c.post("/assistant/turn", json={"message": "hi"}))
    sid = first[0]["session_id"]
    assert c.delete(f"/assistant/sessions/{sid}").json() == {"deleted": 1}
    assert c.delete(f"/assistant/sessions/{sid}").json() == {"deleted": 0}
    provider.replies.append(Reply("again"))
    c.post("/assistant/turn", json={"message": "hi"})
    assert c.delete("/assistant/sessions").json() == {"deleted": 1}
    usage = c.get("/assistant/usage").json()
    assert usage["turns"] == 2 and usage["tokens"] > 0


def test_existing_endpoints_are_untouched():
    c = TestClient(app)
    assert c.get("/health").json() == {"status": "ok"}
    paths = set(app.openapi()["paths"])
    for path in ("/auth/otp/verify", "/users/me/state", "/auth/refresh", "/assistant/turn"):
        assert path in paths
