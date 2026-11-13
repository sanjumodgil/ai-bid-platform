from sqlmodel import SQLModel, create_engine, Session, select
from sqlalchemy import event, text
from sqlalchemy.pool import NullPool, QueuePool
from app.config import settings
import logging

logger = logging.getLogger(__name__)

# ── Engine — backend-aware config ────────────────────────────────
_is_sqlite  = "sqlite" in settings.DATABASE_URL
_is_pg      = settings.DATABASE_URL.startswith("postgresql")
_is_mssql   = settings.DATABASE_URL.startswith("mssql")

if _is_sqlite:
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args = {"check_same_thread": False},
        echo         = settings.DEBUG,
    )
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
else:
    # PostgreSQL / MSSQL — use connection pool
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size         = settings.DATABASE_POOL_SIZE,
        max_overflow      = settings.DATABASE_MAX_OVERFLOW,
        pool_pre_ping     = True,   # reconnect on stale connections
        pool_recycle      = 3600,   # recycle connections every hour
        echo              = settings.DEBUG,
    )

def get_session():
    with Session(engine) as session:
        yield session

# ── Column migrations ─────────────────────────────────────────────
# SQLite doesn't support ALTER TABLE DROP COLUMN or complex changes,
# but ADD COLUMN is safe. We run these at startup so the DB is always
# in sync with the model without requiring a full recreation.
_MIGRATIONS = [
    # Phase 1 columns
    ("opportunities",      "sub_domain",        "VARCHAR",  "NULL"),
    ("opportunities",      "capture_result",    "VARCHAR",  "NULL"),
    ("documents",          "sub_domain",        "VARCHAR",  "NULL"),
    ("documents",          "display_name",      "VARCHAR",  "NULL"),
    ("documents",          "owning_team",       "VARCHAR",  "NULL"),
    ("documents",          "uploaded_by_name",  "VARCHAR",  "NULL"),
    ("documents",          "uploaded_by_id",    "VARCHAR",  "NULL"),
    ("users",              "must_change_password", "BOOLEAN", "0"),
    # Embedding config
    ("llm_provider_config", "embedding_model",  "VARCHAR",  "NULL"),
    ("llm_provider_config", "api_version",      "VARCHAR",  "NULL"),
    # Phase 2 — new tables handled by create_all, but check they exist
    ("bid_sections",        "id",  "VARCHAR", None),
    ("section_annotations", "id",  "VARCHAR", None),
    ("compliance_checks",   "id",  "VARCHAR", None),
    ("submissions",         "id",  "VARCHAR", None),
    # Phase 3 — orals track
    ("oral_sessions",         "id", "VARCHAR", None),
    ("presentation_slides",   "id", "VARCHAR", None),
    ("anticipated_questions", "id", "VARCHAR", None),
    ("rehearsal_sessions",    "id", "VARCHAR", None),
]

def _run_migrations():
    """Add missing columns to existing tables. Safe to run multiple times."""
    if "sqlite" not in settings.DATABASE_URL:
        return  # Only auto-migrate SQLite; use Alembic for production DBs

    with engine.connect() as conn:
        # Get existing tables
        tables = {row[0] for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}

        for table, column, col_type, default in _MIGRATIONS:
            if table not in tables:
                continue  # table doesn't exist yet — create_all will handle it
            if default is None:
                continue  # skip — just a table existence check

            # Check if column exists
            cols = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if column not in cols:
                default_clause = f"DEFAULT {default}" if default != "NULL" else ""
                sql = f"ALTER TABLE {table} ADD COLUMN {column} {col_type} {default_clause}"
                conn.execute(text(sql))
                conn.commit()
                logger.info(f"Migration: added {table}.{column}")

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    _run_migrations()
    _migrate_encrypt_secrets()
    logger.info("Database tables ready")

def _migrate_encrypt_secrets():
    """One-time migration: encrypt any plaintext API keys in the DB."""
    try:
        from app.core.encryption import migrate_plaintext
        from app.models import LLMProviderConfig, IntegrationConfig
        import json
        with Session(engine) as session:
            # Encrypt LLM provider API keys
            providers = session.exec(select(LLMProviderConfig)).all()
            changed = 0
            for p in providers:
                if p.api_key_encrypted and not p.api_key_encrypted.startswith("enc:"):
                    p.api_key_encrypted = migrate_plaintext(p.api_key_encrypted)
                    session.add(p)
                    changed += 1
            # Encrypt integration config secrets
            integrations = session.exec(select(IntegrationConfig)).all()
            for i in integrations:
                if i.config_json:
                    try:
                        cfg = json.loads(i.config_json)
                        dirty = False
                        for k in cfg:
                            if any(s in k.lower() for s in ['secret', 'password', 'key']):
                                if cfg[k] and not cfg[k].startswith("enc:"):
                                    cfg[k] = migrate_plaintext(cfg[k])
                                    dirty = True
                        if dirty:
                            i.config_json = json.dumps(cfg)
                            session.add(i)
                            changed += 1
                    except Exception:
                        pass
            if changed:
                session.commit()
                logger.info(f"Encrypted {changed} plaintext secret(s) in DB")
    except Exception as e:
        logger.warning(f"Secret migration skipped: {e}")
