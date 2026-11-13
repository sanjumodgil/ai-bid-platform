from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
from datetime import datetime
from pydantic import BaseModel, EmailStr
from app.database import get_session
from app.models import User, UserRole
from app.core.auth import (
    verify_password, hash_password, create_access_token, create_refresh_token,
    decode_token, get_current_user
)
import logging

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    full_name: str
    role: str
    must_change_password: bool = False

class RefreshRequest(BaseModel):
    refresh_token: str

class UserProfile(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    is_active: bool
    avatar_initials: str
    last_login: datetime | None

@router.post("/token", response_model=TokenResponse)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session)
):
    user = session.exec(select(User).where(User.email == form_data.username)).first()
    if not user or not verify_password(form_data.password, user.hashed_password or ""):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Account is inactive")

    # Silently re-hash with new bcrypt if stored with old passlib format
    # (old passlib hashes start with $2b$ but use a different internal structure)
    try:
        import bcrypt as _bcrypt
        _bcrypt.checkpw(form_data.password.encode('utf-8'), (user.hashed_password or "").encode('utf-8'))
    except Exception:
        # Old format detected — upgrade the hash transparently
        user.hashed_password = hash_password(form_data.password)
        logger.info(f"Upgraded password hash for user {user.email}")

    user.last_login = datetime.utcnow()
    session.add(user)
    session.commit()

    token_data = {"sub": user.id, "email": user.email, "role": user.role}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        must_change_password=user.must_change_password,
    )

@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: RefreshRequest,
    session: Session = Depends(get_session)
):
    payload = decode_token(request.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = session.get(User, payload.get("sub"))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found")
    token_data = {"sub": user.id, "email": user.email, "role": user.role}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
    )

@router.get("/me", response_model=UserProfile)
async def get_me(current_user: User = Depends(get_current_user)):
    initials = "".join(n[0].upper() for n in current_user.full_name.split()[:2])
    return UserProfile(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
        avatar_initials=initials,
        last_login=current_user.last_login,
    )

# ── Azure AD SSO endpoints ────────────────────────────────────────

@router.get("/azure-ad/login")
async def azure_ad_login(redirect_uri: str = ""):
    """Returns the Azure AD login URL for redirect."""
    from app.core.azure_ad_auth import get_azure_ad_login_url, is_azure_ad_configured
    from app.config import settings
    if not is_azure_ad_configured():
        raise HTTPException(400, "Azure AD not configured. Set AUTH_BACKEND=azure_ad and credentials in .env.")
    import secrets as _secrets
    state   = _secrets.token_urlsafe(16)
    login_url = get_azure_ad_login_url(redirect_uri or "http://localhost:5180/auth/callback", state)
    return {"login_url": login_url, "state": state}

@router.post("/azure-ad/callback")
async def azure_ad_callback(
    code:         str,
    redirect_uri: str = "http://localhost:5180/auth/callback",
    session: Session = Depends(get_session),
):
    """Exchange Azure AD code for platform JWT tokens."""
    from app.core.azure_ad_auth import exchange_code_for_token, get_user_info, validate_token_and_get_user
    from app.config import settings
    try:
        tokens     = await exchange_code_for_token(code, redirect_uri)
        access_tok = tokens.get("access_token", "")
        user_info  = await get_user_info(access_tok)

        email      = user_info.get("mail") or user_info.get("userPrincipalName", "")
        name       = user_info.get("displayName", email)

        # Get or create platform user
        from sqlmodel import select
        from app.models import User, UserRole
        from app.core.auth import hash_password
        import uuid as _uuid

        user = session.exec(select(User).where(User.email == email)).first()
        if not user:
            user = User(
                email           = email,
                full_name       = name,
                role            = UserRole.REVIEWER,
                hashed_password = hash_password(_uuid.uuid4().hex),
                is_active       = True,
            )
            session.add(user)
            session.commit()
            session.refresh(user)

        token_data = {"sub": user.id, "email": user.email, "role": user.role}
        return TokenResponse(
            access_token          = create_access_token(token_data),
            refresh_token         = create_refresh_token(token_data),
            user_id               = user.id,
            email                 = user.email,
            full_name             = user.full_name,
            role                  = user.role,
            must_change_password  = False,   # AD users never need to change password here
        )
    except Exception as e:
        raise HTTPException(400, f"Azure AD authentication failed: {str(e)[:200]}")

@router.get("/auth-config")
async def get_auth_config():
    """Returns auth backend config so the frontend knows whether to show SSO button."""
    from app.config import settings
    from app.core.azure_ad_auth import is_azure_ad_configured
    return {
        "backend":          settings.AUTH_BACKEND,
        "azure_ad_enabled": is_azure_ad_configured(),
        "sso_label":        "Sign in with Microsoft" if is_azure_ad_configured() else None,
    }

# ── Azure AD SSO endpoints ────────────────────────────────────────

@router.get("/azure-ad/config")
async def azure_ad_config():
    """Returns whether Azure AD SSO is configured (for login page display)."""
    from app.core.azure_ad_auth import is_configured
    from app.config import settings
    return {
        "enabled":    is_configured(),
        "auth_backend": settings.AUTH_BACKEND,
        "tenant_id":  settings.AZURE_AD_TENANT_ID,
        "client_id":  settings.AZURE_AD_CLIENT_ID,
    }

@router.get("/azure-ad/login")
async def azure_ad_login(redirect_uri: str = "http://localhost:5180/auth/callback"):
    """Redirect to Microsoft login page."""
    from app.core.azure_ad_auth import get_auth_url, is_configured
    if not is_configured():
        raise HTTPException(400, "Azure AD SSO is not configured")
    url = get_auth_url(redirect_uri)
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url)

@router.post("/azure-ad/callback")
async def azure_ad_callback(
    code:         str,
    redirect_uri: str = "http://localhost:5180/auth/callback",
    session: Session = Depends(get_session),
):
    """Exchange Azure AD code for local JWT. Creates user if first login."""
    from app.core.azure_ad_auth import exchange_code, is_configured
    if not is_configured():
        raise HTTPException(400, "Azure AD SSO is not configured")

    user_info = exchange_code(code, redirect_uri)
    if not user_info or not user_info.get("email"):
        raise HTTPException(401, "Azure AD authentication failed")

    email = user_info["email"].lower()

    # Find or create user
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        from app.core.auth import hash_password
        import secrets
        user = User(
            email       = email,
            full_name   = user_info.get("full_name", email),
            role        = UserRole.MEMBER,
            is_active   = True,
            hashed_password = hash_password(secrets.token_urlsafe(32)),  # random, unused
            department  = user_info.get("department", ""),
            job_title   = user_info.get("job_title", ""),
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        logger.info(f"New user created via Azure AD SSO: {email}")
    else:
        # Sync profile updates from Azure AD
        user.full_name = user_info.get("full_name") or user.full_name
        session.add(user)
        session.commit()

    # Issue local JWT
    from app.core.auth import create_access_token
    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role})
    return {
        "access_token": token,
        "token_type":   "bearer",
        "user": {
            "id":        user.id,
            "email":     user.email,
            "full_name": user.full_name,
            "role":      user.role,
        }
    }

# ── SAML 2.0 endpoints ────────────────────────────────────────────

@router.get("/saml/login")
async def saml_login(request_url: str = ""):
    """Redirect to SAML IdP login page."""
    from app.core.saml_auth import is_configured, get_login_url
    if not is_configured():
        raise HTTPException(400, "SAML is not configured. Set AUTH_BACKEND=saml and SAML_* variables in .env")
    url = get_login_url(request_url)
    if not url:
        raise HTTPException(500, "SAML login URL generation failed. Ensure python3-saml is installed.")
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url)

@router.post("/saml/acs")
async def saml_acs(
    request_url: str = "",
    SAMLResponse: str = "",
    session: Session = Depends(get_session),
):
    """SAML Assertion Consumer Service — receives and validates IdP response."""
    from app.core.saml_auth import is_configured, process_response
    if not is_configured():
        raise HTTPException(400, "SAML is not configured")

    user_info = process_response(request_url, {"SAMLResponse": SAMLResponse})
    if not user_info or not user_info.get("email"):
        raise HTTPException(401, "SAML authentication failed")

    email = user_info["email"].lower()
    user  = session.exec(select(User).where(User.email == email)).first()
    if not user:
        from app.core.auth import hash_password
        import secrets as _secrets
        user = User(
            email           = email,
            full_name       = user_info.get("full_name", email),
            role            = UserRole.MEMBER,
            is_active       = True,
            hashed_password = hash_password(_secrets.token_urlsafe(32)),
            department      = user_info.get("department", ""),
            job_title       = user_info.get("job_title", ""),
        )
        session.add(user); session.commit(); session.refresh(user)
        logger.info(f"New user created via SAML: {email}")
    else:
        user.full_name = user_info.get("full_name") or user.full_name
        session.add(user); session.commit()

    from app.core.auth import create_access_token
    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role})
    return {"access_token": token, "token_type": "bearer",
            "user": {"id": user.id, "email": user.email, "full_name": user.full_name, "role": user.role}}

@router.get("/saml/metadata")
async def saml_metadata():
    """SP metadata XML — register this with your IdP."""
    from app.core.saml_auth import get_metadata
    metadata = get_metadata()
    if not metadata:
        raise HTTPException(500, "SAML metadata unavailable. Ensure python3-saml is installed.")
    from fastapi.responses import Response
    return Response(content=metadata, media_type="application/xml")
