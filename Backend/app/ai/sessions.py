"""Conversation sessions.

A session holds the running conversation for one signed-in user. It is keyed by
(user id, session id), so one user can never read or continue another's.

Memory only: sessions expire after a period of inactivity and vanish on restart, which is
the intended privacy posture (no conversation is written to disk or to Firestore). The
`SessionStore` interface is the seam for a shared store (Redis) when more than one
server process is run; see docs/ASSISTANT_AI.md.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from .providers.base import ModelUsage
from .schemas import ProposedAction, SourceInfo


@dataclass
class PendingTurn:
    """A turn paused while the phone runs the tools the model asked for."""

    turn_id: str
    user_text: str
    # (tool_use id, tool name) the phone must answer, in the order the model asked.
    device_calls: list[tuple[str, str]]
    # tool_result blocks the gateway already produced (propose_action, ...) in the same step.
    ready_results: list[dict[str, Any]]
    expires_at: float
    rounds: int
    spoken: list[str] = field(default_factory=list)
    actions: list[ProposedAction] = field(default_factory=list)
    sources: list[SourceInfo] = field(default_factory=list)
    usage: ModelUsage = field(default_factory=ModelUsage)
    model_calls: int = 0
    started_at: float = field(default_factory=time.monotonic)


@dataclass
class Session:
    id: str
    uid: str
    created_at: float
    last_used: float
    # Compact history: plain user / assistant text. Tool exchanges and thinking blocks of
    # finished turns are dropped, so every request replays a clean, append-only prefix.
    history: list[dict[str, Any]] = field(default_factory=list)
    # The in-flight turn's messages, kept verbatim (including the provider's own content
    # blocks) until the turn ends.
    turn_messages: list[Any] = field(default_factory=list)
    pending: PendingTurn | None = None
    busy_since: float | None = None

    def acquire(self, now: float, stale_after: float) -> bool:
        if self.busy_since is not None and now - self.busy_since < stale_after:
            return False
        self.busy_since = now
        return True

    def release(self) -> None:
        self.busy_since = None


class InMemorySessionStore:
    def __init__(self, ttl_s: int, max_per_user: int):
        self._ttl = ttl_s
        self._max = max_per_user
        self._sessions: dict[tuple[str, str], Session] = {}

    def _alive(self, s: Session, now: float) -> bool:
        return now - s.last_used < self._ttl

    def sweep(self, now: float | None = None) -> int:
        now = time.monotonic() if now is None else now
        dead = [k for k, s in self._sessions.items() if not self._alive(s, now)]
        for k in dead:
            del self._sessions[k]
        return len(dead)

    def create(self, uid: str, now: float | None = None) -> Session:
        now = time.monotonic() if now is None else now
        self.sweep(now)
        mine = sorted((s for s in self._sessions.values() if s.uid == uid), key=lambda s: s.last_used)
        while len(mine) >= self._max:
            oldest = mine.pop(0)
            self._sessions.pop((oldest.uid, oldest.id), None)
        session = Session(id=secrets.token_urlsafe(16), uid=uid, created_at=now, last_used=now)
        self._sessions[(uid, session.id)] = session
        return session

    def get(self, uid: str, session_id: str, now: float | None = None) -> Session | None:
        now = time.monotonic() if now is None else now
        s = self._sessions.get((uid, session_id))
        if s is None:
            return None
        if not self._alive(s, now):
            del self._sessions[(uid, session_id)]
            return None
        return s

    def touch(self, session: Session, now: float | None = None) -> None:
        session.last_used = time.monotonic() if now is None else now

    def delete(self, uid: str, session_id: str) -> bool:
        return self._sessions.pop((uid, session_id), None) is not None

    def delete_all(self, uid: str) -> int:
        keys = [k for k in self._sessions if k[0] == uid]
        for k in keys:
            del self._sessions[k]
        return len(keys)

    def count(self) -> int:
        return len(self._sessions)
