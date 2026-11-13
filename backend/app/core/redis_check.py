"""
Redis availability check.
Called once at startup. Sets REDIS_AVAILABLE flag used throughout the app
to decide whether to dispatch Celery tasks or run synchronously as fallback.
"""
import logging

logger = logging.getLogger(__name__)

REDIS_AVAILABLE: bool = False

def check_redis(redis_url: str) -> bool:
    """Ping Redis. Returns True if reachable, False otherwise."""
    global REDIS_AVAILABLE
    try:
        import redis
        r = redis.from_url(redis_url, socket_connect_timeout=2)
        r.ping()
        REDIS_AVAILABLE = True
        logger.info(f"Redis available at {redis_url}")
        return True
    except Exception as e:
        REDIS_AVAILABLE = False
        logger.warning(
            f"Redis not available ({e}). "
            "Document ingestion will run synchronously (slower but functional). "
            "Install Redis or Docker to enable background processing."
        )
        return False
