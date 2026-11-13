"""
Stage 9 — Submission Tracking
Stage 10 — Capture Result + KB Learning Loop Trigger
"""
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from pydantic import BaseModel
from app.database import get_session
from app.models import Submission, Opportunity, OpportunityStatus, ActivityLog, User
from app.core.auth import get_current_user, require_bid_lead

router = APIRouter(prefix="/submission", tags=["submission"])
logger = logging.getLogger(__name__)

class SubmissionCreate(BaseModel):
    submitted_at:      Optional[str]  = None   # ISO datetime string
    submission_method: Optional[str]  = None   # portal, email, physical
    confirmation_ref:  Optional[str]  = None

class CaptureResult(BaseModel):
    capture_result:   str              # won, lost, shortlisted, withdrawn, no_bid
    capture_date:     Optional[str]    = None
    capture_notes:    Optional[str]    = None
    score_received:   Optional[str]    = None
    feedback_received: Optional[str]   = None

def _sub_dict(s: Submission) -> dict:
    return {
        "id":                s.id,
        "opportunity_id":    s.opportunity_id,
        "submitted_at":      s.submitted_at.isoformat() if s.submitted_at else None,
        "submission_method": s.submission_method,
        "confirmation_ref":  s.confirmation_ref,
        "submitted_by_name": s.submitted_by_name,
        "capture_result":    s.capture_result,
        "capture_date":      s.capture_date.isoformat() if s.capture_date else None,
        "capture_notes":     s.capture_notes,
        "score_received":    s.score_received,
        "feedback_received": s.feedback_received,
        "kb_promoted":       s.kb_promoted,
        "lessons_added":     s.lessons_added,
        "created_at":        s.created_at.isoformat(),
        "updated_at":        s.updated_at.isoformat(),
    }

@router.get("/{opp_id}")
async def get_submission(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    sub = session.exec(
        select(Submission).where(Submission.opportunity_id == opp_id)
    ).first()
    return {"submission": _sub_dict(sub) if sub else None}

@router.post("/{opp_id}/submit")
async def record_submission(
    opp_id: str,
    data: SubmissionCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    """Stage 9: Record that the bid has been submitted."""
    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(404, "Opportunity not found")

    # Get or create submission record
    sub = session.exec(
        select(Submission).where(Submission.opportunity_id == opp_id)
    ).first()
    if not sub:
        sub = Submission(opportunity_id=opp_id)

    sub.submitted_at      = datetime.fromisoformat(data.submitted_at) if data.submitted_at else datetime.utcnow()
    sub.submission_method = data.submission_method
    sub.confirmation_ref  = data.confirmation_ref
    sub.submitted_by_id   = current_user.id
    sub.submitted_by_name = current_user.full_name
    sub.updated_at        = datetime.utcnow()
    session.add(sub)

    # Advance opportunity status
    opp.status     = OpportunityStatus.SUBMITTED
    opp.updated_at = datetime.utcnow()
    session.add(opp)

    log = ActivityLog(
        opportunity_id = opp_id,
        user_id        = current_user.id,
        user_name      = current_user.full_name,
        action         = "submitted",
        detail         = f"Bid submitted via {data.submission_method or 'unspecified'}"
                         + (f", ref: {data.confirmation_ref}" if data.confirmation_ref else ""),
    )
    session.add(log)
    session.commit()
    session.refresh(sub)
    logger.info(f"Bid {opp_id} marked submitted by {current_user.email}")
    return {"submission": _sub_dict(sub), "message": "Submission recorded."}

@router.post("/{opp_id}/capture")
async def capture_result(
    opp_id: str,
    data: CaptureResult,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    """Stage 10: Record the bid outcome and trigger KB learning loop."""
    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(404, "Opportunity not found")

    sub = session.exec(
        select(Submission).where(Submission.opportunity_id == opp_id)
    ).first()
    if not sub:
        sub = Submission(opportunity_id=opp_id)

    sub.capture_result    = data.capture_result
    sub.capture_date      = datetime.fromisoformat(data.capture_date) if data.capture_date else datetime.utcnow()
    sub.capture_notes     = data.capture_notes
    sub.score_received    = data.score_received
    sub.feedback_received = data.feedback_received
    sub.updated_at        = datetime.utcnow()
    session.add(sub)

    # Update opportunity status
    status_map = {
        "won":         OpportunityStatus.WON_DIRECT,
        "lost":        OpportunityStatus.LOST_AT_RFP,
        "shortlisted": OpportunityStatus.SHORTLISTED,
        "withdrawn":   OpportunityStatus.CANCELLED,
        "no_bid":      OpportunityStatus.CANCELLED,
    }
    new_status = status_map.get(data.capture_result, opp.status)
    opp.status        = new_status
    opp.capture_result = data.capture_result
    opp.updated_at    = datetime.utcnow()
    session.add(opp)

    log = ActivityLog(
        opportunity_id = opp_id,
        user_id        = current_user.id,
        user_name      = current_user.full_name,
        action         = "capture_result",
        detail         = f"Result: {data.capture_result}"
                         + (f" | Score: {data.score_received}" if data.score_received else ""),
    )
    session.add(log)
    session.commit()
    session.refresh(sub)
    logger.info(f"Bid {opp_id} result captured: {data.capture_result}")

    # Email notification to bid lead
    try:
        if opp and opp.bid_lead_id:
            bid_lead = session.get(User, opp.bid_lead_id)
            if bid_lead and bid_lead.email:
                from app.core.email import send_capture_result_email
                send_capture_result_email(
                    to               = bid_lead.email,
                    recipient_name   = bid_lead.full_name,
                    opportunity_name = opp.name,
                    result           = data.capture_result,
                    score            = data.score_received or "",
                )
    except Exception as e:
        logger.warning(f"Capture result email failed: {e}")

    return {
        "submission":     _sub_dict(sub),
        "message":        f"Result recorded: {data.capture_result}",
        "prompt_kb_loop": True,
        "opp_status":     new_status,
    }

@router.patch("/{opp_id}/kb-promoted")
async def mark_kb_promoted(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    """Mark KB promotion as done (Stage 16)."""
    sub = session.exec(
        select(Submission).where(Submission.opportunity_id == opp_id)
    ).first()
    if sub:
        sub.kb_promoted = True
        sub.updated_at  = datetime.utcnow()
        session.add(sub)
        session.commit()
    return {"success": True}

@router.patch("/{opp_id}/lessons-added")
async def mark_lessons_added(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    """Mark lessons learned as recorded (Stage 16)."""
    sub = session.exec(
        select(Submission).where(Submission.opportunity_id == opp_id)
    ).first()
    if sub:
        sub.lessons_added = True
        sub.updated_at    = datetime.utcnow()
        session.add(sub)
        session.commit()
    return {"success": True}
