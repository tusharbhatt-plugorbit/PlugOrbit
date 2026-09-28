from fastapi import APIRouter, Depends

from ..deps import get_current_user
from ..schemas import MessageResponse, UpdateProfileRequest, UserOut
from ..services import users

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
