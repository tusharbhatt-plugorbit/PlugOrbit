"""Per-user request limits.

Two sliding windows (new driver turns, and every HTTP call including tool round-trips) plus
the daily token budget in `usage.py`. In-memory and per process: with several server
processes the effective limit is multiplied, which is acceptable for abuse protection and
should be replaced by a shared counter if hard guarantees are needed.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_s: float = 60.0):
        self._limit = limit
        self._window = window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str, now: float | None = None) -> tuple[bool, int]:
        """Record an attempt. Returns (allowed, seconds_until_a_slot_frees)."""
        now = time.monotonic() if now is None else now
        q = self._hits[key]
        while q and now - q[0] >= self._window:
            q.popleft()
        if len(q) >= self._limit:
            return False, max(1, int(self._window - (now - q[0])) + 1)
        q.append(now)
        return True, 0

    def prune(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        for key in [k for k, q in self._hits.items() if not q or now - q[-1] >= self._window]:
            del self._hits[key]
