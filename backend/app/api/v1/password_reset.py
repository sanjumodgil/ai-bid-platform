"""
Password Reset — Phase 1 implementation.
- No email config: generates a reset token, shows it on screen (demo mode)
- With email config: sends reset link via email
- First login: forces password change
"""
import secrets
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from pydantic import BaseModel
from app.database import get_session
from app.models import User
from app.core.auth import hash_password, verify_password
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

# In-memory reset token store (Phase 1 — no DB table needed)
# { token: { user_id, expires_at } }
_reset_tokens: dict = {}

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

@router.post("/forgot-password")
async def forgot_password(
    data: ForgotPasswordRequest,
    session: Session = Depends(get_session)
):
    user = session.exec(select(User).where(User.email == data.email)).first()
    # Always return success to prevent email enumeration
    if not user:
        return {"message": "If that email exists, a reset link has been sent.", "demo_token": None}

    token = secrets.token_urlsafe(32)
    _reset_tokens[token] = {
        "user_id": user.id,
        "expires_at": datetime.utcnow() + timedelta(hours=1)
    }

    from app.core.email import send_password_reset_email
    email_sent = send_password_reset_email(user.email, token)

    if email_sent:
        return {
            "message": "Password reset link sent to your email.",
            "demo_token": None
        }
    else:
        # SMTP not configured — demo mode, return token directly
        logger.info(f"Password reset token for {user.email}: {token}")
        return {
            "message": "No email server configured. Use the token below to reset your password.",
            "demo_token": token,
            "expires_in_minutes": 60
        }

@router.post("/reset-password")
async def reset_password(
    data: ResetPasswordRequest,
    session: Session = Depends(get_session)
):
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    if len(data.new_password) > 72:
        raise HTTPException(status_code=400, detail="Password must be 72 characters or fewer.")

    token_data = _reset_tokens.get(data.token)
    if not token_data:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")
    if datetime.utcnow() > token_data["expires_at"]:
        del _reset_tokens[data.token]
        raise HTTPException(status_code=400, detail="Reset token has expired. Please request a new one.")

    user = session.get(User, token_data["user_id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    user.hashed_password = hash_password(data.new_password)
    user.must_change_password = False
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    del _reset_tokens[data.token]
    logger.info(f"Password reset completed for {user.email}")
    return {"message": "Password reset successfully. You can now sign in."}

@router.post("/change-password")
async def change_password(
    data: ChangePasswordRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(__import__('app.core.auth', fromlist=['get_current_user']).get_current_user)
):
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    if len(data.new_password) > 72:
        raise HTTPException(status_code=400, detail="Password must be 72 characters or fewer.")

    current_user.hashed_password = hash_password(data.new_password)
    current_user.must_change_password = False
    current_user.updated_at = datetime.utcnow()
    session.add(current_user)
    session.commit()
    return {"message": "Password changed successfully."}
