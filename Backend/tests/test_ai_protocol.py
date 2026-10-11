"""The wire protocol, locked from both sides.

* `fixtures/gateway_events.json` is what the gateway streams for a scripted conversation
  (recorded here, played by the app's own tests in LoginApp/__tests__/assistant/protocol.test.ts).
* `fixtures/app_requests.json` is what the app really sends for the same conversation
  (recorded by that Jest test, validated and replayed here).

If either side changes the protocol, one of the two tests fails until both fixtures are
regenerated:  UPDATE_FIXTURES=1 pytest tests/test_ai_protocol.py  and then
UPDATE_FIXTURES=1 npx jest __tests__/assistant/protocol.test.ts   (in LoginApp/).
"""
import itertools
import json
import os
import secrets
from pathlib import Path

import pytest
from ai_fakes import Reply, call, make_engine, of_type, run

from app.ai.schemas import TurnRequest

FIXTURES = Path(__file__).parent / "fixtures"
EVENTS = FIXTURES / "gateway_events.json"
REQUESTS = FIXTURES / "app_requests.json"
UPDATE = os.environ.get("UPDATE_FIXTURES") == "1"
UID = "driver-1"

# The tool ids the scripted model uses; the app echoes them back in its results.
RECOMMEND_ID, BATTERY_ID = "toolu_01", "toolu_02"

# A minimal stand-in for what the app sends, used only to record the events fixture.
DEFAULT_BODIES = {
    "turn_start": {"message": "Jaipur jaana hai, at least 20%", "context": {}},
    "tool_results": {
        "tool_results": [
            {"tool_use_id": RECOMMEND_ID, "status": "ok", "data": {"charging_needed": True}},
            {"tool_use_id": BATTERY_ID, "status": "ok", "data": {"percent": 60}},
        ]
    },
}


def scenario():
    return [
        Reply(
            "Sure. Let me check. ",
            [
                call("toolu_00", "update_journey_memory", destination="Jaipur", min_arrival_soc_pct=20),
                call(RECOMMEND_ID, "recommend_charging_stops", destination="Jaipur", min_arrival_soc_percent=20),
                call(BATTERY_ID, "get_battery_level"),
            ],
        ),
        Reply(
            "You need one charge, at Neemrana. ",
            [
                call("toolu_03", "propose_action", kind="start_journey", label="Start trip to Jaipur", detail="Plans your charging.", params={"destination": "Jaipur"}),
                call("toolu_04", "propose_action", kind="view_route", label="View route", params={"destination": "Jaipur"}),
            ],
        ),
        Reply("Tap Start trip when you're ready."),
    ]


def play(bodies, monkeypatch):
    counter = itertools.count(1)
    monkeypatch.setattr(secrets, "token_urlsafe", lambda n=16: f"id{next(counter)}")
    engine, _ = make_engine(scenario())
    first = run(engine, UID, TurnRequest.model_validate(bodies["turn_start"]))
    request = of_type(first, "tool_requests")[0]
    second_body = {**bodies["tool_results"], "session_id": first[0]["session_id"], "turn_id": request["turn_id"]}
    second = run(engine, UID, TurnRequest.model_validate(second_body))
    return first, second


def test_event_stream_matches_the_recorded_fixture(monkeypatch):
    first, second = play(DEFAULT_BODIES, monkeypatch)
    recorded = {"first_call": first, "second_call": second}
    if UPDATE:
        EVENTS.write_text(json.dumps(recorded, indent=2, ensure_ascii=False) + "\n")
    assert json.loads(EVENTS.read_text()) == recorded, "the gateway's events changed; regenerate the fixtures (see module docstring)"
    # What the fixture promises the app: the kinds of events, in a sensible order.
    kinds = [e["type"] for e in first]
    assert kinds[0] == "session" and kinds[-1] == "tool_requests" and "memory" in kinds
    kinds = [e["type"] for e in second]
    assert kinds[0] == "session" and kinds[-1] == "done" and "actions" in kinds


@pytest.mark.skipif(not REQUESTS.exists(), reason="record app_requests.json from the Jest protocol test first")
def test_what_the_app_really_sends_is_accepted_and_drives_the_same_conversation(monkeypatch):
    bodies = json.loads(REQUESTS.read_text())
    TurnRequest.model_validate(bodies["turn_start"])
    results = TurnRequest.model_validate({**bodies["tool_results"]}).tool_results
    assert {r.tool_use_id for r in results} == {RECOMMEND_ID, BATTERY_ID}
    first, second = play(bodies, monkeypatch)
    recorded = json.loads(EVENTS.read_text())
    assert first == recorded["first_call"]
    # Same conversation; only the data-source report differs, because it describes the
    # real results the app sent instead of the stand-ins used to record the fixture.
    assert second[:-1] == recorded["second_call"][:-1]
    done = second[-1]
    assert done["type"] == "done"
    assert [s["tool"] for s in done["sources"]] == ["recommend_charging_stops", "get_battery_level"]
    assert all(s["kind"] and s["system"] == "plugorbit_app" for s in done["sources"])


@pytest.mark.skipif(not (FIXTURES / "device_tool_results.json").exists(), reason="record device_tool_results.json from the Jest tools test first")
def test_every_result_the_real_device_tools_produce_passes_the_gateways_validation():
    """The gateway rejects unknown fields and oversize text; the app's tools must never trip that."""
    results = json.loads((FIXTURES / "device_tool_results.json").read_text(encoding="utf-8"))
    assert len(results) >= 15
    for name, variants in results.items():
        for i, result in enumerate(variants):
            body = {"session_id": "s", "turn_id": "t", "tool_results": [{**result, "tool_use_id": f"{name}-{i}"}]}
            parsed = TurnRequest.model_validate(body)
            assert parsed.tool_results[0].status == result["status"], name
