import copy
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.deps import get_current_user
from app.routes import support

class Snapshot:
    def __init__(self, data): self.data=data; self.exists=data is not None
    def to_dict(self): return copy.deepcopy(self.data)
class Document:
    def __init__(self, records, key): self.records=records; self.key=key
    def get(self): return Snapshot(self.records.get(self.key))
    def create(self, data):
        if self.key in self.records: raise RuntimeError("exists")
        self.records[self.key]=copy.deepcopy(data)
    def update(self, data):
        for key,value in data.items():
            if hasattr(value, "values"): self.records[self.key].setdefault(key,[]).extend(copy.deepcopy(value.values))
            else: self.records[self.key][key]=value
class Collection:
    def __init__(self): self.records={}
    def document(self,key): return Document(self.records,key)

@pytest.fixture
def setup(monkeypatch):
    store=Collection(); user={"uid":"customer", "email":"customer@example.com", "email_verified":True}
    app.dependency_overrides[get_current_user]=lambda: user
    monkeypatch.setattr(support,"collection",lambda:store)
    monkeypatch.setattr(support,"get_settings",lambda:SimpleNamespace(gemini_api_key="",support_agent_emails=["admin@plugorbit.com"]))
    yield TestClient(app),store,user
    app.dependency_overrides.clear()

def create(client): return client.post('/support/tickets',json={"category":"charging","title":"Cannot start","message":"The connector is not starting", "requestId":"unique-test-id"})

def test_saved_initial_help_and_idempotent(setup):
    client,store,user=setup
    first=create(client);assert first.status_code==200
    t=first.json()['ticket']; assert len(t['messages'])==2
    assert t['messages'][1]['author']=='orbit_guide'
    assert 'ownerUid' not in t
    assert create(client).json()['ticket']['id']==t['id'];assert len(store.records)==1

def test_owner_scope_and_agent_reply(setup):
    client,store,user=setup;t=create(client).json()['ticket']; path='/support/tickets/'+t['id']
    user['uid']='other'
    assert client.get(path).status_code==404
    assert client.post('/support/agent/tickets/'+t['id']+'/reply',json={'text':'Done'}).status_code==403
    user.update(uid='agent',email='admin@plugorbit.com',email_verified=False)
    assert client.get('/support/access').json()['agent'] is False
    user['email_verified']=True
    r=client.post('/support/agent/tickets/'+t['id']+'/reply',json={'text':'Checked the station; please use bay 2','resolve':True})
    assert r.status_code==200;assert r.json()['ticket']['messages'][-1]['author']=='agent'
    user.update(uid='customer',email='customer@example.com')
    assert client.get(path).json()['ticket']['status']=='resolved'
    assert client.post(path+'/reply',json={'text':'More help'}).status_code==409

def test_customer_cannot_resolve_and_auth_required(setup):
    client,store,user=setup;t=create(client).json()['ticket']
    assert client.post('/support/tickets/'+t['id']+'/reply',json={'text':'Close it','resolve':True}).status_code==403
    app.dependency_overrides.clear()
    assert create(client).status_code==401

def test_live_ai_author_is_distinct_from_agent(setup,monkeypatch):
    client,store,user=setup
    monkeypatch.setattr(support,'get_settings',lambda:SimpleNamespace(gemini_api_key='test',support_agent_emails=[]))
    async def answer(*args): return {'answer':'Check the operator app.'}
    monkeypatch.setattr(support,'chat',answer)
    t=create(client).json()['ticket']
    last=client.get('/support/tickets/'+t['id']).json()['ticket']['messages'][-1]
    assert last['author']=='orbit'
