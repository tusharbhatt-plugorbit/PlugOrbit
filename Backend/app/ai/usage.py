"""Usage metering and cost estimates.

Counts tokens per user per UTC day (the daily budget reads this), keeps process-wide
totals, and logs one structured line per finished turn: no message text, no user id, only
an opaque hash. Prices are list prices per million tokens and are estimates for monitoring,
not an invoice.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field

from .providers.base import ModelUsage

log = logging.getLogger("plugorbit.assistant.usage")

# USD per million tokens: (input, output, cache read, cache write 5m). Check
# https://platform.claude.com/docs/en/about-claude/pricing before relying on these.
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20, 2.50),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
}


def estimate_cost_usd(model: str, usage: ModelUsage) -> float:
    price = PRICES.get(model)
    if price is None:
        return 0.0
    inp, out, cread, cwrite = price
    return round(
        (usage.input_tokens * inp + usage.output_tokens * out + usage.cache_read_tokens * cread + usage.cache_write_tokens * cwrite)
        / 1_000_000,
        6,
    )


def _day(now: float | None = None) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(now))


@dataclass
class DayUsage:
    day: str
    tokens: int = 0
    turns: int = 0
    model_calls: int = 0
    cost_usd: float = 0.0


@dataclass
class Totals:
    turns: int = 0
    errors: int = 0
    model_calls: int = 0
    tokens: int = 0
    cost_usd: float = 0.0
    by_outcome: dict[str, int] = field(default_factory=dict)


class UsageMeter:
    def __init__(self) -> None:
        self._by_user: dict[str, DayUsage] = {}
        self.totals = Totals()

    def _entry(self, uid: str, now: float | None = None) -> DayUsage:
        day = _day(now)
        entry = self._by_user.get(uid)
        if entry is None or entry.day != day:
            entry = DayUsage(day=day)
            self._by_user[uid] = entry
        return entry

    def tokens_today(self, uid: str, now: float | None = None) -> int:
        return self._entry(uid, now).tokens

    def today(self, uid: str, now: float | None = None) -> DayUsage:
        return self._entry(uid, now)

    def charge(self, uid: str, *, model: str, usage: ModelUsage, now: float | None = None) -> float:
        """Add one model call to the user's day. Called per call, so a turn that is cut
        short still counts against the daily budget."""
        cost = estimate_cost_usd(model, usage)
        entry = self._entry(uid, now)
        entry.tokens += usage.billable_tokens
        entry.model_calls += 1
        entry.cost_usd = round(entry.cost_usd + cost, 6)
        t = self.totals
        t.model_calls += 1
        t.tokens += usage.billable_tokens
        t.cost_usd = round(t.cost_usd + cost, 6)
        return cost

    def finish_turn(
        self,
        uid: str,
        *,
        model: str,
        usage: ModelUsage,
        model_calls: int,
        outcome: str,
        latency_ms: int,
        tool_rounds: int,
        now: float | None = None,
    ) -> None:
        self._entry(uid, now).turns += 1
        t = self.totals
        t.turns += 1
        t.by_outcome[outcome] = t.by_outcome.get(outcome, 0) + 1
        if outcome != "ok":
            t.errors += 1
        log.info(
            json.dumps(
                {
                    "event": "assistant_turn",
                    "user": hashlib.sha256(uid.encode()).hexdigest()[:12],
                    "model": model,
                    "outcome": outcome,
                    "latency_ms": latency_ms,
                    "tool_rounds": tool_rounds,
                    "model_calls": model_calls,
                    "input_tokens": usage.input_tokens,
                    "output_tokens": usage.output_tokens,
                    "cache_read_tokens": usage.cache_read_tokens,
                    "est_cost_usd": estimate_cost_usd(model, usage),
                },
                separators=(",", ":"),
            )
        )
