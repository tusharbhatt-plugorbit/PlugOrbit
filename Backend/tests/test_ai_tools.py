"""The tool catalogue and its validation."""
import pytest

from app.ai.tools import (
    ALL_TOOLS,
    DEVICE_TOOLS,
    GATEWAY_TOOLS,
    ToolInputError,
    api_tool_definitions,
    validate_action_params,
    validate_tool_input,
)

# The operations the product brief asks for, plus the Orbit Assist trip and its explanations.
REQUIRED = {
    "get_vehicle_status", "get_battery_level", "get_vehicle_compatibility", "get_current_location",
    "get_route_options", "get_chargers_along_route", "get_charger_details", "get_charger_availability",
    "estimate_route_energy", "recommend_charging_stops", "calculate_trip_cost",
    "get_active_charging_session", "get_user_preferences",
}


def test_every_requested_operation_exists_and_runs_on_the_device():
    assert REQUIRED <= set(DEVICE_TOOLS)
    assert {"get_active_trip", "explain_plan"} <= set(DEVICE_TOOLS)
    assert set(GATEWAY_TOOLS) == {"propose_action", "update_journey_memory"}


def test_definitions_are_well_formed_and_stable():
    defs = api_tool_definitions()
    assert [d["name"] for d in defs] == list(ALL_TOOLS)  # fixed order keeps the prompt cache warm
    for d in defs:
        assert d["description"] and len(d["description"]) > 30
        schema = d["input_schema"]
        assert schema["type"] == "object" and schema["additionalProperties"] is False
        assert set(schema["required"]) <= set(schema["properties"])
    assert api_tool_definitions() == defs


def test_valid_inputs_pass_and_are_trimmed():
    assert validate_tool_input("get_battery_level", {}) == {}
    assert validate_tool_input("get_battery_level", None) == {}
    out = validate_tool_input("recommend_charging_stops", {"destination": "  Jaipur ", "min_arrival_soc_percent": 20, "max_stops": 1, "strategy": "cheapest", "avoid_station_ids": ["a"]})
    assert out["destination"] == "Jaipur" and out["max_stops"] == 1


@pytest.mark.parametrize(
    "name,args",
    [
        ("get_battery_level", {"x": 1}),
        ("get_route_options", {}),
        ("get_route_options", {"destination": "J"}),
        ("get_route_options", {"destination": "Jaipur", "start_soc_percent": 150}),
        ("get_route_options", {"destination": "Jaipur", "start_soc_percent": float("nan")}),
        ("get_route_options", {"destination": "Jaipur", "start_soc_percent": True}),
        ("recommend_charging_stops", {"destination": "Jaipur", "strategy": "scenic"}),
        ("recommend_charging_stops", {"destination": "Jaipur", "max_stops": 1.5}),
        ("recommend_charging_stops", {"destination": "Jaipur", "avoid_station_ids": list("abcdefg")}),
        ("get_charger_details", {"station_id": 5}),
        ("explain_plan", {"question": "why_not"}),
        ("nope", {}),
    ],
)
def test_bad_inputs_are_rejected(name, args):
    with pytest.raises(ToolInputError):
        validate_tool_input(name, args)


def test_action_params_are_checked_per_kind():
    assert validate_action_params("view_route", {"destination": "Jaipur"}) == {"destination": "Jaipur"}
    assert validate_action_params("save_preference", {"key": "min_arrival_soc_pct", "value": "20"}) == {"key": "min_arrival_soc_pct", "value": 20}
    assert validate_action_params("save_preference", {"key": "prioritise", "value": "cost"})["value"] == "cost"
    for kind, params in [
        ("pay", {}),
        ("save_preference", {"key": "min_arrival_soc_pct", "value": 2}),
        ("save_preference", {"key": "prioritise", "value": "luxury"}),
        ("save_preference", {"key": "home_address", "value": "x"}),
        ("save_preference", {"key": "strategy", "value": "fastest", "extra": 1}),
        ("compare_chargers", {"station_ids": ["a"]}),
        ("view_charger", {"station_id": "a", "x": 1}),
    ]:
        with pytest.raises(ToolInputError):
            validate_action_params(kind, params)
