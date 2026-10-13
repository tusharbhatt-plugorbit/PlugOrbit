"""Owned support tickets with automated first help and authorised human replies."""
import hashlib
import time
import uuid
from typing import Literal
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from firebase_admin import firestore
from ..config import get_settings
from ..deps import get_current_user
from .assistant_guide import Chat, chat

router = APIRouter(prefix="/support", tags=["support"])
class NewTicket(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    category: Literal["charging", "payment", "station", "other"]
    title: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=2000)
    linkedSessionId: str | None = Field(default=None, max_length=200)
    requestId: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
class Reply(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    text: str = Field(min_length=1, max_length=2000)
    resolve: bool = False

def collection(): return firestore.client().collection("support_tickets")
def is_agent(user):
    return user.get("support_agent") is True or (user.get("email_verified") is True and (user.get("email") or "").lower() in {e.lower() for e in get_settings().support_agent_emails})
def agent(user = Depends(get_current_user)):
    if not is_agent(user): raise HTTPException(403, detail={"message": "Support agent access is required."})
    return user

def public(ticket): return {k: v for k, v in ticket.items() if k not in {"ownerUid", "ownerEmail"}}
def owned(ticket_id, user):
    ref = collection().document(ticket_id); snapshot = ref.get()
    if not snapshot.exists: raise HTTPException(404, detail={"message": "Ticket not found."})
    ticket = snapshot.to_dict()
    if ticket["ownerUid"] != user["uid"] and not is_agent(user): raise HTTPException(404, detail={"message": "Ticket not found."})
    return ref, ticket

def message(text, author):
    return {"id": uuid.uuid4().hex, "from": "user" if author == "user" else "support", "author": author, "text": text, "at": int(time.time()*1000)}
def guide(category, question=""):
    q = question.lower()
    if any(word in q for word in ["receipt", "invoice", "gst", "download"]):
        return "Open Activity, choose the session and tap Download receipt. Select a folder in Files and tap Save. This exports an app summary with a GST calculation; obtain an official tax invoice from the operator. Your ticket is saved for human review."
    if any(word in q for word in ["login", "sign in", "google", "sms", "otp"]):
        return "Try email sign-in or Google browser sign-in. Approve your Google account in the browser and return to PlugOrbit. If SMS reports billing unavailable, the project owner must complete billing setup. Never share your OTP or password. Your ticket is saved for human review."
    if any(word in q for word in ["qr", "camera", "scan"]):
        return "Open Scan charger QR to launch the camera scanner. Check Google Play services are available. You can enter the registered charger ID manually, or explicitly open the website shown by an operator QR. Your ticket is saved for human review."
    help_text = {"charging": "Check the connector fits your car and the operator app shows this charger online. If charging will not start, stop the attempt in the operator app, reconnect only when safe, and keep the charger ID for support.",
      "payment": "Keep the receipt/reference and avoid repeating a payment while its status is unclear. Check the charging operator's payment history. A support agent must verify duplicate charges or refunds; Orbit cannot issue a refund.",
      "station": "Check the map address and operator status. If a charger is blocked or offline, choose a compatible alternative. Share the station name and what you found so support can verify the details."}
    return help_text.get(category, "Please describe what happened and which screen or charging station was involved. Do not send passwords, OTPs or payment card details.") + " Your ticket is saved for human support review; a reply will appear here when an agent responds."

async def ai_first(ticket_id, body, user):
    if not get_settings().gemini_api_key: return
    try:
        response = await chat(Chat(message=body.message, context="Support ticket category: " + body.category + "; title: " + body.title), user)
        ref = collection().document(ticket_id)
        ref.update({"messages": firestore.ArrayUnion([message(response["answer"], "orbit")]), "updatedAt": int(time.time()*1000)})
    except Exception:
        # The clearly labelled automated guide remains; never impersonate a human agent.
        return

@router.get("/access")
def access(user = Depends(get_current_user)): return {"agent": is_agent(user)}

@router.get("/tickets")
def tickets(user = Depends(get_current_user)):
    from google.cloud.firestore_v1.base_query import FieldFilter
    rows = [public(d.to_dict()) for d in collection().where(filter=FieldFilter("ownerUid", "==", user["uid"])).limit(100).stream()]
    return {"tickets": sorted(rows, key=lambda t: t["updatedAt"], reverse=True)}

@router.post("/tickets")
def create(body: NewTicket, background: BackgroundTasks, user = Depends(get_current_user)):
    ticket_id = hashlib.sha256((user["uid"] + ":" + body.requestId).encode()).hexdigest()[:40]
    ref = collection().document(ticket_id)
    old = ref.get()
    if old.exists: return {"ticket": public(old.to_dict())}
    now = int(time.time()*1000)
    ticket = {"id": ticket_id, "number": "PO-" + ticket_id[:12].upper(), "ownerUid": user["uid"], "ownerEmail": user.get("email", ""),
      "category": body.category, "title": body.title.strip(), "status": "open", "linkedSessionId": body.linkedSessionId,
      "createdAt": now, "updatedAt": now, "messages": [message(body.message.strip(), "user"), message(guide(body.category, body.title + " " + body.message), "orbit_guide")]}
    try: ref.create(ticket)
    except Exception:
        old = ref.get()
        if old.exists: return {"ticket": public(old.to_dict())}
        raise
    background.add_task(ai_first, ticket_id, body, user)
    return {"ticket": public(ticket)}

@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str, user = Depends(get_current_user)):
    _, ticket = owned(ticket_id, user); return {"ticket": public(ticket)}

@router.post("/tickets/{ticket_id}/reply")
def reply(ticket_id: str, body: Reply, user = Depends(get_current_user)):
    if body.resolve: raise HTTPException(403, detail={"message": "Only an agent can resolve a ticket."})
    ref, ticket = owned(ticket_id, user)
    if ticket["status"] == "resolved": raise HTTPException(409, detail={"message": "This ticket is resolved. Open a new ticket for more help."})
    ref.update({"messages": firestore.ArrayUnion([message(body.text.strip(), "user")]), "updatedAt": int(time.time()*1000)})
    return {"ticket": public(ref.get().to_dict())}

@router.get("/agent/tickets")
def inbox(user = Depends(agent)):
    rows = [d.to_dict() for d in collection().order_by("updatedAt", direction="DESCENDING").limit(100).stream()]
    return {"tickets": rows}

@router.post("/agent/tickets/{ticket_id}/reply")
def agent_reply(ticket_id: str, body: Reply, user = Depends(agent)):
    ref, _ = owned(ticket_id, user)
    ref.update({"messages": firestore.ArrayUnion([message(body.text.strip(), "agent")]), "updatedAt": int(time.time()*1000), "status": "resolved" if body.resolve else "in_review"})
    return {"ticket": ref.get().to_dict()}
