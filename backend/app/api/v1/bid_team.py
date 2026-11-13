"""
Bid Team API — capture and manage individuals involved in an RFP.
"""
import logging
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from pydantic import BaseModel
from app.database import get_session
from app.models import BidTeamMember, BidRole, Opportunity
from app.core.auth import get_current_user

router = APIRouter(prefix="/bid-team", tags=["bid-team"])
logger = logging.getLogger(__name__)

class BidTeamMemberAdd(BaseModel):
    opportunity_id: str
    display_name:   str
    email:          Optional[str] = None
    job_title:      Optional[str] = None
    department:     Optional[str] = None
    role:           BidRole = BidRole.OTHER
    ad_object_id:   Optional[str] = None

class BidTeamMemberUpdate(BaseModel):
    role:           Optional[BidRole] = None
    display_name:   Optional[str] = None
    job_title:      Optional[str] = None

def _to_dict(m: BidTeamMember) -> dict:
    return {
        "id":           m.id,
        "opportunity_id": m.opportunity_id,
        "display_name": m.display_name,
        "email":        m.email,
        "job_title":    m.job_title,
        "department":   m.department,
        "role":         m.role,
        "ad_object_id": m.ad_object_id,
        "created_at":   m.created_at.isoformat(),
    }

@router.get("/{opportunity_id}")
async def get_bid_team(
    opportunity_id: str,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    members = session.exec(
        select(BidTeamMember)
        .where(BidTeamMember.opportunity_id == opportunity_id)
        .order_by(BidTeamMember.created_at)
    ).all()
    return {"members": [_to_dict(m) for m in members], "total": len(members)}

@router.post("/")
async def add_member(
    data: BidTeamMemberAdd,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    # Prevent duplicates by email or name
    existing_q = select(BidTeamMember).where(
        BidTeamMember.opportunity_id == data.opportunity_id
    )
    existing = session.exec(existing_q).all()
    for m in existing:
        if data.email and m.email and m.email.lower() == data.email.lower():
            raise HTTPException(status_code=400, detail=f"{data.display_name} is already on the bid team.")
        if not data.email and m.display_name.lower() == data.display_name.lower():
            raise HTTPException(status_code=400, detail=f"{data.display_name} is already on the bid team.")

    member = BidTeamMember(
        opportunity_id = data.opportunity_id,
        display_name   = data.display_name,
        email          = data.email,
        job_title      = data.job_title,
        department     = data.department,
        role           = data.role,
        ad_object_id   = data.ad_object_id,
        added_by       = current_user.id,
    )
    session.add(member)
    session.commit()
    session.refresh(member)
    logger.info(f"Added {data.display_name} to bid team for opportunity {data.opportunity_id}")
    return _to_dict(member)

@router.patch("/{member_id}")
async def update_member(
    member_id: str,
    data: BidTeamMemberUpdate,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    member = session.get(BidTeamMember, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found.")
    if data.role         is not None: member.role         = data.role
    if data.display_name is not None: member.display_name = data.display_name
    if data.job_title    is not None: member.job_title    = data.job_title
    session.add(member)
    session.commit()
    session.refresh(member)
    return _to_dict(member)

@router.delete("/{member_id}")
async def remove_member(
    member_id: str,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    member = session.get(BidTeamMember, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found.")
    session.delete(member)
    session.commit()
    return {"success": True, "message": "Team member removed."}

@router.get("/bulk-add/{opportunity_id}")
async def add_bulk_manual(
    opportunity_id: str,
    names: str,    # comma-separated
    role: BidRole = BidRole.OTHER,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Add multiple team members from a comma-separated name string (manual entry mode)."""
    added = []
    skipped = []
    for raw in names.split(","):
        name = raw.strip()
        if not name:
            continue
        existing = session.exec(
            select(BidTeamMember).where(
                BidTeamMember.opportunity_id == opportunity_id,
                BidTeamMember.display_name == name,
            )
        ).first()
        if existing:
            skipped.append(name)
            continue
        m = BidTeamMember(
            opportunity_id = opportunity_id,
            display_name   = name,
            role           = role,
            added_by       = current_user.id,
        )
        session.add(m)
        added.append(name)
    session.commit()
    return {"added": added, "skipped": skipped, "total_added": len(added)}
