from firebase_admin import auth, firestore

from ..firebase import get_db
from ..schemas import UserOut

USERS = "users"


def create_profile(uid: str, email: str, name: str) -> None:
    get_db().collection(USERS).document(uid).set({
        "email": email,
        "name": name,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })


def get_profile(uid: str) -> UserOut:
    record = auth.get_user(uid)
    ref = get_db().collection(USERS).document(uid)
    snap = ref.get()
    if not snap.exists:
        create_profile(uid, record.email, record.display_name or "")
        snap = ref.get()
    data = snap.to_dict() or {}
    return UserOut(
        uid=uid,
        email=record.email,
        name=data.get("name") or record.display_name or "",
        email_verified=record.email_verified,
        created_at=data.get("createdAt"),
    )


def update_name(uid: str, name: str) -> UserOut:
    auth.update_user(uid, display_name=name)
    get_db().collection(USERS).document(uid).set({"name": name}, merge=True)
    return get_profile(uid)


def delete_user(uid: str) -> None:
    # Recursive: the profile and everything under it (users/{uid}/state/*), so deleting an
    # account leaves no orphaned user data behind.
    ref = get_db().collection(USERS).document(uid)
    get_db().recursive_delete(ref)
    auth.delete_user(uid)
