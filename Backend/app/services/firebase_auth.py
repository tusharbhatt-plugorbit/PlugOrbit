"""
Wrapper around the Firebase Auth REST API.
"""
import httpx
from fastapi import HTTPException, status

from ..config import get_settings

IDENTITY_URL = "https://identitytoolkit.googleapis.com/v1/accounts"
TOKEN_URL = "https://securetoken.googleapis.com/v1/token"

_ERRORS = {
    "EMAIL_EXISTS": (409, "An account with this email already exists."),
    "EMAIL_NOT_FOUND": (401, "Invalid email or password."),
    "INVALID_PASSWORD": (401, "Invalid email or password."),
    "INVALID_LOGIN_CREDENTIALS": (401, "Invalid email or password."),
    "USER_DISABLED": (403, "This account has been disabled."),
    "USER_NOT_FOUND": (401, "Session expired. Please log in again."),
    "TOO_MANY_ATTEMPTS_TRY_LATER": (429, "Too many attempts. Please try again later."),
    "WEAK_PASSWORD": (400, "Password must be at least 6 characters."),
    "INVALID_EMAIL": (400, "Invalid email address."),
    "INVALID_REFRESH_TOKEN": (401, "Session expired. Please log in again."),
    "TOKEN_EXPIRED": (401, "Session expired. Please log in again."),
    "INVALID_ID_TOKEN": (401, "Session expired. Please log in again."),
}


def _raise_firebase_error(resp: httpx.Response) -> None:
    try:
        raw = resp.json()["error"]["message"]
    except Exception:
        raw = "UNKNOWN"
    code = raw.split(" ")[0].split(":")[0]
    http_status, message = _ERRORS.get(code, (400, "Authentication failed."))
    raise HTTPException(status_code=http_status, detail={"code": code, "message": message})


def _post(url: str, payload: dict, form: bool = False) -> dict:
    params = {"key": get_settings().firebase_web_api_key}
    try:
        with httpx.Client(timeout=10) as client:
            if form:
                resp = client.post(url, params=params, data=payload)
            else:
                resp = client.post(url, params=params, json=payload)
    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "AUTH_UNAVAILABLE", "message": "Auth service unreachable. Try again."},
        )
    if resp.status_code != 200:
        _raise_firebase_error(resp)
    return resp.json()


def sign_up(email: str, password: str) -> dict:
    return _post(f"{IDENTITY_URL}:signUp",
                 {"email": email, "password": password, "returnSecureToken": True})


def sign_in(email: str, password: str) -> dict:
    return _post(f"{IDENTITY_URL}:signInWithPassword",
                 {"email": email, "password": password, "returnSecureToken": True})


def refresh_id_token(refresh_token: str) -> dict:
    data = _post(TOKEN_URL,
                 {"grant_type": "refresh_token", "refresh_token": refresh_token},
                 form=True)
    return {
        "id_token": data["id_token"],
        "refresh_token": data["refresh_token"],
        "expires_in": int(data["expires_in"]),
    }


def send_password_reset(email: str) -> None:
    _post(f"{IDENTITY_URL}:sendOobCode", {"requestType": "PASSWORD_RESET", "email": email})


def send_email_verification(id_token: str) -> None:
    _post(f"{IDENTITY_URL}:sendOobCode", {"requestType": "VERIFY_EMAIL", "idToken": id_token})
