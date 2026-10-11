"""The wire protocol between the mobile app and the AI gateway.

One endpoint streams newline-delimited JSON events. A turn is one or more HTTP calls:

  1. the app posts `message` (what the driver said) and `context`;
  2. the gateway streams `text` events, and may end the stream with `tool_requests`;
  3. the app runs those tools on the phone and posts `turn_id` + `tool_results`;
  4. repeat 2-3 until the stream ends with `done`.

Everything the app sends is untrusted input: sizes are capped, unknown fields are
rejected, and nothing in `context` or `tool_results` is ever treated as an instruction.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------- context --

VoiceLanguage = Literal["auto", "en", "hi", "hinglish"]
ResponseStyle = Literal["brief", "detailed"]


class JourneyMemory(_Strict):
    """What the driver told us about the journey in progress. Remembered, not verified."""

    destination: str | None = Field(default=None, max_length=80)
    origin: str | None = Field(default=None, max_length=80)
    min_arrival_soc_pct: int | None = Field(default=None, ge=0, le=100)
    strategy: Literal["fastest", "cheapest", "reliable"] | None = None
    max_stops: int | None = Field(default=None, ge=0, le=10)
    selected_station_id: str | None = Field(default=None, max_length=80)
    selected_station_name: str | None = Field(default=None, max_length=120)
    updated_at: int | None = None


class RememberedPreference(_Strict):
    key: str = Field(max_length=40)
    value: str = Field(max_length=80)
    saved_at: int | None = None


class RecentEvent(_Strict):
    """Something the app told the driver on its own (a proactive notice)."""

    at: int
    kind: str = Field(max_length=40)
    text: str = Field(max_length=300)


class ClientContext(_Strict):
    locale: str = Field(default="en-IN", max_length=12)
    voice_language: VoiceLanguage = "auto"
    response_style: ResponseStyle = "brief"
    input_mode: Literal["voice", "text"] = "text"
    driving_mode: bool = False
    # ISO 8601 with offset, from the phone's clock.
    local_time: str | None = Field(default=None, max_length=40)
    # True while the app runs on sample data (see RUNS_ON_DEMO_DATA in the app).
    demo_data: bool = True
    journey: JourneyMemory | None = None
    remembered_preferences: list[RememberedPreference] = Field(default_factory=list, max_length=12)
    recent_events: list[RecentEvent] = Field(default_factory=list, max_length=5)


# ------------------------------------------------------------------ tool results --

ToolStatus = Literal["ok", "unavailable", "unknown", "error"]


class ToolSource(_Strict):
    """Where a tool's answer came from, so the model can say how much to trust it."""

    system: str = Field(max_length=60)
    kind: Literal["deterministic_engine", "device_store", "device_gps", "sample_data", "unavailable"]
    as_of: int | None = None
    demo: bool = False
    # Data-trust label from the app: live | estimated | user | unknown.
    trust: Literal["live", "estimated", "user", "unknown"] | None = None


class ToolResult(_Strict):
    tool_use_id: str = Field(max_length=80)
    status: ToolStatus
    data: dict[str, Any] | list[Any] | None = None
    message: str | None = Field(default=None, max_length=400)
    source: ToolSource | None = None
    assumptions: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("assumptions")
    @classmethod
    def _short_assumptions(cls, value: list[str]) -> list[str]:
        return [a[:200] for a in value]


# ------------------------------------------------------------------------ request --


class TurnRequest(_Strict):
    session_id: str | None = Field(default=None, max_length=64)
    # Exactly one of `message` (a new driver turn) or `turn_id` + `tool_results`.
    message: str | None = Field(default=None, max_length=8000)
    turn_id: str | None = Field(default=None, max_length=64)
    tool_results: list[ToolResult] | None = Field(default=None, max_length=12)
    context: ClientContext = Field(default_factory=ClientContext)


# ----------------------------------------------------------------------- actions --

ActionKind = Literal[
    "view_route",
    "compare_chargers",
    "view_charger",
    "start_journey",
    "switch_charger",
    "start_navigation",
    "open_charging_screen",
    "save_preference",
]

# Actions that change something the driver owns. They always wait for a tap, and the
# card says exactly what will change. Everything else only opens an existing screen.
APPROVAL_REQUIRED: frozenset[str] = frozenset({"start_journey", "switch_charger", "save_preference"})

PreferenceKey = Literal[
    "min_arrival_soc_pct",
    "strategy",
    "preferred_network",
    "min_charger_kw",
    "max_stops",
    "prioritise",
]


class ProposedAction(BaseModel):
    """A button the driver can press. The gateway never performs an action itself."""

    id: str
    kind: ActionKind
    label: str
    detail: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    # `suggested`: opens a screen when tapped. `pending_approval`: changes something and
    # waits for an explicit yes. `completed` / `failed` are set by the app, never here.
    status: Literal["suggested", "pending_approval"]


# ------------------------------------------------------------------------ events --


class UsageInfo(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    model_calls: int = 0
    estimated_cost_usd: float = 0.0


class SourceInfo(BaseModel):
    tool: str
    system: str | None = None
    kind: str | None = None
    as_of: int | None = None
    demo: bool = False
    trust: str | None = None
    status: str


class StatusResponse(BaseModel):
    enabled: bool
    reason: str | None = None
    provider: str
    model: str | None = None
    tools: list[str]
    limits: dict[str, int]
    protocol: int = 1
