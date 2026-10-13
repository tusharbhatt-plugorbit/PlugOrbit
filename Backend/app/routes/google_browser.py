"""Browser Google fallback; app-only poll secret, CSRF-bound completion, short-lived flows."""
import hashlib
import json
import secrets
import time
from collections import OrderedDict
from pathlib import Path
from threading import Lock
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from ..config import get_settings
from ..deps import require_firebase
from ..schemas import GoogleLoginRequest
from .auth import google_login

router=APIRouter(prefix="/auth/google-browser",tags=["Google browser sign-in"],dependencies=[Depends(require_firebase)])
_flows: dict[str,dict]={}
_starts: OrderedDict[str,list[float]]=OrderedDict()
_lock=Lock()
class Completion(BaseModel):
    flow_id: str = Field(min_length=16,max_length=80,pattern=r"^[A-Za-z0-9_-]+$")
    id_token: str = Field(min_length=1,max_length=16000)

def flow_for(flow_id):
    flow=_flows.get(flow_id)
    if not flow or flow["expires"]<time.monotonic():
        _flows.pop(flow_id,None)
        raise HTTPException(410,detail={"message":"Google sign-in expired. Return to the app and retry."})
    return flow

def cookie_name(flow_id): return "po_google_"+flow_id[:12]

@router.post("/start")
def start(request: Request):
    with _lock:
        now=time.monotonic()
        for key in list(_flows):
            if _flows[key]["expires"]<now: _flows.pop(key,None)
        ip=request.client.host if request.client else "unknown"
        recent=[t for t in _starts.pop(ip,[]) if now-t<300];_starts[ip]=recent
        while len(_starts)>1000: _starts.popitem(last=False)
        if len(recent)>=8 or len(_flows)>=512: raise HTTPException(429,detail={"message":"Please wait before retrying Google sign-in."})
        recent.append(now)
        flow_id=secrets.token_urlsafe(24); poll=secrets.token_urlsafe(32)
        _flows[flow_id]={"expires":now+240,"poll_hash":hashlib.sha256(poll.encode()).digest(),"csrf":secrets.token_urlsafe(32),"state":"pending","session":None}
    return JSONResponse({"flow_id":flow_id,"poll_secret":poll,"expires_in":240}, headers={"Cache-Control":"no-store"})

@router.get("/page",response_class=HTMLResponse)
def page(request: Request, flow: str):
    with _lock: pending=flow_for(flow)
    settings=get_settings(); nonce=secrets.token_urlsafe(24)
    config={"apiKey":settings.firebase_web_api_key,"authDomain":settings.firebase_project_id+".firebaseapp.com","projectId":settings.firebase_project_id}
    content=(Path(__file__).resolve().parent.parent/"web"/"google_login.html").read_text(encoding="utf-8")
    for marker,value in {"__CONFIG__":config,"__FLOW__":flow,"__CSRF__":pending["csrf"]}.items(): content=content.replace(marker,json.dumps(value).replace("<","\\u003c"))
    content=content.replace("__NONCE__",nonce)
    response=HTMLResponse(content,headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Frame-Options":"DENY",
      "Content-Security-Policy":f"default-src 'self'; script-src 'nonce-{nonce}' https://www.gstatic.com https://apis.google.com; style-src 'unsafe-inline'; connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com; frame-src https://*.firebaseapp.com https://accounts.google.com https://apis.google.com; frame-ancestors 'none'; base-uri 'none'"})
    response.set_cookie(cookie_name(flow),pending["csrf"],httponly=True,samesite="lax",secure=request.url.scheme=="https",path="/auth/google-browser",max_age=240)
    return response

@router.post("/complete")
def complete(body: Completion, request: Request, x_flow_csrf: str = Header(default="")):
    if request.headers.get("origin") != str(request.base_url).rstrip("/"):
        raise HTTPException(403,detail={"message":"This sign-in must finish in the browser page opened by PlugOrbit."})
    with _lock:
        flow=flow_for(body.flow_id)
        cookie=request.cookies.get(cookie_name(body.flow_id),"")
        if not secrets.compare_digest(flow["csrf"],x_flow_csrf) or not secrets.compare_digest(flow["csrf"],cookie):
            raise HTTPException(403,detail={"message":"Sign-in verification failed. Reopen Google sign-in from the app."})
        if flow["state"] != "pending": raise HTTPException(409,detail={"message":"This sign-in request has already been used."})
        flow["state"]="completing"
    try:
        session=google_login(GoogleLoginRequest(id_token=body.id_token)).model_dump(mode="json")
        with _lock: flow["session"]=session;flow["state"]="complete"
        return {"ok":True}
    except HTTPException as error:
        with _lock: flow["state"]="failed";flow["error"]="Google could not open your app session. Return to PlugOrbit and retry."
        raise error
    except Exception:
        with _lock: flow["state"]="failed";flow["error"]="Google sign-in could not finish. Please retry."
        raise HTTPException(503,detail={"message":"Google sign-in could not finish. Please retry."}) from None

@router.get("/poll/{flow_id}")
def poll(flow_id: str,x_poll_secret: str=Header(default="")):
    with _lock:
        flow=flow_for(flow_id)
        if not secrets.compare_digest(flow["poll_hash"],hashlib.sha256(x_poll_secret.encode()).digest()):
            raise HTTPException(403,detail={"message":"Sign-in request not found."})
        if flow["state"]=="complete":
            result={"status":"complete","session":flow["session"]};_flows.pop(flow_id,None);return JSONResponse(result,headers={"Cache-Control":"no-store"})
        if flow["state"]=="failed": return JSONResponse({"status":"failed","message":flow["error"]},headers={"Cache-Control":"no-store"})
        return JSONResponse({"status":"pending"},headers={"Cache-Control":"no-store"})
