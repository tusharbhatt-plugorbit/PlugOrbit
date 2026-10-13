"""Claude via the official Anthropic SDK (async, streaming)."""

from __future__ import annotations

import hashlib
import logging
from typing import Any, AsyncIterator

from ..settings import AiSettings
from .base import Finished, ModelTurn, ModelUsage, ProviderError, TextDelta

log = logging.getLogger("plugorbit.assistant.provider")

FALLBACK_BETA = "server-side-fallback-2026-07-01"


def _usage_of(raw: Any) -> ModelUsage:
    if raw is None:
        return ModelUsage()
    return ModelUsage(
        input_tokens=int(getattr(raw, "input_tokens", 0) or 0),
        output_tokens=int(getattr(raw, "output_tokens", 0) or 0),
        cache_read_tokens=int(getattr(raw, "cache_read_input_tokens", 0) or 0),
        cache_write_tokens=int(getattr(raw, "cache_creation_input_tokens", 0) or 0),
    )


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, settings: AiSettings, client: Any | None = None):
        self._settings = settings
        self.model = settings.assistant_model
        if client is None:
            import anthropic  # imported late so the rest of the API runs without the SDK

            # One retry: a voice answer that needs a third attempt is already too late.
            client = anthropic.AsyncAnthropic(
                api_key=settings.anthropic_api_key,
                timeout=settings.assistant_request_timeout_s,
                max_retries=1,
            )
        self._client = client

    def _request(self, system: str, tools: list[dict[str, Any]], messages: list[dict[str, Any]], user_key: str) -> dict[str, Any]:
        s = self._settings
        params: dict[str, Any] = {
            "model": s.assistant_model,
            "max_tokens": s.assistant_max_output_tokens,
            "system": system,
            "tools": tools,
            "messages": messages,
            # Thinking is left at the model default (adaptive). Effort is what trades
            # depth for speed; the deterministic tools already did the arithmetic.
            "output_config": {"effort": s.assistant_effort},
            # Caches tools + system + the conversation so far: the next turn only pays
            # for what is new.
            "cache_control": {"type": "ephemeral"},
            # Opaque, stable per user, so the provider can attribute abuse without PII.
            "metadata": {"user_id": hashlib.sha256(user_key.encode()).hexdigest()[:32]},
        }
        if s.assistant_refusal_fallback:
            params["betas"] = [FALLBACK_BETA]
            params["fallbacks"] = "default"
        return params

    async def stream_turn(
        self, *, system: str, tools: list[dict[str, Any]], messages: list[dict[str, Any]], user_key: str
    ) -> AsyncIterator[TextDelta | Finished]:
        import anthropic

        params = self._request(system, tools, messages, user_key)
        api = self._client.beta.messages if self._settings.assistant_refusal_fallback else self._client.messages
        try:
            async with api.stream(**params) as stream:
                async for event in stream:
                    if event.type == "text" and event.text:
                        yield TextDelta(event.text)
                final = await stream.get_final_message()
        except anthropic.APITimeoutError as exc:
            raise ProviderError(
                "PROVIDER_TIMEOUT", "The assistant took too long to answer.", retryable=True, detail=str(exc)
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError(
                "PROVIDER_UNREACHABLE", "The assistant service can't be reached right now.", retryable=True, detail=str(exc)
            ) from exc
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as exc:
            log.error("provider credentials rejected: %s", exc)
            raise ProviderError(
                "PROVIDER_MISCONFIGURED", "The assistant isn't set up correctly on the server.", retryable=False, detail=str(exc)
            ) from exc
        except anthropic.RateLimitError as exc:
            raise ProviderError(
                "PROVIDER_BUSY", "The assistant is busy. Try again in a moment.", retryable=True, detail=str(exc)
            ) from exc
        except anthropic.BadRequestError as exc:
            log.error("provider rejected the request: %s", exc)
            raise ProviderError(
                "PROVIDER_REJECTED", "The assistant couldn't process that request.", retryable=False, detail=str(exc)
            ) from exc
        except anthropic.APIStatusError as exc:
            raise ProviderError(
                "PROVIDER_ERROR", "The assistant service had a problem.", retryable=exc.status_code >= 500, detail=str(exc)
            ) from exc

        yield Finished(
            ModelTurn(
                content=list(final.content),
                stop_reason=final.stop_reason,
                usage=_usage_of(final.usage),
                model=getattr(final, "model", self.model) or self.model,
            )
        )
