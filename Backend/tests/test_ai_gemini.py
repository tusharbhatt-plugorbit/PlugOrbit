import asyncio
from types import SimpleNamespace
import httpx
import pytest
from app.ai.providers.gemini_provider import GeminiProvider
from app.ai.providers.base import ProviderError
S=SimpleNamespace(gemini_api_key="test",gemini_model="model",assistant_max_output_tokens=500,assistant_request_timeout_s=5)
def test_signature_roundtrip():
    part={"functionCall":{"name":"battery","args":{},"id":"x"},"thoughtSignature":"opaque"}
    provider=GeminiProvider(S)
    messages=[{"role":"assistant","content":[{"type":"tool_use","id":"x","name":"battery","input":{},"gemini_part":part}]},{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","content":"{\"soc\":20}"}]}]
    contents=provider._contents(messages)
    assert contents[0]["parts"][0]==part
    assert contents[1]["parts"][0]["functionResponse"]=={"name":"battery","id":"x","response":{"soc":20}}
@pytest.mark.parametrize("status,payload,code",[(403,{},"AI_ACCESS_DENIED"),(200,{"candidates":[]},"PROVIDER_UNAVAILABLE")])
def test_safe_errors(status,payload,code):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:httpx.Response(status,json=payload))) as client:
            with pytest.raises(ProviderError) as error:
                async for event in GeminiProvider(S,client).stream_turn(system="guide",tools=[],messages=[],user_key="u"):pass
            assert error.value.code==code
    asyncio.run(run())

def test_expired_admin_credentials_are_service_error(monkeypatch):
    from fastapi import HTTPException
    from google.auth.exceptions import RefreshError
    from app import deps
    def fail(*args,**kwargs):raise RefreshError("private reauthentication detail")
    monkeypatch.setattr(deps.auth,"verify_id_token",fail)
    with pytest.raises(HTTPException) as error:deps.get_current_user("fake",None)
    assert error.value.status_code==503
    assert error.value.detail["code"]=="SERVER_CREDENTIALS_EXPIRED"
    assert "private" not in error.value.detail["message"]

def test_health_probes_generation_and_caches_denial(monkeypatch):
    real_client=httpx.AsyncClient
    calls=[]
    def respond(request):
        calls.append(request)
        return httpx.Response(403,json={"error":{"message":"project denied"}})
    monkeypatch.setattr(httpx,"AsyncClient",lambda **kwargs:real_client(transport=httpx.MockTransport(respond),**kwargs))
    async def run():
        provider=GeminiProvider(S)
        assert "denied" in await provider.availability()
        assert "denied" in await provider.availability()
        assert len(calls)==1
        assert calls[0].method=="POST"
        assert calls[0].url.path.endswith(":generateContent")
    asyncio.run(run())

def test_vertex_transport_uses_adc_bearer_token(monkeypatch):
    from app.ai import gemini_transport
    settings=SimpleNamespace(gemini_model="gemini-3.8-flash",gemini_use_vertex=True,
      gemini_vertex_project_id="plugorbit-783dc",gemini_vertex_location="global")
    monkeypatch.setattr(gemini_transport,"_vertex_token",lambda: asyncio.sleep(0,result="test-access-token"))
    calls=[]
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:(calls.append(req) or httpx.Response(200,json={"candidates":[]})))) as client:
            response=await gemini_transport.generate_content(client,settings,{"contents":[]})
            assert response.status_code==200
    asyncio.run(run())
    request=calls[0]
    assert request.url.host=="aiplatform.googleapis.com"
    assert request.url.path.endswith("/locations/global/publishers/google/models/gemini-3.8-flash:generateContent")
    assert request.headers["Authorization"]=="Bearer test-access-token"
    assert "x-goog-api-key" not in request.headers
