"""HTTP endpoints for Orbit Assist.

    GET    /assistant/status          is the assistant available, and with what limits
    POST   /assistant/turn            one driver turn (streams NDJSON)
    DELETE /assistant/sessions/{id}   forget one conversation
    DELETE /assistant/sessions        forget all of my conversations
    GET    /assistant/usage           my token use today

Every endpoint needs the same Firebase ID token as the rest of the API. Errors found
before streaming use the API's usual `{"detail": {"code", "message"}}` shape.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..deps import get_current_user
from .engine import AssistantEngine, AssistantError
from .providers.base import LLMProvider
from .schemas import StatusResponse, TurnRequest
from .settings import AiSettings, get_ai_settings
from .tools import ALL_TOOLS

log = logging.getLogger("plugorbit.assistant")

router = APIRouter(prefix="/orbit-assist", tags=["assistant"])


def _build_provider(settings: AiSettings) -> tuple[LLMProvider | None, str | None]:
    if not settings.configured:
        return None, "No model API key is configured on the server (ANTHROPIC_API_KEY)."
    if not settings.anthropic_api_key.strip() and settings.gemini_api_key.strip():
        from .providers.gemini_provider import GeminiProvider
        return GeminiProvider(settings), None
    try:
        from .providers.anthropic_provider import AnthropicProvider

        return AnthropicProvider(settings), None
    except ImportError:
        return None, "The 'anthropic' package is not installed on the server."
    except Exception as exc:  # noqa: BLE001
        log.error("could not start the model provider: %s", exc)
        return None, "The model provider could not be started."


@lru_cache
def get_engine() -> AssistantEngine:
    settings = get_ai_settings()
    provider, _ = _build_provider(settings)
    return AssistantEngine(settings, provider)


def _unavailable_reason() -> str | None:
    settings = get_ai_settings()
    return _build_provider(settings)[1] if not get_engine().enabled else None


def _http_error(exc: AssistantError) -> HTTPException:
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
    return HTTPException(status_code=exc.status, detail={"code": exc.code, "message": exc.message}, headers=headers)


async def _ndjson(events: AsyncIterator[dict[str, Any]]) -> AsyncIterator[bytes]:
    try:
        async for event in events:
            yield (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    finally:
        aclose = getattr(events, "aclose", None)
        if aclose is not None:
            await aclose()


@router.get("/status", response_model=StatusResponse)
async def status(user: dict = Depends(get_current_user), engine: AssistantEngine = Depends(get_engine)) -> StatusResponse:
    s = engine.settings
    reason = await engine.provider.availability() if engine.enabled and hasattr(engine.provider, "availability") else None
    return StatusResponse(
        enabled=engine.enabled and reason is None,
        reason=reason or (None if engine.enabled else _unavailable_reason()),
        provider=engine.provider.name if engine.provider else "none",
        model=engine.provider.model if engine.provider else None,
        tools=list(ALL_TOOLS),
        limits={
            "turns_per_minute": s.assistant_turns_per_minute,
            "max_message_chars": s.assistant_max_message_chars,
            "daily_token_budget": s.assistant_daily_token_budget,
        },
    )


@router.post("/turn")
async def turn(
    body: TurnRequest,
    user: dict = Depends(get_current_user),
    engine: AssistantEngine = Depends(get_engine),
) -> StreamingResponse:
    try:
        prepared = engine.prepare(user["uid"], body)
    except AssistantError as exc:
        raise _http_error(exc) from exc
    return StreamingResponse(
        _ndjson(prepared.events()),
        media_type="application/x-ndjson",
        # Proxies must not buffer the stream or the driver hears nothing until the end.
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str, user: dict = Depends(get_current_user), engine: AssistantEngine = Depends(get_engine)) -> dict:
    return {"deleted": 1 if engine.clear_session(user["uid"], session_id) else 0}


@router.delete("/sessions")
def delete_sessions(user: dict = Depends(get_current_user), engine: AssistantEngine = Depends(get_engine)) -> dict:
    return {"deleted": engine.clear_all(user["uid"])}


@router.get("/usage")
def usage(user: dict = Depends(get_current_user), engine: AssistantEngine = Depends(get_engine)) -> dict:
    summary=engine.usage_today(user["uid"])
    if engine.provider and engine.provider.name == "gemini": summary["estimated_cost_usd"]=None
    return summary
