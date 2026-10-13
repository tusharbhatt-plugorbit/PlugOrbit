"""Gemini adapter for the existing tool loop; keys and thought signatures stay server-side."""
import json
import time
import uuid
from types import SimpleNamespace
import httpx
from .base import Finished,ModelTurn,ModelUsage,ProviderError,TextDelta

class GeminiProvider:
    name='gemini'
    def __init__(self,settings,client=None):
        self.settings=settings; self.model=settings.gemini_model; self.client=client
        self._health_at=0; self._reason=None
    async def availability(self):
        if self._health_at and time.monotonic()-self._health_at<600:return self._reason
        try:
            # Listing models can succeed even when this project cannot generate.
            # Probe once per ten minutes; never send user data in a health check.
            async with httpx.AsyncClient(timeout=10) as client:
                response=await client.post('https://generativelanguage.googleapis.com/v1beta/models/'+self.model+':generateContent',headers={'x-goog-api-key':self.settings.gemini_api_key},json={'contents':[{'role':'user','parts':[{'text':'Reply OK.'}]}],'generationConfig':{'maxOutputTokens':8}})
            self._reason=None if response.is_success else ('Google denied this AI project access. Resolve project access with Google.' if response.status_code in (401,403) else 'The AI provider is temporarily unavailable.')
        except httpx.HTTPError:self._reason='Could not reach the AI provider. Check the server connection.'
        self._health_at=time.monotonic();return self._reason
    def _contents(self,messages):
        contents=[];calls={}
        for message in messages:
            content=message['content'];parts=[]
            if isinstance(content,str):parts=[{'text':content}]
            else:
                for raw in content:
                    block=raw if isinstance(raw,dict) else vars(raw)
                    if block.get('type')=='tool_use':
                        original=block.get('gemini_part')
                        calls[block['id']]=(block['name'],(original or {}).get('functionCall',{}).get('id'))
                        parts.append(original or {'functionCall':{'name':block['name'],'args':block['input']}})
                    elif block.get('type')=='tool_result':
                        name,wire_id=calls[block['tool_use_id']]
                        result=block.get('content','')
                        try:result=json.loads(result) if isinstance(result,str) else result
                        except ValueError:result={'text':result}
                        response={'name':name,'response':result if isinstance(result,dict) else {'result':result}}
                        if wire_id:response['id']=wire_id
                        parts.append({'functionResponse':response})
                    elif block.get('gemini_part'):parts.append(block['gemini_part'])
                    elif block.get('type')=='text':parts.append({'text':block['text']})
            if parts:contents.append({'role':'model' if message['role']=='assistant' else 'user','parts':parts})
        return contents
    async def stream_turn(self,*,system,tools,messages,user_key):
        declarations=[{'name':t['name'],'description':t.get('description',''),'parametersJsonSchema':t['input_schema']} for t in tools]
        payload={'systemInstruction':{'parts':[{'text':system}]},'contents':self._contents(messages),
                 'generationConfig':{'maxOutputTokens':self.settings.assistant_max_output_tokens}}
        if declarations:payload['tools']=[{'functionDeclarations':declarations}]
        async def request(client):
            return await client.post('https://generativelanguage.googleapis.com/v1beta/models/'+self.model+':generateContent',headers={'x-goog-api-key':self.settings.gemini_api_key},json=payload)
        try:
            if self.client is not None:response=await request(self.client)
            else:
                async with httpx.AsyncClient(timeout=self.settings.assistant_request_timeout_s) as client:response=await request(client)
        except httpx.HTTPError as exc:raise ProviderError('PROVIDER_UNAVAILABLE','Could not reach the AI provider.',retryable=True) from exc
        if not response.is_success:
            denied=response.status_code in (401,403)
            if denied:self._health_at=time.monotonic();self._reason='Google denied this AI project access. Resolve project access with Google.'
            raise ProviderError('AI_ACCESS_DENIED' if denied else 'PROVIDER_UNAVAILABLE',self._reason if denied else 'The AI provider could not answer. Retry later.',retryable=not denied)
        data=response.json();candidate=(data.get('candidates') or [{}])[0];blocks=[];uses_tools=False
        for part in candidate.get('content',{}).get('parts',[]):
            call=part.get('functionCall')
            if call:
                uses_tools=True;blocks.append(SimpleNamespace(type='tool_use',id=call.get('id') or uuid.uuid4().hex,name=call['name'],input=call.get('args',{}),gemini_part=part))
            elif part.get('text') and not part.get('thought'):
                yield TextDelta(part['text']);blocks.append(SimpleNamespace(type='text',text=part['text'],gemini_part=part))
            else:blocks.append(SimpleNamespace(type='gemini_part',gemini_part=part))
        if not blocks:raise ProviderError('PROVIDER_UNAVAILABLE','The AI provider returned no answer.',retryable=True)
        usage=data.get('usageMetadata',{})
        yield Finished(ModelTurn(content=blocks,stop_reason='tool_use' if uses_tools else 'end_turn',model=self.model,
          usage=ModelUsage(input_tokens=usage.get('promptTokenCount',0),output_tokens=usage.get('candidatesTokenCount',0))))
