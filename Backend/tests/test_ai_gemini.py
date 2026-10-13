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
