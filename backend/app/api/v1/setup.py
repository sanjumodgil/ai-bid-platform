from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from app.database import get_session
from app.models import User, UserRole, PlatformConfig, LLMProviderConfig
from app.core.auth import hash_password, get_current_user, require_admin, validate_password_length
from app.core.encryption import encrypt, decrypt
import logging

router = APIRouter(prefix="/setup", tags=["setup"])
logger = logging.getLogger(__name__)

class FirstRunRequest(BaseModel):
    platform_name: str = "AI-Powered Bid Platform"
    accent_color: str = "#C8A882"
    admin_email: EmailStr
    admin_name: str
    admin_password: str
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    llm_endpoint: Optional[str] = None
    vector_db_backend: str = "chroma"
    vector_db_url: Optional[str] = None
    vector_db_api_key: Optional[str] = None

class LLMProviderRequest(BaseModel):
    provider: str
    display_name: str
    api_key: Optional[str] = None
    endpoint: Optional[str] = None
    api_version: Optional[str] = None
    model: str
    embedding_model: Optional[str] = None
    is_default: bool = False
    data_residency: Optional[str] = None

class PlatformConfigResponse(BaseModel):
    id: str
    platform_name: str
    accent_color: str
    first_run_completed: bool
    vector_db_backend: str
    embedding_backend: str
    sso_enabled: bool

@router.get("/status")
async def get_setup_status(session: Session = Depends(get_session)):
    """Check if first-run setup has been completed. Public endpoint."""
    config = session.exec(select(PlatformConfig)).first()
    if not config or not config.first_run_completed:
        return {"first_run_completed": False, "message": "Platform setup required"}
    return {
        "first_run_completed": True,
        "platform_name": config.platform_name,
        "accent_color": config.accent_color,
        "sso_enabled": config.sso_enabled,
    }

@router.post("/first-run", status_code=201)
async def complete_first_run(
    data: FirstRunRequest,
    session: Session = Depends(get_session)
):
    """Complete the first-run wizard. Can only be called once."""
    existing = session.exec(select(PlatformConfig)).first()
    if existing and existing.first_run_completed:
        # Already configured — return 200 so the frontend redirects to login
        # instead of crashing with a 400 error
        return {
            "message": "Platform already configured",
            "already_configured": True,
            "platform_name": existing.platform_name,
        }
    if session.exec(select(User).where(User.email == data.admin_email)).first():
        raise HTTPException(status_code=400, detail="Admin email already registered")

    validate_password_length(data.admin_password)

    # Create platform config
    config = existing or PlatformConfig()
    config.platform_name = data.platform_name
    config.accent_color = data.accent_color
    config.first_run_completed = True
    config.default_llm_provider = data.llm_provider
    config.default_llm_model = data.llm_model
    config.vector_db_backend = data.vector_db_backend
    config.updated_at = datetime.utcnow()
    session.add(config)

    # Create superuser
    admin = User(
        email=data.admin_email,
        full_name=data.admin_name,
        hashed_password=hash_password(data.admin_password),
        role=UserRole.SUPER_ADMIN,
        is_active=True,
        is_verified=True,
    )
    session.add(admin)

    # Create initial LLM provider config if provided
    if data.llm_provider and data.llm_model:
        from cryptography.fernet import Fernet
        llm_config = LLMProviderConfig(
            provider=data.llm_provider,
            display_name=data.llm_provider.replace("_", " ").title(),
            api_key_encrypted=data.llm_api_key,  # TODO: encrypt in production
            endpoint=data.llm_endpoint,
            model=data.llm_model,
            is_default=True,
            is_active=True,
        )
        session.add(llm_config)

    session.commit()
    logger.info(f"First-run setup completed. Platform: {data.platform_name}, Admin: {data.admin_email}")
    return {"message": "Setup completed successfully", "platform_name": data.platform_name}

@router.get("/config", response_model=PlatformConfigResponse)
async def get_platform_config(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    config = session.exec(select(PlatformConfig)).first()
    if not config:
        raise HTTPException(status_code=404, detail="Platform not configured")
    return PlatformConfigResponse(**config.model_dump())

@router.patch("/config")
async def update_platform_config(
    data: dict,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_admin)
):
    config = session.exec(select(PlatformConfig)).first()
    if not config:
        raise HTTPException(status_code=404, detail="Platform not configured")
    allowed_fields = ["platform_name", "accent_color", "sso_enabled", "vector_db_backend", "embedding_backend"]
    for field in allowed_fields:
        if field in data:
            setattr(config, field, data[field])
    config.updated_at = datetime.utcnow()
    session.add(config)
    session.commit()
    return {"message": "Configuration updated"}

@router.get("/llm-providers")
async def list_llm_providers(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_admin)
):
    providers = session.exec(select(LLMProviderConfig).where(LLMProviderConfig.is_active == True)).all()
    return [{"id": p.id, "provider": p.provider, "display_name": p.display_name,
             "model": p.model, "is_default": p.is_default, "data_residency": p.data_residency,
             "endpoint": p.endpoint} for p in providers]

@router.post("/llm-providers", status_code=201)
async def add_llm_provider(
    data: LLMProviderRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_admin)
):
    if data.is_default:
        # Remove default from others
        existing_defaults = session.exec(select(LLMProviderConfig).where(LLMProviderConfig.is_default == True)).all()
        for ep in existing_defaults:
            ep.is_default = False
            session.add(ep)

    llm = LLMProviderConfig(
        provider           = data.provider,
        display_name       = data.display_name,
        api_key_encrypted  = encrypt(data.api_key) if data.api_key else None,
        endpoint           = data.endpoint,
        api_version        = data.api_version,
        model              = data.model,
        embedding_model    = data.embedding_model or None,
        is_default         = data.is_default,
        data_residency     = data.data_residency,
    )
    session.add(llm)
    session.commit()

    # Reset embedding model cache so it picks up new config
    try:
        from app.core.embeddings import reset_embedding_model
        reset_embedding_model()
    except Exception:
        pass

    return {"id": llm.id, "message": "LLM provider added"}

@router.get("/health")
async def health_check():
    """System health check — all infrastructure components."""
    from app.config import settings
    checks = {}

    # ── Relational DB ─────────────────────────────────────────────
    try:
        from app.database import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = {
            "status":  "ok",
            "backend": settings.database_backend,
            "url":     settings.DATABASE_URL.split("@")[-1] if "@" in settings.DATABASE_URL else settings.DATABASE_URL,
        }
    except Exception as e:
        checks["database"] = {"status": "error", "backend": settings.database_backend, "error": str(e)[:120]}

    # ── Vector DB ─────────────────────────────────────────────────
    try:
        from app.core.vector_store import get_or_create_vector_store
        vs = get_or_create_vector_store()
        count = vs.count()
        checks["vector_db"] = {
            "status":  "ok",
            "backend": settings.VECTOR_DB_BACKEND,
            "chunks":  count,
        }
    except Exception as e:
        checks["vector_db"] = {"status": "error", "backend": settings.VECTOR_DB_BACKEND, "error": str(e)[:120]}

    # ── File Storage ──────────────────────────────────────────────
    try:
        if settings.STORAGE_BACKEND == "local":
            import os
            ok = os.path.isdir(settings.UPLOAD_DIR)
            checks["storage"] = {
                "status":  "ok" if ok else "warn",
                "backend": "local",
                "path":    settings.UPLOAD_DIR,
            }
        elif settings.STORAGE_BACKEND == "azure_blob":
            from azure.storage.blob import BlobServiceClient
            conn = settings.AZURE_STORAGE_CONNECTION_STRING
            client = BlobServiceClient.from_connection_string(conn)
            client.get_account_information()
            checks["storage"] = {"status": "ok", "backend": "azure_blob", "container": settings.AZURE_STORAGE_CONTAINER}
        elif settings.STORAGE_BACKEND == "s3":
            import boto3
            s3 = boto3.client("s3", aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                              aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                              region_name=settings.AWS_S3_REGION)
            s3.head_bucket(Bucket=settings.AWS_S3_BUCKET)
            checks["storage"] = {"status": "ok", "backend": "s3", "bucket": settings.AWS_S3_BUCKET}
        else:
            checks["storage"] = {"status": "warn", "backend": settings.STORAGE_BACKEND, "error": "Unknown backend"}
    except Exception as e:
        checks["storage"] = {"status": "error", "backend": settings.STORAGE_BACKEND, "error": str(e)[:120]}

    # ── Authentication ────────────────────────────────────────────
    checks["auth"] = {
        "status":     "ok",
        "backend":    settings.AUTH_BACKEND,
        "configured": settings.auth_configured,
    }

    # ── Secrets ───────────────────────────────────────────────────
    checks["secrets"] = {
        "status":   "ok" if settings.secrets_configured else "warn",
        "backend":  settings.SECRETS_BACKEND,
        "secure":   settings.secrets_secure,
        "warning":  "API keys stored in plaintext database — use azure_keyvault or env for production"
                    if not settings.secrets_secure else None,
    }

    # ── Redis / Jobs ──────────────────────────────────────────────
    try:
        import redis as _redis
        r = _redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        r.ping()
        checks["jobs"] = {"status": "ok", "backend": settings.JOBS_BACKEND, "redis": "connected"}
    except Exception as e:
        checks["jobs"] = {
            "status":  "warn" if settings.JOBS_BACKEND == "sync" else "error",
            "backend": settings.JOBS_BACKEND,
            "redis":   "unavailable",
            "note":    "Running in synchronous mode" if settings.JOBS_BACKEND == "sync" else str(e)[:80],
        }

    # ── Embedding ─────────────────────────────────────────────────
    try:
        from app.core.embeddings import get_embedding_status
        emb = get_embedding_status()
        checks["embeddings"] = {"status": "ok", **emb}
    except Exception as e:
        checks["embeddings"] = {"status": "error", "error": str(e)[:120]}

    # ── LLM ───────────────────────────────────────────────────────
    from app.core.llm import get_status as llm_status
    llm = llm_status()
    checks["llm"] = {
        "status":     "ok" if llm.get("configured") else "warn",
        "configured": llm.get("configured", False),
        "provider":   llm.get("provider"),
        "model":      llm.get("model"),
        "reason":     llm.get("reason") if not llm.get("configured") else None,
    }

    # ── Overall ───────────────────────────────────────────────────
    statuses = [v.get("status") for v in checks.values()]
    overall = "healthy" if all(s == "ok" for s in statuses) \
        else "degraded" if "error" in statuses \
        else "warning"

    return {
        "status":      overall,
        "environment": settings.ENVIRONMENT,
        "checks":      checks,
        "config": {
            "database_backend":   settings.database_backend,
            "vector_db_backend":  settings.VECTOR_DB_BACKEND,
            "storage_backend":    settings.STORAGE_BACKEND,
            "auth_backend":       settings.AUTH_BACKEND,
            "secrets_backend":    settings.SECRETS_BACKEND,
            "jobs_backend":       settings.JOBS_BACKEND,
            "data_residency":     settings.DATA_RESIDENCY,
            "gdpr_mode":          settings.GDPR_MODE,
            "audit_log_enabled":  settings.AUDIT_LOG_ENABLED,
        },
        "timestamp": datetime.utcnow().isoformat(),
    }

@router.get("/infrastructure")
async def get_infrastructure_config():
    """Returns current infrastructure configuration for the Settings UI."""
    from app.config import settings
    return {
        "database": {
            "backend":      settings.database_backend,
            "url_masked":   settings.DATABASE_URL.split("@")[-1] if "@" in settings.DATABASE_URL else settings.DATABASE_URL,
            "is_production_ready": settings.database_backend != "sqlite",
        },
        "vector_db": {
            "backend":      settings.VECTOR_DB_BACKEND,
            "configured":   settings.vector_db_configured,
            "is_production_ready": settings.VECTOR_DB_BACKEND != "chroma",
        },
        "storage": {
            "backend":      settings.STORAGE_BACKEND,
            "configured":   settings.storage_configured,
            "is_production_ready": settings.STORAGE_BACKEND != "local",
        },
        "auth": {
            "backend":      settings.AUTH_BACKEND,
            "configured":   settings.auth_configured,
            "sso_enabled":  settings.SSO_ENABLED,
            "is_production_ready": settings.AUTH_BACKEND != "local",
        },
        "secrets": {
            "backend":      settings.SECRETS_BACKEND,
            "secure":       settings.secrets_secure,
            "is_production_ready": settings.secrets_secure,
        },
        "jobs": {
            "backend":      settings.JOBS_BACKEND,
            "is_production_ready": settings.JOBS_BACKEND != "sync",
        },
        "compliance": {
            "data_residency": settings.DATA_RESIDENCY,
            "gdpr_mode":      settings.GDPR_MODE,
            "audit_log":      settings.AUDIT_LOG_ENABLED,
        },
        "environment": settings.ENVIRONMENT,
    }
