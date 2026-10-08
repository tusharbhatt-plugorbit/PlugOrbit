from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class SignupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class UpdateProfileRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class UserOut(BaseModel):
    uid: str
    email: str | None
    name: str
    email_verified: bool
    created_at: datetime | None = None


class TokenResponse(BaseModel):
    id_token: str
    refresh_token: str
    expires_in: int


class AuthResponse(TokenResponse):
    user: UserOut


class MessageResponse(BaseModel):
    message: str


class OtpSendRequest(BaseModel):
    # Exactly as the user typed it (email or mobile number); validated and normalised
    # in services/otp.py so a bad value answers INVALID_IDENTIFIER instead of a bare 422.
    identifier: str


class OtpSendResponse(BaseModel):
    message: str
    identifier_type: Literal["email", "phone"]
    channel: Literal["email", "sms", "screen"]
    delivered: bool
    dev_code: str | None = None  # only set on channel "screen" (dev fallback)
    expires_in: int
    resend_in: int


class OtpVerifyRequest(BaseModel):
    identifier: str
    code: str


class OtpVerifyResponse(BaseModel):
    verified: bool
    message: str
