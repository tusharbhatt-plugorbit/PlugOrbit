import logging
import os
import firebase_admin
from firebase_admin import credentials, firestore

from .config import get_settings

log = logging.getLogger(__name__)


def init_firebase() -> None:
    """Initialise the Firebase Admin SDK once per process if credentials file exists."""
    if not firebase_admin._apps:
        cred_path = get_settings().firebase_credentials_path
        if os.path.exists(cred_path):
            try:
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred)
                log.info("Firebase Admin initialized successfully using %s", cred_path)
            except Exception as e:
                log.error("Failed to initialize Firebase Admin with %s: %s", cred_path, e)
        else:
            log.warning(
                "⚠️ Firebase credentials file '%s' was not found in Backend root.\n"
                "The FastAPI server will start, but Firebase features require 'serviceAccountKey.json'.\n"
                "Please download your Firebase Admin service account key JSON and place it in the Backend folder.",
                cred_path,
            )


def get_db():
    if not firebase_admin._apps:
        raise RuntimeError(
            "Firebase Admin SDK is not initialized. "
            "Please place your 'serviceAccountKey.json' file in the Backend directory."
        )
    return firestore.client()
