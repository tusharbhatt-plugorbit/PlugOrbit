import re
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.deps import require_firebase
from app.routes import google_browser as browser

@pytest.fixture
def client(monkeypatch):
    browser._flows.clear();browser._starts.clear()
    app.dependency_overrides[require_firebase]=lambda:None
    monkeypatch.setattr(browser,'get_settings',lambda:SimpleNamespace(firebase_web_api_key='public-test-key',firebase_project_id='plugorbit-test'))
    yield TestClient(app)
    app.dependency_overrides.clear()

def start(client): return client.post('/auth/google-browser/start').json()

def test_private_poll_secret_and_no_secret_in_browser(client):
    flow=start(client)
    page=client.get('/auth/google-browser/page',params={'flow':flow['flow_id']})
    assert page.status_code==200
    assert flow['poll_secret'] not in page.text
    assert page.headers['cache-control']=='no-store'
    policy=page.headers['content-security-policy']
    assert 'https://apis.google.com' in policy.split('script-src ',1)[1].split(';',1)[0]
    assert "frame-ancestors 'none'" in policy
    assert client.get('/auth/google-browser/poll/'+flow['flow_id']).status_code==403
    assert client.get('/auth/google-browser/poll/'+flow['flow_id'],headers={'X-Poll-Secret':flow['poll_secret']}).json()=={'status':'pending'}

def test_csrf_origin_and_one_time_handoff(client,monkeypatch):
    flow=start(client);page=client.get('/auth/google-browser/page',params={'flow':flow['flow_id']})
    csrf=browser._flows[flow['flow_id']]['csrf']
    payload={'flow_id':flow['flow_id'],'id_token':'google-token'}
    assert client.post('/auth/google-browser/complete',json=payload).status_code==403
    headers={'Origin':'http://testserver','X-Flow-CSRF':csrf}
    session={'id_token':'firebase-id','refresh_token':'firebase-refresh','expires_in':3600,'user':{'uid':'verified-uid'}}
    class Verified:
        def model_dump(self,**kw):return session
    monkeypatch.setattr(browser,'google_login',lambda body:Verified())
    assert client.post('/auth/google-browser/complete',headers=headers,json=payload).status_code==200
    assert client.post('/auth/google-browser/complete',headers=headers,json=payload).status_code==409
    result=client.get('/auth/google-browser/poll/'+flow['flow_id'],headers={'X-Poll-Secret':flow['poll_secret']})
    assert result.headers['cache-control']=='no-store'
    assert result.json()=={'status':'complete','session':session}
    assert client.get('/auth/google-browser/poll/'+flow['flow_id'],headers={'X-Poll-Secret':flow['poll_secret']}).status_code==410

def test_expiry_and_rate_limit(client):
    flow=start(client);browser._flows[flow['flow_id']]['expires']=0
    assert client.get('/auth/google-browser/poll/'+flow['flow_id'],headers={'X-Poll-Secret':flow['poll_secret']}).status_code==410
    for _ in range(7):assert client.post('/auth/google-browser/start').status_code==200
    assert client.post('/auth/google-browser/start').status_code==429
