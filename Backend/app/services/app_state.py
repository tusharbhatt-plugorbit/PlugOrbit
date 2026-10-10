"""
The mobile app's persisted user data in Cloud Firestore: users/{uid}/state/{slice}.

A slice is one top-level field of the app's persisted store (vehicles, history, ...).
Each is one document holding that slice's JSON as a *string*: Firestore rejects nested
arrays (route geometry has them) and the app's TypeScript types stay the single source
of truth for the inner shape. The server checks what it can without duplicating them:
which slices may be stored, that each has the right outer JSON type, and its size.

Only the Admin SDK reaches this data; the live security rules deny every client.
"""
import json
import logging
import uuid
from contextlib import contextmanager
from typing import Any

from fastapi import HTTPException, status
from firebase_admin import firestore
from google.api_core import exceptions as gexc

from ..firebase import get_db
from .users import USERS

log = logging.getLogger(__name__)

STATE = "state"

# Durable, user-owned data worth restoring on a new phone. Left out on purpose:
#   signedIn          derived from the session, not data
#   session, reservation, queue, chosen, activeRoute, smartDrive, battery, vehicleLink
#                     in-flight / device-bound state that must not resume on another phone
#   paymentMethods    financial data; not synced until that is decided explicitly
SLICE_TYPES: dict[str, type | tuple[type, ...]] = {
    "vehicles": list,
    "activeVehicleId": (str, type(None)),
    "filters": dict,
    "tripPrefs": dict,
    "alertPrefs": dict,
    "privacy": dict,
    "language": str,
    "plus": dict,
    "favouriteStationIds": list,
    "savedRoutes": list,
    "history": list,
    "tickets": list,
    "notifications": list,
    "feedbackDone": list,
}

# A Firestore document is capped at 1 MiB including its name and field names.
MAX_SLICE_BYTES = 900_000
# One batched commit is capped at 10 MiB.
MAX_REQUEST_BYTES = 8_000_000


def _bad_request(code: str, message: str, http_status: int = 422) -> HTTPException:
    return HTTPException(status_code=http_status, detail={"code": code, "message": message})


@contextmanager
def _database_errors():
    """Turn Firestore outages / misconfiguration into a clear 503 instead of a bare 500."""
    try:
        yield
    except (gexc.GoogleAPICallError, gexc.RetryError):
        log.exception("Firestore request failed")
        raise _bad_request("DATABASE_UNAVAILABLE", "Could not reach the database. Try again.",
                           status.HTTP_503_SERVICE_UNAVAILABLE) from None


def _collection(uid: str):
    return get_db().collection(USERS).document(uid).collection(STATE)


def encode_slices(slices: dict[str, Any]) -> dict[str, str]:
    """Validate a client payload and return {slice: json text}. Raises 422/413 HTTPException."""
    unknown = sorted(set(slices) - set(SLICE_TYPES))
    if unknown:
        raise _bad_request("UNKNOWN_SLICE", f"Not a syncable slice: {', '.join(unknown)}.")
    encoded: dict[str, str] = {}
    total = 0
    for name, value in slices.items():
        expected = SLICE_TYPES[name]
        # bool is an int subclass but never a valid slice value here.
        if isinstance(value, bool) or not isinstance(value, expected):
            raise _bad_request("INVALID_SLICE", f"'{name}' has the wrong type.")
        try:
            # allow_nan=False: NaN / Infinity parse from a request body but are not valid JSON,
            # so they could never be read back by the app.
            text = json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        except ValueError:
            raise _bad_request("INVALID_SLICE", f"'{name}' contains a value that is not valid JSON.") from None
        size = len(text.encode("utf-8"))
        if size > MAX_SLICE_BYTES:
            raise _bad_request("SLICE_TOO_LARGE", f"'{name}' is too large to sync.",
                               413)
        total += size
        encoded[name] = text
    if total > MAX_REQUEST_BYTES:
        raise _bad_request("STATE_TOO_LARGE", "Too much data in one request.",
                           413)
    return encoded


def list_state(uid: str) -> dict[str, dict]:
    """Every stored slice as {name: {"value": ..., "updated_at": datetime | None}}."""
    out: dict[str, dict] = {}
    with _database_errors():
        for snap in _collection(uid).stream():
            data = snap.to_dict() or {}
            if snap.id not in SLICE_TYPES:
                continue  # a slice retired in a later version of the app
            try:
                value = json.loads(data["json"])
            except (KeyError, TypeError, ValueError):
                log.warning("Skipping unreadable slice '%s' for user %s", snap.id, uid)
                continue
            out[snap.id] = {"value": value, "updated_at": data.get("updatedAt"),
                            "schema_version": data.get("schema"), "rev": data.get("rev")}
    return out


def put_state(uid: str, slices: dict[str, Any], schema_version: int = 1) -> dict[str, dict]:
    """Replace the given slices (all or nothing); other slices are untouched.
    Returns {name: {"rev": ..., "updated_at": ...}} for what was written.

    `rev` is a fresh random token per write and is what clients compare to learn "has this
    slice changed since I last saw it". It is exact and independent of clocks, unlike
    updatedAt: Firestore resolves SERVER_TIMESTAMP at request time but reports the commit time
    as the write's update_time, so the two differ by tens of milliseconds."""
    encoded = encode_slices(slices)
    revs = {name: uuid.uuid4().hex for name in encoded}
    with _database_errors():
        db = get_db()
        batch = db.batch()
        names = list(encoded)
        for name in names:
            batch.set(_collection(uid).document(name), {
                "json": encoded[name],
                "bytes": len(encoded[name].encode("utf-8")),
                "schema": schema_version,
                "rev": revs[name],
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
        results = batch.commit()
    return {name: {"rev": revs[name], "updated_at": result.update_time}
            for name, result in zip(names, results)}
