import base64
import binascii
import json
import logging

import firebase_admin
from firebase_admin import credentials, firestore

from .config import Settings, get_settings

log = logging.getLogger(__name__)


def _parse_credentials_json(raw: str) -> dict:
    """The service-account key as a dict, from its JSON or from that JSON base64-encoded
    (base64 survives .env files and CI secret stores that mangle quotes and newlines)."""
    text = raw.strip()
    if not text.startswith("{"):
        try:
            text = base64.b64decode(text, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError):
            raise ValueError("not JSON and not base64-encoded JSON") from None
    info = json.loads(text)
    if not isinstance(info, dict):
        raise ValueError("not a JSON object")
    return info


def _load_credential(settings: Settings) -> tuple[credentials.Base, str] | None:
    """Pick the Admin credential and say where it came from. None = nothing configured.
    Never log the key or its contents, only the source."""
    path = settings.credentials_file
    if path.exists():
        return credentials.Certificate(str(path)), f"key file {path.name}"
    if settings.firebase_credentials_json.strip():
        info = _parse_credentials_json(settings.firebase_credentials_json)
        return credentials.Certificate(info), "FIREBASE_CREDENTIALS_JSON"
    if settings.firebase_use_adc:
        return credentials.ApplicationDefault(), "application default credentials"
    return None


def init_firebase() -> None:
    """Initialise the Firebase Admin SDK once per process if credentials are configured."""
    settings = get_settings()
    if not settings.firebase_web_api_key:
        log.warning("FIREBASE_WEB_API_KEY is not set. Login, signup, token refresh and password reset "
                    "will fail with 503 until it is added to Backend/.env.")
    if firebase_admin._apps:
        return
    try:
        loaded = _load_credential(settings)
    except Exception as e:
        # Type only: a parse error must never echo part of the key into the logs.
        log.error("Firebase credentials are configured but unusable (%s). Check %s / FIREBASE_CREDENTIALS_JSON.",
                  type(e).__name__, settings.credentials_file)
        return
    if loaded is None:
        log.warning(
            "⚠️ No Firebase Admin credentials found.\n"
            "The FastAPI server will start, but Firebase features need one of:\n"
            "  - the service-account key at '%s' (git-ignored),\n"
            "  - FIREBASE_CREDENTIALS_JSON (the key's JSON or its base64), or\n"
            "  - FIREBASE_USE_ADC=true with Application Default Credentials (+ FIREBASE_PROJECT_ID).",
            settings.credentials_file,
        )
        return
    cred, source = loaded
    options = {"projectId": settings.firebase_project_id} if settings.firebase_project_id else None
    try:
        app = firebase_admin.initialize_app(cred, options)
    except Exception as e:
        log.error("Failed to initialise Firebase Admin from %s: %s", source, type(e).__name__)
        return
    log.info("Firebase Admin initialised for project '%s' using %s", app.project_id, source)


def get_db():
    if not firebase_admin._apps:
        raise RuntimeError(
            "Firebase Admin SDK is not initialized. Add the service-account key "
            "(Backend/serviceAccountKey.json), FIREBASE_CREDENTIALS_JSON, or FIREBASE_USE_ADC=true."
        )
    return firestore.client()
