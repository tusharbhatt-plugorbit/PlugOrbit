"""
Turn a verified one-time code into a Firebase sign-in.

The login screen proves ownership of an email or mobile number with a code (services/otp.py).
Here that proof becomes a real Firebase account: find or create the user for the identifier,
mint a custom token with the Admin SDK and exchange it for ID + refresh tokens over the
Identity Toolkit REST API (the Backend already holds the Web API key). The app never needs the
Firebase client SDK, and every later request is authorised by the ID token.

Opening a session is best effort: the code is already consumed, so when Firebase is missing or
down the caller still gets "verified" and the app signs in locally, as it did before Firebase.
"""
import logging
import secrets
from typing import Literal

import firebase_admin
from fastapi import HTTPException
from firebase_admin import auth

from ..config import get_settings
from ..schemas import AuthResponse, UserOut
from . import firebase_auth as fb
from . import users

log = logging.getLogger(__name__)

SessionStatus = Literal["ready", "unavailable", "dev_code"]


def _lookup(kind: str, key: str):
    return auth.get_user_by_email(key) if kind == "email" else auth.get_user_by_phone_number(key)


def resolve_user(kind: str, key: str):
    """The Firebase user for a verified email / E.164 number, created on first sign-in.
    Raises 403 USER_DISABLED for an account an admin has disabled."""
    try:
        record = _lookup(kind, key)
    except auth.UserNotFoundError:
        try:
            record = (auth.create_user(email=key, email_verified=True) if kind == "email"
                      else auth.create_user(phone_number=key))
        except (auth.EmailAlreadyExistsError, auth.PhoneNumberAlreadyExistsError):
            record = _lookup(kind, key)  # a parallel sign-in created it first
    if record.disabled:
        raise HTTPException(status_code=403,
                            detail={"code": "USER_DISABLED", "message": "This account has been disabled."})
    if kind == "email" and not record.email_verified:
        # The code proves control of this inbox. The public /auth/signup never verifies the
        # address, so someone else may have registered it first with a password they know:
        # replace that password and end their sessions before this person takes the account over.
        auth.update_user(record.uid, email_verified=True, password=secrets.token_urlsafe(32))
        auth.revoke_refresh_tokens(record.uid)
    return record


def _user_out(record, kind: str, key: str) -> UserOut:
    """Profile for the response; falls back to what Firebase already told us if Firestore is down."""
    try:
        return users.get_profile(record.uid)
    except Exception:
        log.exception("Could not load profile for %s; answering from the auth record", record.uid)
        return UserOut(uid=record.uid, email=key if kind == "email" else record.email,
                       name=record.display_name or "", email_verified=bool(record.email_verified))


def open_session(kind: str, key: str, *, code_was_exposed: bool) -> tuple[SessionStatus | None, AuthResponse | None]:
    """(status, session) for a freshly verified code. status None = Firebase is not configured
    here, which the API reports by simply omitting both fields, exactly as before Firebase."""
    settings = get_settings()
    if not firebase_admin._apps or not settings.firebase_web_api_key:
        return None, None
    if code_was_exposed and not settings.otp_dev_fallback_sessions:
        log.warning("Not opening a Firebase session for %s: its code was shown on screen (OTP_DEV_FALLBACK). "
                    "Set OTP_DEV_FALLBACK_SESSIONS=true on a local dev machine to allow it.", key)
        return "dev_code", None
    try:
        record = resolve_user(kind, key)
        tokens = fb.sign_in_with_custom_token(auth.create_custom_token(record.uid).decode("ascii"))
        user = _user_out(record, kind, key)
    except HTTPException as exc:
        if exc.status_code == 403:
            raise  # a disabled account must not be signed in, not even locally
        log.error("Could not open a Firebase session for %s: %s", key, exc.detail)
        return "unavailable", None
    except Exception:
        log.exception("Could not open a Firebase session for %s", key)
        return "unavailable", None
    return "ready", AuthResponse(
        id_token=tokens["idToken"],
        refresh_token=tokens["refreshToken"],
        expires_in=int(tokens["expiresIn"]),
        user=user,
    )
