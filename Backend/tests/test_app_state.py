"""Tests for the synced app-data endpoints. Firestore is replaced by a small in-memory fake."""
import logging
from datetime import datetime, timezone
from types import SimpleNamespace

import firebase_admin
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from firebase_admin import firestore
from google.api_core import exceptions as gexc

from app.deps import get_current_user
from app.main import app
from app.services import app_state, users

NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


class FakeSnap:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self.exists = data is not None
        self._data = data

    def to_dict(self):
        return None if self._data is None else dict(self._data)


class FakeDoc:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def collection(self, name):
        return FakeCol(self.db, self.path + (name,))

    def get(self):
        return FakeSnap(self.path[-1], self.db.data.get(self.path))


class FakeCol:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def document(self, doc_id):
        return FakeDoc(self.db, self.path + (doc_id,))

    def stream(self):
        for path, data in list(self.db.data.items()):
            if len(path) == len(self.path) + 1 and path[:-1] == self.path:
                yield FakeSnap(path[-1], data)


class FakeBatch:
    def __init__(self, db):
        self.db, self.ops = db, []

    def set(self, ref, data):
        self.ops.append((ref, data))

    def commit(self):
        if self.db.error:
            raise self.db.error
        for ref, data in self.ops:
            self.db.data[ref.path] = {k: NOW if v is firestore.SERVER_TIMESTAMP else v for k, v in data.items()}
        return [SimpleNamespace(update_time=NOW) for _ in self.ops]


class FakeDb:
    def __init__(self):
        self.data: dict[tuple, dict] = {}
        self.error: Exception | None = None
        self.recursively_deleted: list[tuple] = []

    def collection(self, name):
        return FakeCol(self, (name,))

    def batch(self):
        return FakeBatch(self)

    def recursive_delete(self, ref):
        self.recursively_deleted.append(ref.path)
        self.data = {p: d for p, d in self.data.items() if p[:len(ref.path)] != ref.path}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDb()
    monkeypatch.setattr(app_state, "get_db", lambda: fake)
    monkeypatch.setattr(users, "get_db", lambda: fake)
    return fake


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setitem(firebase_admin._apps, "[DEFAULT]", object())
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def signed_in():
    """Act as Firebase user u1 (token verification itself is covered by deps/auth tests)."""
    app.dependency_overrides[get_current_user] = lambda: {"uid": "u1"}
    yield "u1"
    app.dependency_overrides.pop(get_current_user, None)


ROUTE = {"id": "r1", "polyline": [[28.61, 77.20], [28.70, 77.31]], "name": "Delhi → Jaipur"}  # nested arrays


# --- service ---------------------------------------------------------------------

def test_round_trip_keeps_nested_arrays_and_unicode(db):
    written = app_state.put_state("u1", {"savedRoutes": [ROUTE], "language": "hi", "activeVehicleId": None})
    assert written == {"savedRoutes": NOW, "language": NOW, "activeVehicleId": NOW}
    state = app_state.list_state("u1")
    assert state["savedRoutes"] == {"value": [ROUTE], "updated_at": NOW}
    assert state["language"]["value"] == "hi"
    assert state["activeVehicleId"]["value"] is None
    # stored under users/{uid}/state/{slice}, one document per slice
    assert ("users", "u1", "state", "savedRoutes") in db.data


def test_put_replaces_only_the_named_slices(db):
    app_state.put_state("u1", {"history": [{"id": "a"}], "tickets": [{"id": "t"}]})
    app_state.put_state("u1", {"history": []})
    state = app_state.list_state("u1")
    assert state["history"]["value"] == []
    assert state["tickets"]["value"] == [{"id": "t"}]


def test_users_cannot_see_each_others_state(db):
    app_state.put_state("u1", {"history": [{"id": "mine"}]})
    assert app_state.list_state("u2") == {}


@pytest.mark.parametrize("slices, code, http", [
    ({"history": [], "paymentMethods": []}, "UNKNOWN_SLICE", 422),   # not a syncable slice
    ({"signedIn": True}, "UNKNOWN_SLICE", 422),
    ({"history": {"not": "a list"}}, "INVALID_SLICE", 422),
    ({"filters": []}, "INVALID_SLICE", 422),
    ({"language": True}, "INVALID_SLICE", 422),                      # bool is not a str/dict/list
    ({"history": [float("nan")]}, "INVALID_SLICE", 422),
    ({"history": ["x" * (app_state.MAX_SLICE_BYTES + 1)]}, "SLICE_TOO_LARGE", 413),
])
def test_bad_payload_is_rejected_and_nothing_is_written(db, slices, code, http):
    with pytest.raises(HTTPException) as exc:
        app_state.put_state("u1", {"tickets": [], **slices})
    assert exc.value.status_code == http
    assert exc.value.detail["code"] == code
    assert db.data == {}  # all or nothing: the valid 'tickets' slice was not written either


def _filler(expected, size):
    """A value of the right outer JSON type for a slice, ~`size` bytes long."""
    if expected is list:
        return ["x" * size]
    if expected is dict:
        return {"v": "x" * size}
    return "x" * size  # str / str-or-null


def test_total_request_size_is_capped(db):
    ok = {name: _filler(app_state.SLICE_TYPES[name], 800_000) for name in list(app_state.SLICE_TYPES)[:5]}
    assert set(app_state.encode_slices(ok)) == set(ok)  # 5 x 0.8 MB: fine
    every = {name: _filler(kind, 800_000) for name, kind in app_state.SLICE_TYPES.items()}  # each under its own cap
    with pytest.raises(HTTPException) as exc:
        app_state.encode_slices(every)  # but ~11 MB together
    assert exc.value.status_code == 413
    assert exc.value.detail["code"] == "STATE_TOO_LARGE"


def test_unreadable_or_retired_slices_are_skipped(db, caplog):
    app_state.put_state("u1", {"history": [{"id": "a"}]})
    db.data[("users", "u1", "state", "tickets")] = {"json": "{not json", "updatedAt": NOW}
    db.data[("users", "u1", "state", "oldSliceFromV0")] = {"json": "[]", "updatedAt": NOW}
    with caplog.at_level(logging.WARNING):
        state = app_state.list_state("u1")
    assert list(state) == ["history"]
    assert "Skipping unreadable slice 'tickets'" in caplog.text


def test_database_outage_becomes_a_503(db):
    db.error = gexc.ServiceUnavailable("backend down")
    with pytest.raises(HTTPException) as exc:
        app_state.put_state("u1", {"history": []})
    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "DATABASE_UNAVAILABLE"


# --- routes ----------------------------------------------------------------------

def test_state_routes_need_a_login(client, db):
    assert client.get("/users/me/state").status_code == 401
    assert client.put("/users/me/state", json={"slices": {"history": []}}).status_code == 401


def test_put_then_get_over_http(client, db, signed_in):
    r = client.put("/users/me/state", json={"slices": {"vehicles": [{"id": "v1"}], "language": "en"}})
    assert r.status_code == 200
    assert set(r.json()["updated_at"]) == {"vehicles", "language"}
    r = client.get("/users/me/state")
    assert r.status_code == 200
    assert r.json()["slices"]["vehicles"]["value"] == [{"id": "v1"}]
    assert r.json()["slices"]["language"]["updated_at"].startswith("2026-01-02T03:04:05")


def test_put_rejects_unknown_slice_and_empty_body(client, db, signed_in):
    r = client.put("/users/me/state", json={"slices": {"paymentMethods": []}})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "UNKNOWN_SLICE"
    assert client.put("/users/me/state", json={"slices": {}}).status_code == 422


def test_routes_only_touch_the_callers_own_documents(client, db, signed_in):
    db.data[("users", "someone-else", "state", "history")] = {"json": '[{"id":"theirs"}]', "updatedAt": NOW}
    assert client.get("/users/me/state").json() == {"slices": {}}


# --- account deletion ------------------------------------------------------------

def test_deleting_an_account_removes_its_synced_data(db, monkeypatch):
    app_state.put_state("u1", {"history": [{"id": "a"}]})
    app_state.put_state("u2", {"history": [{"id": "b"}]})
    deleted = []
    monkeypatch.setattr(users.auth, "delete_user", deleted.append)
    users.delete_user("u1")
    assert db.recursively_deleted == [("users", "u1")]
    assert app_state.list_state("u1") == {}
    assert app_state.list_state("u2")["history"]["value"] == [{"id": "b"}]  # neighbours untouched
    assert deleted == ["u1"]
