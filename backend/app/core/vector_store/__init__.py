"""
Vector store factory — returns the configured backend.
Backends: chroma | pgvector | pinecone | weaviate | azure_ai_search | qdrant

All backends implement the same interface:
  add(chunks)          — add list of {id, text, embedding, metadata}
  query(embedding, n)  — return top-n results
  delete_by_document(doc_id)
  count()              — total chunks
  reset()              — wipe all data (used for reindex)
"""
import logging
from typing import List, Dict, Any, Optional
from app.config import settings

logger = logging.getLogger(__name__)
_instance = None

# ── Base interface ────────────────────────────────────────────────

class VectorStoreBase:
    def add(self, chunks: List[Dict]) -> None: raise NotImplementedError
    def query(self, embedding: List[float], n_results: int = 5) -> Dict: raise NotImplementedError
    def delete_by_document(self, document_id: str) -> None: raise NotImplementedError
    def count(self) -> int: raise NotImplementedError
    def reset(self) -> None: raise NotImplementedError

# ── ChromaDB (default) ────────────────────────────────────────────

class ChromaVectorStore(VectorStoreBase):
    def __init__(self):
        import chromadb
        self._client = chromadb.PersistentClient(path=settings.CHROMA_PERSIST_DIR)
        self._col    = self._client.get_or_create_collection(
            name     = settings.VECTOR_DB_COLLECTION,
            metadata = {"hnsw:space": "cosine"},
        )
        logger.info(f"ChromaDB ready — {self._col.count()} chunks")

    def add(self, chunks):
        if not chunks: return
        self._col.upsert(
            ids        = [c["id"] for c in chunks],
            embeddings = [c["embedding"] for c in chunks],
            documents  = [c["text"] for c in chunks],
            metadatas  = [c.get("metadata", {}) for c in chunks],
        )

    def query(self, embedding, n_results=5):
        results = self._col.query(
            query_embeddings = [embedding],
            n_results        = min(n_results, max(self._col.count(), 1)),
            include          = ["documents", "metadatas", "distances"],
        )
        return {"results": [
            {"id": ids, "text": doc, "metadata": meta, "distance": dist}
            for ids, doc, meta, dist in zip(
                results["ids"][0],
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0],
            )
        ]}

    def delete_by_document(self, document_id):
        try:
            self._col.delete(where={"document_id": document_id})
        except Exception as e:
            logger.warning(f"ChromaDB delete failed: {e}")

    def count(self): return self._col.count()

    def reset(self):
        self._client.delete_collection(settings.VECTOR_DB_COLLECTION)
        self._col = self._client.get_or_create_collection(
            name=settings.VECTOR_DB_COLLECTION,
            metadata={"hnsw:space": "cosine"},
        )
        logger.info("ChromaDB collection reset")

# ── pgvector ──────────────────────────────────────────────────────

class PgVectorStore(VectorStoreBase):
    def __init__(self):
        import psycopg2
        from pgvector.psycopg2 import register_vector
        from app.core.embeddings import get_embedding_model
        dims = get_embedding_model().dimensions
        self._dsn   = settings.DATABASE_URL.replace("postgresql+asyncpg", "postgresql")
        self._table = settings.PGVECTOR_TABLE
        self._dims  = dims
        self._ensure_table()
        logger.info(f"pgvector ready — table: {self._table}, dims: {dims}")

    def _conn(self):
        import psycopg2
        from pgvector.psycopg2 import register_vector
        conn = psycopg2.connect(self._dsn)
        register_vector(conn)
        return conn

    def _ensure_table(self):
        conn = self._conn()
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {self._table} (
                    id TEXT PRIMARY KEY,
                    document_id TEXT,
                    text TEXT,
                    embedding vector({self._dims}),
                    metadata JSONB
                )
            """)
            cur.execute(f"CREATE INDEX IF NOT EXISTS {self._table}_emb_idx ON {self._table} USING ivfflat (embedding vector_cosine_ops)")
        conn.commit(); conn.close()

    def add(self, chunks):
        if not chunks: return
        import json
        conn = self._conn()
        with conn.cursor() as cur:
            for c in chunks:
                cur.execute(
                    f"INSERT INTO {self._table}(id,document_id,text,embedding,metadata) VALUES(%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET text=EXCLUDED.text,embedding=EXCLUDED.embedding,metadata=EXCLUDED.metadata",
                    (c["id"], c.get("metadata",{}).get("document_id"), c["text"], c["embedding"], json.dumps(c.get("metadata",{})))
                )
        conn.commit(); conn.close()

    def query(self, embedding, n_results=5):
        conn = self._conn()
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id,text,metadata,1-(embedding<=>%s::vector) AS score FROM {self._table} ORDER BY embedding<=>%s::vector LIMIT %s",
                (embedding, embedding, n_results)
            )
            rows = cur.fetchall()
        conn.close()
        return {"results": [{"id": r[0], "text": r[1], "metadata": r[2] or {}, "distance": 1-r[3]} for r in rows]}

    def delete_by_document(self, document_id):
        conn = self._conn()
        with conn.cursor() as cur:
            cur.execute(f"DELETE FROM {self._table} WHERE document_id=%s", (document_id,))
        conn.commit(); conn.close()

    def count(self):
        conn = self._conn()
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {self._table}")
            n = cur.fetchone()[0]
        conn.close(); return n

    def reset(self):
        conn = self._conn()
        with conn.cursor() as cur:
            cur.execute(f"TRUNCATE {self._table}")
        conn.commit(); conn.close()
        logger.info("pgvector table truncated")

# ── Azure AI Search ───────────────────────────────────────────────

class AzureAISearchStore(VectorStoreBase):
    def __init__(self):
        from azure.search.documents import SearchClient
        from azure.search.documents.indexes import SearchIndexClient
        from azure.core.credentials import AzureKeyCredential
        from app.core.embeddings import get_embedding_model
        dims = get_embedding_model().dimensions
        cred = AzureKeyCredential(settings.AZURE_SEARCH_API_KEY)
        idx_client = SearchIndexClient(settings.AZURE_SEARCH_ENDPOINT, cred)
        self._client = SearchClient(settings.AZURE_SEARCH_ENDPOINT, settings.AZURE_SEARCH_INDEX, cred)
        self._ensure_index(idx_client, dims)
        logger.info(f"Azure AI Search ready — index: {settings.AZURE_SEARCH_INDEX}")

    def _ensure_index(self, idx_client, dims):
        from azure.search.documents.indexes.models import (
            SearchIndex, SearchField, SearchFieldDataType,
            VectorSearch, HnswAlgorithmConfiguration, VectorSearchProfile,
            SimpleField, SearchableField
        )
        fields = [
            SimpleField(name="id",          type=SearchFieldDataType.String, key=True),
            SimpleField(name="document_id", type=SearchFieldDataType.String, filterable=True),
            SearchableField(name="text",    type=SearchFieldDataType.String),
            SearchField(name="embedding",   type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                        searchable=True, vector_search_dimensions=dims,
                        vector_search_profile_name="default-profile"),
        ]
        vs = VectorSearch(
            algorithms    = [HnswAlgorithmConfiguration(name="default-algo")],
            profiles      = [VectorSearchProfile(name="default-profile", algorithm_configuration_name="default-algo")],
        )
        index = SearchIndex(name=settings.AZURE_SEARCH_INDEX, fields=fields, vector_search=vs)
        try:
            idx_client.create_or_update_index(index)
        except Exception as e:
            logger.warning(f"Azure AI Search index setup: {e}")

    def add(self, chunks):
        if not chunks: return
        docs = [{"id": c["id"], "document_id": c.get("metadata",{}).get("document_id",""),
                 "text": c["text"], "embedding": c["embedding"]} for c in chunks]
        self._client.upload_documents(docs)

    def query(self, embedding, n_results=5):
        from azure.search.documents.models import VectorizedQuery
        vq      = VectorizedQuery(vector=embedding, k_nearest_neighbors=n_results, fields="embedding")
        results = self._client.search(search_text=None, vector_queries=[vq], select=["id","document_id","text"], top=n_results)
        return {"results": [{"id": r["id"], "text": r["text"], "metadata": {"document_id": r.get("document_id","")}, "distance": 1-r.get("@search.score",0)} for r in results]}

    def delete_by_document(self, document_id):
        results = self._client.search(filter=f"document_id eq '{document_id}'", select=["id"])
        ids = [{"id": r["id"]} for r in results]
        if ids: self._client.delete_documents(ids)

    def count(self):
        return self._client.get_document_count()

    def reset(self):
        results = self._client.search(search_text="*", select=["id"])
        ids = [{"id": r["id"]} for r in results]
        if ids: self._client.delete_documents(ids)
        logger.info("Azure AI Search index cleared")

# ── Pinecone ──────────────────────────────────────────────────────

class PineconeStore(VectorStoreBase):
    def __init__(self):
        from pinecone import Pinecone, ServerlessSpec
        pc = Pinecone(api_key=settings.PINECONE_API_KEY)
        from app.core.embeddings import get_embedding_model
        dims = get_embedding_model().dimensions
        if settings.PINECONE_INDEX_NAME not in [i.name for i in pc.list_indexes()]:
            pc.create_index(
                name      = settings.PINECONE_INDEX_NAME,
                dimension = dims,
                metric    = "cosine",
                spec      = ServerlessSpec(cloud="aws", region=settings.PINECONE_ENVIRONMENT or "us-east-1"),
            )
        self._idx = pc.Index(settings.PINECONE_INDEX_NAME)
        logger.info(f"Pinecone ready — index: {settings.PINECONE_INDEX_NAME}")

    def add(self, chunks):
        if not chunks: return
        vectors = [(c["id"], c["embedding"], c.get("metadata",{})) for c in chunks]
        self._idx.upsert(vectors=vectors, batch_size=100)

    def query(self, embedding, n_results=5):
        r = self._idx.query(vector=embedding, top_k=n_results, include_metadata=True)
        return {"results": [{"id": m.id, "text": m.metadata.get("text",""), "metadata": m.metadata, "distance": 1-m.score} for m in r.matches]}

    def delete_by_document(self, document_id):
        r = self._idx.query(vector=[0]*self._idx.describe_index_stats()["dimension"],
                            filter={"document_id": document_id}, top_k=10000)
        ids = [m.id for m in r.matches]
        if ids: self._idx.delete(ids=ids)

    def count(self):
        return self._idx.describe_index_stats().get("total_vector_count", 0)

    def reset(self):
        self._idx.delete(delete_all=True)

# ── Qdrant ────────────────────────────────────────────────────────

class QdrantStore(VectorStoreBase):
    def __init__(self):
        from qdrant_client import QdrantClient
        from qdrant_client.models import Distance, VectorParams
        from app.core.embeddings import get_embedding_model
        dims = get_embedding_model().dimensions
        self._client = QdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY or None)
        self._col    = settings.QDRANT_COLLECTION
        try:
            self._client.get_collection(self._col)
        except Exception:
            self._client.create_collection(
                collection_name = self._col,
                vectors_config  = VectorParams(size=dims, distance=Distance.COSINE),
            )
        logger.info(f"Qdrant ready — collection: {self._col}")

    def add(self, chunks):
        if not chunks: return
        from qdrant_client.models import PointStruct
        points = [PointStruct(id=i, vector=c["embedding"], payload={**c.get("metadata",{}), "text": c["text"], "_id": c["id"]})
                  for i, c in enumerate(chunks)]
        self._client.upsert(collection_name=self._col, points=points)

    def query(self, embedding, n_results=5):
        results = self._client.search(collection_name=self._col, query_vector=embedding, limit=n_results, with_payload=True)
        return {"results": [{"id": r.payload.get("_id", str(r.id)), "text": r.payload.get("text",""), "metadata": r.payload, "distance": 1-r.score} for r in results]}

    def delete_by_document(self, document_id):
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        self._client.delete(
            collection_name = self._col,
            points_selector = Filter(must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))])
        )

    def count(self):
        return self._client.get_collection(self._col).points_count

    def reset(self):
        from qdrant_client.models import Distance, VectorParams
        from app.core.embeddings import get_embedding_model
        self._client.delete_collection(self._col)
        self._client.create_collection(
            collection_name = self._col,
            vectors_config  = VectorParams(size=get_embedding_model().dimensions, distance=Distance.COSINE),
        )

# ── Weaviate ──────────────────────────────────────────────────────

class WeaviateStore(VectorStoreBase):
    def __init__(self):
        import weaviate
        from app.core.embeddings import get_embedding_model
        auth = weaviate.auth.AuthApiKey(settings.WEAVIATE_API_KEY) if settings.WEAVIATE_API_KEY else None
        self._client = weaviate.connect_to_custom(
            http_host=settings.WEAVIATE_URL.split("//")[-1].split(":")[0],
            http_port=int(settings.WEAVIATE_URL.split(":")[-1]) if ":" in settings.WEAVIATE_URL.split("//")[-1] else 80,
            http_secure=settings.WEAVIATE_URL.startswith("https"),
            grpc_host=settings.WEAVIATE_URL.split("//")[-1].split(":")[0],
            grpc_port=50051,
            grpc_secure=False,
            auth_credentials=auth,
        )
        self._class = settings.WEAVIATE_CLASS_NAME
        self._ensure_class()
        logger.info(f"Weaviate ready — class: {self._class}")

    def _ensure_class(self):
        from weaviate.classes.config import Configure, Property, DataType
        from app.core.embeddings import get_embedding_model
        try:
            self._client.collections.get(self._class)
        except Exception:
            self._client.collections.create(
                name        = self._class,
                vectorizer_config = Configure.Vectorizer.none(),
                properties  = [
                    Property(name="text",        data_type=DataType.TEXT),
                    Property(name="document_id", data_type=DataType.TEXT),
                ]
            )

    def add(self, chunks):
        col = self._client.collections.get(self._class)
        with col.batch.dynamic() as batch:
            for c in chunks:
                batch.add_object(properties={"text": c["text"], "document_id": c.get("metadata",{}).get("document_id","")},
                                 vector=c["embedding"], uuid=c["id"])

    def query(self, embedding, n_results=5):
        from weaviate.classes.query import MetadataQuery
        col     = self._client.collections.get(self._class)
        results = col.query.near_vector(near_vector=embedding, limit=n_results, return_metadata=MetadataQuery(distance=True))
        return {"results": [{"id": str(r.uuid), "text": r.properties.get("text",""), "metadata": r.properties, "distance": r.metadata.distance} for r in results.objects]}

    def delete_by_document(self, document_id):
        from weaviate.classes.query import Filter
        col = self._client.collections.get(self._class)
        col.data.delete_many(where=Filter.by_property("document_id").equal(document_id))

    def count(self):
        col = self._client.collections.get(self._class)
        return col.aggregate.over_all(total_count=True).total_count

    def reset(self):
        self._client.collections.delete(self._class)
        self._ensure_class()

# ── Factory ───────────────────────────────────────────────────────

def get_or_create_vector_store() -> VectorStoreBase:
    global _instance
    if _instance is None:
        backend = settings.VECTOR_DB_BACKEND.lower()
        logger.info(f"Initialising vector store: {backend}")
        try:
            if   backend == "chroma":          _instance = ChromaVectorStore()
            elif backend == "pgvector":        _instance = PgVectorStore()
            elif backend == "azure_ai_search": _instance = AzureAISearchStore()
            elif backend == "pinecone":        _instance = PineconeStore()
            elif backend == "qdrant":          _instance = QdrantStore()
            elif backend == "weaviate":        _instance = WeaviateStore()
            else:
                logger.warning(f"Unknown vector backend '{backend}', falling back to chroma")
                _instance = ChromaVectorStore()
        except Exception as e:
            logger.error(f"Failed to init vector store '{backend}': {e} — falling back to chroma")
            _instance = ChromaVectorStore()
    return _instance

def reset_vector_store():
    global _instance
    _instance = None
