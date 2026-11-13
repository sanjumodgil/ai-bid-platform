"""
Embedding service — reads active provider config from DB.
Falls back to local all-MiniLM-L6-v2 if no embedding model configured.

Providers with embedding support:
  - local       : all-MiniLM-L6-v2 (default, free, offline)
  - openai      : text-embedding-3-small/large, text-embedding-ada-002
  - azure_openai: any deployed embedding model name
  - google      : text-embedding-004, embedding-001
  - mistral     : mistral-embed
  - ollama      : nomic-embed-text, mxbai-embed-large, all-minilm

Anthropic has NO embedding model — always uses local fallback.
"""
from abc import ABC, abstractmethod
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)

# ── Base class ────────────────────────────────────────────────────

class EmbeddingBase(ABC):
    @abstractmethod
    def embed(self, texts: List[str]) -> List[List[float]]: pass

    @abstractmethod
    def embed_single(self, text: str) -> List[float]: pass

    @property
    @abstractmethod
    def dimensions(self) -> int: pass

    @property
    @abstractmethod
    def provider_name(self) -> str: pass

# ── Implementations ───────────────────────────────────────────────

class LocalEmbedding(EmbeddingBase):
    """sentence-transformers — free, offline, no API key needed."""
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        from sentence_transformers import SentenceTransformer
        logger.info(f"Loading local embedding model: {model_name}")
        self._model = SentenceTransformer(model_name)
        self._dims  = self._model.get_sentence_embedding_dimension()
        self._name  = model_name
        logger.info(f"Local embeddings ready — {self._dims} dims")

    def embed(self, texts: List[str]) -> List[List[float]]:
        return self._model.encode(texts, convert_to_numpy=True).tolist()

    def embed_single(self, text: str) -> List[float]:
        return self.embed([text])[0]

    @property
    def dimensions(self) -> int: return self._dims
    @property
    def provider_name(self) -> str: return f"local/{self._name}"


class OpenAIEmbedding(EmbeddingBase):
    """OpenAI embeddings API."""
    _DIM_MAP = {
        "text-embedding-3-small": 1536,
        "text-embedding-3-large": 3072,
        "text-embedding-ada-002": 1536,
    }
    def __init__(self, model: str, api_key: str):
        from openai import OpenAI
        self._client = OpenAI(api_key=api_key)
        self._model  = model

    def embed(self, texts: List[str]) -> List[List[float]]:
        resp = self._client.embeddings.create(input=texts, model=self._model)
        return [item.embedding for item in resp.data]

    def embed_single(self, text: str) -> List[float]:
        return self.embed([text])[0]

    @property
    def dimensions(self) -> int: return self._DIM_MAP.get(self._model, 1536)
    @property
    def provider_name(self) -> str: return f"openai/{self._model}"


class AzureOpenAIEmbedding(EmbeddingBase):
    """Azure OpenAI embeddings — deployment name as model."""
    def __init__(self, deployment: str, api_key: str, endpoint: str, api_version: str = "2024-02-01"):
        from openai import AzureOpenAI
        self._client     = AzureOpenAI(api_key=api_key, azure_endpoint=endpoint, api_version=api_version)
        self._deployment = deployment

    def embed(self, texts: List[str]) -> List[List[float]]:
        resp = self._client.embeddings.create(input=texts, model=self._deployment)
        return [item.embedding for item in resp.data]

    def embed_single(self, text: str) -> List[float]:
        return self.embed([text])[0]

    @property
    def dimensions(self) -> int: return 1536   # most Azure embedding deployments
    @property
    def provider_name(self) -> str: return f"azure_openai/{self._deployment}"


class GoogleEmbedding(EmbeddingBase):
    """Google Generative AI embeddings."""
    _DIM_MAP = {"text-embedding-004": 768, "embedding-001": 768}

    def __init__(self, model: str, api_key: str):
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        self._genai = genai
        self._model = model

    def embed(self, texts: List[str]) -> List[List[float]]:
        result = self._genai.embed_content(model=self._model, content=texts,
                                           task_type="retrieval_document")
        return result["embedding"] if isinstance(texts, str) else result["embedding"]

    def embed_single(self, text: str) -> List[float]:
        result = self._genai.embed_content(model=self._model, content=text,
                                           task_type="retrieval_query")
        return result["embedding"]

    @property
    def dimensions(self) -> int: return self._DIM_MAP.get(self._model, 768)
    @property
    def provider_name(self) -> str: return f"google/{self._model}"


class MistralEmbedding(EmbeddingBase):
    """Mistral embeddings — mistral-embed model."""
    def __init__(self, api_key: str):
        from mistralai.client import MistralClient
        self._client = MistralClient(api_key=api_key)

    def embed(self, texts: List[str]) -> List[List[float]]:
        resp = self._client.embeddings(model="mistral-embed", input=texts)
        return [item.embedding for item in resp.data]

    def embed_single(self, text: str) -> List[float]:
        return self.embed([text])[0]

    @property
    def dimensions(self) -> int: return 1024
    @property
    def provider_name(self) -> str: return "mistral/mistral-embed"


class OllamaEmbedding(EmbeddingBase):
    """Ollama local embeddings."""
    _DIM_MAP = {
        "nomic-embed-text":  768,
        "mxbai-embed-large": 1024,
        "all-minilm":        384,
    }
    def __init__(self, model: str = "nomic-embed-text", base_url: str = "http://localhost:11434"):
        import httpx
        self._client   = httpx.Client(base_url=base_url, timeout=30)
        self._model    = model

    def embed(self, texts: List[str]) -> List[List[float]]:
        return [self.embed_single(t) for t in texts]

    def embed_single(self, text: str) -> List[float]:
        import json
        r = self._client.post("/api/embeddings", json={"model": self._model, "prompt": text})
        return json.loads(r.text)["embedding"]

    @property
    def dimensions(self) -> int: return self._DIM_MAP.get(self._model, 768)
    @property
    def provider_name(self) -> str: return f"ollama/{self._model}"


# ── Factory — reads from DB config ───────────────────────────────

_instance: Optional[EmbeddingBase] = None

def _load_from_db() -> Optional[EmbeddingBase]:
    """Read active LLM provider config and use its embedding_model field if set."""
    try:
        import json as _json
        from app.database import engine
        from sqlmodel import Session, select
        from app.models import LLMProviderConfig

        with Session(engine) as session:
            cfg = session.exec(
                select(LLMProviderConfig).where(LLMProviderConfig.is_active == True)
            ).first()

            if not cfg or not cfg.embedding_model:
                return None   # no embedding model configured — use local default

            provider  = cfg.provider
            emb_model = cfg.embedding_model
            from app.core.encryption import decrypt as _decrypt
            api_key   = _decrypt(cfg.api_key_encrypted) or ""
            endpoint  = cfg.endpoint or ""
            api_ver   = getattr(cfg, 'api_version', '2024-02-01')

            logger.info(f"Using configured embedding: {provider}/{emb_model}")

            if provider == "openai":
                return OpenAIEmbedding(model=emb_model, api_key=api_key)

            elif provider == "azure_openai":
                return AzureOpenAIEmbedding(
                    deployment=emb_model, api_key=api_key,
                    endpoint=endpoint, api_version=api_ver
                )

            elif provider == "google":
                return GoogleEmbedding(model=emb_model, api_key=api_key)

            elif provider == "mistral":
                return MistralEmbedding(api_key=api_key)

            elif provider == "ollama":
                return OllamaEmbedding(model=emb_model, base_url=endpoint or "http://localhost:11434")

            elif provider == "anthropic":
                logger.warning("Anthropic has no embedding model. Using local fallback.")
                return None

            else:
                logger.warning(f"Unknown provider '{provider}' for embeddings. Using local.")
                return None

    except Exception as e:
        logger.warning(f"Could not load embedding config from DB: {e}")
        return None

def get_embedding_model(force_reload: bool = False) -> EmbeddingBase:
    """Get the active embedding model. Cached — call reset_embedding_model() to reload."""
    global _instance
    if _instance is None or force_reload:
        db_model = _load_from_db()
        if db_model is not None:
            _instance = db_model
        else:
            # Default: local all-MiniLM-L6-v2
            from app.config import settings
            model_name = getattr(settings, 'EMBEDDING_MODEL', 'all-MiniLM-L6-v2')
            _instance = LocalEmbedding(model_name)
    return _instance

def reset_embedding_model():
    """Force reload on next call — called after config change."""
    global _instance
    _instance = None
    logger.info("Embedding model cache cleared — will reload on next use")

def get_embedding_status() -> dict:
    """Returns current embedding model info for health/settings display."""
    try:
        model = get_embedding_model()
        return {
            "provider":   model.provider_name,
            "dimensions": model.dimensions,
            "configured": True,
        }
    except Exception as e:
        return {
            "provider":   "local/all-MiniLM-L6-v2",
            "dimensions": 384,
            "configured": False,
            "error":      str(e),
        }
