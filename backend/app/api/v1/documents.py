from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlmodel import Session, select
from typing import Optional, List
from datetime import datetime
import os, uuid, shutil, logging
from app.database import get_session
from app.models import Document, DocumentType, DocumentStatus, Opportunity, User
from app.core.auth import get_current_user, require_bid_lead
from app.config import settings

router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {
    "pdf": "pdf", "docx": "docx", "doc": "docx", "xlsx": "xlsx", "xls": "xlsx"
}
MAX_SIZE = settings.MAX_FILE_SIZE_MB * 1024 * 1024


def _ingest_sync(document_id: str, session: Session) -> None:
    """
    Synchronous document ingestion — used as fallback when Redis/Celery unavailable.
    Runs in-process: parse → chunk → embed → store in vector DB.
    Slower than async (blocks the request), but requires zero extra infrastructure.
    """
    from app.core.ingestion import process_document, semantic_chunk_text
    from app.core.embeddings import get_embedding_model
    from app.core.vector_store import get_or_create_vector_store
    from app.models import DocumentChunk, DocumentStatus
    from datetime import datetime
    import uuid as _uuid

    doc = session.get(Document, document_id)
    if not doc:
        return
    try:
        full_text, page_count, word_count = process_document(doc.file_path, doc.file_type)
        doc.page_count = page_count
        doc.word_count = word_count
        session.add(doc)
        session.commit()

        chunks = semantic_chunk_text(full_text)
        embedding_model = get_embedding_model()
        vector_store = get_or_create_vector_store()

        texts = [c["text"] for c in chunks]
        all_embeddings = []
        for i in range(0, len(texts), 32):
            all_embeddings.extend(embedding_model.embed(texts[i:i+32]))

        db_chunks = []
        for i, (chunk, emb) in enumerate(zip(chunks, all_embeddings)):
            cid = str(_uuid.uuid4())
            metadata = {
                "document_id": document_id,
                "opportunity_id": doc.opportunity_id or "",
                "industry_vertical": doc.industry_vertical or "",
                "solution_type": doc.solution_type or "",
                "geography": doc.geography or "",
                "outcome": doc.outcome or "",
                "content_type": doc.content_type or "",
                "section_path": chunk.get("section_path") or "",
                "chunk_index": i,
            }
            vector_store.upsert(cid, chunk["text"], emb, metadata)
            db_chunks.append(DocumentChunk(
                id=cid, document_id=document_id, chunk_index=i,
                text=chunk["text"], section_path=chunk.get("section_path"),
                token_count=int(chunk.get("token_count", 0)), vector_id=cid,
            ))

        session.add_all(db_chunks)
        doc.chunk_count = len(db_chunks)
        doc.status = DocumentStatus.COMPLETED
        doc.updated_at = datetime.utcnow()
        session.add(doc)
        session.commit()
        logger.info(f"Sync ingestion complete: {len(db_chunks)} chunks for {document_id}")

    except Exception as e:
        logger.error(f"Sync ingestion failed for {document_id}: {e}", exc_info=True)
        doc.status = DocumentStatus.FAILED
        doc.processing_error = str(e)[:500]
        doc.updated_at = datetime.utcnow()
        session.add(doc)
        session.commit()


class DocumentOut(dict):
    pass

def doc_to_dict(doc: Document) -> dict:
    return {
        "id": doc.id, "filename": doc.filename, "original_filename": doc.original_filename,
        "display_name": doc.display_name,
        "uploaded_by_name": doc.uploaded_by_name,
        "uploaded_by_id": doc.uploaded_by_id,
        "owning_team": doc.owning_team,
        "file_type": doc.file_type, "doc_type": doc.doc_type, "file_size_bytes": doc.file_size_bytes,
        "status": doc.status, "processing_error": doc.processing_error,
        "chunk_count": doc.chunk_count, "page_count": doc.page_count, "word_count": doc.word_count,
        "celery_task_id": doc.celery_task_id, "opportunity_id": doc.opportunity_id,
        "industry_vertical": doc.industry_vertical, "sub_domain": doc.sub_domain,
        "solution_type": doc.solution_type,
        "geography": doc.geography, "outcome": doc.outcome, "content_type": doc.content_type,
        "created_at": doc.created_at.isoformat(), "updated_at": doc.updated_at.isoformat(),
    }

@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    opportunity_id: Optional[str] = Form(None),
    doc_type: DocumentType = Form(...),
    display_name: Optional[str] = Form(None),
    owning_team: Optional[str] = Form(None),
    industry_vertical: Optional[str] = Form(None),
    sub_domain: Optional[str] = Form(None),
    solution_type: Optional[str] = Form(None),
    geography: Optional[str] = Form(None),
    outcome: Optional[str] = Form(None),
    content_type_tag: Optional[str] = Form(None),
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead)
):
    # Validate file extension
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: .{ext}. Allowed: {list(ALLOWED_EXTENSIONS.keys())}")

    file_type = ALLOWED_EXTENSIONS[ext]

    # Read file content
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum: {settings.MAX_FILE_SIZE_MB}MB")

    # Validate opportunity exists if provided
    if opportunity_id:
        opp = session.get(Opportunity, opportunity_id)
        if not opp:
            raise HTTPException(status_code=404, detail="Opportunity not found")

    # Save file via configured storage backend
    doc_id    = str(uuid.uuid4())
    safe_name = f"{doc_id}.{ext}"
    from app.core.storage import get_storage
    storage   = get_storage()
    file_path = storage.save(content, safe_name)

    # Create DB record
    doc = Document(
        id=doc_id,
        opportunity_id=opportunity_id,
        filename=safe_name,
        original_filename=file.filename,
        display_name=display_name.strip() if display_name else None,
        uploaded_by_id=current_user.id,
        uploaded_by_name=current_user.full_name,
        owning_team=owning_team.strip() if owning_team else None,
        file_type=file_type,
        doc_type=doc_type,
        file_size_bytes=len(content),
        file_path=file_path,
        status=DocumentStatus.UPLOADING,
        industry_vertical=industry_vertical,
        sub_domain=sub_domain,
        solution_type=solution_type,
        geography=geography,
        outcome=outcome,
        content_type=content_type_tag,
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)

    # Dispatch ingestion via configured jobs backend (sync | celery_redis | azure_service_bus)
    try:
        from app.core.jobs import run_job
        from app.config import settings

        if file_type == "xlsx" and opportunity_id and doc_type == DocumentType.REQUIREMENTS_EXCEL:
            doc.status = DocumentStatus.PROCESSING
            session.add(doc); session.commit()
            if settings.JOBS_BACKEND == "sync":
                from app.core.ingestion import extract_requirements_from_excel
                from app.models import Requirement
                reqs = extract_requirements_from_excel(doc.file_path)
                req_objects = [
                    Requirement(
                        opportunity_id=opportunity_id,
                        req_id=r["req_id"], description=r["description"],
                        priority=r.get("priority","Medium"), category=r.get("category"),
                        section=r.get("section"), source_document_id=doc.id,
                    ) for r in reqs
                ]
                session.add_all(req_objects)
                doc.status = DocumentStatus.COMPLETED
                doc.chunk_count = len(req_objects)
            else:
                run_job("ingest_document", document_id=doc.id, file_path=doc.file_path)

        elif file_type in ("pdf", "docx"):
            doc.status = DocumentStatus.PROCESSING
            session.add(doc); session.commit()
            if settings.JOBS_BACKEND == "sync":
                _ingest_sync(doc.id, session)
                session.refresh(doc)
            else:
                run_job("ingest_document", document_id=doc.id, file_path=doc.file_path)

        from datetime import datetime
        doc.updated_at = datetime.utcnow()
        session.add(doc); session.commit()

    except Exception as e:
        logger.error(f"Failed to process document: {e}")
        doc.status = DocumentStatus.FAILED
        doc.processing_error = f"Processing failed: {str(e)[:200]}"
        session.add(doc); session.commit()

    return doc_to_dict(doc)

@router.get("/{doc_id}/status")
async def get_document_status(
    doc_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    result = {"id": doc.id, "status": doc.status, "chunk_count": doc.chunk_count,
              "processing_error": doc.processing_error, "page_count": doc.page_count}

    # Check Celery task status if processing
    if doc.celery_task_id and doc.status == DocumentStatus.PROCESSING:
        try:
            from celery.result import AsyncResult
            from app.celery_app import celery_app
            task_result = AsyncResult(doc.celery_task_id, app=celery_app)
            result["task_status"] = task_result.status
            if task_result.info and isinstance(task_result.info, dict):
                result["progress"] = task_result.info
        except Exception as e:
            logger.warning(f"Could not fetch task status: {e}")

    return result

@router.get("/opportunity/{opp_id}")
async def list_opportunity_documents(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    docs = session.exec(
        select(Document).where(Document.opportunity_id == opp_id)
        .order_by(Document.created_at.desc())
    ).all()
    return [doc_to_dict(d) for d in docs]

@router.get("/knowledge-base/list")
async def list_kb_documents(
    skip: int = 0,
    limit: int = 50,
    outcome: Optional[str] = Query(None),
    industry: Optional[str] = Query(None),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """List all past proposals in the knowledge base."""
    query = select(Document).where(Document.doc_type == DocumentType.PAST_PROPOSAL)
    if outcome:
        query = query.where(Document.outcome == outcome)
    if industry:
        query = query.where(Document.industry_vertical == industry)
    query = query.order_by(Document.created_at.desc()).offset(skip).limit(limit)
    docs = session.exec(query).all()
    return [doc_to_dict(d) for d in docs]

@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead)
):
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Remove from vector store
    try:
        from app.core.vector_store import get_or_create_vector_store
        vs = get_or_create_vector_store()
        vs.delete_by_document(doc_id)
    except Exception as e:
        logger.warning(f"Could not remove from vector store: {e}")

    # Delete chunks first (NOT NULL constraint on document_id prevents cascade null)
    from app.models import DocumentChunk
    chunks = session.exec(select(DocumentChunk).where(DocumentChunk.document_id == doc_id)).all()
    for chunk in chunks:
        session.delete(chunk)
    session.flush()

    # Delete KB contributors and lessons if any
    try:
        from app.models import KBContributor, KBLesson
        for c in session.exec(select(KBContributor).where(KBContributor.document_id == doc_id)).all():
            session.delete(c)
        for l in session.exec(select(KBLesson).where(KBLesson.document_id == doc_id)).all():
            session.delete(l)
        session.flush()
    except Exception as e:
        logger.warning(f"Could not delete KB metadata: {e}")

    # Remove file from disk
    try:
        if doc.file_path and os.path.exists(doc.file_path):
            os.remove(doc.file_path)
    except Exception as e:
        logger.warning(f"Could not remove file: {e}")

    session.delete(doc)
    session.commit()
    return {"success": True, "message": "Document deleted."}

# ── KB Search endpoint ────────────────────────────────────────────
from pydantic import BaseModel as _BaseModel

class KBSearchRequest(_BaseModel):
    query: str
    n_results: int = 5
    opportunity_id: Optional[str] = None   # exclude opp-specific docs if set

@router.post("/knowledge-base/search")
async def search_knowledge_base(
    req: KBSearchRequest,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Semantic search across the knowledge base."""
    if not req.query.strip():
        return {"results": [], "total": 0}

    try:
        from app.core.embeddings import get_embedding_model
        from app.core.vector_store import get_or_create_vector_store

        model   = get_embedding_model()
        store   = get_or_create_vector_store()

        embedding = model.embed([req.query])[0]
        raw = store.query(embedding, n_results=req.n_results * 3)

        # Enrich results with document metadata from DB
        results = []
        seen_docs: set = set()
        for r in raw.get("results", []):
            doc_id = r.get("metadata", {}).get("document_id")
            if not doc_id or doc_id in seen_docs:
                continue
            # Skip docs belonging to other opportunities (not KB docs)
            opp_id = r.get("metadata", {}).get("opportunity_id", "")
            if opp_id and opp_id != (req.opportunity_id or ""):
                continue
            seen_docs.add(doc_id)
            doc = session.get(Document, doc_id)
            if not doc:
                continue
            results.append({
                "chunk_id":      r.get("id"),
                "document_id":   doc_id,
                "document_name": doc.original_filename,
                "doc_type":      doc.doc_type,
                "industry":      doc.industry_vertical,
                "outcome":       doc.outcome,
                "score":         round(1 - r.get("distance", 1), 3),
                "excerpt":       r.get("text", "")[:300],
                "created_at":    doc.created_at.isoformat() if doc.created_at else None,
            })
            if len(results) >= req.n_results:
                break

        return {"results": results, "total": len(results), "query": req.query}

    except Exception as e:
        logger.error(f"KB search error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


# ── Promote opportunity document to KB ───────────────────────────
class PromoteToKBRequest(_BaseModel):
    document_id: str
    outcome: Optional[str] = None        # won / lost / no_bid
    industry_vertical: Optional[str] = None
    solution_type: Optional[str] = None
    notes: Optional[str] = None

@router.post("/promote-to-kb")
async def promote_to_kb(
    req: PromoteToKBRequest,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Promote an opportunity document into the global knowledge base."""
    doc = session.get(Document, req.document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status != DocumentStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Document must be fully processed before promoting to KB")

    # Keep opportunity_id — it's a useful reference showing which bid this came from
    # Just change doc_type to make it globally searchable in the KB
    doc.doc_type            = DocumentType.PAST_PROPOSAL
    doc.outcome             = req.outcome             or doc.outcome
    doc.industry_vertical   = req.industry_vertical   or doc.industry_vertical
    doc.solution_type       = req.solution_type       or doc.solution_type
    if req.notes:
        doc.notes = req.notes

    from datetime import datetime as _dt
    doc.updated_at = _dt.utcnow()
    session.add(doc)
    session.commit()
    session.refresh(doc)

    logger.info(f"Document {doc.id} promoted to KB by {current_user.email}")
    return {"success": True, "message": f"'{doc.original_filename}' added to knowledge base.", "document": doc_to_dict(doc)}

# ── Re-index all documents ────────────────────────────────────────

@router.post("/reindex")
async def reindex_all_documents(
    session: Session = Depends(get_session),
    current_user = Depends(require_bid_lead),
):
    """
    Re-embed all documents using the currently configured embedding model.
    Called after changing the embedding model in settings.
    Clears ChromaDB and re-processes every completed document.
    """
    import asyncio

    # Reset embedding cache so it picks up new config
    from app.core.embeddings import reset_embedding_model, get_embedding_model
    reset_embedding_model()

    # Clear vector store
    try:
        from app.core.vector_store import get_or_create_vector_store
        vs = get_or_create_vector_store()
        vs.reset()   # wipe all vectors
        logger.info("Vector store cleared for reindex")
    except Exception as e:
        raise HTTPException(500, f"Failed to clear vector store: {e}")

    # Get all completed documents
    docs = session.exec(
        select(Document).where(Document.status == DocumentStatus.COMPLETED)
    ).all()

    if not docs:
        return {"success": True, "message": "No documents to reindex.", "total": 0}

    # Reindex each document
    succeeded = 0
    failed    = 0
    errors    = []

    for doc in docs:
        try:
            if not doc.file_path or not os.path.exists(doc.file_path):
                failed += 1
                errors.append(f"{doc.original_filename}: file not found")
                continue

            from app.core.ingestion import process_document
            # Reset chunk count — process_document will rebuild
            doc.chunk_count = 0
            doc.status = DocumentStatus.PROCESSING
            session.add(doc)
            session.commit()

            # Re-ingest synchronously
            await asyncio.to_thread(process_document, doc.id, doc.file_path, doc.file_type)
            succeeded += 1
            logger.info(f"Reindexed: {doc.original_filename}")

        except Exception as e:
            failed += 1
            errors.append(f"{doc.original_filename}: {str(e)[:100]}")
            doc.status = DocumentStatus.COMPLETED   # restore status
            session.add(doc)
            session.commit()

    from app.core.embeddings import get_embedding_status
    emb_status = get_embedding_status()

    return {
        "success":    True,
        "total":      len(docs),
        "succeeded":  succeeded,
        "failed":     failed,
        "errors":     errors[:10],
        "embedding":  emb_status,
        "message":    f"Reindexed {succeeded}/{len(docs)} documents using {emb_status['provider']}",
    }

@router.get("/embedding-status")
async def get_embedding_status_endpoint(
    current_user = Depends(get_current_user),
):
    """Returns the currently active embedding model info."""
    from app.core.embeddings import get_embedding_status
    return get_embedding_status()
