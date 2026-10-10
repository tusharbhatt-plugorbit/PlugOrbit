from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# Backend/ folder, so .env and the key file resolve no matter where uvicorn is started from.
BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    firebase_web_api_key: str = ""
    # Admin credentials, first source found wins (see app/firebase.py):
    # 1. the key file at firebase_credentials_path, 2. firebase_credentials_json (the
    # key's JSON, or that JSON base64-encoded; for hosts that keep secrets in env vars),
    # 3. Application Default Credentials when firebase_use_adc (Cloud Run, GCE, gcloud login).
    firebase_credentials_path: str = "serviceAccountKey.json"
    firebase_credentials_json: str = ""
    firebase_use_adc: bool = False
    # Only needed with ADC; a key file already names its project.
    firebase_project_id: str = ""
    cors_origins: list[str] = ["*"]

    # Login/signup one-time codes. The app's code boxes expect 6 digits.
    otp_length: int = Field(default=6, ge=4, le=10)
    otp_ttl_seconds: int = Field(default=300, ge=1)
    otp_resend_seconds: int = Field(default=30, ge=0)  # 0 disables the resend cooldown
    otp_max_attempts: int = Field(default=5, ge=1)
    # DEVELOPMENT ONLY: when a code cannot be emailed/texted, hand it back in the API
    # response so the app can show it on screen. Turn off outside development.
    otp_dev_fallback: bool = True
    # DEVELOPMENT ONLY. A code shown on screen (dev fallback) proves nothing about the inbox
    # or phone, so by default it signs the app in locally but does NOT open a Firebase
    # session (which would expose that account's cloud data to anyone who can reach the API).
    # Set true on a local dev machine without email/SMS to try cloud sync with on-screen codes.
    otp_dev_fallback_sessions: bool = False
    # Prepended to mobile numbers typed without a country code.
    default_country_code: str = "+91"

    # Email delivery of codes (SMTP + STARTTLS). Configured when smtp_host is set.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""  # falls back to smtp_username
    smtp_use_tls: bool = True

    # SMS delivery of codes (Twilio). Configured when sid, token and from number are all set.
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    twilio_api_base: str = "https://api.twilio.com"

    @property
    def credentials_file(self) -> Path:
        path = Path(self.firebase_credentials_path)
        return path if path.is_absolute() else BASE_DIR / path


@lru_cache
def get_settings() -> Settings:
    return Settings()
