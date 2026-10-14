from types import SimpleNamespace
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.deps import get_current_user
from app.routes import assistant

@pytest.fixture
def client(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: {"uid": "orbit-test"}
    assistant._usage.clear()
    monkeypatch.setattr(assistant, "get_settings", lambda: SimpleNamespace(gemini_api_key="test-key", gemini_model="gemini-flash-latest"))
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_not_configured(client, monkeypatch):
    monkeypatch.setattr(assistant, "get_settings", lambda: SimpleNamespace(gemini_api_key=""))
    assert client.get("/assistant/status").json() == {"configured": False}
    assert client.post("/assistant/chat", json={"message": "Help"}).status_code == 503

def test_provider_reply_and_context(client, monkeypatch):
    def reply(request):
        assert request.headers["x-goog-api-key"] == "test-key"
        assert "battery" in request.content.decode()
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Open Trips"}]}}]})
    real = httpx.AsyncClient
    monkeypatch.setattr(assistant.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(reply), **kw))
    response = client.post("/assistant/chat", json={"message": "Plan a trip", "context": "battery 70%"})
    assert response.json() == {"answer": "Open Trips", "mode": "online"}

def test_vertex_only_configuration_enables_online_chat(client, monkeypatch):
    monkeypatch.setattr(assistant, "get_settings", lambda: SimpleNamespace(
        gemini_api_key="", gemini_model="gemini-3.8-flash", gemini_use_vertex=True,
        gemini_vertex_project_id="plugorbit-783dc", gemini_vertex_location="global"))
    assert client.get("/assistant/status").json() == {"configured": True}
    async def generate(_client, _settings, _payload):
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Vertex is online"}]}}]})
    monkeypatch.setattr(assistant, "generate_content", generate)
    response = client.post("/assistant/chat", json={"message": "Status?"})
    assert response.status_code == 200
    assert response.json() == {"answer": "Vertex is online", "mode": "online"}

def test_rate_limit_and_validation(client, monkeypatch):
    real = httpx.AsyncClient
    monkeypatch.setattr(assistant.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(lambda _: httpx.Response(429)), **kw))
    assert client.post("/assistant/chat", json={"message": "x" * 2001}).status_code == 422
    response = client.post("/assistant/chat", json={"message": "Help"})
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "AI_PROVIDER_LIMIT"

def test_requires_login(client):
    app.dependency_overrides.clear()
    assert client.post("/assistant/chat", json={"message": "Help"}).status_code == 401
