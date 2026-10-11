"""The one interface the engine needs from a language model.

Keeping it this small is what makes the provider swappable (a different vendor, or a
smaller model for cost) without touching the tool loop, and what lets the tests drive the
whole gateway with a scripted fake.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol


class ProviderError(Exception):
    """A model-provider failure, already reduced to something safe to show the app."""

    def __init__(self, code: str, message: str, *, retryable: bool, detail: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        # For server logs only. Never sent to the app.
        self.detail = detail


@dataclass
class ModelUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    def add(self, other: "ModelUsage") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.cache_write_tokens += other.cache_write_tokens

    @property
    def billable_tokens(self) -> int:
        return self.input_tokens + self.output_tokens + self.cache_write_tokens + self.cache_read_tokens


@dataclass
class ModelTurn:
    """One finished model response."""

    # The assistant content blocks exactly as the provider returned them. They are sent
    # back unchanged while a tool loop is in flight (thinking blocks must not be edited).
    content: list[Any]
    stop_reason: str | None
    usage: ModelUsage = field(default_factory=ModelUsage)
    model: str = ""


@dataclass
class TextDelta:
    text: str


@dataclass
class Finished:
    turn: ModelTurn


class LLMProvider(Protocol):
    name: str
    model: str

    def stream_turn(
        self,
        *,
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        user_key: str,
    ) -> AsyncIterator[TextDelta | Finished]:
        """Yield `TextDelta`s as they arrive, then one `Finished`. Raise `ProviderError`."""
        ...
