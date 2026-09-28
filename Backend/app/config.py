from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# Backend/ folder, so .env and the key file resolve no matter where uvicorn is started from.
BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    firebase_web_api_key: str = ""
    firebase_credentials_path: str = "serviceAccountKey.json"
    cors_origins: list[str] = ["*"]

    @property
    def credentials_file(self) -> Path:
        path = Path(self.firebase_credentials_path)
        return path if path.is_absolute() else BASE_DIR / path


@lru_cache
def get_settings() -> Settings:
    return Settings()
