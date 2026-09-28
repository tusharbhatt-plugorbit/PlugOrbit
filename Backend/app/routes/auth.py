import logging

from fastapi import APIRouter, Depends, HTTPException, status
from firebase_admin import auth

from ..deps import get_bearer_token, get_current_user, require_firebase
from ..schemas import (AuthResponse, ForgotPasswordRequest, LoginRequest, MessageResponse,
                       RefreshRequest, SignupRequest, TokenResponse)
from ..services import firebase_auth as fb
from ..services import users

log = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_firebase)])
def signup(body: SignupRequest):
    data = fb.sign_up(body.email, body.password)
    uid = data["localId"]

    try:
        auth.update_user(uid, display_name=body.name)
        users.create_profile(uid, body.email, body.name)
    except Exception:
        log.exception("Profile creation failed, rolling back user %s", uid)
        try:
            auth.delete_user(uid)
        except Exception:
            log.exception("Rollback failed; user %s must be deleted manually", uid)
        raise HTTPException(status_code=500,
                            detail={"code": "SIGNUP_FAILED", "message": "Could not create account."})

    try:
        fb.send_email_verification(data["idToken"])
    except HTTPException:
        log.warning("Could not send verification email to %s", body.email)

    return AuthResponse(
        id_token=data["idToken"],
        refresh_token=data["refreshToken"],
        expires_in=int(data["expiresIn"]),
        user=users.get_profile(uid),
    )


@router.post("/login", response_model=AuthResponse, dependencies=[Depends(require_firebase)])
def login(body: LoginRequest):
    data = fb.sign_in(body.email, body.password)
    return AuthResponse(
        id_token=data["idToken"],
        refresh_token=data["refreshToken"],
        expires_in=int(data["expiresIn"]),
        user=users.get_profile(data["localId"]),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest):
    return TokenResponse(**fb.refresh_id_token(body.refresh_token))


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(body: ForgotPasswordRequest):
    try:
        fb.send_password_reset(body.email)
    except HTTPException as exc:
        if exc.status_code == 429:
            raise
    return MessageResponse(message="If an account exists for this email, a reset link has been sent.")


@router.post("/resend-verification", response_model=MessageResponse)
def resend_verification(token: str = Depends(get_bearer_token), user: dict = Depends(get_current_user)):
    if user.get("email_verified"):
        return MessageResponse(message="Email is already verified.")
    fb.send_email_verification(token)
    return MessageResponse(message="Verification email sent.")


@router.post("/logout", response_model=MessageResponse)
def logout(user: dict = Depends(get_current_user)):
    auth.revoke_refresh_tokens(user["uid"])
    return MessageResponse(message="Logged out.")
