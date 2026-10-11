from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Backend/ folder, so .env resolves no matter where uvicorn is started from.
BASE_DIR = Path(__file__).resolve().parent.parent.parent


class AiSettings(BaseSettings):
    """AI gateway configuration. Every field can be set from Backend/.env.

    The provider key lives here and nowhere else: it is never sent to, or stored in,
    the mobile app.
    """

    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore", populate_by_name=True)

    # --- provider -----------------------------------------------------------------------
    # Empty = the assistant reports itself unavailable and the app falls back to the map
    # and the manual planner. Also read from the standard ANTHROPIC_API_KEY variable.
    anthropic_api_key: str = Field(
        default="", validation_alias=AliasChoices("ASSISTANT_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY")
    )
    # Anthropic's default model. For a voice assistant the cheaper `claude-sonnet-5-5` or
    # `claude-haiku-5-5` is a reasonable trade of cost and latency; see docs/ASSISTANT_AI.md.
    assistant_model: str = "claude-opus-5-5"
    # Thinking depth. `low` keeps spoken answers quick; the deterministic tools do the maths.
    assistant_effort: str = Field(default="low", pattern="^(low|medium|high|xhigh|max)$")
    assistant_max_output_tokens: int = Field(default=1024, ge=64, le=8192)
    # Seconds before one model call is abandoned (the app then shows its offline fallback).
    assistant_request_timeout_s: float = Field(default=30.0, ge=2.0, le=120.0)
    # Opt in to the API's server-side refusal fallback (Claude API only).
    assistant_refusal_fallback: bool = False

    # --- conversation ---------------------------------------------------------------------
    assistant_max_tool_rounds: int = Field(default=6, ge=1, le=12)
    assistant_max_history_turns: int = Field(default=16, ge=1, le=100)
    assistant_session_ttl_s: int = Field(default=1800, ge=60)
    # How long the app has to run the tools the model asked for and answer.
    assistant_pending_ttl_s: int = Field(default=120, ge=10)
    assistant_max_sessions_per_user: int = Field(default=3, ge=1, le=20)
    assistant_max_message_chars: int = Field(default=1200, ge=50, le=8000)
    assistant_max_context_bytes: int = Field(default=6000, ge=500, le=50000)
    assistant_max_tool_result_bytes: int = Field(default=20000, ge=1000, le=200000)

    # --- abuse and cost control (per signed-in user, per process) -------------------------
    assistant_turns_per_minute: int = Field(default=12, ge=1)
    assistant_requests_per_minute: int = Field(default=60, ge=1)
    assistant_daily_token_budget: int = Field(default=300_000, ge=1000)
    assistant_max_concurrent_model_calls: int = Field(default=16, ge=1)

    @property
    def configured(self) -> bool:
        return bool(self.anthropic_api_key.strip())


@lru_cache
def get_ai_settings() -> AiSettings:
    return AiSettings()
