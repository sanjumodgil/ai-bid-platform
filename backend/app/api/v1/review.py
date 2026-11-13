"""
Stage 6 — HITL Review Portal
Bid lead assigns reviewers to sections. Reviewers annotate and approve/reject.
"""
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from pydantic import BaseModel
from app.database import get_session
from app.models import BidSection, SectionAnnotation, User, ReviewStatus, ActivityLog, Opportunity
from app.core.auth import get_current_user, require_bid_lead
from app.api.v1.generation import _section_dict

router = APIRouter(prefix="/review", tags=["review"])
logger = logging.getLogger(__name__)

class AssignReviewer(BaseModel):
    reviewer_id:   str
    reviewer_name: str

class AnnotationCreate(BaseModel):
    content:         str
    annotation_type: str = "comment"   # comment, suggestion, approval, rejection

class SectionEdit(BaseModel):
    edited_content: str

class ReviewDecision(BaseModel):
    decision: str   # approved, changes_requested
    note:     Optional[str] = None

# ── Section retrieval ─────────────────────────────────────────────

@router.get("/{opp_id}/sections")
async def list_review_sections(
    opp_id: str,
    reviewer_id: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    q = select(BidSection).where(BidSection.opportunity_id == opp_id)
    if reviewer_id:
        q = q.where(BidSection.reviewer_id == reviewer_id)
    sections = session.exec(q.order_by(BidSection.section_order)).all()

    enriched = []
    for s in sections:
        d = _section_dict(s)
        annotations = session.exec(
            select(SectionAnnotation).where(SectionAnnotation.section_id == s.id)
            .order_by(SectionAnnotation.created_at)
        ).all()
        d["annotations"] = [_annotation_dict(a) for a in annotations]
        enriched.append(d)
    return {"sections": enriched, "total": len(enriched)}

@router.get("/section/{section_id}")
async def get_section(
    section_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    s = session.get(BidSection, section_id)
    if not s:
        raise HTTPException(404, "Section not found")
    d = _section_dict(s)
    annotations = session.exec(
        select(SectionAnnotation).where(SectionAnnotation.section_id == section_id)
        .order_by(SectionAnnotation.created_at)
    ).all()
    d["annotations"] = [_annotation_dict(a) for a in annotations]
    return d

# ── Reviewer assignment ───────────────────────────────────────────

@router.patch("/section/{section_id}/assign")
async def assign_reviewer(
    section_id: str,
    data: AssignReviewer,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    s = session.get(BidSection, section_id)
    if not s:
        raise HTTPException(404, "Section not found")

    s.reviewer_id   = data.reviewer_id
    s.reviewer_name = data.reviewer_name
    s.review_status = ReviewStatus.IN_REVIEW
    s.updated_at    = datetime.utcnow()
    session.add(s)
    session.commit()
    session.refresh(s)
    logger.info(f"Section {section_id} assigned to {data.reviewer_name}")

    # Email notification if reviewer has an email
    try:
        reviewer = session.get(User, data.reviewer_id)
        opp      = session.get(Opportunity, s.opportunity_id)
        if reviewer and reviewer.email:
            from app.core.email import send_review_assignment_email
            send_review_assignment_email(
                to               = reviewer.email,
                reviewer_name    = reviewer.full_name,
                section_title    = s.section_title,
                opportunity_name = opp.name if opp else "Unknown",
            )
    except Exception as e:
        logger.warning(f"Review assignment email failed: {e}")

    return _section_dict(s)

@router.patch("/section/{section_id}/unassign")
async def unassign_reviewer(
    section_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    s = session.get(BidSection, section_id)
    if not s:
        raise HTTPException(404, "Section not found")
    s.reviewer_id   = None
    s.reviewer_name = None
    s.review_status = ReviewStatus.PENDING
    s.updated_at    = datetime.utcnow()
    session.add(s)
    session.commit()
    session.refresh(s)
    return _section_dict(s)

# ── Inline editing ────────────────────────────────────────────────

@router.patch("/section/{section_id}/edit")
async def edit_section(
    section_id: str,
    data: SectionEdit,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    s = session.get(BidSection, section_id)
    if not s:
        raise HTTPException(404, "Section not found")

    s.edited_content = data.edited_content
    s.word_count     = len(data.edited_content.split())
    s.review_status  = ReviewStatus.REWRITTEN
    s.updated_at     = datetime.utcnow()
    session.add(s)
    session.commit()
    session.refresh(s)
    return _section_dict(s)

# ── Review decision ───────────────────────────────────────────────

@router.patch("/section/{section_id}/decide")
async def review_decision(
    section_id: str,
    data: ReviewDecision,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    s = session.get(BidSection, section_id)
    if not s:
        raise HTTPException(404, "Section not found")

    if data.decision == "approved":
        s.review_status = ReviewStatus.APPROVED
    elif data.decision == "changes_requested":
        s.review_status = ReviewStatus.CHANGES_REQUESTED
    else:
        raise HTTPException(400, f"Unknown decision: {data.decision}")

    s.updated_at = datetime.utcnow()
    session.add(s)

    # Auto-add annotation for the decision
    if data.note or data.decision:
        note_text = data.note or f"Section {data.decision.replace('_', ' ')}."
        ann = SectionAnnotation(
            section_id       = section_id,
            author_id        = current_user.id,
            author_name      = current_user.full_name,
            content          = note_text,
            annotation_type  = data.decision,
        )
        session.add(ann)

    session.commit()
    session.refresh(s)
    return _section_dict(s)

# ── Annotations ───────────────────────────────────────────────────

@router.post("/section/{section_id}/annotations")
async def add_annotation(
    section_id: str,
    data: AnnotationCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    s = session.get(BidSection, section_id)
    if not s:
        raise HTTPException(404, "Section not found")

    ann = SectionAnnotation(
        section_id       = section_id,
        author_id        = current_user.id,
        author_name      = current_user.full_name,
        content          = data.content,
        annotation_type  = data.annotation_type,
    )
    session.add(ann)
    session.commit()
    session.refresh(ann)
    return _annotation_dict(ann)

@router.patch("/annotation/{ann_id}/resolve")
async def resolve_annotation(
    ann_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    ann = session.get(SectionAnnotation, ann_id)
    if not ann:
        raise HTTPException(404, "Annotation not found")
    ann.resolved = True
    session.add(ann)
    session.commit()
    return _annotation_dict(ann)

# ── Review summary ────────────────────────────────────────────────

@router.get("/{opp_id}/summary")
async def review_summary(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    sections = session.exec(
        select(BidSection).where(BidSection.opportunity_id == opp_id)
    ).all()

    by_status: dict = {}
    for s in sections:
        key = s.review_status
        by_status[key] = by_status.get(key, 0) + 1

    total     = len(sections)
    approved  = by_status.get("approved", 0)
    pending   = by_status.get("pending", 0)
    in_review = by_status.get("in_review", 0)
    changes   = by_status.get("changes_requested", 0)
    rewritten = by_status.get("rewritten", 0)
    low_conf  = sum(1 for s in sections if s.confidence_overall and s.confidence_overall < 65)

    return {
        "total":            total,
        "approved":         approved,
        "pending":          pending,
        "in_review":        in_review,
        "changes_requested": changes,
        "rewritten":        rewritten,
        "low_confidence":   low_conf,
        "ready_for_export": approved == total and total > 0,
        "by_status":        by_status,
    }

def _annotation_dict(a: SectionAnnotation) -> dict:
    return {
        "id":              a.id,
        "section_id":      a.section_id,
        "author_id":       a.author_id,
        "author_name":     a.author_name,
        "content":         a.content,
        "annotation_type": a.annotation_type,
        "resolved":        a.resolved,
        "created_at":      a.created_at.isoformat(),
    }
