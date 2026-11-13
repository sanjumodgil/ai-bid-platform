from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.database import get_session
from app.models import (
    Opportunity, OpportunityStatus, IndustryVertical, GoNoGoStatus,
    Document, Requirement, ActivityLog, User
)
from app.core.auth import get_current_user, require_bid_lead

router = APIRouter(prefix="/opportunities", tags=["opportunities"])

class OpportunityCreate(BaseModel):
    name: str
    client_name: str
    procurement_reference: Optional[str] = None
    industry_vertical: IndustryVertical = IndustryVertical.OTHER
    sub_domain: Optional[str] = None
    solution_type: Optional[str] = None
    geography: Optional[str] = None
    submission_deadline: Optional[datetime] = None
    estimated_value: Optional[float] = None
    notes: Optional[str] = None
    crm_reference: Optional[str] = None

class OpportunityUpdate(BaseModel):
    name: Optional[str] = None
    client_name: Optional[str] = None
    procurement_reference: Optional[str] = None
    industry_vertical: Optional[IndustryVertical] = None
    sub_domain: Optional[str] = None
    solution_type: Optional[str] = None
    geography: Optional[str] = None
    submission_deadline: Optional[datetime] = None
    estimated_value: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[OpportunityStatus] = None
    go_no_go_status: Optional[GoNoGoStatus] = None

class CFAVUpdate(BaseModel):
    complexity_score: Optional[float] = None
    feasibility_score: Optional[float] = None
    alignment_score: Optional[float] = None
    value_score: Optional[float] = None
    go_no_go_override: Optional[str] = None  # sponsor justification text

class OpportunityOut(BaseModel):
    id: str
    name: str
    client_name: str
    procurement_reference: Optional[str]
    industry_vertical: str
    sub_domain: Optional[str]
    solution_type: Optional[str]
    geography: Optional[str]
    submission_deadline: Optional[datetime]
    estimated_value: Optional[float]
    status: str
    oral_status: Optional[str]
    go_no_go_status: str
    cfav_score: Optional[float]
    complexity_score: Optional[float]
    feasibility_score: Optional[float]
    alignment_score: Optional[float]
    value_score: Optional[float]
    notes: Optional[str]
    bid_lead_id: Optional[str]
    bid_lead_name: Optional[str]
    document_count: int
    requirement_count: int
    created_at: datetime
    updated_at: datetime

def compute_cfav_aggregate(opp: Opportunity) -> Optional[float]:
    scores = [s for s in [opp.complexity_score, opp.feasibility_score, opp.alignment_score, opp.value_score] if s is not None]
    if not scores:
        return None
    weights = [0.20, 0.30, 0.30, 0.20]
    available = [(s, w) for s, w in zip([opp.complexity_score, opp.feasibility_score, opp.alignment_score, opp.value_score], weights) if s is not None]
    total_weight = sum(w for _, w in available)
    weighted_sum = sum(s * w for s, w in available)
    return round((weighted_sum / total_weight) * 10, 1)  # 0-100 scale

def derive_go_no_go(cfav_score: Optional[float]) -> GoNoGoStatus:
    if cfav_score is None:
        return GoNoGoStatus.PENDING
    if cfav_score >= 65:
        return GoNoGoStatus.GO
    elif cfav_score >= 45:
        return GoNoGoStatus.PURSUE_WITH_CAVEATS
    return GoNoGoStatus.NO_GO

def opp_to_out(opp: Opportunity, session: Session) -> OpportunityOut:
    doc_count = session.exec(select(func.count(Document.id)).where(Document.opportunity_id == opp.id)).one()
    req_count = session.exec(select(func.count(Requirement.id)).where(Requirement.opportunity_id == opp.id)).one()
    bid_lead_name = None
    if opp.bid_lead_id:
        lead = session.get(User, opp.bid_lead_id)
        bid_lead_name = lead.full_name if lead else None
    return OpportunityOut(
        id=opp.id, name=opp.name, client_name=opp.client_name,
        procurement_reference=opp.procurement_reference,
        industry_vertical=opp.industry_vertical, sub_domain=opp.sub_domain, solution_type=opp.solution_type,
        geography=opp.geography, submission_deadline=opp.submission_deadline,
        estimated_value=opp.estimated_value, status=opp.status,
        oral_status=opp.oral_status, go_no_go_status=opp.go_no_go_status,
        cfav_score=opp.cfav_score, complexity_score=opp.complexity_score,
        feasibility_score=opp.feasibility_score, alignment_score=opp.alignment_score,
        value_score=opp.value_score, notes=opp.notes,
        bid_lead_id=opp.bid_lead_id, bid_lead_name=bid_lead_name,
        document_count=doc_count, requirement_count=req_count,
        created_at=opp.created_at, updated_at=opp.updated_at,
    )

def log_activity(session: Session, opportunity_id: str, user: User, action: str, detail: str = None):
    entry = ActivityLog(
        opportunity_id=opportunity_id,
        user_id=user.id,
        user_name=user.full_name,
        action=action,
        detail=detail,
        entity_type="opportunity",
        entity_id=opportunity_id,
    )
    session.add(entry)

@router.get("/", response_model=List[OpportunityOut])
async def list_opportunities(
    status: Optional[str] = Query(None),
    industry: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 50,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    query = select(Opportunity)
    if status:
        query = query.where(Opportunity.status == status)
    if industry:
        query = query.where(Opportunity.industry_vertical == industry)
    if search:
        query = query.where(
            (Opportunity.name.contains(search)) | (Opportunity.client_name.contains(search))
        )
    # Viewers see all; bid leads see their own + assigned
    query = query.order_by(Opportunity.updated_at.desc()).offset(skip).limit(limit)
    opps = session.exec(query).all()
    return [opp_to_out(o, session) for o in opps]

@router.post("/", response_model=OpportunityOut, status_code=201)
async def create_opportunity(
    data: OpportunityCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead)
):
    opp = Opportunity(
        **data.model_dump(),
        bid_lead_id=current_user.id,
        status=OpportunityStatus.DRAFT,
    )
    session.add(opp)
    log_activity(session, opp.id, current_user, "created", f"Opportunity created: {opp.name}")
    session.commit()
    session.refresh(opp)
    return opp_to_out(opp, session)

@router.get("/{opp_id}", response_model=OpportunityOut)
async def get_opportunity(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    return opp_to_out(opp, session)

@router.patch("/{opp_id}", response_model=OpportunityOut)
async def update_opportunity(
    opp_id: str,
    data: OpportunityUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead)
):
    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(opp, k, v)
    opp.updated_at = datetime.utcnow()
    session.add(opp)
    log_activity(session, opp_id, current_user, "updated", "Opportunity details updated")
    session.commit()
    return opp_to_out(opp, session)

@router.post("/{opp_id}/cfav", response_model=OpportunityOut)
async def update_cfav_scores(
    opp_id: str,
    data: CFAVUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead)
):
    """Update CFAV scores and compute Go/No-Go recommendation (Stage 3)."""
    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    if data.complexity_score is not None:
        opp.complexity_score = max(0, min(100, data.complexity_score))
    if data.feasibility_score is not None:
        opp.feasibility_score = max(0, min(100, data.feasibility_score))
    if data.alignment_score is not None:
        opp.alignment_score = max(0, min(100, data.alignment_score))
    if data.value_score is not None:
        opp.value_score = max(0, min(100, data.value_score))

    opp.cfav_score = compute_cfav_aggregate(opp)
    opp.go_no_go_status = derive_go_no_go(opp.cfav_score)
    opp.updated_at = datetime.utcnow()
    session.add(opp)
    log_activity(session, opp_id, current_user, "cfav_scored",
                 f"CFAV scored: {opp.cfav_score:.1f} → {opp.go_no_go_status}")
    session.commit()
    return opp_to_out(opp, session)

@router.post("/{opp_id}/proceed", response_model=OpportunityOut)
async def confirm_proceed(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead)
):
    """Stage 3: Human confirms decision to proceed to generation."""
    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    opp.status = OpportunityStatus.UNDER_REVIEW
    opp.updated_at = datetime.utcnow()
    session.add(opp)
    log_activity(session, opp_id, current_user, "proceed_confirmed",
                 f"Decision to proceed confirmed by {current_user.full_name} (CFAV: {opp.cfav_score})")
    session.commit()
    return opp_to_out(opp, session)

@router.get("/{opp_id}/activity", response_model=List[dict])
async def get_activity(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    logs = session.exec(
        select(ActivityLog).where(ActivityLog.opportunity_id == opp_id)
        .order_by(ActivityLog.created_at.desc()).limit(50)
    ).all()
    return [{"id": l.id, "action": l.action, "detail": l.detail,
             "user_name": l.user_name, "created_at": l.created_at.isoformat()} for l in logs]

@router.get("/{opp_id}/requirements", response_model=List[dict])
async def get_requirements(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    reqs = session.exec(select(Requirement).where(Requirement.opportunity_id == opp_id)).all()
    return [{"id": r.id, "req_id": r.req_id, "description": r.description,
             "priority": r.priority, "category": r.category, "section": r.section,
             "cfav_aggregate": r.cfav_aggregate, "is_mandatory": r.is_mandatory,
             "created_at": r.created_at.isoformat()} for r in reqs]
