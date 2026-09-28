from datetime import datetime

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
