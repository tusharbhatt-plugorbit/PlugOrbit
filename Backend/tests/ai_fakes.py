"""Test doubles for the AI gateway: a scripted model, and helpers to drive the engine."""
import asyncio
from typing import Any

from anthropic.types import TextBlock, ToolUseBlock

from app.ai.engine import AssistantEngine
from app.ai.providers.base import Finished, ModelTurn, ModelUsage, TextDelta
from app.ai.schemas import ClientContext, TurnRequest
from app.ai.settings import AiSettings


def make_settings(**overrides: Any) -> AiSettings:
    base = dict(
        anthropic_api_key="test-key",
        assistant_turns_per_minute=100,
        assistant_requests_per_minute=1000,
    )
    base.update(overrides)
    return AiSettings(_env_file=None, **base)


def call(call_id: str, name: str, **args: Any) -> ToolUseBlock:
    return ToolUseBlock(type="tool_use", id=call_id, name=name, input=args)


class Reply:
    """One scripted model response: some spoken text and/or tool calls."""

    def __init__(self, text: str = "", calls: list[ToolUseBlock] | None = None, stop_reason: str | None = None, usage=(100, 20)):
        self.text = text
        self.calls = calls or []
        self.stop_reason = stop_reason or ("tool_use" if self.calls else "end_turn")
        self.usage = usage


class ScriptedProvider:
    name = "scripted"
    model = "claude-opus-5-5"

    def __init__(self, replies: list[Reply | Exception]):
        self.replies = list(replies)
        self.requests: list[dict[str, Any]] = []

    async def stream_turn(self, *, system, tools, messages, user_key):
        self.requests.append({"system": system, "tools": tools, "messages": list(messages), "user_key": user_key})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        content: list[Any] = []
        if reply.text:
            half = max(1, len(reply.text) // 2)
            for part in (reply.text[:half], reply.text[half:]):
                if part:
                    yield TextDelta(part)
            content.append(TextBlock(type="text", text=reply.text))
        content.extend(reply.calls)
        yield Finished(
            ModelTurn(
                content=content,
                stop_reason=reply.stop_reason,
                usage=ModelUsage(input_tokens=reply.usage[0], output_tokens=reply.usage[1]),
                model=self.model,
            )
        )


def make_engine(replies: list[Reply | Exception], **settings: Any) -> tuple[AssistantEngine, ScriptedProvider]:
    provider = ScriptedProvider(replies)
    return AssistantEngine(make_settings(**settings), provider), provider


def say(text: str, session_id: str | None = None, **ctx: Any) -> TurnRequest:
    return TurnRequest(session_id=session_id, message=text, context=ClientContext(**ctx))


def results(session_id: str, turn_id: str, *items: dict[str, Any]) -> TurnRequest:
    return TurnRequest.model_validate({"session_id": session_id, "turn_id": turn_id, "tool_results": list(items)})


def ok(tool_use_id: str, data: Any = None, **extra: Any) -> dict[str, Any]:
    return {"tool_use_id": tool_use_id, "status": "ok", "data": data, **extra}


def run(engine: AssistantEngine, uid: str, req: TurnRequest) -> list[dict[str, Any]]:
    """Run one HTTP call of a turn to completion and return its events."""

    async def go() -> list[dict[str, Any]]:
        prepared = engine.prepare(uid, req)
        return [e async for e in prepared.events()]

    return asyncio.run(go())


def of_type(events: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [e for e in events if e["type"] == kind]


def spoken(events: list[dict[str, Any]]) -> str:
    return "".join(e["delta"] for e in of_type(events, "text"))
