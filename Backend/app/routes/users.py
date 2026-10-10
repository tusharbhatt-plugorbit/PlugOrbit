from fastapi import APIRouter, Depends

from ..deps import get_current_user
from ..schemas import (MessageResponse, PutStateRequest, PutStateResponse, StateOut,
                       UpdateProfileRequest, UserOut)
from ..services import app_state, users

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def get_me(user: dict = Depends(get_current_user)):
    return users.get_profile(user["uid"])


@router.patch("/me", response_model=UserOut)
def update_me(body: UpdateProfileRequest, user: dict = Depends(get_current_user)):
    return users.update_name(user["uid"], body.name)


@router.delete("/me", response_model=MessageResponse)
def delete_me(user: dict = Depends(get_current_user)):
    users.delete_user(user["uid"])
    return MessageResponse(message="Account deleted.")


@router.get("/me/state", response_model=StateOut)
def get_state(user: dict = Depends(get_current_user)):
    """The signed-in user's synced app data, one entry per stored slice."""
    return StateOut(slices=app_state.list_state(user["uid"]))


@router.put("/me/state", response_model=PutStateResponse)
def put_state(body: PutStateRequest, user: dict = Depends(get_current_user)):
    """Replace the given slices (all or nothing). Slices not in the body are left alone."""
    return PutStateResponse(slices=app_state.put_state(user["uid"], body.slices, body.schema_version))
