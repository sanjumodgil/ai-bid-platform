from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import Optional
import secrets
import os

class Settings(BaseSettings):
    # ── Core ──────────────────────────────────────────────────────
    APP_NAME:    str = "AI-Powered Bid Platform"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = "development"   # development | staging | production
    DEBUG:       bool = False
    SECRET_KEY:  str = secrets.token_urlsafe(32)
    ALGORITHM:   str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES:  int = 60 * 8   # 8 hours
    REFRESH_TOKEN_EXPIRE_DAYS:    int = 30

    # ── Server ────────────────────────────────────────────────────
    HOST: str = "0.0.0.0"
    PORT: int = 8010
    CORS_ORIGINS: str = "http://localhost:5180,http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    # ── Relational Database ───────────────────────────────────────
    # Backends: sqlite | postgresql | mssql
    DATABASE_URL:    str = "sqlite:///./bidplatform.db"
    DATABASE_POOL_SIZE:    int = 5
    DATABASE_MAX_OVERFLOW: int = 10

    @property
    def database_backend(self) -> str:
        url = self.DATABASE_URL.lower()
        if url.startswith("sqlite"):        return "sqlite"
        if url.startswith("postgresql"):    return "postgresql"
        if url.startswith("mssql"):         return "mssql"
        return "unknown"

    # ── Vector Database ───────────────────────────────────────────
    # Backends: chroma | pgvector | pinecone | weaviate | azure_ai_search | qdrant
    VECTOR_DB_BACKEND:    str = "chroma"
    CHROMA_PERSIST_DIR:   str = "./chroma_db"

    # pgvector (uses same PostgreSQL as app DATABASE_URL)
    PGVECTOR_TABLE:       str = "document_embeddings"

    # Pinecone
    PINECONE_API_KEY:     Optional[str] = None
    PINECONE_ENVIRONMENT: Optional[str] = None  # e.g. us-east-1-aws
    PINECONE_INDEX_NAME:  Optional[str] = None

    # Weaviate
    WEAVIATE_URL:         Optional[str] = None
    WEAVIATE_API_KEY:     Optional[str] = None
    WEAVIATE_CLASS_NAME:  str = "BidChunk"

    # Azure AI Search
    AZURE_SEARCH_ENDPOINT: Optional[str] = None   # https://your-service.search.windows.net
    AZURE_SEARCH_API_KEY:  Optional[str] = None
    AZURE_SEARCH_INDEX:    str = "bid-platform-kb"

    # Qdrant
    QDRANT_URL:           Optional[str] = None
    QDRANT_API_KEY:       Optional[str] = None
    QDRANT_COLLECTION:    str = "bid_platform_kb"

    # Common
    VECTOR_DB_COLLECTION: str = "bid_platform_kb"

    @property
    def vector_db_configured(self) -> bool:
        b = self.VECTOR_DB_BACKEND
        if b == "chroma":          return True
        if b == "pgvector":        return self.database_backend == "postgresql"
        if b == "pinecone":        return bool(self.PINECONE_API_KEY)
        if b == "weaviate":        return bool(self.WEAVIATE_URL)
        if b == "azure_ai_search": return bool(self.AZURE_SEARCH_ENDPOINT and self.AZURE_SEARCH_API_KEY)
        if b == "qdrant":          return bool(self.QDRANT_URL)
        return False

    # ── File Storage ──────────────────────────────────────────────
    # Backends: local | azure_blob | s3
    STORAGE_BACKEND: str = "local"
    UPLOAD_DIR:      str = "./uploads"
    MAX_FILE_SIZE_MB: int = 100

    # Azure Blob Storage
    AZURE_STORAGE_CONNECTION_STRING: Optional[str] = None
    AZURE_STORAGE_CONTAINER:         str = "bid-platform-uploads"
    AZURE_STORAGE_ACCOUNT_NAME:      Optional[str] = None
    AZURE_STORAGE_ACCOUNT_KEY:       Optional[str] = None

    # AWS S3
    AWS_ACCESS_KEY_ID:     Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_S3_BUCKET:         Optional[str] = None
    AWS_S3_REGION:         str = "eu-west-2"

    @property
    def storage_configured(self) -> bool:
        b = self.STORAGE_BACKEND
        if b == "local":      return True
        if b == "azure_blob": return bool(self.AZURE_STORAGE_CONNECTION_STRING or
                                          self.AZURE_STORAGE_ACCOUNT_NAME)
        if b == "s3":         return bool(self.AWS_ACCESS_KEY_ID and self.AWS_S3_BUCKET)
        return False

    # ── Authentication Backend ─────────────────────────────────────
    # Backends: local | azure_ad | saml
    AUTH_BACKEND: str = "local"

    # Azure AD OIDC/OAuth2 (enterprise SSO)
    AZURE_AD_TENANT_ID:     Optional[str] = None
    AZURE_AD_CLIENT_ID:     Optional[str] = None
    AZURE_AD_CLIENT_SECRET: Optional[str] = None
    AZURE_AD_AUTHORITY:     Optional[str] = None  # auto-built from tenant if blank
    AZURE_AD_SCOPES:        str = "User.Read"

    # SAML 2.0
    SAML_IDP_METADATA_URL:  Optional[str] = None
    SAML_SP_ENTITY_ID:      Optional[str] = None
    SAML_SP_ACS_URL:        Optional[str] = None  # Assertion Consumer Service URL

    # Legacy SSO flags
    SSO_ENABLED: bool = False
    MICROSOFT_CLIENT_ID:     Optional[str] = None
    MICROSOFT_CLIENT_SECRET: Optional[str] = None
    GOOGLE_CLIENT_ID:        Optional[str] = None
    GOOGLE_CLIENT_SECRET:    Optional[str] = None

    @property
    def auth_configured(self) -> bool:
        b = self.AUTH_BACKEND
        if b == "local":    return True
        if b == "azure_ad": return bool(self.AZURE_AD_TENANT_ID and self.AZURE_AD_CLIENT_ID)
        if b == "saml":     return bool(self.SAML_IDP_METADATA_URL and self.SAML_SP_ENTITY_ID)
        return False

    # ── Secrets Backend ───────────────────────────────────────────
    # Backends: db | env | azure_keyvault | hashicorp_vault
    SECRETS_BACKEND: str = "db"   # db = stored in SQLite (dev only)

    # Azure Key Vault
    AZURE_KEYVAULT_URL:       Optional[str] = None   # https://your-vault.vault.azure.net
    AZURE_KEYVAULT_CLIENT_ID: Optional[str] = None   # service principal or managed identity
    AZURE_KEYVAULT_SECRET:    Optional[str] = None

    # HashiCorp Vault
    VAULT_URL:     Optional[str] = None   # http://vault.example.com:8200
    VAULT_TOKEN:   Optional[str] = None
    VAULT_PATH:    str = "secret/bidplatform"

    @property
    def secrets_configured(self) -> bool:
        b = self.SECRETS_BACKEND
        if b == "db":              return True
        if b == "env":             return True
        if b == "azure_keyvault":  return bool(self.AZURE_KEYVAULT_URL)
        if b == "hashicorp_vault": return bool(self.VAULT_URL and self.VAULT_TOKEN)
        return False

    @property
    def secrets_secure(self) -> bool:
        """Returns True if secrets are stored securely (not plaintext DB)."""
        return self.SECRETS_BACKEND != "db"

    # ── Background Jobs ───────────────────────────────────────────
    # Backends: auto | sync | celery_redis | azure_service_bus
    # auto (default): uses Celery+Redis if Redis is reachable, else sync
    JOBS_BACKEND: str = "auto"
    REDIS_URL:             str = "redis://localhost:6379/0"
    CELERY_BROKER_URL:     str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/1"
    AZURE_SERVICE_BUS_CONNECTION_STRING: Optional[str] = None
    AZURE_SERVICE_BUS_QUEUE: str = "bid-platform-jobs"

    # ── Embedding ─────────────────────────────────────────────────
    EMBEDDING_BACKEND:    str = "local"
    EMBEDDING_MODEL:      str = "all-MiniLM-L6-v2"
    EMBEDDING_DIMENSIONS: int = 384

    # ── LLM (legacy env-based — prefer DB config via Settings UI) ─
    DEFAULT_LLM_PROVIDER:     Optional[str] = None
    DEFAULT_LLM_MODEL:        Optional[str] = None
    OPENAI_API_KEY:           Optional[str] = None
    ANTHROPIC_API_KEY:        Optional[str] = None
    GOOGLE_API_KEY:           Optional[str] = None
    AZURE_OPENAI_API_KEY:     Optional[str] = None
    AZURE_OPENAI_ENDPOINT:    Optional[str] = None

    # ── Compliance & Data Residency ───────────────────────────────
    DATA_RESIDENCY:     str = "any"    # any | eu | uk | us | on-premise
    GDPR_MODE:          bool = False   # enforce GDPR-specific controls
    AUDIT_LOG_ENABLED:  bool = True
    AUDIT_LOG_RETENTION_DAYS: int = 365

    # ── Rate limiting ─────────────────────────────────────────────
    RATE_LIMIT_ENABLED:      bool = False
    RATE_LIMIT_PER_MINUTE:   int = 100

    @field_validator("UPLOAD_DIR")
    @classmethod
    def create_upload_dir(cls, v):
        os.makedirs(v, exist_ok=True)
        return v

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()
