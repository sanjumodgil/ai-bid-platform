"""
Stage 8 — RFP Export
Generate Word (.docx) document from approved bid sections.
Supports default template and custom uploaded template.
"""
import io
import os
import json
import logging
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
from app.database import get_session
from app.models import BidSection, Opportunity, Submission, User, GenerationStatus
from app.core.auth import get_current_user, require_bid_lead

router = APIRouter(prefix="/export", tags=["export"])
logger = logging.getLogger(__name__)

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "export_templates")
os.makedirs(TEMPLATE_DIR, exist_ok=True)

@router.get("/{opp_id}/preview")
async def preview_export(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Returns a summary of what will be in the export."""
    sections = session.exec(
        select(BidSection)
        .where(BidSection.opportunity_id == opp_id)
        .where(BidSection.generation_status == GenerationStatus.COMPLETED)
        .order_by(BidSection.section_order)
    ).all()
    if not sections:
        raise HTTPException(400, "No completed sections to export.")

    total_words = sum(s.word_count or 0 for s in sections)
    return {
        "section_count": len(sections),
        "total_words":   total_words,
        "sections":      [{"title": s.section_title, "words": s.word_count or 0,
                           "review_status": s.review_status} for s in sections],
        "has_custom_template": os.path.exists(os.path.join(TEMPLATE_DIR, f"{opp_id}.docx")),
    }

@router.post("/{opp_id}/template")
async def upload_template(
    opp_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    """Upload a custom .docx template for this opportunity."""
    if not file.filename.endswith(".docx"):
        raise HTTPException(400, "Template must be a .docx file")
    content = await file.read()
    path = os.path.join(TEMPLATE_DIR, f"{opp_id}.docx")
    with open(path, "wb") as f:
        f.write(content)
    logger.info(f"Custom template uploaded for opportunity {opp_id} by {current_user.email}")
    return {"success": True, "message": "Template uploaded successfully."}

@router.delete("/{opp_id}/template")
async def delete_template(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_bid_lead),
):
    path = os.path.join(TEMPLATE_DIR, f"{opp_id}.docx")
    if os.path.exists(path):
        os.remove(path)
    return {"success": True, "message": "Custom template removed. Default template will be used."}

@router.get("/{opp_id}/download")
async def download_export(
    opp_id: str,
    include_sources: bool = True,
    approved_only: bool = False,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Generate and download the Word document."""
    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(404, "Opportunity not found")

    q = (
        select(BidSection)
        .where(BidSection.opportunity_id == opp_id)
        .where(BidSection.generation_status == GenerationStatus.COMPLETED)
        .order_by(BidSection.section_order)
    )
    if approved_only:
        from app.models import ReviewStatus
        q = q.where(BidSection.review_status == ReviewStatus.APPROVED)

    sections = session.exec(q).all()
    if not sections:
        raise HTTPException(400, "No completed sections to export.")

    docx_bytes = _build_docx(opp, sections, include_sources, opp_id)

    filename = f"{opp.name.replace(' ', '_')[:40]}_RFP_Response.docx"
    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

def _build_docx(opp: Opportunity, sections: list, include_sources: bool, opp_id: str) -> bytes:
    """Build Word document — uses template if uploaded, default otherwise."""
    from app.core.docx_export import build_docx
    custom_template = os.path.join(TEMPLATE_DIR, f"{opp_id}.docx")
    template_path   = custom_template if os.path.exists(custom_template) else None
    return build_docx(opp, sections, include_sources, template_path)


# ── PPTX Export — RFP Executive Summary ──────────────────────────

@router.get("/template-guide")
async def template_guide():
    """
    Returns the list of bookmark names to add to a custom .docx template.
    Teams create these bookmarks in Word (Insert → Bookmark) to control
    where the platform injects content.
    """
    return {
        "instructions": (
            "Add Word bookmarks (Insert → Bookmark) at the positions where you want "
            "content injected. The platform scans for these names automatically."
        ),
        "bookmarks": {
            "cover_fields": {
                "BID_TITLE":      "Replaced with the opportunity name",
                "BID_CLIENT":     "Replaced with the client name",
                "BID_DATE":       "Replaced with export date (DD Month YYYY)",
                "BID_REFERENCE":  "Replaced with procurement reference",
                "BID_INDUSTRY":   "Replaced with industry vertical",
            },
            "toc": {
                "TOC_PLACEHOLDER": "Replaced with a list of section titles",
            },
            "sections": {
                "SECTION_1 … SECTION_n": (
                    "Replaced with the full generated content for that section. "
                    "The section heading is inserted automatically above."
                ),
                "SECTION_1_TITLE … SECTION_n_TITLE": (
                    "Replaced with just the section title (for custom heading styles)."
                ),
            },
        },
        "fallback": (
            "If no BID_* or SECTION_* bookmarks are found, the platform appends "
            "all sections after the template body, preserving your branding and styles."
        ),
    }
async def download_pptx(
    opp_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Generate a PowerPoint summary of the RFP response."""
    opp = session.get(Opportunity, opp_id)
    if not opp:
        raise HTTPException(404, "Opportunity not found")

    sections = session.exec(
        select(BidSection)
        .where(BidSection.opportunity_id == opp_id)
        .where(BidSection.generation_status == GenerationStatus.COMPLETED)
        .order_by(BidSection.section_order)
    ).all()

    try:
        pptx_bytes = _build_rfp_pptx(opp, sections)
        filename   = f"{opp.name.replace(' ', '_')[:40]}_RFP_Summary.pptx"
        return StreamingResponse(
            io.BytesIO(pptx_bytes),
            media_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers    = {"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ImportError:
        raise HTTPException(500, "python-pptx not installed. Run: pip install python-pptx")

def _build_rfp_pptx(opp: Opportunity, sections: list) -> bytes:
    from pptx import Presentation
    from pptx.util import Inches, Pt, Emu
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
    import io as _io

    CLAY   = RGBColor(0xC8, 0xA8, 0x82)
    INK    = RGBColor(0x2C, 0x26, 0x20)
    SMOKE  = RGBColor(0x88, 0x80, 0x78)
    WHITE  = RGBColor(0xFF, 0xFF, 0xFF)

    prs = Presentation()
    prs.slide_width  = Inches(13.33)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]   # blank layout

    def _add_text(slide, text, left, top, width, height,
                  size=18, bold=False, color=INK, align=PP_ALIGN.LEFT, wrap=True):
        txBox = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
        tf    = txBox.text_frame
        tf.word_wrap = wrap
        p = tf.paragraphs[0]
        p.alignment = align
        run = p.add_run()
        run.text = text
        run.font.size  = Pt(size)
        run.font.bold  = bold
        run.font.color.rgb = color
        return txBox

    def _add_rect(slide, left, top, width, height, fill_color):
        shape = slide.shapes.add_shape(
            1,  # MSO_SHAPE_TYPE.RECTANGLE
            Inches(left), Inches(top), Inches(width), Inches(height)
        )
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill_color
        shape.line.fill.background()
        return shape

    # ── Slide 1: Cover ────────────────────────────────────────────
    slide = prs.slides.add_slide(blank)
    _add_rect(slide, 0, 0, 13.33, 7.5, RGBColor(0xF5, 0xF0, 0xEB))
    _add_rect(slide, 0, 0, 13.33, 1.2, CLAY)
    _add_text(slide, "RFP Response", 0.5, 0.25, 12, 0.7,
              size=28, bold=True, color=WHITE, align=PP_ALIGN.LEFT)
    _add_text(slide, opp.name, 0.5, 1.6, 12, 1.2,
              size=32, bold=True, color=INK)
    _add_text(slide, f"Prepared for: {opp.client_name}", 0.5, 3.0, 12, 0.5,
              size=18, color=SMOKE)
    if opp.industry_vertical:
        _add_text(slide, f"Industry: {opp.industry_vertical.replace('_', ' ').title()}", 0.5, 3.6, 12, 0.5,
                  size=16, color=SMOKE)
    from datetime import datetime as _dt
    _add_text(slide, _dt.utcnow().strftime("%B %Y"), 0.5, 6.5, 12, 0.6,
              size=14, color=SMOKE)

    # ── Slides per section ────────────────────────────────────────
    for s in sections[:20]:
        slide = prs.slides.add_slide(blank)
        _add_rect(slide, 0, 0, 13.33, 1.1, CLAY)
        _add_text(slide, s.section_title, 0.4, 0.2, 12.5, 0.7,
                  size=22, bold=True, color=WHITE)
        if s.confidence_overall:
            conf_color = RGBColor(0x4C, 0xAF, 0x50) if s.confidence_overall >= 70 else RGBColor(0xFF, 0x98, 0x00)
            _add_text(slide, f"Confidence: {s.confidence_overall:.0f}%", 10.5, 0.3, 2.5, 0.5,
                      size=12, color=conf_color, align=PP_ALIGN.RIGHT)

        content = s.edited_content or s.generated_content or ""
        # Strip markdown for PPTX
        clean_lines = []
        for line in content.split("\n"):
            line = line.strip()
            if not line: continue
            if line.startswith("## ") or line.startswith("### "): line = line.lstrip("#").strip()
            if line.startswith("**") and line.endswith("**"): line = line.strip("*")
            clean_lines.append(line)

        body_text = "\n".join(clean_lines[:18])
        _add_text(slide, body_text, 0.4, 1.3, 12.5, 5.8, size=13, color=INK)

    # ── Closing slide ─────────────────────────────────────────────
    slide = prs.slides.add_slide(blank)
    _add_rect(slide, 0, 0, 13.33, 7.5, CLAY)
    _add_text(slide, "Thank You", 0.5, 2.5, 12.33, 1.5,
              size=44, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
    _add_text(slide, opp.client_name, 0.5, 4.2, 12.33, 0.8,
              size=22, color=WHITE, align=PP_ALIGN.CENTER)

    buf = _io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
