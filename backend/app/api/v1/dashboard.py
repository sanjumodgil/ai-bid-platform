from fastapi import APIRouter, Depends
from sqlmodel import Session, select, func
from datetime import datetime, timedelta
from typing import Optional
from app.database import get_session
from app.models import (
    Opportunity, Document, User, DocumentChunk, OpportunityStatus,
    BidSection, ReviewStatus, GenerationStatus, Submission
)
from app.core.auth import get_current_user
from app.core.llm import get_status as llm_status

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("/stats")
async def get_dashboard_stats(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    total_opps  = session.exec(select(func.count(Opportunity.id))).one()
    active_opps = session.exec(
        select(func.count(Opportunity.id)).where(
            Opportunity.status.in_([OpportunityStatus.DRAFT, OpportunityStatus.UNDER_REVIEW, OpportunityStatus.SUBMITTED])
        )
    ).one()
    total_users = session.exec(select(func.count(User.id))).one()
    kb_chunks   = session.exec(select(func.count(DocumentChunk.id))).one()
    kb_docs     = session.exec(select(func.count(Document.id))).one()

    # ── Phase 2 stats ────────────────────────────────────────────
    try:
        sections_pending_review = session.exec(
            select(func.count(BidSection.id)).where(
                BidSection.review_status.in_([ReviewStatus.PENDING, ReviewStatus.IN_REVIEW])
            )
        ).one()

        sections_approved_week = session.exec(
            select(func.count(BidSection.id)).where(
                BidSection.review_status == ReviewStatus.APPROVED,
                BidSection.updated_at >= datetime.utcnow() - timedelta(days=7)
            )
        ).one()

        sections_low_confidence = session.exec(
            select(func.count(BidSection.id)).where(
                BidSection.generation_status == GenerationStatus.COMPLETED,
                BidSection.confidence_overall < 65
            )
        ).one()

        # My review queue (sections assigned to current user)
        my_review_count = session.exec(
            select(func.count(BidSection.id)).where(
                BidSection.reviewer_id == current_user.id,
                BidSection.review_status.in_([ReviewStatus.PENDING, ReviewStatus.IN_REVIEW])
            )
        ).one()

        # Upcoming deadlines (next 14 days)
        upcoming_deadlines = session.exec(
            select(Opportunity).where(
                Opportunity.submission_deadline >= datetime.utcnow(),
                Opportunity.submission_deadline <= datetime.utcnow() + timedelta(days=14),
                Opportunity.status.in_([OpportunityStatus.DRAFT, OpportunityStatus.UNDER_REVIEW])
            ).order_by(Opportunity.submission_deadline)
        ).all()

        phase2_stats = {
            "sections_pending_review":  sections_pending_review,
            "sections_approved_week":   sections_approved_week,
            "sections_low_confidence":  sections_low_confidence,
            "my_review_count":          my_review_count,
            "upcoming_deadlines": [
                {
                    "id":       o.id,
                    "name":     o.name,
                    "client":   o.client_name,
                    "deadline": o.submission_deadline.isoformat(),
                    "days_left": (o.submission_deadline - datetime.utcnow()).days
                }
                for o in upcoming_deadlines
            ],
        }
    except Exception:
        phase2_stats = {
            "sections_pending_review": 0,
            "sections_approved_week":  0,
            "sections_low_confidence": 0,
            "my_review_count":         0,
            "upcoming_deadlines":      [],
        }

    recent = session.exec(
        select(Opportunity).order_by(Opportunity.updated_at.desc()).limit(5)
    ).all()

    llm = llm_status()

    return {
        "total_opportunities":  total_opps,
        "active_opportunities": active_opps,
        "total_users":          total_users,
        "kb_documents":         kb_docs,
        "kb_chunks":            kb_chunks,
        "phase2":               phase2_stats,
        "recent_opportunities": [
            {"id": o.id, "name": o.name, "client": o.client_name,
             "status": o.status, "updated_at": o.updated_at.isoformat()}
            for o in recent
        ],
        "config_status": {
            "llm": llm,
        }
    }

@router.get("/my-reviews")
async def get_my_reviews(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """All sections assigned to the current user that need review."""
    sections = session.exec(
        select(BidSection).where(
            BidSection.reviewer_id == current_user.id,
            BidSection.review_status.in_([ReviewStatus.PENDING, ReviewStatus.IN_REVIEW, ReviewStatus.CHANGES_REQUESTED])
        ).order_by(BidSection.updated_at.desc())
    ).all()

    results = []
    for s in sections:
        opp = session.get(Opportunity, s.opportunity_id)
        results.append({
            "section_id":       s.id,
            "section_title":    s.section_title,
            "section_type":     s.section_type,
            "review_status":    s.review_status,
            "confidence_overall": s.confidence_overall,
            "opportunity_id":   s.opportunity_id,
            "opportunity_name": opp.name if opp else "Unknown",
            "client_name":      opp.client_name if opp else "",
            "updated_at":       s.updated_at.isoformat(),
        })
    return {"sections": results, "total": len(results)}

# ── Global Audit Log ──────────────────────────────────────────────

@router.get("/audit-log")
async def get_audit_log(
    skip:   int = 0,
    limit:  int = 50,
    user_id: Optional[str] = None,
    action:  Optional[str] = None,
    opp_id:  Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Global audit log — all activity across all opportunities."""
    from app.models import ActivityLog
    q = select(ActivityLog)
    if user_id: q = q.where(ActivityLog.user_id == user_id)
    if action:  q = q.where(ActivityLog.action == action)
    if opp_id:  q = q.where(ActivityLog.opportunity_id == opp_id)
    q = q.order_by(ActivityLog.created_at.desc()).offset(skip).limit(limit)
    logs = session.exec(q).all()

    total = session.exec(select(func.count(ActivityLog.id))).one()

    return {
        "logs": [
            {
                "id":             l.id,
                "opportunity_id": l.opportunity_id,
                "user_id":        l.user_id,
                "user_name":      l.user_name,
                "action":         l.action,
                "detail":         l.detail,
                "entity_type":    l.entity_type,
                "entity_id":      l.entity_id,
                "created_at":     l.created_at.isoformat(),
            }
            for l in logs
        ],
        "total": total,
        "skip":  skip,
        "limit": limit,
    }
