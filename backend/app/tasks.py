from app.celery_app import celery_app
from app.database import engine
from app.models import Document, DocumentChunk, DocumentStatus, Requirement
from app.core.ingestion import process_document, extract_requirements_from_excel, semantic_chunk_text
from app.core.embeddings import get_embedding_model
from app.core.vector_store import get_or_create_vector_store
from sqlmodel import Session, select
from datetime import datetime
import logging
import uuid

logger = logging.getLogger(__name__)

@celery_app.task(bind=True, name="ingest_document", max_retries=3)
def ingest_document(self, document_id: str):
    """
    Full document ingestion pipeline:
    1. Parse document (PDF/DOCX)
    2. Semantic chunk
    3. Embed each chunk
    4. Store in vector DB + SQL
    """
    logger.info(f"Starting ingestion for document {document_id}")

    with Session(engine) as session:
        doc = session.get(Document, document_id)
        if not doc:
            logger.error(f"Document {document_id} not found")
            return {"status": "error", "message": "Document not found"}

        try:
            # Update status to processing
            doc.status = DocumentStatus.PROCESSING
            doc.updated_at = datetime.utcnow()
            session.add(doc)
            session.commit()

            # Step 1: Extract text
            logger.info(f"Extracting text from {doc.file_type} document")
            full_text, page_count, word_count = process_document(doc.file_path, doc.file_type)

            doc.page_count = page_count
            doc.word_count = word_count
            session.add(doc)
            session.commit()

            # Step 2: Semantic chunk
            logger.info("Chunking document text")
            chunks = semantic_chunk_text(full_text, chunk_size=512, chunk_overlap=64)

            # Step 3 & 4: Embed and store
            embedding_model = get_embedding_model()
            vector_store = get_or_create_vector_store()

            chunk_texts = [c["text"] for c in chunks]

            # Batch embed (more efficient)
            logger.info(f"Embedding {len(chunks)} chunks")
            batch_size = 32
            all_embeddings = []
            for i in range(0, len(chunk_texts), batch_size):
                batch = chunk_texts[i:i + batch_size]
                embeddings = embedding_model.embed(batch)
                all_embeddings.extend(embeddings)
                # Update task progress
                self.update_state(
                    state="PROGRESS",
                    meta={"current": i + len(batch), "total": len(chunks), "stage": "embedding"}
                )

            # Store chunks
            logger.info("Storing chunks in vector DB and SQL")
            db_chunks = []
            for i, (chunk, embedding) in enumerate(zip(chunks, all_embeddings)):
                chunk_id = str(uuid.uuid4())
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
                # Store in vector DB
                vector_store.upsert(chunk_id, chunk["text"], embedding, metadata)

                # Store in SQL
                db_chunk = DocumentChunk(
                    id=chunk_id,
                    document_id=document_id,
                    chunk_index=i,
                    text=chunk["text"],
                    section_path=chunk.get("section_path"),
                    token_count=int(chunk.get("token_count", 0)),
                    vector_id=chunk_id,
                )
                db_chunks.append(db_chunk)

            session.add_all(db_chunks)
            doc.chunk_count = len(db_chunks)
            doc.status = DocumentStatus.COMPLETED
            doc.updated_at = datetime.utcnow()
            session.add(doc)
            session.commit()

            logger.info(f"Document {document_id} ingestion complete: {len(db_chunks)} chunks")
            return {"status": "success", "chunks": len(db_chunks), "pages": page_count}

        except Exception as exc:
            logger.error(f"Document ingestion failed: {exc}", exc_info=True)
            with Session(engine) as err_session:
                err_doc = err_session.get(Document, document_id)
                if err_doc:
                    err_doc.status = DocumentStatus.FAILED
                    err_doc.processing_error = str(exc)[:500]
                    err_doc.updated_at = datetime.utcnow()
                    err_session.add(err_doc)
                    err_session.commit()
            raise self.retry(exc=exc, countdown=60)

@celery_app.task(bind=True, name="ingest_requirements_excel", max_retries=2)
def ingest_requirements_excel(self, document_id: str, opportunity_id: str):
    """Parse Excel requirements file and create Requirement records."""
    logger.info(f"Parsing requirements Excel for opportunity {opportunity_id}")

    with Session(engine) as session:
        doc = session.get(Document, document_id)
        if not doc:
            return {"status": "error", "message": "Document not found"}

        try:
            doc.status = DocumentStatus.PROCESSING
            session.add(doc)
            session.commit()

            requirements = extract_requirements_from_excel(doc.file_path)

            req_objects = []
            for req_data in requirements:
                req = Requirement(
                    opportunity_id=opportunity_id,
                    req_id=req_data["req_id"],
                    description=req_data["description"],
                    priority=req_data.get("priority", "Medium"),
                    category=req_data.get("category"),
                    section=req_data.get("section"),
                    source_document_id=document_id,
                )
                req_objects.append(req)

            session.add_all(req_objects)
            doc.status = DocumentStatus.COMPLETED
            doc.chunk_count = len(req_objects)
            doc.updated_at = datetime.utcnow()
            session.add(doc)
            session.commit()

            logger.info(f"Extracted {len(req_objects)} requirements")
            return {"status": "success", "requirements": len(req_objects)}

        except Exception as exc:
            logger.error(f"Requirements ingestion failed: {exc}", exc_info=True)
            with Session(engine) as err_session:
                err_doc = err_session.get(Document, document_id)
                if err_doc:
                    err_doc.status = DocumentStatus.FAILED
                    err_doc.processing_error = str(exc)[:500]
                    err_session.add(err_doc)
                    err_session.commit()
            raise self.retry(exc=exc, countdown=30)
