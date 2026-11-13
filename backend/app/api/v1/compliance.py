"""
Stage 7 — Pre-Export Compliance Check
Runs automated checks before allowing export.
"""
import logging
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from app.database import get_session
from app.models import BidSection, Requirement, ComplianceCheck, ReviewStatus, GenerationStatus, User
from app.core.auth import get_current_user

router = APIRouter(prefix="/compliance", tags=["compliance"])
logger = logging.getLogger(__name__)

@router.post("/{opp_id}/run")
async def run_compliance(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Run all pre-export compliance checks. Returns detailed results."""
    sections = session.exec(
        select(BidSection).where(BidSection.opportunity_id == opp_id)
    ).all()
    requirements = session.exec(
        select(Requirement).where(Requirement.opportunity_id == opp_id)
    ).all()

    if not sections:
        raise HTTPException(400, "No sections generated yet. Run generation first.")

    # Clear previous checks
    old = session.exec(
        select(ComplianceCheck).where(ComplianceCheck.opportunity_id == opp_id)
    ).all()
    for c in old:
        session.delete(c)
    session.flush()

    checks = []

    # ── Check 1: All sections generated ──────────────────────────
    failed_gen = [s for s in sections if s.generation_status == GenerationStatus.FAILED]
    pending_gen = [s for s in sections if s.generation_status == GenerationStatus.PENDING]
    c = ComplianceCheck(
        opportunity_id = opp_id,
        check_name     = "All sections generated",
        check_category = "coverage",
        status         = "fail" if failed_gen else ("warn" if pending_gen else "pass"),
        detail         = (
            f"{len(failed_gen)} section(s) failed generation: {', '.join(s.section_title for s in failed_gen[:3])}" if failed_gen
            else f"{len(pending_gen)} section(s) not yet generated" if pending_gen
            else f"All {len(sections)} sections generated successfully"
        ),
        auto_fixable   = False,
    )
    session.add(c); checks.append(c)

    # ── Check 2: Review completeness ─────────────────────────────
    not_reviewed = [s for s in sections if s.review_status not in (
        ReviewStatus.APPROVED, ReviewStatus.REWRITTEN
    )]
    assigned_not_done = [s for s in sections if s.reviewer_id and
                         s.review_status not in (ReviewStatus.APPROVED, ReviewStatus.REWRITTEN)]
    c = ComplianceCheck(
        opportunity_id = opp_id,
        check_name     = "All sections reviewed",
        check_category = "review",
        status         = "fail" if len(not_reviewed) > len(sections) * 0.5 else
                         "warn" if not_reviewed else "pass",
        detail         = (
            f"{len(not_reviewed)} section(s) not yet approved: {', '.join(s.section_title for s in not_reviewed[:3])}"
            if not_reviewed else "All sections reviewed and approved"
        ),
        auto_fixable   = False,
    )
    session.add(c); checks.append(c)

    # ── Check 3: Changes requested outstanding ───────────────────
    changes_req = [s for s in sections if s.review_status == ReviewStatus.CHANGES_REQUESTED]
    c = ComplianceCheck(
        opportunity_id = opp_id,
        check_name     = "No outstanding change requests",
        check_category = "review",
        status         = "fail" if changes_req else "pass",
        detail         = (
            f"{len(changes_req)} section(s) have unresolved change requests: {', '.join(s.section_title for s in changes_req[:3])}"
            if changes_req else "No outstanding change requests"
        ),
        auto_fixable   = False,
    )
    session.add(c); checks.append(c)

    # ── Check 4: Confidence threshold ────────────────────────────
    low_conf = [s for s in sections if s.confidence_overall and s.confidence_overall < 50]
    c = ComplianceCheck(
        opportunity_id = opp_id,
        check_name     = "Confidence scores acceptable",
        check_category = "content",
        status         = "fail" if low_conf else "pass",
        detail         = (
            f"{len(low_conf)} section(s) have low confidence (<50): {', '.join(s.section_title for s in low_conf[:3])}"
            if low_conf else "All sections meet confidence threshold"
        ),
        auto_fixable   = False,
    )
    session.add(c); checks.append(c)

    # ── Check 5: Mandatory requirements addressed ─────────────────
    mandatory_reqs = [r for r in requirements if r.is_mandatory]
    req_ids_with_section = {s.requirement_id for s in sections if s.requirement_id}
    unaddressed = [r for r in mandatory_reqs if r.id not in req_ids_with_section]
    c = ComplianceCheck(
        opportunity_id = opp_id,
        check_name     = "Mandatory requirements addressed",
        check_category = "coverage",
        status         = "fail" if unaddressed else "pass" if mandatory_reqs else "warn",
        detail         = (
            f"{len(unaddressed)} mandatory requirement(s) not addressed: {', '.join(r.req_id or r.id[:8] for r in unaddressed[:3])}"
            if unaddressed else
            f"All {len(mandatory_reqs)} mandatory requirements addressed" if mandatory_reqs
            else "No requirements extracted — cannot verify coverage"
        ),
        auto_fixable   = False,
    )
    session.add(c); checks.append(c)

    # ── Check 6: Minimum word count ───────────────────────────────
    short_sections = [s for s in sections if s.word_count and s.word_count < 50]
    empty_sections = [s for s in sections if not (s.generated_content or s.edited_content)]
    c = ComplianceCheck(
        opportunity_id = opp_id,
        check_name     = "Section word counts acceptable",
        check_category = "format",
        status         = "fail" if empty_sections else "warn" if short_sections else "pass",
        detail         = (
            f"{len(empty_sections)} empty section(s)" if empty_sections
            else f"{len(short_sections)} very short section(s) (<50 words)" if short_sections
            else f"All sections have adequate content"
        ),
        auto_fixable   = False,
    )
    session.add(c); checks.append(c)

    session.commit()

    results = [_check_dict(c) for c in checks]
    overall = (
        "fail" if any(c["status"] == "fail" for c in results)
        else "warn" if any(c["status"] == "warn" for c in results)
        else "pass"
    )
    return {
        "overall":      overall,
        "checks":       results,
        "can_export":   overall in ("pass", "warn"),
        "ran_at":       datetime.utcnow().isoformat(),
    }

@router.get("/{opp_id}/results")
async def get_compliance_results(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    checks = session.exec(
        select(ComplianceCheck)
        .where(ComplianceCheck.opportunity_id == opp_id)
        .order_by(ComplianceCheck.ran_at.desc())
    ).all()
    if not checks:
        return {"checks": [], "overall": None, "message": "Compliance checks not yet run"}

    results = [_check_dict(c) for c in checks]
    overall = (
        "fail" if any(c["status"] == "fail" for c in results)
        else "warn" if any(c["status"] == "warn" for c in results)
        else "pass"
    )
    return {
        "overall":    overall,
        "checks":     results,
        "can_export": overall in ("pass", "warn"),
    }

def _check_dict(c: ComplianceCheck) -> dict:
    return {
        "id":            c.id,
        "check_name":    c.check_name,
        "check_category": c.check_category,
        "status":        c.status,
        "detail":        c.detail,
        "auto_fixable":  c.auto_fixable,
    }
