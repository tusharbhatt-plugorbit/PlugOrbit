import firebase_admin
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": code, "message": message},
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_firebase() -> None:
    """Fail with a clear 503 instead of a bare 500 when serviceAccountKey.json is missing."""
    if not firebase_admin._apps:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "FIREBASE_NOT_CONFIGURED",
                    "message": "Server is not configured. Add serviceAccountKey.json to the Backend folder."},
        )


def get_bearer_token(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    if creds is None or not creds.credentials:
        raise _unauthorized("MISSING_TOKEN", "Not logged in.")
    return creds.credentials


def get_current_user(token: str = Depends(get_bearer_token), _: None = Depends(require_firebase)) -> dict:
    """Verify the Firebase ID token sent as `Authorization: Bearer <id_token>`.
    Returns the decoded token (contains `uid`, `email`, ...)."""
    try:
        return auth.verify_id_token(token, check_revoked=True)
    except auth.ExpiredIdTokenError:
        raise _unauthorized("TOKEN_EXPIRED", "Session expired. Refresh your token.")
    except auth.RevokedIdTokenError:
        raise _unauthorized("TOKEN_REVOKED", "You were logged out. Please log in again.")
    except auth.UserDisabledError:
        raise HTTPException(status_code=403,
                            detail={"code": "USER_DISABLED", "message": "This account has been disabled."})
    except (auth.InvalidIdTokenError, ValueError):
        raise _unauthorized("INVALID_TOKEN", "Invalid session. Please log in again.")
