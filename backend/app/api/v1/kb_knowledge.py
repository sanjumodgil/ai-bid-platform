"""
KB Contributors and Lessons Learned API.
Captures who worked on past RFPs and what was learned — 
institutional memory for future bid teams.
"""
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from pydantic import BaseModel
from app.database import get_session
from app.models import KBContributor, KBLesson, LessonStatus, Document
from app.core.auth import get_current_user

router = APIRouter(prefix="/kb", tags=["kb-knowledge"])
logger = logging.getLogger(__name__)

# ── Schemas ───────────────────────────────────────────────────────

class ContributorAdd(BaseModel):
    document_id:  str
    display_name: str
    email:        Optional[str] = None
    job_title:    Optional[str] = None
    department:   Optional[str] = None
    role:         Optional[str] = None
    ad_object_id: Optional[str] = None

class LessonUpsert(BaseModel):
    document_id:        str
    went_well:          Optional[str] = None
    went_poorly:        Optional[str] = None
    do_differently:     Optional[str] = None
    evaluator_feedback: Optional[str] = None
    bid_outcome:        Optional[str] = None
    score_received:     Optional[str] = None
    flag_for_attention: bool = False
    status:             LessonStatus = LessonStatus.DRAFT

# ── Helpers ───────────────────────────────────────────────────────

def _contributor_dict(c: KBContributor) -> dict:
    return {
        "id": c.id, "document_id": c.document_id,
        "display_name": c.display_name, "email": c.email,
        "job_title": c.job_title, "department": c.department,
        "role": c.role, "ad_object_id": c.ad_object_id,
        "created_at": c.created_at.isoformat(),
    }

def _lesson_dict(l: KBLesson) -> dict:
    return {
        "id": l.id, "document_id": l.document_id,
        "went_well": l.went_well, "went_poorly": l.went_poorly,
        "do_differently": l.do_differently,
        "evaluator_feedback": l.evaluator_feedback,
        "bid_outcome": l.bid_outcome, "score_received": l.score_received,
        "flag_for_attention": l.flag_for_attention,
        "status": l.status,
        "created_by_name": l.created_by_name,
        "created_at": l.created_at.isoformat(),
        "updated_at": l.updated_at.isoformat(),
    }

# ── Contributors ──────────────────────────────────────────────────

@router.get("/contributors/{document_id}")
async def list_contributors(
    document_id: str,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    contributors = session.exec(
        select(KBContributor)
        .where(KBContributor.document_id == document_id)
        .order_by(KBContributor.created_at)
    ).all()
    return {"contributors": [_contributor_dict(c) for c in contributors]}

@router.post("/contributors")
async def add_contributor(
    data: ContributorAdd,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    # Prevent duplicates
    existing = session.exec(
        select(KBContributor).where(KBContributor.document_id == data.document_id)
    ).all()
    for c in existing:
        if data.email and c.email and c.email.lower() == data.email.lower():
            raise HTTPException(400, f"{data.display_name} is already listed as a contributor.")
        if not data.email and c.display_name.lower() == data.display_name.lower():
            raise HTTPException(400, f"{data.display_name} is already listed as a contributor.")

    contributor = KBContributor(
        document_id  = data.document_id,
        display_name = data.display_name,
        email        = data.email,
        job_title    = data.job_title,
        department   = data.department,
        role         = data.role,
        ad_object_id = data.ad_object_id,
        added_by     = current_user.id,
    )
    session.add(contributor)
    session.commit()
    session.refresh(contributor)
    return _contributor_dict(contributor)

@router.delete("/contributors/{contributor_id}")
async def remove_contributor(
    contributor_id: str,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    c = session.get(KBContributor, contributor_id)
    if not c:
        raise HTTPException(404, "Contributor not found.")
    session.delete(c)
    session.commit()
    return {"success": True}

# ── Lessons Learned ───────────────────────────────────────────────

@router.get("/lessons/{document_id}")
async def get_lesson(
    document_id: str,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    lesson = session.exec(
        select(KBLesson).where(KBLesson.document_id == document_id)
    ).first()
    if not lesson:
        return {"lesson": None}
    return {"lesson": _lesson_dict(lesson)}

@router.put("/lessons")
async def upsert_lesson(
    data: LessonUpsert,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    lesson = session.exec(
        select(KBLesson).where(KBLesson.document_id == data.document_id)
    ).first()

    if lesson:
        lesson.went_well          = data.went_well
        lesson.went_poorly        = data.went_poorly
        lesson.do_differently     = data.do_differently
        lesson.evaluator_feedback = data.evaluator_feedback
        lesson.bid_outcome        = data.bid_outcome
        lesson.score_received     = data.score_received
        lesson.flag_for_attention = data.flag_for_attention
        lesson.status             = data.status
        lesson.updated_at         = datetime.utcnow()
    else:
        lesson = KBLesson(
            document_id        = data.document_id,
            went_well          = data.went_well,
            went_poorly        = data.went_poorly,
            do_differently     = data.do_differently,
            evaluator_feedback = data.evaluator_feedback,
            bid_outcome        = data.bid_outcome,
            score_received     = data.score_received,
            flag_for_attention = data.flag_for_attention,
            status             = data.status,
            created_by         = current_user.id,
            created_by_name    = current_user.full_name,
        )

    session.add(lesson)
    session.commit()
    session.refresh(lesson)
    logger.info(f"Lesson upserted for document {data.document_id} by {current_user.email}")
    return {"lesson": _lesson_dict(lesson)}

# ── Summary endpoint — for search results enrichment ─────────────

@router.get("/summary/{document_id}")
async def get_document_summary(
    document_id: str,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Returns contributors + lesson for a document in one call."""
    contributors = session.exec(
        select(KBContributor).where(KBContributor.document_id == document_id)
    ).all()
    lesson = session.exec(
        select(KBLesson).where(KBLesson.document_id == document_id)
    ).first()
    return {
        "contributors": [_contributor_dict(c) for c in contributors],
        "lesson": _lesson_dict(lesson) if lesson else None,
    }

# ── Flagged lessons — for dashboard / new bid context ────────────

@router.get("/lessons-flagged")
async def get_flagged_lessons(
    industry: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Returns all flag_for_attention=True lessons, optionally filtered by industry."""
    q = (
        select(KBLesson)
        .where(KBLesson.flag_for_attention == True)
        .where(KBLesson.status == LessonStatus.PUBLISHED)
    )
    lessons = session.exec(q.order_by(KBLesson.updated_at.desc()).limit(20)).all()

    results = []
    for l in lessons:
        doc = session.get(Document, l.document_id)
        # If industry filter set, only include matching or unknown industry
        if industry and doc and doc.industry_vertical and doc.industry_vertical != industry:
            continue
        results.append({
            **_lesson_dict(l),
            "document_name":     doc.display_name or doc.original_filename if doc else "Unknown",
            "document_outcome":  doc.outcome if doc else None,
            "document_industry": doc.industry_vertical if doc else None,
        })
    return {"lessons": results, "total": len(results)}
