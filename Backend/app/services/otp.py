"""
One-time codes for the login/signup screen: identifier normalisation, code generation
and the store that issues and verifies them.

The store is a plain in-memory dict guarded by a lock. That is a single-process
development store: codes are lost on restart and are not shared between workers, so
run uvicorn with one worker while using it.
"""
import hashlib
import hmac
import logging
import math
import re
import secrets
import threading
import time
from dataclasses import dataclass

from fastapi import HTTPException, status

from ..config import get_settings

log = logging.getLogger(__name__)

MAX_IDENTIFIER_LENGTH = 254

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_SEPARATORS_RE = re.compile(r"[\s\-().]")
_PHONE_RE = re.compile(r"\+?[0-9]+")  # ASCII only: \d would also match Arabic-Indic / fullwidth digits


@dataclass
class _Entry:
    salt: bytes
    digest: bytes  # salted hash of the code, the code itself is never stored
    sent_at: float
    expires_at: float
    attempts: int = 0
    locked: bool = False  # kept after too many wrong tries so the resend cooldown still applies
    exposed: bool = False  # the code was returned to whoever asked for it (dev fallback)


_store: dict[str, _Entry] = {}
_lock = threading.Lock()


def _now() -> float:
    """Clock for expiry and cooldown. Module-level so tests can control time."""
    return time.monotonic()


def _error(http_status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=http_status, detail={"code": code, "message": message, **extra})


def _invalid_identifier() -> HTTPException:
    return _error(status.HTTP_400_BAD_REQUEST, "INVALID_IDENTIFIER",
                  "Enter a valid email address or mobile number.")


def _normalize_phone(value: str) -> str | None:
    """E.164 form of a typed mobile number, or None when it is not a plausible number."""
    compact = _PHONE_SEPARATORS_RE.sub("", value)
    if not _PHONE_RE.fullmatch(compact):
        return None
    if compact.startswith("+"):
        digits = compact[1:]
    elif compact.startswith("00"):
        digits = compact[2:]
    else:
        digits = compact.lstrip("0")  # drop the national trunk prefix
    if not 7 <= len(digits) <= 15 or digits.startswith("0"):
        return None
    if not compact.startswith(("+", "00")) and len(digits) <= 10:
        digits = re.sub(r"\D", "", get_settings().default_country_code) + digits
    return "+" + digits


def normalize_identifier(raw: str) -> tuple[str, str]:
    """Return (type, key) for what the user typed: ("email", "a@b.co") or ("phone", "+919876543210").
    The key identifies the user in the store, so send and verify must both go through here."""
    value = (raw or "").strip()
    if not value or len(value) > MAX_IDENTIFIER_LENGTH:
        raise _invalid_identifier()
    if "@" in value:
        email = value.lower()
        if not _EMAIL_RE.match(email):
            raise _invalid_identifier()
        return "email", email
    phone = _normalize_phone(value)
    if phone is None:
        raise _invalid_identifier()
    return "phone", phone


def generate_code() -> str:
    length = get_settings().otp_length
    return f"{secrets.randbelow(10 ** length):0{length}d}"


def _digest(salt: bytes, code: str) -> bytes:
    return hashlib.sha256(salt + code.encode()).digest()


def _purge_expired(now: float) -> None:
    for key in [k for k, entry in _store.items() if entry.expires_at <= now]:
        del _store[key]


def issue(key: str) -> str:
    """Create a fresh code for `key`, replacing any earlier one, and return it.
    Raises 429 OTP_RATE_LIMITED while the resend cooldown of the previous code is running."""
    settings = get_settings()
    with _lock:
        now = _now()
        _purge_expired(now)
        previous = _store.get(key)
        if previous is not None and settings.otp_resend_seconds > 0:
            wait = previous.sent_at + settings.otp_resend_seconds - now
            if wait > 0:
                raise _error(status.HTTP_429_TOO_MANY_REQUESTS, "OTP_RATE_LIMITED",
                             f"Please wait {math.ceil(wait)}s before requesting another code.",
                             retry_after=math.ceil(wait))
        code = generate_code()
        salt = secrets.token_bytes(16)
        _store[key] = _Entry(salt=salt, digest=_digest(salt, code), sent_at=now,
                             expires_at=now + settings.otp_ttl_seconds)
    return code


def discard(key: str, code: str) -> None:
    """Drop `code` again when delivery failed, unless a newer code has replaced it meanwhile."""
    with _lock:
        entry = _store.get(key)
        if entry is not None and hmac.compare_digest(entry.digest, _digest(entry.salt, code)):
            del _store[key]


def mark_exposed(key: str, code: str) -> None:
    """Record that `code` was handed back in the API response instead of being delivered,
    so verifying it must not be treated as proof of owning the email / number."""
    with _lock:
        entry = _store.get(key)
        if entry is not None and hmac.compare_digest(entry.digest, _digest(entry.salt, code)):
            entry.exposed = True


def verify(key: str, code: str) -> bool:
    """Consume the code for `key` if `code` matches and return whether it had been exposed
    (see mark_exposed). Raises OTP_EXPIRED / OTP_INVALID / OTP_TOO_MANY_ATTEMPTS otherwise."""
    max_attempts = get_settings().otp_max_attempts
    with _lock:
        now = _now()
        _purge_expired(now)
        entry = _store.get(key)
        if entry is None:
            raise _error(status.HTTP_400_BAD_REQUEST, "OTP_EXPIRED",
                         "This code has expired or was already used. Request a new one.")
        if entry.locked:
            raise _error(status.HTTP_429_TOO_MANY_REQUESTS, "OTP_TOO_MANY_ATTEMPTS",
                         "Too many wrong attempts. Request a new code.")
        if hmac.compare_digest(entry.digest, _digest(entry.salt, (code or "").strip())):
            del _store[key]  # single use
            return entry.exposed
        entry.attempts += 1
        if entry.attempts >= max_attempts:
            entry.locked = True
            raise _error(status.HTTP_429_TOO_MANY_REQUESTS, "OTP_TOO_MANY_ATTEMPTS",
                         "Too many wrong attempts. Request a new code.")
        raise _error(status.HTTP_400_BAD_REQUEST, "OTP_INVALID", "Incorrect code. Try again.",
                     attempts_left=max_attempts - entry.attempts)


def reset() -> None:
    """Forget every code (used by tests)."""
    with _lock:
        _store.clear()

