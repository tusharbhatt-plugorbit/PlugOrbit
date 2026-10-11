"""The tool catalogue.

Two kinds of tool:

* **Device tools** read the driver's own app: vehicle, battery, location, chargers, the
  route planner and the Smart Drive engine. They run on the phone (the data and the
  deterministic engines live there), so the gateway only *asks* for them and the app
  answers in the next request. Each answer carries `status` (ok / unavailable / unknown /
  error) and `source`, so the model can say how far to trust it.
* **Gateway tools** need no phone: `propose_action` (a button for the driver to approve) and
  `update_journey_memory` (what the driver just told us about the journey).

No tool pays, books, starts or stops charging, or changes the destination. The most the
model can do is *propose* an action; the driver approves it in the app.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from .schemas import APPROVAL_REQUIRED


class ToolInputError(ValueError):
    """The model sent arguments that do not match the tool's schema."""


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    schema: dict[str, Any]
    where: str  # "device" | "gateway"

    def api_definition(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.schema}


def _obj(properties: dict[str, Any] | None = None, required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties or {},
        "required": required or [],
        "additionalProperties": False,
    }


_DEST = {
    "type": "string",
    "minLength": 2,
    "maxLength": 80,
    "description": "Destination place name as the driver said it, e.g. 'Jaipur'. "
    "Only places the planner knows can be planned; the tool says which if it does not know one.",
}
_ORIGIN = {
    "type": "string",
    "maxLength": 80,
    "description": "Start place. Omit to start from the driver's current location (nearest known place).",
}
_START_SOC = {
    "type": "number",
    "minimum": 0,
    "maximum": 100,
    "description": "Battery percent at the start. Omit to use the battery on record; "
    "only pass it when the driver gave a different number.",
}
_MIN_ARRIVAL = {
    "type": "number",
    "minimum": 0,
    "maximum": 60,
    "description": "Battery percent the driver wants left on arrival. Omit to use their saved reserve.",
}
_STRATEGY = {
    "type": "string",
    "enum": ["fastest", "cheapest", "reliable"],
    "description": "What to optimise. Omit to use the driver's saved preference.",
}
_STATION_ID = {"type": "string", "minLength": 2, "maxLength": 80, "description": "Charger id from an earlier tool result."}

_ROUTE_ARGS = {
    "destination": _DEST,
    "origin": _ORIGIN,
    "start_soc_percent": _START_SOC,
    "min_arrival_soc_percent": _MIN_ARRIVAL,
}

DEVICE_TOOLS: dict[str, ToolSpec] = {
    t.name: t
    for t in [
        ToolSpec(
            "get_vehicle_status",
            "The driver's active car (make, model, usable battery kWh, connectors it can use, max charging "
            "power, real-world range at 100%) and whether it is linked for live battery. Call first when the "
            "car matters. Returns status 'unavailable' if no car has been added.",
            _obj(),
            "device",
        ),
        ToolSpec(
            "get_battery_level",
            "Current battery percent with where it came from ('manual' typed by the driver, 'vehicle' read "
            "from the car, 'trip_estimate' the app's own estimate during a trip) and how old it is. "
            "Status 'unknown' if no battery has been set. Never guess a battery level.",
            _obj(),
            "device",
        ),
        ToolSpec(
            "get_vehicle_compatibility",
            "Which connector types the car can use. With station_id, whether that charger has a plug the car "
            "can use (or whether its connectors are unconfirmed).",
            _obj({"station_id": _STATION_ID}),
            "device",
        ),
        ToolSpec(
            "get_current_location",
            "The phone's current position as the nearest known place. 'unavailable' if location permission "
            "is off or the fix timed out; the position may be a few minutes old.",
            _obj(),
            "device",
        ),
        ToolSpec(
            "get_route_options",
            "Compare the fastest, cheapest and most reliable plans to a destination: distance, total time "
            "including charging, battery on arrival, number of charging stops and known charging cost. Use "
            "for 'can I reach X', 'how many stops' and 'can we reach without charging' (stops == 0).",
            _obj(_ROUTE_ARGS, ["destination"]),
            "device",
        ),
        ToolSpec(
            "get_chargers_along_route",
            "The chargers the plan to a destination would use, with detour, power for this car, price per "
            "kWh, availability with its trust label, reliability and a backup for each.",
            _obj({**_ROUTE_ARGS, "strategy": _STRATEGY}, ["destination"]),
            "device",
        ),
        ToolSpec(
            "get_charger_details",
            "Everything known about one charger: operator, address, hours, amenities, each connector's type, "
            "power, price and status, rating and reliability (null when nobody has rated it), and the age "
            "and source of its data.",
            _obj({"station_id": _STATION_ID}, ["station_id"]),
            "device",
        ),
        ToolSpec(
            "get_charger_availability",
            "Whether a charger's connectors for this car are free, with the trust label (live / estimated / "
            "user / unknown), how old the status is, queue length if reported, and the expected wait as a "
            "range. Only a trust of 'live' may be called live. Use before saying a charger is free or busy.",
            _obj({"station_id": _STATION_ID}, ["station_id"]),
            "device",
        ),
        ToolSpec(
            "estimate_route_energy",
            "Battery percent after each leg of the plan to a destination (start, each stop, arrival) and the "
            "lowest point, from the car's range model. Lists its assumptions; it ignores traffic, weather "
            "and elevation.",
            _obj(_ROUTE_ARGS, ["destination"]),
            "device",
        ),
        ToolSpec(
            "recommend_charging_stops",
            "The deterministic charging plan to a destination: whether charging is needed, which stops, "
            "battery on arrival at each, charge target, charge time, detour, cost and a backup. This is the "
            "source for any recommendation; explain it, never recompute it. Pass max_stops to check the "
            "plan against the driver's stop limit. Pass avoid_station_ids to plan around chargers the "
            "driver rejected.",
            _obj(
                {
                    **_ROUTE_ARGS,
                    "strategy": _STRATEGY,
                    "max_stops": {"type": "integer", "minimum": 0, "maximum": 6, "description": "The driver's stop limit."},
                    "avoid_station_ids": {
                        "type": "array",
                        "items": {"type": "string", "maxLength": 80},
                        "maxItems": 5,
                        "description": "Chargers to leave out of the plan.",
                    },
                },
                ["destination"],
            ),
            "device",
        ),
        ToolSpec(
            "calculate_trip_cost",
            "Charging cost of the plan to a destination: per stop and total, counting only prices the "
            "operators actually published. Stops with no published price are counted separately, never "
            "guessed. Excludes tolls, parking and fuel-equivalent comparisons.",
            _obj({**_ROUTE_ARGS, "strategy": _STRATEGY}, ["destination"]),
            "device",
        ),
        ToolSpec(
            "get_active_charging_session",
            "The charging session in progress or awaiting payment: station, battery now, energy, elapsed "
            "time, cost so far, status. {'active': false} when the car is not charging.",
            _obj(),
            "device",
        ),
        ToolSpec(
            "get_user_preferences",
            "The driver's saved settings (reserve, route priority, paid parking, amenities, Orbit Assist "
            "mode and talkativeness) which are verified app settings, separate from 'remembered' "
            "assistant preferences the driver stated earlier.",
            _obj(),
            "device",
        ),
        ToolSpec(
            "get_active_trip",
            "The Orbit Assist journey in progress: origin and destination, phase, ETA, battery now and "
            "expected on arrival (as a band), whether charging is required, the planned stop and its "
            "backup with ETA, cost and wait, safe alternatives, and whether monitoring is paused offline. "
            "{'active': false} when no journey is under way.",
            _obj(),
            "device",
        ),
        ToolSpec(
            "explain_plan",
            "The engine's own plain-language answer about the journey in progress. question: why_here (why "
            "this charger), skip (can I skip it), cheaper, faster, backup (what if it fails), battery (what "
            "will I have). The answer is verified; paraphrase it, do not add facts.",
            _obj(
                {"question": {"type": "string", "enum": ["why_here", "skip", "cheaper", "faster", "backup", "battery"]}},
                ["question"],
            ),
            "device",
        ),
    ]
}

_ACTION_KINDS = [
    "view_route",
    "compare_chargers",
    "view_charger",
    "start_journey",
    "switch_charger",
    "start_navigation",
    "open_charging_screen",
    "save_preference",
]

GATEWAY_TOOLS: dict[str, ToolSpec] = {
    t.name: t
    for t in [
        ToolSpec(
            "propose_action",
            "Show the driver a button for something they can approve in the app. You cannot do the action "
            "yourself and must never say it is done: after proposing, say what you offered and wait. kinds: "
            "view_route (open the planned route), compare_chargers (2-4 station_ids side by side), "
            "view_charger, start_journey (begin Orbit Assist for a destination; changes the journey, so "
            "the driver must approve), switch_charger (take a different safe charger on the current "
            "journey), start_navigation (open turn-by-turn to a charger), open_charging_screen (open the "
            "start-charging screen; the driver still confirms payment there), save_preference (remember "
            "a preference on this phone, only when the driver stated it). label is the button text "
            "(max 40 chars, plain words, no emoji). Never propose payment, booking or starting/stopping "
            "charging; they are not available to you.",
            _obj(
                {
                    "kind": {"type": "string", "enum": _ACTION_KINDS},
                    "label": {"type": "string", "minLength": 2, "maxLength": 40},
                    "detail": {"type": "string", "maxLength": 140, "description": "One line saying exactly what will happen."},
                    "params": {"type": "object", "description": "Arguments for the kind, e.g. {destination} or {station_id}."},
                },
                ["kind", "label", "params"],
            ),
            "gateway",
        ),
        ToolSpec(
            "update_journey_memory",
            "Remember something the driver just said about this journey, so follow-ups need no repeating: "
            "destination, origin, the arrival reserve they want, route priority, the most stops they will "
            "accept, or the charger they picked. These are the driver's stated wishes, not verified data. "
            "Pass clear: true when they cancel or finish the journey.",
            _obj(
                {
                    "destination": {"type": "string", "maxLength": 80},
                    "origin": {"type": "string", "maxLength": 80},
                    "min_arrival_soc_pct": {"type": "integer", "minimum": 0, "maximum": 60},
                    "strategy": {"type": "string", "enum": ["fastest", "cheapest", "reliable"]},
                    "max_stops": {"type": "integer", "minimum": 0, "maximum": 6},
                    "selected_station_id": {"type": "string", "maxLength": 80},
                    "selected_station_name": {"type": "string", "maxLength": 120},
                    "clear": {"type": "boolean"},
                }
            ),
            "gateway",
        ),
    ]
}

ALL_TOOLS: dict[str, ToolSpec] = {**DEVICE_TOOLS, **GATEWAY_TOOLS}


def api_tool_definitions() -> list[dict[str, Any]]:
    """The `tools` array for the model request. Fixed order: the prompt cache depends on it."""
    return [t.api_definition() for t in ALL_TOOLS.values()]


# ---------------------------------------------------------------- validation --


def _check(schema: dict[str, Any], value: Any, path: str) -> Any:
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            raise ToolInputError(f"{path or 'input'} must be an object")
        props: dict[str, Any] = schema.get("properties", {})
        extra = set(value) - set(props)
        if extra and schema.get("additionalProperties") is False:
            raise ToolInputError(f"unexpected field(s): {', '.join(sorted(extra))}")
        for name in schema.get("required", []):
            if name not in value:
                raise ToolInputError(f"missing required field: {name}")
        return {k: _check(props[k], v, f"{path}.{k}" if path else k) if k in props else v for k, v in value.items()}
    if kind == "string":
        if not isinstance(value, str):
            raise ToolInputError(f"{path} must be a string")
        text = value.strip()
        if len(text) < schema.get("minLength", 0):
            raise ToolInputError(f"{path} is too short")
        if len(text) > schema.get("maxLength", 10_000):
            raise ToolInputError(f"{path} is too long")
        if "enum" in schema and text not in schema["enum"]:
            raise ToolInputError(f"{path} must be one of: {', '.join(schema['enum'])}")
        return text
    if kind in ("number", "integer"):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ToolInputError(f"{path} must be a number")
        if kind == "integer" and int(value) != value:
            raise ToolInputError(f"{path} must be a whole number")
        if value < schema.get("minimum", -math.inf) or value > schema.get("maximum", math.inf):
            raise ToolInputError(f"{path} is out of range")
        return int(value) if kind == "integer" else value
    if kind == "boolean":
        if not isinstance(value, bool):
            raise ToolInputError(f"{path} must be true or false")
        return value
    if kind == "array":
        if not isinstance(value, list):
            raise ToolInputError(f"{path} must be a list")
        if len(value) > schema.get("maxItems", 100):
            raise ToolInputError(f"{path} has too many items")
        return [_check(schema.get("items", {}), item, f"{path}[]") for item in value]
    return value


def validate_tool_input(name: str, raw: Any) -> dict[str, Any]:
    spec = ALL_TOOLS.get(name)
    if spec is None:
        raise ToolInputError(f"unknown tool: {name}")
    if raw is None:
        raw = {}
    return _check(spec.schema, raw, "")


# ------------------------------------------------------------ action params --

_PREFERENCE_RULES: dict[str, dict[str, Any]] = {
    "min_arrival_soc_pct": {"type": "integer", "minimum": 5, "maximum": 50},
    "strategy": {"type": "string", "enum": ["fastest", "cheapest", "reliable"]},
    "preferred_network": {"type": "string", "minLength": 2, "maxLength": 40},
    "min_charger_kw": {"type": "number", "minimum": 3, "maximum": 400},
    "max_stops": {"type": "integer", "minimum": 0, "maximum": 6},
    "prioritise": {"type": "string", "enum": ["cost", "time", "reliability"]},
}

_ACTION_PARAMS: dict[str, dict[str, Any]] = {
    "view_route": _obj({"destination": _DEST, "origin": _ORIGIN, "strategy": _STRATEGY}, ["destination"]),
    "compare_chargers": _obj(
        {"station_ids": {"type": "array", "items": {"type": "string", "minLength": 2, "maxLength": 80}, "maxItems": 4}},
        ["station_ids"],
    ),
    "view_charger": _obj({"station_id": _STATION_ID}, ["station_id"]),
    "start_journey": _obj({"destination": _DEST, "origin": _ORIGIN, "start_soc_percent": _START_SOC}, ["destination"]),
    "switch_charger": _obj({"station_id": _STATION_ID}, ["station_id"]),
    "start_navigation": _obj({"station_id": _STATION_ID}, ["station_id"]),
    "open_charging_screen": _obj({"station_id": _STATION_ID}, ["station_id"]),
    "save_preference": _obj(
        {"key": {"type": "string", "enum": list(_PREFERENCE_RULES)}, "value": {"type": ["string", "number"]}},
        ["key", "value"],
    ),
}


def validate_action_params(kind: str, params: Any) -> dict[str, Any]:
    schema = _ACTION_PARAMS.get(kind)
    if schema is None:
        raise ToolInputError(f"unsupported action kind: {kind}")
    if not isinstance(params, dict):
        raise ToolInputError("params must be an object")
    if kind == "compare_chargers":
        ids = params.get("station_ids")
        if not isinstance(ids, list) or len(ids) < 2:
            raise ToolInputError("compare_chargers needs at least two station_ids")
    if kind != "save_preference":
        return _check(schema, params, "params")

    key = params.get("key")
    rule = _PREFERENCE_RULES.get(key) if isinstance(key, str) else None
    if rule is None:
        raise ToolInputError("unsupported preference key")
    if set(params) - {"key", "value"}:
        raise ToolInputError("unexpected field(s) in params")
    value = params.get("value")
    if rule["type"] in ("integer", "number") and isinstance(value, str):
        try:
            value = float(value)
        except ValueError as exc:
            raise ToolInputError("value must be a number") from exc
    return {"key": key, "value": _check(rule, value, "value")}


def action_status(kind: str) -> str:
    return "pending_approval" if kind in APPROVAL_REQUIRED else "suggested"
