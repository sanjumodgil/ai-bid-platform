"""
Background job runner — auto-detects the best available backend.

Priority order (highest to lowest):
  1. JOBS_BACKEND=celery_redis      → Celery + Redis (if Redis reachable)
  2. JOBS_BACKEND=azure_service_bus → Azure Service Bus
  3. JOBS_BACKEND=sync (default)    → In-process synchronous

Auto-detection: if JOBS_BACKEND is not set (or set to 'sync') BUT Redis is
reachable, the platform automatically uses Celery for better throughput.
Set JOBS_BACKEND=sync explicitly to force synchronous mode.

Usage:
    from app.core.jobs import run_job
    run_job("ingest_document", document_id=doc.id, file_path=path)
"""
import logging
from typing import Any
from app.config import settings

logger = logging.getLogger(__name__)

# ── Redis availability check ──────────────────────────────────────

_redis_available: bool | None = None   # None = not yet tested

def _check_redis() -> bool:
    global _redis_available
    if _redis_available is not None:
        return _redis_available
    try:
        import redis
        r = redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        r.ping()
        _redis_available = True
        logger.info("Jobs: Redis reachable — using Celery for background tasks")
    except Exception:
        _redis_available = False
        logger.info("Jobs: Redis not reachable — using synchronous fallback")
    return _redis_available

def _effective_backend() -> str:
    """
    Resolve the actual jobs backend to use.
    If JOBS_BACKEND is explicitly set, honour it.
    Otherwise auto-detect: use celery_redis if Redis is reachable.
    """
    configured = settings.JOBS_BACKEND.lower()
    if configured in ("celery_redis", "azure_service_bus"):
        return configured
    # Auto-detect
    if _check_redis():
        return "celery_redis"
    return "sync"

# ── Task registry ─────────────────────────────────────────────────

def _task_ingest_document(document_id: str, file_path: str, **kwargs):
    from app.core.ingestion import process_document
    from app.database import engine
    from sqlmodel import Session
    from app.models import Document
    with Session(engine) as session:
        doc = session.get(Document, document_id)
        file_type = doc.file_type if doc else "pdf"
    process_document(document_id, file_path, file_type)

TASK_REGISTRY = {
    "ingest_document": _task_ingest_document,
}

# ── Sync runner ───────────────────────────────────────────────────

def _run_sync(task_name: str, **kwargs):
    fn = TASK_REGISTRY.get(task_name)
    if not fn:
        raise ValueError(f"Unknown task: {task_name}")
    try:
        fn(**kwargs)
        logger.info(f"Sync task '{task_name}' completed")
    except Exception as e:
        logger.error(f"Sync task '{task_name}' failed: {e}", exc_info=True)
        raise

# ── Celery runner (with sync fallback) ───────────────────────────

def _run_celery(task_name: str, **kwargs):
    try:
        from app.celery_app import celery_app

        @celery_app.task(name=task_name, bind=True, max_retries=3)
        def _celery_task(self, **kw):
            fn = TASK_REGISTRY.get(task_name)
            if fn: fn(**kw)

        _celery_task.apply_async(kwargs=kwargs)
        logger.info(f"Celery task '{task_name}' dispatched")
    except Exception as e:
        logger.warning(f"Celery dispatch failed ({e}) — falling back to sync")
        _run_sync(task_name, **kwargs)

# ── Azure Service Bus runner (with sync fallback) ─────────────────

def _run_azure_service_bus(task_name: str, **kwargs):
    import json
    try:
        from azure.servicebus import ServiceBusClient, ServiceBusMessage
        msg_body = json.dumps({"task": task_name, "kwargs": kwargs})
        conn = settings.AZURE_SERVICE_BUS_CONNECTION_STRING
        if not conn:
            raise ValueError("AZURE_SERVICE_BUS_CONNECTION_STRING not set")
        with ServiceBusClient.from_connection_string(conn) as client:
            with client.get_queue_sender(settings.AZURE_SERVICE_BUS_QUEUE) as sender:
                sender.send_messages(ServiceBusMessage(msg_body))
        logger.info(f"Service Bus message sent: {task_name}")
    except Exception as e:
        logger.warning(f"Service Bus dispatch failed ({e}) — falling back to sync")
        _run_sync(task_name, **kwargs)

# ── Public API ────────────────────────────────────────────────────

def run_job(task_name: str, **kwargs):
    """Dispatch a background job. Auto-detects best available backend."""
    backend = _effective_backend()
    if   backend == "celery_redis":      _run_celery(task_name, **kwargs)
    elif backend == "azure_service_bus": _run_azure_service_bus(task_name, **kwargs)
    else:                                _run_sync(task_name, **kwargs)

async def run_job_async(task_name: str, **kwargs):
    """Fire-and-forget from an async FastAPI endpoint."""
    import asyncio
    await asyncio.to_thread(run_job, task_name, **kwargs)
