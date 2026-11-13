from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from app.database import get_session
from app.models import User, UserRole
from app.core.auth import hash_password, get_current_user, require_admin, validate_password_length

router = APIRouter(prefix="/users", tags=["users"])

class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: UserRole = UserRole.VIEWER

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None

class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    is_active: bool
    last_login: Optional[datetime]
    created_at: datetime
    avatar_initials: str

def user_to_out(user: User) -> UserOut:
    initials = "".join(n[0].upper() for n in user.full_name.split()[:2])
    return UserOut(
        id=user.id, email=user.email, full_name=user.full_name,
        role=user.role, is_active=user.is_active, last_login=user.last_login,
        created_at=user.created_at, avatar_initials=initials,
    )

@router.get("/", response_model=List[UserOut])
async def list_users(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_admin)
):
    users = session.exec(select(User).order_by(User.created_at.desc())).all()
    return [user_to_out(u) for u in users]

@router.post("/", response_model=UserOut, status_code=201)
async def create_user(
    data: UserCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_admin)
):
    if session.exec(select(User).where(User.email == data.email)).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    validate_password_length(data.password)
    user = User(
        email=data.email,
        full_name=data.full_name,
        hashed_password=hash_password(data.password),
        role=data.role,
        is_verified=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user_to_out(user)

@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    data: UserUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_admin)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.role is not None:
        user.role = data.role
    if data.is_active is not None:
        user.is_active = data.is_active
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    return user_to_out(user)

@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_admin)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    session.delete(user)
    session.commit()
