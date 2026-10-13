"""The Anthropic adapter, run through the real SDK against a fake HTTP server.

No network and no key: `httpx2.MockTransport` plays the Messages API, including its
server-sent-event stream, so the SDK's own parsing of text deltas, tool_use blocks, stop
reasons and usage is what the adapter is tested against.
"""
import asyncio
import json

import anthropic
import httpx2
import pytest
from ai_fakes import make_settings

from app.ai.providers.anthropic_provider import AnthropicProvider
from app.ai.providers.base import Finished, ProviderError, TextDelta


def sse(*events: tuple[str, dict]) -> bytes:
    return b"".join(f"event: {name}\ndata: {json.dumps(data)}\n\n".encode() for name, data in events)


def message_stream(text: str, tool: tuple[str, str, dict] | None = None, stop: str = "end_turn") -> bytes:
    evs = [
        (
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [],
                    "stop_reason": None, "stop_sequence": None,
                    "usage": {"input_tokens": 321, "output_tokens": 1, "cache_read_input_tokens": 300, "cache_creation_input_tokens": 0},
                },
            },
        ),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
    ]
    for part in (text[: len(text) // 2], text[len(text) // 2 :]):
        evs.append(("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": part}}))
    evs.append(("content_block_stop", {"type": "content_block_stop", "index": 0}))
    if tool:
        tid, name, args = tool
        evs += [
            ("content_block_start", {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": tid, "name": name, "input": {}}}),
            ("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": json.dumps(args)}}),
            ("content_block_stop", {"type": "content_block_stop", "index": 1}),
        ]
    evs += [
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None}, "usage": {"output_tokens": 42}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return sse(*evs)


def provider_for(handler, **settings) -> AnthropicProvider:
    client = anthropic.AsyncAnthropic(
        api_key="test-key",
        base_url="http://anthropic.test",
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
    )
    return AnthropicProvider(make_settings(**settings), client=client)


def collect(provider, **kw):
    async def go():
        return [e async for e in provider.stream_turn(system="SYS", tools=[{"name": "t", "description": "d", "input_schema": {"type": "object"}}], messages=[{"role": "user", "content": "hi"}], user_key="uid-1", **kw)]

    return asyncio.run(go())


def test_streams_text_then_a_finished_turn_with_tool_use_and_usage():
    seen = {}

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen["body"] = json.loads(request.content)
        seen["path"] = request.url.path
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=message_stream("You have 42 percent.", ("toolu_1", "get_battery_level", {}), "tool_use"))

    events = collect(provider_for(handler))
    assert "".join(e.text for e in events if isinstance(e, TextDelta)) == "You have 42 percent."
    finished = events[-1]
    assert isinstance(finished, Finished)
    turn = finished.turn
    assert turn.stop_reason == "tool_use"
    assert [b.type for b in turn.content] == ["text", "tool_use"]
    assert turn.content[1].name == "get_battery_level" and turn.content[1].id == "toolu_1"
    assert (turn.usage.input_tokens, turn.usage.output_tokens, turn.usage.cache_read_tokens) == (321, 42, 300)

    body = seen["body"]
    assert seen["path"] == "/v1/messages" and body["stream"] is True
    assert body["model"] == "claude-opus-5-5" and body["system"] == "SYS"
    assert body["output_config"] == {"effort": "low"}
    assert body["cache_control"] == {"type": "ephemeral"}
    assert "thinking" not in body and "temperature" not in body and "tool_choice" not in body
    assert body["metadata"]["user_id"] != "uid-1" and len(body["metadata"]["user_id"]) == 32
    assert body["tools"][0]["name"] == "t"


def test_model_and_effort_come_from_settings():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=message_stream("ok"))

    collect(provider_for(handler, assistant_model="claude-sonnet-5-5", assistant_effort="medium", assistant_max_output_tokens=512))
    assert seen["body"]["model"] == "claude-sonnet-5-5"
    assert seen["body"]["output_config"] == {"effort": "medium"} and seen["body"]["max_tokens"] == 512


@pytest.mark.parametrize(
    "status,code,retryable",
    [
        (401, "PROVIDER_MISCONFIGURED", False),
        (403, "PROVIDER_MISCONFIGURED", False),
        (429, "PROVIDER_BUSY", True),
        (400, "PROVIDER_REJECTED", False),
        (500, "PROVIDER_ERROR", True),
        (529, "PROVIDER_ERROR", True),
    ],
)
def test_http_errors_become_safe_provider_errors(status, code, retryable):
    def handler(request):
        return httpx2.Response(status, json={"type": "error", "error": {"type": "api_error", "message": "secret upstream detail"}})

    with pytest.raises(ProviderError) as e:
        collect(provider_for(handler))
    assert e.value.code == code and e.value.retryable is retryable
    assert "secret upstream detail" not in e.value.message


def test_network_failure_and_timeout_are_retryable_provider_errors():
    def down(request):
        raise httpx2.ConnectError("no route", request=request)

    def slow(request):
        raise httpx2.ReadTimeout("slow", request=request)

    with pytest.raises(ProviderError) as e:
        collect(provider_for(down))
    assert e.value.code == "PROVIDER_UNREACHABLE" and e.value.retryable
    with pytest.raises(ProviderError) as e:
        collect(provider_for(slow))
    assert e.value.code == "PROVIDER_TIMEOUT" and e.value.retryable


def test_opt_in_refusal_fallback_uses_the_beta_endpoint():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        seen["beta"] = request.headers.get("anthropic-beta", "")
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=message_stream("ok"))

    collect(provider_for(handler, assistant_refusal_fallback=True))
    assert seen["body"]["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in seen["beta"]
