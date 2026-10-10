"""
Live Firestore test of the synced app-data layer, against the real project.

Skipped unless RUN_LIVE_FIREBASE_TESTS=1 (and Admin credentials are configured, see
Backend/.env.example). It only ever touches users/it-<random>/..., a user id no real account
can have, and deletes it again in a finally block.

    RUN_LIVE_FIREBASE_TESTS=1 python -m pytest tests/test_live_firestore.py -v
"""
import os
import uuid

import firebase_admin
import pytest

from app.firebase import get_db, init_firebase
from app.services import app_state

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE_FIREBASE_TESTS") != "1",
    reason="live Firebase test: set RUN_LIVE_FIREBASE_TESTS=1 to run it against the real project",
)


@pytest.fixture
def uid():
    if not firebase_admin._apps:
        init_firebase()
    if not firebase_admin._apps:
        pytest.fail("RUN_LIVE_FIREBASE_TESTS=1 but no Firebase Admin credentials are configured")
    test_uid = f"it-{uuid.uuid4().hex}"
    yield test_uid
    ref = get_db().collection("users").document(test_uid)
    get_db().recursive_delete(ref)
    assert not list(ref.collection(app_state.STATE).stream()), "test data was not cleaned up"


def test_create_read_update_delete_against_real_firestore(uid):
    route = {"id": "r1", "polyline": [[28.61, 77.20], [28.70, 77.31]]}  # nested arrays survive

    # create
    written = app_state.put_state(uid, {"vehicles": [{"id": "v1", "name": "Nexon EV"}], "savedRoutes": [route]})
    assert set(written) == {"vehicles", "savedRoutes"} and all(w["rev"] and w["updated_at"] for w in written.values())

    # read
    state = app_state.list_state(uid)
    assert state["vehicles"]["value"] == [{"id": "v1", "name": "Nexon EV"}]
    assert state["savedRoutes"]["value"] == [route]
    first_write = state["vehicles"]["updated_at"]
    assert first_write is not None
    # the revision a write reports is exactly what a later read reports (clients rely on this)
    assert state["vehicles"]["rev"] == written["vehicles"]["rev"]

    # update: replaces the named slice, leaves the other alone, moves the server timestamp forward
    rewritten = app_state.put_state(uid, {"vehicles": []})
    state = app_state.list_state(uid)
    assert state["vehicles"]["rev"] == rewritten["vehicles"]["rev"] != written["vehicles"]["rev"]
    assert state["vehicles"]["value"] == []
    assert state["vehicles"]["updated_at"] >= first_write
    assert state["savedRoutes"]["value"] == [route]

    # rejected input never reaches the database
    with pytest.raises(Exception):
        app_state.put_state(uid, {"paymentMethods": []})
    assert set(app_state.list_state(uid)) == {"vehicles", "savedRoutes"}

    # delete: recursive_delete is what account deletion uses
    ref = get_db().collection("users").document(uid)
    get_db().recursive_delete(ref)
    assert app_state.list_state(uid) == {}
