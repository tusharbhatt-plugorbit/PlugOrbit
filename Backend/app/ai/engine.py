"""The tool-use loop.

A driver turn runs like this:

    prepare()  validates the request, applies the limits, finds or creates the session
    events()   streams the model, runs gateway tools in place, and when the model asks for
               device tools ends the stream with `tool_requests`; the app answers in a
               second request and `prepare()` + `events()` pick the same turn up again.

What is kept between turns is deliberately small: the driver's words and what Orbit said
(plain text). Tool exchanges and the model's thinking from a finished turn are dropped, so
data from earlier in the conversation is re-checked rather than trusted, and the replayed
history is always an append-only prefix.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable

from .providers.base import Finished, LLMProvider, ModelUsage, ProviderError, TextDelta
from .prompt import SYSTEM_PROMPT
from .ratelimit import SlidingWindowLimiter
from .schemas import ClientContext, ProposedAction, SourceInfo, ToolResult, TurnRequest, UsageInfo
from .sessions import InMemorySessionStore, PendingTurn, Session
from .settings import AiSettings
from .tools import (
    ALL_TOOLS,
    ToolInputError,
    action_status,
    api_tool_definitions,
    validate_action_params,
    validate_tool_input,
)
from .usage import UsageMeter, estimate_cost_usd

log = logging.getLogger("plugorbit.assistant")

MAX_ACTIONS_PER_TURN = 4
MAX_STRING_IN_TOOL_RESULT = 300
REFUSAL_LINE = "Sorry, I can't help with that one."
EMPTY_LINE = "Sorry, I didn't get an answer together. Could you ask again?"
ROUNDS_LINE = "Sorry, that took too many steps. Could you ask it a little differently?"


class AssistantError(Exception):
    """A problem found before the stream starts. Becomes an HTTP error."""

    def __init__(self, code: str, message: str, status: int = 400, retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retry_after = retry_after


# ------------------------------------------------------------------ rendering --

_TAG = re.compile(r"<\s*/?\s*driver_(context|said)", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(value: str) -> str:
    """Remove control characters and anything that could pose as our own delimiters."""
    return _TAG.sub("(tag removed)", _CONTROL.sub("", value)).strip()


def _clean_json(value: Any) -> Any:
    if isinstance(value, str):
        return clean_text(value)
    if isinstance(value, list):
        return [_clean_json(v) for v in value]
    if isinstance(value, dict):
        return {k: _clean_json(v) for k, v in value.items()}
    return value


def render_user_turn(text: str, ctx: ClientContext) -> str:
    """The user message for a new turn: app context first, the driver's words last.

    The context is facts the app knows about its own settings and what the driver said
    earlier. None of it is verified battery, price or availability data; that only comes
    from tools.
    """
    body: dict[str, Any] = {
        "local_time": ctx.local_time,
        "locale": ctx.locale,
        "voice_language": ctx.voice_language,
        "response_style": ctx.response_style,
        "input_mode": ctx.input_mode,
        "driving_mode": ctx.driving_mode,
        "demo_data": ctx.demo_data,
    }
    if ctx.journey:
        body["journey_stated_by_driver"] = ctx.journey.model_dump(exclude_none=True)
    if ctx.remembered_preferences:
        body["remembered_preferences_unverified"] = [p.model_dump(exclude_none=True) for p in ctx.remembered_preferences]
    if ctx.recent_events:
        body["recent_app_notices"] = [e.model_dump() for e in ctx.recent_events]
    payload = json.dumps(_clean_json({k: v for k, v in body.items() if v is not None}), ensure_ascii=False, separators=(",", ":"))
    return f"<driver_context>\n{payload}\n</driver_context>\n<driver_said>\n{clean_text(text)}\n</driver_said>"


def _clip(value: Any, depth: int = 0) -> Any:
    if depth > 8:
        return None
    if isinstance(value, str):
        return clean_text(value)[:MAX_STRING_IN_TOOL_RESULT]
    if isinstance(value, list):
        return [_clip(v, depth + 1) for v in value[:60]]
    if isinstance(value, dict):
        return {str(k)[:60]: _clip(v, depth + 1) for k, v in list(value.items())[:80]}
    return value


def render_tool_result(result: ToolResult, cap_bytes: int) -> tuple[str, bool]:
    """The tool_result content the model sees, and whether it is an error."""
    envelope: dict[str, Any] = {"status": result.status}
    if result.message:
        envelope["message"] = clean_text(result.message)
    if result.source:
        envelope["source"] = result.source.model_dump(exclude_none=True)
    if result.assumptions:
        envelope["assumptions"] = [clean_text(a) for a in result.assumptions]
    if result.data is not None:
        envelope["data"] = _clip(result.data)
    text = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))
    if len(text.encode()) > cap_bytes:
        envelope["data"] = {"omitted": True, "note": "The result was too large to use. Ask for something narrower."}
        text = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))
    return text, result.status == "error"


# ---------------------------------------------------------------------- engine --


@dataclass
class PreparedTurn:
    engine: "AssistantEngine"
    session: Session
    pending: PendingTurn
    resumed_session: bool
    continuation: bool

    def events(self) -> AsyncIterator[dict[str, Any]]:
        return self.engine._run(self)


class AssistantEngine:
    def __init__(
        self,
        settings: AiSettings,
        provider: LLMProvider | None,
        *,
        sessions: InMemorySessionStore | None = None,
        meter: UsageMeter | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.settings = settings
        self.provider = provider
        self.sessions = sessions or InMemorySessionStore(settings.assistant_session_ttl_s, settings.assistant_max_sessions_per_user)
        self.meter = meter or UsageMeter()
        self._turn_limit = SlidingWindowLimiter(settings.assistant_turns_per_minute)
        self._request_limit = SlidingWindowLimiter(settings.assistant_requests_per_minute)
        self._model_slots = asyncio.Semaphore(settings.assistant_max_concurrent_model_calls)
        self._clock = clock
        self._tools = api_tool_definitions()

    @property
    def enabled(self) -> bool:
        return self.provider is not None

    # ------------------------------------------------------------- preflight --

    def prepare(self, uid: str, req: TurnRequest) -> PreparedTurn:
        if not self.enabled:
            raise AssistantError("ASSISTANT_UNAVAILABLE", "The assistant isn't available right now.", 503)

        now = self._clock()
        ok, wait = self._request_limit.hit(uid, now)
        if not ok:
            raise AssistantError("RATE_LIMITED", "Too many requests. Try again in a moment.", 429, wait)

        is_new = req.message is not None
        has_results = req.tool_results is not None or req.turn_id is not None
        if is_new == has_results:
            raise AssistantError("BAD_REQUEST", "Send either a message or tool results for a turn, not both or neither.", 422)

        return self._prepare_new(uid, req, now) if is_new else self._prepare_continuation(uid, req, now)

    def _prepare_new(self, uid: str, req: TurnRequest, now: float) -> PreparedTurn:
        s = self.settings
        text = clean_text(req.message or "")
        if not text:
            raise AssistantError("EMPTY_MESSAGE", "Say or type something first.", 422)
        if len(text) > s.assistant_max_message_chars:
            raise AssistantError("MESSAGE_TOO_LONG", "That message is too long.", 413)
        if len(req.context.model_dump_json().encode()) > s.assistant_max_context_bytes:
            raise AssistantError("CONTEXT_TOO_LARGE", "Too much context was attached.", 413)

        ok, wait = self._turn_limit.hit(uid, now)
        if not ok:
            raise AssistantError("RATE_LIMITED", "You're asking faster than I can answer. Try again in a moment.", 429, wait)
        if self.meter.tokens_today(uid) >= s.assistant_daily_token_budget:
            raise AssistantError("DAILY_LIMIT", "You've reached today's Orbit Assist limit. It resets tomorrow.", 429)

        session = self.sessions.get(uid, req.session_id, now) if req.session_id else None
        resumed = session is not None
        if session is None:
            session = self.sessions.create(uid, now)
        if not session.acquire(now, s.assistant_request_timeout_s * 3):
            raise AssistantError("TURN_IN_PROGRESS", "Still working on your last question.", 409)

        # A turn the app abandoned half-way (it was closed while running tools) is dropped.
        session.pending = None
        session.turn_messages = [{"role": "user", "content": render_user_turn(text, req.context)}]
        pending = PendingTurn(
            turn_id=secrets.token_urlsafe(12),
            user_text=text,
            device_calls=[],
            ready_results=[],
            expires_at=0.0,
            rounds=0,
        )
        return PreparedTurn(self, session, pending, resumed, continuation=False)

    def _prepare_continuation(self, uid: str, req: TurnRequest, now: float) -> PreparedTurn:
        s = self.settings
        if not req.session_id or not req.turn_id or req.tool_results is None:
            raise AssistantError("BAD_REQUEST", "session_id, turn_id and tool_results are all required.", 422)
        session = self.sessions.get(uid, req.session_id, now)
        if session is None:
            raise AssistantError("SESSION_NOT_FOUND", "That conversation has ended. Ask again to start a new one.", 404)
        pending = session.pending
        if pending is None or pending.turn_id != req.turn_id:
            raise AssistantError("TURN_NOT_FOUND", "That question is no longer waiting for tool results.", 409)
        if now > pending.expires_at:
            session.pending = None
            session.turn_messages = []
            raise AssistantError("TURN_EXPIRED", "Tool results arrived too late. Ask again.", 410)
        wanted = [call_id for call_id, _ in pending.device_calls]
        got = [r.tool_use_id for r in req.tool_results]
        if sorted(wanted) != sorted(got) or len(set(got)) != len(got):
            raise AssistantError("TOOL_RESULTS_MISMATCH", "Tool results don't match the tools that were requested.", 422)
        if not session.acquire(now, s.assistant_request_timeout_s * 3):
            raise AssistantError("TURN_IN_PROGRESS", "Still working on your last question.", 409)

        by_id = {r.tool_use_id: r for r in req.tool_results}
        blocks: list[dict[str, Any]] = list(pending.ready_results)
        for call_id, name in pending.device_calls:
            result = by_id[call_id]
            content, is_error = render_tool_result(result, s.assistant_max_tool_result_bytes)
            blocks.append({"type": "tool_result", "tool_use_id": call_id, "content": content, **({"is_error": True} if is_error else {})})
            pending.sources.append(
                SourceInfo(
                    tool=name,
                    system=result.source.system if result.source else None,
                    kind=result.source.kind if result.source else None,
                    as_of=result.source.as_of if result.source else None,
                    demo=result.source.demo if result.source else False,
                    trust=result.source.trust if result.source else None,
                    status=result.status,
                )
            )
        session.turn_messages.append({"role": "user", "content": blocks})
        pending.device_calls = []
        pending.ready_results = []
        session.pending = None
        return PreparedTurn(self, session, pending, resumed_session=True, continuation=True)

    # ----------------------------------------------------------------- stream --

    async def _run(self, prepared: PreparedTurn) -> AsyncIterator[dict[str, Any]]:
        s = self.settings
        session, pending = prepared.session, prepared.pending
        uid = session.uid
        started = self._clock()
        outcome = "ok"
        handed_off = False
        finished = False
        yield {"type": "session", "session_id": session.id, "turn_id": pending.turn_id, "resumed": prepared.resumed_session}
        try:
            while True:
                if pending.rounds >= s.assistant_max_tool_rounds:
                    outcome = "too_many_rounds"
                    pending.spoken.append(ROUNDS_LINE)
                    yield {"type": "text", "delta": ROUNDS_LINE}
                    break
                pending.rounds += 1

                final = None
                try:
                    await asyncio.wait_for(self._model_slots.acquire(), timeout=5)
                except asyncio.TimeoutError:
                    raise ProviderError("PROVIDER_BUSY", "The assistant is busy. Try again in a moment.", retryable=True)
                try:
                    async for event in self.provider.stream_turn(  # type: ignore[union-attr]
                        system=SYSTEM_PROMPT,
                        tools=self._tools,
                        messages=session.history + session.turn_messages,
                        user_key=uid,
                    ):
                        if isinstance(event, TextDelta):
                            pending.spoken.append(event.text)
                            yield {"type": "text", "delta": event.text}
                        elif isinstance(event, Finished):
                            final = event.turn
                finally:
                    self._model_slots.release()
                if final is None:
                    raise ProviderError("PROVIDER_ERROR", "The assistant service had a problem.", retryable=True)

                pending.usage.add(final.usage)
                pending.model_calls += 1
                self.meter.charge(uid, model=final.model or self.provider.model, usage=final.usage)  # type: ignore[union-attr]
                session.turn_messages.append({"role": "assistant", "content": final.content})

                if final.stop_reason == "refusal":
                    outcome = "refused"
                    pending.spoken.append(REFUSAL_LINE)
                    yield {"type": "text", "delta": REFUSAL_LINE}
                    break
                if final.stop_reason == "pause_turn":
                    continue
                if final.stop_reason != "tool_use":
                    break

                results: list[dict[str, Any]] = []
                device_calls: list[tuple[str, str]] = []
                requests: list[dict[str, Any]] = []
                for block in (b for b in final.content if getattr(b, "type", None) == "tool_use"):
                    call_id, name, raw = block.id, block.name, block.input
                    spec = ALL_TOOLS.get(name)
                    try:
                        args = validate_tool_input(name, raw)
                    except ToolInputError as exc:
                        results.append(_error_block(call_id, f"Invalid arguments: {exc}"))
                        continue
                    if spec is None:  # unreachable after validation, kept for safety
                        results.append(_error_block(call_id, "Unknown tool."))
                    elif spec.where == "device":
                        device_calls.append((call_id, name))
                        requests.append({"id": call_id, "name": name, "input": args})
                    else:
                        block_result, events = self._run_gateway_tool(call_id, name, args, pending)
                        results.append(block_result)
                        for ev in events:
                            yield ev

                if device_calls:
                    pending.device_calls = device_calls
                    pending.ready_results = results
                    pending.expires_at = self._clock() + s.assistant_pending_ttl_s
                    session.pending = pending
                    self.sessions.touch(session, self._clock())
                    handed_off = True
                    yield {"type": "tool_requests", "turn_id": pending.turn_id, "calls": requests}
                    return
                session.turn_messages.append({"role": "user", "content": results})

            finished = True
        except ProviderError as exc:
            outcome = exc.code.lower()
            if exc.detail:
                log.warning("provider error %s: %s", exc.code, exc.detail)
            yield {"type": "error", "code": exc.code, "message": exc.message, "retryable": exc.retryable}
        except (asyncio.CancelledError, GeneratorExit):
            outcome = "client_closed"
            raise
        except Exception:  # noqa: BLE001 - the stream must end with an event, never a stack trace
            outcome = "internal_error"
            log.exception("assistant turn failed")
            yield {"type": "error", "code": "INTERNAL", "message": "Something went wrong on our side.", "retryable": True}
        finally:
            session.release()
            if not handed_off:
                self._end_turn(session, pending, outcome, started, completed=finished)

        if not finished:
            return
        if pending.actions:
            yield {"type": "actions", "actions": [a.model_dump() for a in pending.actions]}
        yield {
            "type": "done",
            "outcome": outcome,
            "usage": UsageInfo(
                input_tokens=pending.usage.input_tokens,
                output_tokens=pending.usage.output_tokens,
                cache_read_tokens=pending.usage.cache_read_tokens,
                cache_write_tokens=pending.usage.cache_write_tokens,
                model_calls=pending.model_calls,
                estimated_cost_usd=estimate_cost_usd(self.provider.model, pending.usage),  # type: ignore[union-attr]
            ).model_dump(),
            "sources": [src.model_dump() for src in pending.sources],
        }

    def _end_turn(self, session: Session, pending: PendingTurn, outcome: str, started: float, *, completed: bool) -> None:
        """Fold a finished turn into the compact history, or drop an unfinished one."""
        if completed:
            spoken = "".join(pending.spoken).strip() or EMPTY_LINE
            session.history.append({"role": "user", "content": pending.user_text})
            session.history.append({"role": "assistant", "content": spoken})
            limit = self.settings.assistant_max_history_turns * 2
            if len(session.history) > limit:
                session.history = session.history[-limit:]
        session.turn_messages = []
        session.pending = None
        self.sessions.touch(session, self._clock())
        self.meter.finish_turn(
            session.uid,
            model=self.provider.model if self.provider else "",
            usage=pending.usage,
            model_calls=pending.model_calls,
            outcome=outcome,
            latency_ms=int((self._clock() - started) * 1000),
            tool_rounds=pending.rounds,
        )

    # --------------------------------------------------------- gateway tools --

    def _run_gateway_tool(
        self, call_id: str, name: str, args: dict[str, Any], pending: PendingTurn
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        if name == "update_journey_memory":
            patch = {k: v for k, v in args.items() if v is not None}
            if not patch:
                return _error_block(call_id, "Nothing to remember."), []
            return (
                {"type": "tool_result", "tool_use_id": call_id, "content": '{"status":"ok","message":"Remembered for this journey."}'},
                [{"type": "memory", "patch": patch}],
            )

        # propose_action
        kind = args["kind"]
        try:
            params = validate_action_params(kind, args.get("params", {}))
        except ToolInputError as exc:
            return _error_block(call_id, f"Invalid action: {exc}"), []
        if len(pending.actions) >= MAX_ACTIONS_PER_TURN:
            return _error_block(call_id, "Too many buttons already offered this turn."), []
        action = ProposedAction(
            id=secrets.token_urlsafe(8),
            kind=kind,
            label=clean_text(args["label"]),
            detail=clean_text(args["detail"]) if args.get("detail") else None,
            params=params,
            status=action_status(kind),  # type: ignore[arg-type]
        )
        if not any(a.kind == action.kind and a.params == action.params for a in pending.actions):
            pending.actions.append(action)
        waits = action.status == "pending_approval"
        message = (
            "Button shown. It changes something, so nothing has happened until the driver approves it in the app."
            if waits
            else "Button shown. The driver can tap it to open it."
        )
        return {"type": "tool_result", "tool_use_id": call_id, "content": json.dumps({"status": "ok", "message": message})}, []

    # ------------------------------------------------------------------ misc --

    def clear_session(self, uid: str, session_id: str) -> bool:
        return self.sessions.delete(uid, session_id)

    def clear_all(self, uid: str) -> int:
        return self.sessions.delete_all(uid)

    def usage_today(self, uid: str) -> dict[str, Any]:
        d = self.meter.today(uid)
        return {
            "day": d.day,
            "tokens": d.tokens,
            "turns": d.turns,
            "model_calls": d.model_calls,
            "estimated_cost_usd": d.cost_usd,
            "daily_token_budget": self.settings.assistant_daily_token_budget,
        }


def _error_block(call_id: str, message: str) -> dict[str, Any]:
    return {
        "type": "tool_result",
        "tool_use_id": call_id,
        "content": json.dumps({"status": "error", "message": message}),
        "is_error": True,
    }
