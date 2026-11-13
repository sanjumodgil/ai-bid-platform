"""
Phase 3 — Orals Track (Stages 11–15)
Stages 11-15 of the bid pipeline: prep workspace, deck builder,
Q&A engine, rehearsal tracking, oral delivery & result capture.
"""
import json
import logging
import asyncio
from datetime import datetime
from typing import Optional, AsyncGenerator
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
from pydantic import BaseModel
from app.database import get_session, engine
from app.models import (
    OpportunityStatus,
    OralSession, PresentationSlide, AnticipatedQuestion, RehearsalSession,
    Opportunity, BidSection,  OralStatus, User, ActivityLog
)
from app.core.auth import get_current_user, require_bid_lead
from app.core.llm import complete, is_configured, LLMNotConfiguredError

router = APIRouter(prefix="/orals", tags=["orals"])
logger = logging.getLogger(__name__)

# ── Pydantic schemas ──────────────────────────────────────────────

class OralSessionCreate(BaseModel):
    oral_date:        Optional[str]  = None
    venue:            Optional[str]  = None
    format:           str            = "in_person"
    duration_minutes: Optional[int]  = None
    evaluator_names:  Optional[str]  = None
    evaluator_count:  Optional[int]  = None
    presenter_names:  Optional[str]  = None

class OralSessionUpdate(BaseModel):
    oral_date:        Optional[str]  = None
    venue:            Optional[str]  = None
    format:           Optional[str]  = None
    duration_minutes: Optional[int]  = None
    evaluator_names:  Optional[str]  = None
    evaluator_count:  Optional[int]  = None
    presenter_names:  Optional[str]  = None

class SlideCreate(BaseModel):
    title:            str
    slide_type:       Optional[str]  = None
    slide_order:      int            = 0
    duration_minutes: Optional[int]  = None
    source_section_id: Optional[str] = None

class SlideUpdate(BaseModel):
    title:            Optional[str]  = None
    talking_points:   Optional[str]  = None
    speaker_notes:    Optional[str]  = None
    slide_order:      Optional[int]  = None
    duration_minutes: Optional[int]  = None

class QuestionCreate(BaseModel):
    question:  str
    category:  Optional[str] = None
    difficulty: Optional[str] = None

class QuestionUpdate(BaseModel):
    edited_answer:   Optional[str]  = None
    rehearsed:       Optional[bool] = None
    rehearsal_notes: Optional[str]  = None
    category:        Optional[str]  = None

class RehearsalCreate(BaseModel):
    rehearsal_date:    Optional[str]  = None
    duration_minutes:  Optional[int]  = None
    attendee_names:    Optional[str]  = None
    facilitator_name:  Optional[str]  = None
    feedback:          Optional[str]  = None
    strengths:         Optional[str]  = None
    improvements:      Optional[str]  = None
    questions_covered: Optional[list] = None
    readiness_rating:  Optional[int]  = None

class OralResultCapture(BaseModel):
    result:             str            # won_at_orals, lost_at_orals
    delivered_at:       Optional[str]  = None
    delivery_notes:     Optional[str]  = None
    result_notes:       Optional[str]  = None
    evaluator_feedback: Optional[str]  = None

# ── Dict helpers ──────────────────────────────────────────────────

def _oral_dict(o: OralSession) -> dict:
    return {
        "id": o.id, "opportunity_id": o.opportunity_id,
        "oral_date": o.oral_date.isoformat() if o.oral_date else None,
        "venue": o.venue, "format": o.format,
        "duration_minutes": o.duration_minutes,
        "evaluator_names": o.evaluator_names,
        "evaluator_count": o.evaluator_count,
        "presenter_names": o.presenter_names,
        "oral_status": o.oral_status,
        "readiness_score": o.readiness_score,
        "delivered_at": o.delivered_at.isoformat() if o.delivered_at else None,
        "delivery_notes": o.delivery_notes,
        "result": o.result,
        "result_notes": o.result_notes,
        "evaluator_feedback": o.evaluator_feedback,
        "created_at": o.created_at.isoformat(),
        "updated_at": o.updated_at.isoformat(),
    }

def _slide_dict(s: PresentationSlide) -> dict:
    return {
        "id": s.id, "opportunity_id": s.opportunity_id,
        "slide_order": s.slide_order, "title": s.title,
        "slide_type": s.slide_type, "talking_points": s.talking_points,
        "speaker_notes": s.speaker_notes,
        "source_section_id": s.source_section_id,
        "duration_minutes": s.duration_minutes,
        "status": s.status,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat(),
    }

def _question_dict(q: AnticipatedQuestion) -> dict:
    return {
        "id": q.id, "opportunity_id": q.opportunity_id,
        "question": q.question, "category": q.category,
        "difficulty": q.difficulty,
        "model_answer": q.model_answer,
        "edited_answer": q.edited_answer,
        "source": q.source, "rehearsed": q.rehearsed,
        "rehearsal_notes": q.rehearsal_notes,
        "question_order": q.question_order,
        "created_at": q.created_at.isoformat(),
        "updated_at": q.updated_at.isoformat(),
    }

def _rehearsal_dict(r: RehearsalSession) -> dict:
    return {
        "id": r.id, "opportunity_id": r.opportunity_id,
        "rehearsal_date": r.rehearsal_date.isoformat(),
        "duration_minutes": r.duration_minutes,
        "attendee_names": r.attendee_names,
        "facilitator_name": r.facilitator_name,
        "feedback": r.feedback, "strengths": r.strengths,
        "improvements": r.improvements,
        "questions_covered": json.loads(r.questions_covered) if r.questions_covered else [],
        "readiness_rating": r.readiness_rating,
        "created_at": r.created_at.isoformat(),
    }

# ── Stage 11 — Oral Setup ─────────────────────────────────────────

@router.get("/{opp_id}")
async def get_oral(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    oral = session.exec(select(OralSession).where(OralSession.opportunity_id == opp_id)).first()
    return {"oral": _oral_dict(oral) if oral else None}

@router.post("/{opp_id}/setup")
async def setup_oral(
    opp_id: str,
    data: OralSessionCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(404, "Opportunity not found")

    oral = session.exec(select(OralSession).where(OralSession.opportunity_id == opp_id)).first()
    if not oral:
        oral = OralSession(opportunity_id=opp_id, created_by=current_user.id)

    oral.format           = data.format
    oral.venue            = data.venue
    oral.evaluator_names  = data.evaluator_names
    oral.evaluator_count  = data.evaluator_count
    oral.presenter_names  = data.presenter_names
    oral.duration_minutes = data.duration_minutes
    oral.updated_at       = datetime.utcnow()
    if data.oral_date:
        oral.oral_date = datetime.fromisoformat(data.oral_date)

    # Mark opportunity as shortlisted / preparing
    opp.oral_status = OralStatus.PREPARING
    opp.updated_at  = datetime.utcnow()
    session.add(oral); session.add(opp)
    session.commit(); session.refresh(oral)
    return {"oral": _oral_dict(oral)}

@router.patch("/{opp_id}/setup")
async def update_oral(
    opp_id: str,
    data: OralSessionUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    oral = session.exec(select(OralSession).where(OralSession.opportunity_id == opp_id)).first()
    if not oral:
        raise HTTPException(404, "Oral session not set up yet")

    if data.oral_date        is not None: oral.oral_date = datetime.fromisoformat(data.oral_date)
    if data.venue            is not None: oral.venue = data.venue
    if data.format           is not None: oral.format = data.format
    if data.duration_minutes is not None: oral.duration_minutes = data.duration_minutes
    if data.evaluator_names  is not None: oral.evaluator_names = data.evaluator_names
    if data.evaluator_count  is not None: oral.evaluator_count = data.evaluator_count
    if data.presenter_names  is not None: oral.presenter_names = data.presenter_names
    oral.updated_at = datetime.utcnow()
    session.add(oral); session.commit(); session.refresh(oral)
    return {"oral": _oral_dict(oral)}

# ── Stage 12 — Presentation Deck ─────────────────────────────────

@router.get("/{opp_id}/slides")
async def list_slides(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    slides = session.exec(
        select(PresentationSlide)
        .where(PresentationSlide.opportunity_id == opp_id)
        .order_by(PresentationSlide.slide_order)
    ).all()
    return {"slides": [_slide_dict(s) for s in slides], "total": len(slides)}

@router.post("/{opp_id}/slides/propose")
async def propose_slide_structure(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    """AI proposes a slide structure based on bid sections. Idempotent — won't overwrite existing slides."""
    existing = session.exec(
        select(PresentationSlide).where(PresentationSlide.opportunity_id == opp_id)
    ).all()
    if existing:
        return {"slides": [_slide_dict(s) for s in existing], "already_existed": True}

    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(404, "Opportunity not found")

    # Get approved bid sections to inform structure
    sections = session.exec(
        select(BidSection)
        .where(BidSection.opportunity_id == opp_id)
        .order_by(BidSection.section_order)
    ).all()

    # Build default structure
    default_structure = [
        {"title": "Welcome & Introduction",  "type": "cover",    "order": 1, "mins": 3},
        {"title": "Agenda",                  "type": "agenda",   "order": 2, "mins": 2},
        {"title": "Understanding the Requirement", "type": "section", "order": 3, "mins": 5},
        {"title": "Our Proposed Solution",   "type": "section",  "order": 4, "mins": 8},
        {"title": "Implementation Approach", "type": "section",  "order": 5, "mins": 7},
        {"title": "Team & Credentials",      "type": "section",  "order": 6, "mins": 5},
        {"title": "Commercial Summary",      "type": "section",  "order": 7, "mins": 5},
        {"title": "Why Us",                  "type": "section",  "order": 8, "mins": 3},
        {"title": "Q&A",                     "type": "qa",       "order": 9, "mins": 15},
        {"title": "Next Steps & Close",      "type": "close",   "order": 10, "mins": 2},
    ]

    # Try to use LLM for a tailored structure if configured
    if is_configured() and sections:
        try:
            section_titles = "\n".join([f"- {s.section_title}" for s in sections[:10]])
            prompt = f"""You are preparing an oral presentation structure for an RFP response.

Opportunity: {opp.name}
Client: {opp.client_name}
Available bid sections:
{section_titles}

Propose a presentation slide structure (8-12 slides) as a JSON array.
Each slide: {{"title": "string", "type": "cover|agenda|section|qa|close", "order": number, "mins": number}}
Return ONLY the JSON array, no other text."""

            raw = complete(prompt=prompt, system="Return only valid JSON.", max_tokens=600, temperature=0.3)
            raw = raw.strip().lstrip("```json").rstrip("```").strip()
            proposed = json.loads(raw)
            if isinstance(proposed, list) and len(proposed) >= 5:
                default_structure = proposed
        except Exception as e:
            logger.warning(f"AI slide proposal failed, using default: {e}")

    slides = []
    for item in default_structure:
        # Link to matching bid section by title similarity
        source_id = None
        if sections:
            for sec in sections:
                if any(word.lower() in sec.section_title.lower()
                       for word in item.get("title", "").split() if len(word) > 4):
                    source_id = sec.id
                    break

        slide = PresentationSlide(
            opportunity_id    = opp_id,
            slide_order       = item.get("order", len(slides) + 1),
            title             = item.get("title", "Untitled"),
            slide_type        = item.get("type", "section"),
            duration_minutes  = item.get("mins"),
            source_section_id = source_id,
            status            = "pending",
        )
        session.add(slide)
        slides.append(slide)

    session.commit()
    for s in slides:
        session.refresh(s)

    return {"slides": [_slide_dict(s) for s in slides], "total": len(slides)}

@router.post("/{opp_id}/slides")
async def add_slide(
    opp_id: str,
    data: SlideCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    slide = PresentationSlide(opportunity_id=opp_id, **data.model_dump())
    session.add(slide); session.commit(); session.refresh(slide)
    return _slide_dict(slide)

@router.patch("/{opp_id}/slides/{slide_id}")
async def update_slide(
    opp_id: str,
    slide_id: str,
    data: SlideUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    slide = session.get(PresentationSlide, slide_id)
    if not slide or slide.opportunity_id != opp_id:
        raise HTTPException(404, "Slide not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(slide, k, v)
    slide.updated_at = datetime.utcnow()
    session.add(slide); session.commit(); session.refresh(slide)
    return _slide_dict(slide)

@router.delete("/{opp_id}/slides/{slide_id}")
async def delete_slide(
    opp_id: str,
    slide_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    slide = session.get(PresentationSlide, slide_id)
    if not slide: raise HTTPException(404, "Slide not found")
    session.delete(slide); session.commit()
    return {"success": True}

@router.get("/{opp_id}/slides/{slide_id}/generate")
async def generate_slide_content(
    opp_id: str,
    slide_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """SSE — generate talking points for a single slide."""
    if not is_configured():
        raise HTTPException(400, "LLM not configured.")

    slide = session.get(PresentationSlide, slide_id)
    if not slide: raise HTTPException(404, "Slide not found")
    opp = session.get(Opportunity, opp_id)

    source_content = ""
    if slide.source_section_id:
        sec = session.get(BidSection, slide.source_section_id)
        if sec:
            source_content = (sec.edited_content or sec.generated_content or "")[:1000]

    async def stream():
        yield f"data: {json.dumps({'event': 'start', 'slide_id': slide_id})}\n\n"
        try:
            prompt = f"""Generate concise presentation talking points for a slide titled "{slide.title}".

Opportunity: {opp.name if opp else 'Unknown'}
Client: {opp.client_name if opp else 'Unknown'}
Slide type: {slide.slide_type}
{f'Source content:{chr(10)}{source_content}' if source_content else ''}

Write 4-6 bullet point talking points suitable for a {slide.duration_minutes or 5}-minute slide.
Format as markdown bullet points (- point).
Be specific, confident, and persuasive. Avoid generic statements."""

            content = complete(prompt=prompt, system="You are an expert presentation coach.", max_tokens=400, temperature=0.4)

            with Session(engine) as s:
                sl = s.get(PresentationSlide, slide_id)
                if sl:
                    sl.talking_points = content
                    sl.status = "generated"
                    sl.updated_at = datetime.utcnow()
                    s.add(sl); s.commit()

            yield f"data: {json.dumps({'event': 'done', 'slide_id': slide_id, 'talking_points': content})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@router.get("/{opp_id}/slides/generate-all/stream")
async def generate_all_slides_stream(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """SSE — generate talking points for all pending slides."""
    if not is_configured():
        raise HTTPException(400, "LLM not configured.")

    slides = session.exec(
        select(PresentationSlide)
        .where(PresentationSlide.opportunity_id == opp_id)
        .where(PresentationSlide.status == "pending")
        .order_by(PresentationSlide.slide_order)
    ).all()
    opp = session.get(Opportunity, opp_id)

    sections_map = {}
    sections = session.exec(select(BidSection).where(BidSection.opportunity_id == opp_id)).all()
    for sec in sections:
        sections_map[sec.id] = sec

    async def stream():
        total = len(slides)
        yield f"data: {json.dumps({'event': 'start', 'total': total})}\n\n"

        for i, slide in enumerate(slides, 1):
            yield f"data: {json.dumps({'event': 'generating', 'slide_id': slide.id, 'title': slide.title, 'index': i, 'total': total})}\n\n"

            source_content = ""
            if slide.source_section_id and slide.source_section_id in sections_map:
                sec = sections_map[slide.source_section_id]
                source_content = (sec.edited_content or sec.generated_content or "")[:800]

            try:
                prompt = f"""Generate concise presentation talking points for slide "{slide.title}".
Opportunity: {opp.name if opp else ''}  Client: {opp.client_name if opp else ''}
Slide type: {slide.slide_type}
{f'Source content:{chr(10)}{source_content}' if source_content else ''}
Write 4-6 bullet point talking points. Format as markdown bullets. Be specific and persuasive."""

                content = await asyncio.to_thread(
                    complete, prompt, "You are an expert presentation coach.", 400, 0.4
                )

                with Session(engine) as s:
                    sl = s.get(PresentationSlide, slide.id)
                    if sl:
                        sl.talking_points = content
                        sl.status = "generated"
                        sl.updated_at = datetime.utcnow()
                        s.add(sl); s.commit()

                yield f"data: {json.dumps({'event': 'slide_done', 'slide_id': slide.id, 'title': slide.title, 'index': i, 'total': total})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'event': 'slide_error', 'slide_id': slide.id, 'error': str(e)})}\n\n"

            await asyncio.sleep(0.1)

        yield f"data: {json.dumps({'event': 'complete', 'total': total})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# ── Stage 13 — Q&A Engine ─────────────────────────────────────────

@router.get("/{opp_id}/questions")
async def list_questions(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    questions = session.exec(
        select(AnticipatedQuestion)
        .where(AnticipatedQuestion.opportunity_id == opp_id)
        .order_by(AnticipatedQuestion.question_order)
    ).all()
    return {"questions": [_question_dict(q) for q in questions], "total": len(questions)}

@router.get("/{opp_id}/questions/generate/stream")
async def generate_questions_stream(
    opp_id: str,
    count: int = 20,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """SSE — generate anticipated questions. count configurable: 10, 20, or 30."""
    if not is_configured():
        raise HTTPException(400, "LLM not configured.")
    if count not in (10, 20, 30):
        count = 20

    opp = session.get(Opportunity, opp_id)
    if not opp: raise HTTPException(404, "Opportunity not found")

    sections = session.exec(
        select(BidSection).where(BidSection.opportunity_id == opp_id)
    ).all()
    section_summary = "\n".join([
        f"- {s.section_title}: {(s.edited_content or s.generated_content or '')[:200]}"
        for s in sections[:8]
    ])

    CATEGORIES = ["technical", "commercial", "governance", "risk", "team", "general"]
    per_cat = max(1, count // len(CATEGORIES))

    async def stream():
        yield f"data: {json.dumps({'event': 'start', 'count': count})}\n\n"
        total_added = 0

        for cat in CATEGORIES:
            if total_added >= count:
                break
            n = min(per_cat, count - total_added)
            yield f"data: {json.dumps({'event': 'generating_category', 'category': cat})}\n\n"

            try:
                prompt = f"""Generate {n} {cat} questions that evaluators are likely to ask during an oral presentation for this bid.

Opportunity: {opp.name}
Client: {opp.client_name}
Industry: {opp.industry_vertical}

Bid content summary:
{section_summary if section_summary else 'No bid sections available yet.'}

Return ONLY a JSON array of objects: [{{"question": "...", "difficulty": "easy|medium|hard", "model_answer": "2-3 sentence answer"}}]
Generate exactly {n} questions. No other text."""

                raw = await asyncio.to_thread(
                    complete, prompt, "Return only valid JSON arrays.", 1200, 0.5
                )
                raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
                items = json.loads(raw)

                with Session(engine) as s:
                    for j, item in enumerate(items[:n]):
                        q = AnticipatedQuestion(
                            opportunity_id = opp_id,
                            question       = item.get("question", ""),
                            category       = cat,
                            difficulty     = item.get("difficulty", "medium"),
                            model_answer   = item.get("model_answer", ""),
                            source         = "ai",
                            question_order = total_added + j,
                        )
                        s.add(q)
                    s.commit()

                total_added += len(items[:n])
                yield f"data: {json.dumps({'event': 'category_done', 'category': cat, 'added': len(items[:n])})}\n\n"

            except Exception as e:
                logger.error(f"Q gen failed for {cat}: {e}")
                yield f"data: {json.dumps({'event': 'category_error', 'category': cat, 'error': str(e)})}\n\n"

            await asyncio.sleep(0.1)

        yield f"data: {json.dumps({'event': 'complete', 'total': total_added})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@router.post("/{opp_id}/questions")
async def add_question(
    opp_id: str,
    data: QuestionCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    count = session.exec(
        select(AnticipatedQuestion).where(AnticipatedQuestion.opportunity_id == opp_id)
    ).all()
    q = AnticipatedQuestion(
        opportunity_id = opp_id,
        question       = data.question,
        category       = data.category,
        difficulty     = data.difficulty,
        source         = "manual",
        question_order = len(count),
    )
    session.add(q); session.commit(); session.refresh(q)
    return _question_dict(q)

@router.patch("/{opp_id}/questions/{question_id}")
async def update_question(
    opp_id: str,
    question_id: str,
    data: QuestionUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    q = session.get(AnticipatedQuestion, question_id)
    if not q: raise HTTPException(404, "Question not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(q, k, v)
    q.updated_at = datetime.utcnow()
    session.add(q); session.commit(); session.refresh(q)
    return _question_dict(q)

@router.delete("/{opp_id}/questions/{question_id}")
async def delete_question(
    opp_id: str,
    question_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    q = session.get(AnticipatedQuestion, question_id)
    if not q: raise HTTPException(404, "Question not found")
    session.delete(q); session.commit()
    return {"success": True}

# ── Stage 14 — Rehearsal Tracking ────────────────────────────────

@router.get("/{opp_id}/rehearsals")
async def list_rehearsals(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    rehearsals = session.exec(
        select(RehearsalSession)
        .where(RehearsalSession.opportunity_id == opp_id)
        .order_by(RehearsalSession.rehearsal_date.desc())
    ).all()
    return {"rehearsals": [_rehearsal_dict(r) for r in rehearsals], "total": len(rehearsals)}

@router.post("/{opp_id}/rehearsals")
async def add_rehearsal(
    opp_id: str,
    data: RehearsalCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    r = RehearsalSession(
        opportunity_id    = opp_id,
        rehearsal_date    = datetime.fromisoformat(data.rehearsal_date) if data.rehearsal_date else datetime.utcnow(),
        duration_minutes  = data.duration_minutes,
        attendee_names    = data.attendee_names,
        facilitator_name  = data.facilitator_name,
        feedback          = data.feedback,
        strengths         = data.strengths,
        improvements      = data.improvements,
        questions_covered = json.dumps(data.questions_covered or []),
        readiness_rating  = data.readiness_rating,
        created_by        = current_user.id,
    )
    session.add(r); session.commit(); session.refresh(r)

    # Mark questions as rehearsed
    if data.questions_covered:
        for qid in data.questions_covered:
            q = session.get(AnticipatedQuestion, qid)
            if q:
                q.rehearsed = True
                q.updated_at = datetime.utcnow()
                session.add(q)
        session.commit()

    # Recalculate readiness score on the oral session
    _update_readiness(opp_id, session)

    return _rehearsal_dict(r)

@router.delete("/{opp_id}/rehearsals/{rehearsal_id}")
async def delete_rehearsal(
    opp_id: str,
    rehearsal_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    r = session.get(RehearsalSession, rehearsal_id)
    if not r: raise HTTPException(404, "Rehearsal not found")
    session.delete(r); session.commit()
    return {"success": True}

# ── Stage 15 — Oral Delivery & Result ────────────────────────────

@router.post("/{opp_id}/result")
async def capture_oral_result(
    opp_id: str,
    data: OralResultCapture,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    oral = session.exec(select(OralSession).where(OralSession.opportunity_id == opp_id)).first()
    if not oral:
        raise HTTPException(404, "Oral session not set up")

    oral.result             = data.result
    oral.result_notes       = data.result_notes
    oral.delivery_notes     = data.delivery_notes
    oral.evaluator_feedback = data.evaluator_feedback
    oral.oral_status        = OralStatus.WON_AT_ORALS if data.result == "won_at_orals" else OralStatus.LOST_AT_ORALS
    if data.delivered_at:
        oral.delivered_at = datetime.fromisoformat(data.delivered_at)
    oral.updated_at = datetime.utcnow()
    session.add(oral)

    # Update opportunity status
    opp = session.get(Opportunity, opp_id)
    if opp:
        opp.oral_status = oral.oral_status
        opp.status = (
            OpportunityStatus.WON_DIRECT if data.result == "won_at_orals"
            else OpportunityStatus.LOST_AT_RFP
        )
        opp.updated_at = datetime.utcnow()
        session.add(opp)

    session.commit(); session.refresh(oral)

    # Build pre-filled lessons learned payload for frontend
    prefilled_lesson = {
        "bid_outcome":        "won"  if data.result == "won_at_orals" else "lost",
        "went_well":          data.delivery_notes or "",
        "went_poorly":        "",
        "do_differently":     "",
        "evaluator_feedback": data.evaluator_feedback or "",
        "flag_for_attention": True,
        "status":             "draft",
    }

    return {
        "oral":              _oral_dict(oral),
        "prompt_kb_loop":    True,
        "prefilled_lesson":  prefilled_lesson,
        "message":           f"Oral result captured: {data.result.replace('_', ' ')}",
    }

# ── Readiness score helper ────────────────────────────────────────

def _update_readiness(opp_id: str, session: Session):
    """Recalculate oral readiness score 0-100."""
    questions  = session.exec(select(AnticipatedQuestion).where(AnticipatedQuestion.opportunity_id == opp_id)).all()
    slides     = session.exec(select(PresentationSlide).where(PresentationSlide.opportunity_id == opp_id)).all()
    rehearsals = session.exec(select(RehearsalSession).where(RehearsalSession.opportunity_id == opp_id)).all()

    q_score  = (sum(1 for q in questions if q.rehearsed) / max(len(questions), 1)) * 40
    s_score  = (sum(1 for s in slides if s.status in ("generated", "edited")) / max(len(slides), 1)) * 30
    r_score  = min(30, len(rehearsals) * 10)
    readiness = round(q_score + s_score + r_score, 1)

    oral = session.exec(select(OralSession).where(OralSession.opportunity_id == opp_id)).first()
    if oral:
        oral.readiness_score = readiness
        oral.oral_status     = (
            OralStatus.READY if readiness >= 70
            else OralStatus.PREPARING
        )
        session.add(oral); session.commit()

# ── Stage 12: PPTX Export ─────────────────────────────────────────

@router.get("/{opp_id}/slides/export-pptx")
async def export_slides_pptx(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Generate PowerPoint from the oral presentation deck."""
    import io
    from fastapi.responses import StreamingResponse

    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(404, "Opportunity not found")

    slides = session.exec(
        select(PresentationSlide)
        .where(PresentationSlide.opportunity_id == opp_id)
        .order_by(PresentationSlide.slide_order)
    ).all()

    if not slides:
        raise HTTPException(400, "No slides to export. Create the presentation deck first.")

    try:
        pptx_bytes = _build_oral_pptx(opp, slides)
        filename   = f"{opp.name.replace(' ', '_')[:40]}_Oral_Presentation.pptx"
        return StreamingResponse(
            io.BytesIO(pptx_bytes),
            media_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers    = {"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ImportError:
        raise HTTPException(500, "python-pptx not installed. Run: pip install python-pptx")
    except Exception as e:
        logger.error(f"PPTX export failed: {e}", exc_info=True)
        raise HTTPException(500, f"Export failed: {str(e)}")

def _build_oral_pptx(opp: Opportunity, slides: list) -> bytes:
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
    import io as _io

    CLAY  = RGBColor(0xC8, 0xA8, 0x82)
    INK   = RGBColor(0x2C, 0x26, 0x20)
    SMOKE = RGBColor(0x88, 0x80, 0x78)
    WHITE = RGBColor(0xFF, 0xFF, 0xFF)
    SAND  = RGBColor(0xF5, 0xF0, 0xEB)

    prs = Presentation()
    prs.slide_width  = Inches(13.33)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]

    def _rect(slide, l, t, w, h, color):
        sh = slide.shapes.add_shape(1, Inches(l), Inches(t), Inches(w), Inches(h))
        sh.fill.solid(); sh.fill.fore_color.rgb = color; sh.line.fill.background()
        return sh

    def _text(slide, txt, l, t, w, h, size=18, bold=False, color=INK,
              align=PP_ALIGN.LEFT, italic=False):
        tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
        tf = tb.text_frame; tf.word_wrap = True
        p  = tf.paragraphs[0]; p.alignment = align
        r  = p.add_run(); r.text = txt
        r.font.size = Pt(size); r.font.bold = bold
        r.font.italic = italic; r.font.color.rgb = color
        return tb

    # ── Cover slide ───────────────────────────────────────────────
    s = prs.slides.add_slide(blank)
    _rect(s, 0, 0, 13.33, 7.5, SAND)
    _rect(s, 0, 0, 13.33, 1.3, CLAY)
    _text(s, "Oral Presentation", 0.5, 0.3, 12, 0.7, 26, True, WHITE)
    _text(s, opp.name, 0.5, 1.8, 12.33, 1.4, 34, True, INK, PP_ALIGN.CENTER)
    _text(s, f"Prepared for: {opp.client_name}", 0.5, 3.4, 12.33, 0.6, 18, False, SMOKE, PP_ALIGN.CENTER)
    from datetime import datetime as _dt
    _text(s, _dt.utcnow().strftime("%B %Y"), 0.5, 6.5, 12.33, 0.6, 14, False, SMOKE, PP_ALIGN.CENTER)

    # ── One slide per deck slide ──────────────────────────────────
    for slide_data in slides:
        s = prs.slides.add_slide(blank)
        # Colour by slide type
        header_color = {
            "cover": CLAY, "agenda": INK, "section": CLAY,
            "qa": RGBColor(0x64, 0x5C, 0x52), "close": CLAY
        }.get(slide_data.slide_type or "section", CLAY)

        _rect(s, 0, 0, 13.33, 1.2, header_color)
        _text(s, slide_data.title, 0.4, 0.25, 11, 0.7, 24, True, WHITE)

        if slide_data.duration_minutes:
            _text(s, f"{slide_data.duration_minutes} min", 11.5, 0.35, 1.5, 0.5, 13, False, WHITE, PP_ALIGN.RIGHT)

        # Talking points
        if slide_data.talking_points:
            lines = [l.strip() for l in slide_data.talking_points.split("\n") if l.strip()]
            body  = "\n".join(lines[:10])
            _text(s, body, 0.5, 1.4, 12.33, 5.5, 15, False, INK)
        else:
            _text(s, "[No talking points yet — generate from the deck builder]",
                  0.5, 1.4, 12.33, 1.0, 14, False, SMOKE, italic=True)

        # Speaker notes
        if slide_data.speaker_notes:
            notes_slide = s.notes_slide
            notes_tf    = notes_slide.notes_text_frame
            notes_tf.text = slide_data.speaker_notes

    # ── Close slide ───────────────────────────────────────────────
    s = prs.slides.add_slide(blank)
    _rect(s, 0, 0, 13.33, 7.5, CLAY)
    _text(s, "Questions?", 0.5, 2.5, 12.33, 1.5, 48, True, WHITE, PP_ALIGN.CENTER)
    _text(s, opp.client_name, 0.5, 4.3, 12.33, 0.8, 22, False, WHITE, PP_ALIGN.CENTER)

    buf = _io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
