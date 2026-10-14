"""Shared Gemini GenerateContent transport for API-key and Vertex AI ADC auth."""
from __future__ import annotations

import asyncio
from threading import Lock

import google.auth
from google.auth.transport.requests import Request

_credentials = None
_credentials_lock = Lock()


async def _vertex_token() -> str:
    global _credentials
    if _credentials is None:
        with _credentials_lock:
            if _credentials is None:
                _credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])

    def refresh_if_needed() -> str:
        with _credentials_lock:
            if not _credentials.valid or not _credentials.token:
                _credentials.refresh(Request())
            return _credentials.token

    return await asyncio.to_thread(refresh_if_needed)


async def generate_content(client, settings, payload):
    model = settings.gemini_model
    if getattr(settings, "gemini_use_vertex", False):
        project = getattr(settings, "gemini_vertex_project_id", "").strip()
        location = getattr(settings, "gemini_vertex_location", "global").strip() or "global"
        if not project:
            raise RuntimeError("Vertex AI is enabled but GEMINI_VERTEX_PROJECT_ID is not configured")
        url = f"https://aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent"
        return await client.post(url, headers={"Authorization": f"Bearer {await _vertex_token()}"}, json=payload)

    return await client.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"x-goog-api-key": settings.gemini_api_key},
        json=payload,
    )
