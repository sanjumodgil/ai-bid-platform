"""
Stage 4 — RFP Content Generation
Stage 5 — Confidence Triage

Section-by-section generation with SSE streaming.
Each section is generated independently so the UI updates live.
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
    BidSection, Opportunity, Requirement, DocumentChunk,
    GenerationStatus, ReviewStatus, User, ActivityLog
)
from app.core.auth import get_current_user, require_bid_lead
from app.core.llm import LLMNotConfiguredError

router = APIRouter(prefix="/generation", tags=["generation"])
logger = logging.getLogger(__name__)

# ── Section structure ─────────────────────────────────────────────

SECTION_TEMPLATES = [
    {"title": "Executive Summary",       "type": "executive",   "order": 1},
    {"title": "Understanding of Requirements", "type": "technical", "order": 2},
    {"title": "Technical Approach",      "type": "technical",   "order": 3},
    {"title": "Solution Architecture",   "type": "technical",   "order": 4},
    {"title": "Implementation Plan",     "type": "technical",   "order": 5},
    {"title": "Team & Credentials",      "type": "commercial",  "order": 6},
    {"title": "Relevant Experience",     "type": "commercial",  "order": 7},
    {"title": "Pricing & Commercial",    "type": "commercial",  "order": 8},
    {"title": "Risk & Mitigation",       "type": "legal",       "order": 9},
    {"title": "Compliance Statement",    "type": "legal",       "order": 10},
]

# ── Helpers ───────────────────────────────────────────────────────

def _retrieve_kb_context(opportunity_id: str, query: str, n: int = 5) -> list[dict]:
    """Retrieve relevant KB chunks for a given query."""
    try:
        from app.core.embeddings import get_embedding_model
        from app.core.vector_store import get_or_create_vector_store
        model  = get_embedding_model()
        store  = get_or_create_vector_store()
        emb    = model.embed_single(query)
        raw    = store.query(emb, n_results=n * 2)
        chunks = []
        seen   = set()
        for r in raw.get("results", []):
            cid = r.get("id")
            if cid in seen: continue
            seen.add(cid)
            chunks.append({
                "id":   cid,
                "text": r.get("text", "")[:600],
                "doc":  r.get("metadata", {}).get("document_id", ""),
            })
            if len(chunks) >= n: break
        return chunks
    except Exception as e:
        logger.warning(f"KB retrieval failed: {e}")
        return []

def _score_confidence_rules(content: str, req_desc: str, kb_chunks: list) -> dict:
    """Rule-based fallback — used when LLM is not configured."""
    words         = len(content.split())
    req_words     = set(req_desc.lower().split()) if req_desc else set()
    content_words = set(content.lower().split())
    keyword_overlap = len(req_words & content_words) / max(len(req_words), 1)

    completeness = min(100, words / 3)
    relevance    = min(100, keyword_overlap * 200)
    tone         = 85 if words > 100 else 60
    risk         = 90 if not any(w in content.lower() for w in
                    ["cannot", "unable", "not possible", "limitation"]) else 50

    overall = round((completeness * 0.3 + relevance * 0.3 + tone * 0.2 + risk * 0.2), 1)
    return {
        "overall":      overall,
        "completeness": round(completeness, 1),
        "relevance":    round(relevance, 1),
        "tone":         round(tone, 1),
        "risk":         round(risk, 1),
        "method":       "rule-based",
    }


def _score_confidence_llm(content: str, req_desc: str, section_title: str,
                           opportunity_name: str, client_name: str) -> dict:
    """
    LLM-based confidence scoring.
    Makes a single structured evaluation call — returns scores + rationale.
    Falls back to rule-based if the LLM call fails or returns unparseable output.
    """
    import json as _json
    from app.core.llm import complete

    prompt = f"""You are an expert bid evaluator assessing the quality of an RFP response section.

OPPORTUNITY: {opportunity_name}
CLIENT: {client_name}
SECTION: {section_title}
REQUIREMENT: {req_desc or 'No specific requirement — general section'}

GENERATED CONTENT:
{content[:1500]}

Score this section on four dimensions, each 0–100:

1. COMPLETENESS — Does it fully address the requirement? Does it cover all key points expected?
2. RELEVANCE — Is it specifically tailored to this client and opportunity, or generic?
3. TONE — Is the writing professional, confident, and appropriate for a formal tender?
4. RISK — Does it avoid weak/limiting language? Does it present risk positively?

Respond ONLY with a JSON object, no other text:
{{
  "completeness": <0-100>,
  "relevance": <0-100>,
  "tone": <0-100>,
  "risk": <0-100>,
  "completeness_reason": "<one sentence>",
  "relevance_reason": "<one sentence>",
  "tone_reason": "<one sentence>",
  "risk_reason": "<one sentence>"
}}"""

    try:
        raw = complete(
            prompt  = prompt,
            system  = "You are a bid quality evaluator. Return only valid JSON, no markdown.",
            max_tokens = 300,
            temperature = 0.1,
        )
        raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        data = _json.loads(raw)

        completeness = max(0, min(100, float(data.get("completeness", 50))))
        relevance    = max(0, min(100, float(data.get("relevance",    50))))
        tone         = max(0, min(100, float(data.get("tone",         50))))
        risk         = max(0, min(100, float(data.get("risk",         50))))
        overall      = round(completeness * 0.3 + relevance * 0.3 + tone * 0.2 + risk * 0.2, 1)

        return {
            "overall":              overall,
            "completeness":         round(completeness, 1),
            "relevance":            round(relevance, 1),
            "tone":                 round(tone, 1),
            "risk":                 round(risk, 1),
            "completeness_reason":  data.get("completeness_reason", ""),
            "relevance_reason":     data.get("relevance_reason", ""),
            "tone_reason":          data.get("tone_reason", ""),
            "risk_reason":          data.get("risk_reason", ""),
            "method":               "llm",
        }
    except Exception as e:
        logger.warning(f"LLM confidence scoring failed ({e}), falling back to rule-based")
        return None


def _score_confidence(content: str, req_desc: str, kb_chunks: list,
                      section_title: str = "", opportunity_name: str = "",
                      client_name: str = "") -> dict:
    """
    Score confidence across 4 dimensions.
    Uses LLM evaluation if LLM is configured, rule-based otherwise.
    LLM fallback: if LLM call fails, rule-based is used automatically.
    """
    from app.core.llm import is_configured
    if is_configured():
        result = _score_confidence_llm(
            content, req_desc, section_title, opportunity_name, client_name
        )
        if result is not None:
            return result
    return _score_confidence_rules(content, req_desc, kb_chunks)


async def _generate_section(
    opp: Opportunity,
    section: BidSection,
    requirements: list,
    session: Session,
) -> BidSection:
    """Generate content for a single section using LLM + KB context."""
    from app.core.llm import complete, LLMNotConfiguredError

    req_text = ""
    if section.requirement_id:
        req = next((r for r in requirements if r.id == section.requirement_id), None)
        if req:
            req_text = req.description

    # Build context query
    query = f"{section.section_title} {opp.name} {opp.client_name} {req_text}"
    kb_chunks = _retrieve_kb_context(opp.id, query, n=5)
    kb_context = "\n\n".join([f"[Source {i+1}]: {c['text']}" for i, c in enumerate(kb_chunks)])

    # Build requirements context
    all_reqs = "\n".join([f"- {r.req_id or 'REQ'}: {r.description}" for r in requirements[:20]])

    prompt = f"""You are an expert bid writer preparing an RFP response for {opp.client_name}.

OPPORTUNITY: {opp.name}
INDUSTRY: {opp.industry_vertical}
SECTION: {section.section_title}
{f'SPECIFIC REQUIREMENT: {req_text}' if req_text else ''}

KEY REQUIREMENTS TO ADDRESS:
{all_reqs if all_reqs else 'No specific requirements extracted yet.'}

RELEVANT KNOWLEDGE BASE CONTEXT:
{kb_context if kb_context else 'No matching past proposals found in KB.'}

Write a compelling, professional response for the "{section.section_title}" section of this RFP response.
- Be specific to {opp.client_name} and the opportunity described
- Reference relevant experience and evidence from the KB context where appropriate
- Use a professional, confident tone appropriate for a formal tender response
- Aim for 200-400 words
- Use markdown formatting with clear structure (bold headings, bullet points where appropriate)
- Do not include placeholder text like [INSERT NAME] — write actual content
"""

    try:
        content = complete(
            prompt=prompt,
            system="You are an expert bid writer. Write compelling, specific, evidence-based tender responses.",
            max_tokens=800,
            temperature=0.4,
        )
        scores = _score_confidence(
            content,
            req_text,
            kb_chunks,
            section_title    = section.section_title,
            opportunity_name = opp.name,
            client_name      = opp.client_name,
        )
        section.generated_content     = content
        section.word_count            = len(content.split())
        section.kb_sources            = json.dumps([c["id"] for c in kb_chunks])
        section.confidence_overall    = scores["overall"]
        section.confidence_complete   = scores["completeness"]
        section.confidence_relevance  = scores["relevance"]
        section.confidence_tone       = scores["tone"]
        section.confidence_risk       = scores["risk"]
        # Store rationale as JSON in prompt_used field if LLM-scored
        if scores.get("method") == "llm":
            rationale = {
                "method":               "llm",
                "completeness_reason":  scores.get("completeness_reason", ""),
                "relevance_reason":     scores.get("relevance_reason", ""),
                "tone_reason":          scores.get("tone_reason", ""),
                "risk_reason":          scores.get("risk_reason", ""),
            }
            section.prompt_used = json.dumps(rationale)
        else:
            section.prompt_used = json.dumps({"method": "rule-based"})
        section.generation_status = GenerationStatus.COMPLETED
        section.review_status     = ReviewStatus.PENDING
        section.updated_at        = datetime.utcnow()
    except LLMNotConfiguredError as e:
        section.generation_status = GenerationStatus.FAILED
        section.generation_error  = str(e)
    except Exception as e:
        logger.error(f"Generation failed for section {section.id}: {e}")
        section.generation_status = GenerationStatus.FAILED
        section.generation_error  = str(e)[:300]

    session.add(section)
    session.commit()
    session.refresh(section)
    return section

# ── API endpoints ─────────────────────────────────────────────────

@router.post("/{opp_id}/initialise")
async def initialise_sections(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    """
    Create BidSection rows for this opportunity (one per template + one per requirement).
    Idempotent — safe to call multiple times.
    """
    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(404, "Opportunity not found")

    # Check if already initialised
    existing = session.exec(
        select(BidSection).where(BidSection.opportunity_id == opp_id)
    ).all()
    if existing:
        return {"sections": [_section_dict(s) for s in existing], "already_existed": True}

    # Requirements-based sections
    reqs = session.exec(
        select(Requirement).where(Requirement.opportunity_id == opp_id)
    ).all()

    sections = []
    # Standard template sections
    for tmpl in SECTION_TEMPLATES:
        s = BidSection(
            opportunity_id = opp_id,
            section_title  = tmpl["title"],
            section_type   = tmpl["type"],
            section_order  = tmpl["order"],
        )
        session.add(s)
        sections.append(s)

    # Requirement-specific sections (if requirements were extracted)
    for i, req in enumerate(reqs[:30], start=len(SECTION_TEMPLATES)+1):
        s = BidSection(
            opportunity_id  = opp_id,
            requirement_id  = req.id,
            section_title   = f"{req.req_id or f'REQ-{i:03d}'}: {req.description[:60]}",
            section_type    = "technical",
            section_order   = i,
        )
        session.add(s)
        sections.append(s)

    session.commit()
    for s in sections:
        session.refresh(s)

    return {"sections": [_section_dict(s) for s in sections], "total": len(sections)}

@router.get("/{opp_id}/sections")
async def list_sections(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    sections = session.exec(
        select(BidSection)
        .where(BidSection.opportunity_id == opp_id)
        .order_by(BidSection.section_order)
    ).all()
    return {"sections": [_section_dict(s) for s in sections], "total": len(sections)}

@router.get("/{opp_id}/stream")
async def stream_generation(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    SSE endpoint — generates sections one by one and streams progress events.
    Client receives JSON events for each section as it completes.
    """
    from app.core.llm import is_configured
    if not is_configured():
        raise HTTPException(400, detail=(
            "LLM not configured. Go to Settings → AI Configuration to add a provider."
        ))

    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(404, "Opportunity not found")

    sections = session.exec(
        select(BidSection)
        .where(BidSection.opportunity_id == opp_id)
        .where(BidSection.generation_status == GenerationStatus.PENDING)
        .order_by(BidSection.section_order)
    ).all()

    requirements = session.exec(
        select(Requirement).where(Requirement.opportunity_id == opp_id)
    ).all()

    if not sections:
        raise HTTPException(400, "No pending sections. Run initialise first.")

    async def event_stream() -> AsyncGenerator[str, None]:
        total = len(sections)
        yield f"data: {json.dumps({'event': 'start', 'total': total})}\n\n"

        for i, sec in enumerate(sections, 1):
            # Mark as generating
            with Session(engine) as s:
                sec_live = s.get(BidSection, sec.id)
                if not sec_live: continue
                sec_live.generation_status = GenerationStatus.GENERATING
                s.add(sec_live)
                s.commit()

            yield f"data: {json.dumps({'event': 'generating', 'section_id': sec.id, 'title': sec.section_title, 'index': i, 'total': total})}\n\n"

            # Generate in a thread so we don't block the event loop
            with Session(engine) as gen_session:
                opp_fresh   = gen_session.get(Opportunity, opp_id)
                sec_fresh   = gen_session.get(BidSection, sec.id)
                reqs_fresh  = gen_session.exec(
                    select(Requirement).where(Requirement.opportunity_id == opp_id)
                ).all()
                result = await asyncio.to_thread(
                    _generate_section_sync,
                    opp_fresh, sec_fresh, reqs_fresh, gen_session
                )

            yield f"data: {json.dumps({'event': 'section_done', 'section': _section_dict(result), 'index': i, 'total': total})}\n\n"
            await asyncio.sleep(0.1)  # brief pause to avoid overwhelming clients

        # Log activity
        with Session(engine) as s:
            log = ActivityLog(
                opportunity_id = opp_id,
                user_id        = current_user.id,
                user_name      = current_user.full_name,
                action         = "generation_completed",
                detail         = f"Generated {total} sections",
            )
            s.add(log)
            s.commit()

        yield f"data: {json.dumps({'event': 'complete', 'total': total})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )

@router.post("/{opp_id}/regenerate/{section_id}")
async def regenerate_section(
    opp_id: str,
    section_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    """Regenerate a single section."""
    from app.core.llm import is_configured
    if not is_configured():
        raise HTTPException(400, "LLM not configured.")

    sec = session.get(BidSection, section_id)
    if not sec or sec.opportunity_id != opp_id:
        raise HTTPException(404, "Section not found")

    opp  = session.get(Opportunity, opp_id)
    reqs = session.exec(select(Requirement).where(Requirement.opportunity_id == opp_id)).all()

    sec.generation_status = GenerationStatus.PENDING
    sec.generated_content = None
    result = await asyncio.to_thread(_generate_section_sync, opp, sec, reqs, session)
    return _section_dict(result)

# ── Sync wrapper for asyncio.to_thread ───────────────────────────

def _generate_section_sync(opp, section, requirements, session):
    """Sync wrapper — runs in thread pool via asyncio.to_thread."""
    import asyncio
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(_generate_section(opp, section, requirements, session))
    finally:
        loop.close()

# ── Section dict helper ───────────────────────────────────────────

def _section_dict(s: BidSection) -> dict:
    return {
        "id":                   s.id,
        "opportunity_id":       s.opportunity_id,
        "requirement_id":       s.requirement_id,
        "section_title":        s.section_title,
        "section_type":         s.section_type,
        "section_order":        s.section_order,
        "generated_content":    s.generated_content,
        "edited_content":       s.edited_content,
        "kb_sources":           json.loads(s.kb_sources) if s.kb_sources else [],
        "confidence_overall":   s.confidence_overall,
        "confidence_complete":  s.confidence_complete,
        "confidence_relevance": s.confidence_relevance,
        "confidence_tone":      s.confidence_tone,
        "confidence_risk":      s.confidence_risk,
        "generation_status":    s.generation_status,
        "review_status":        s.review_status,
        "generation_error":     s.generation_error,
        "reviewer_id":          s.reviewer_id,
        "reviewer_name":        s.reviewer_name,
        "word_count":           s.word_count,
        "created_at":           s.created_at.isoformat(),
        "updated_at":           s.updated_at.isoformat(),
    }
