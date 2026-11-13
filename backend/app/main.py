from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.config import settings
from app.database import create_db_and_tables, engine
from app.api.v1 import auth, users, opportunities, documents, setup, dashboard, password_reset, integrations, bid_team, kb_knowledge, generation, review, compliance, export, submission, orals
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Rate limiting (only active when RATE_LIMIT_ENABLED=true in .env) ──
_limiter = None
if settings.RATE_LIMIT_ENABLED:
    try:
        from slowapi import Limiter, _rate_limit_exceeded_handler
        from slowapi.util import get_remote_address
        from slowapi.errors import RateLimitExceeded
        _limiter = Limiter(
            key_func    = get_remote_address,
            default_limits = [f"{settings.RATE_LIMIT_PER_MINUTE}/minute"],
        )
        logger.info(f"Rate limiting enabled: {settings.RATE_LIMIT_PER_MINUTE} req/min per IP")
    except ImportError:
        logger.warning("slowapi not installed — rate limiting disabled. Run: pip install slowapi")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting AI-Powered Bid Platform API")
    create_db_and_tables()

    from app.core.redis_check import check_redis
    check_redis(settings.REDIS_URL)

    try:
        from app.core.embeddings import get_embedding_model
        logger.info("Pre-loading embedding model...")
        get_embedding_model()
        logger.info("Embedding model ready")
    except Exception as e:
        logger.warning(f"Could not pre-load embedding model: {e}")

    # Start background scheduler (deadline reminders etc.)
    from app.core.scheduler import start_scheduler
    start_scheduler()

    yield

    from app.core.scheduler import stop_scheduler
    stop_scheduler()
    logger.info("Shutting down")

app = FastAPI(
    title="AI-Powered Bid Platform API",
    description="Enterprise bid intelligence platform API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,   # must be False when allow_origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
)

# Attach rate limiter if enabled
if _limiter:
    try:
        from slowapi.errors import RateLimitExceeded
        from slowapi.middleware import SlowAPIMiddleware
        from slowapi import _rate_limit_exceeded_handler
        app.state.limiter = _limiter
        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
        app.add_middleware(SlowAPIMiddleware)
    except Exception as e:
        logger.warning(f"Rate limiter middleware failed to attach: {e}")

# Routes
PREFIX = "/api/v1"
app.include_router(setup.router,           prefix=PREFIX)
app.include_router(auth.router,            prefix=PREFIX)
app.include_router(password_reset.router,  prefix=PREFIX)
app.include_router(users.router,           prefix=PREFIX)
app.include_router(opportunities.router,   prefix=PREFIX)
app.include_router(documents.router,       prefix=PREFIX)
app.include_router(dashboard.router,       prefix=PREFIX)
app.include_router(integrations.router,    prefix=PREFIX)
app.include_router(bid_team.router,        prefix=PREFIX)
app.include_router(kb_knowledge.router,    prefix=PREFIX)
app.include_router(generation.router,      prefix=PREFIX)
app.include_router(review.router,          prefix=PREFIX)
app.include_router(compliance.router,      prefix=PREFIX)
app.include_router(export.router,          prefix=PREFIX)
app.include_router(submission.router,      prefix=PREFIX)
app.include_router(orals.router,           prefix=PREFIX)

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}

@app.post("/api/v1/debug/auth-check")
async def debug_auth(data: dict):
    logger.info("=" * 60)
    logger.info("AUTH DEBUG:")
    for k, v in data.items():
        logger.info(f"  {k}: {v}")
    logger.info("=" * 60)
    return {"received": True}

@app.post("/api/v1/debug/reset-password")
async def reset_password(data: dict):
    """
    Emergency password reset — use when hash is in wrong format.
    POST { "email": "...", "new_password": "..." }
    REMOVE THIS ENDPOINT before production deployment.
    """
    from app.database import get_session as _get_session
    from app.models import User as _User
    from app.core.auth import hash_password as _hash
    from sqlmodel import Session, select as _select

    email = data.get("email", "").strip()
    new_password = data.get("new_password", "").strip()

    if not email or not new_password:
        return {"error": "email and new_password required"}
    if len(new_password) < 8:
        return {"error": "password must be at least 8 characters"}

    with Session(engine) as session:
        user = session.exec(_select(_User).where(_User.email == email)).first()
        if not user:
            return {"error": f"No user found with email: {email}"}
        user.hashed_password = _hash(new_password)
        session.add(user)
        session.commit()
        logger.info(f"Password reset for {email} via debug endpoint")
        return {"success": True, "message": f"Password reset for {email}"}
