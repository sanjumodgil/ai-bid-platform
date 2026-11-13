"""
Word document export engine.

Two modes:
  1. Default — builds a clean, well-structured .docx from scratch (python-docx)
  2. Template — fills a client-supplied .docx template using bookmarks or
     content controls. Falls back to default if template is corrupt/missing.

Template conventions (for client templates):
  Bookmark names the platform looks for:
    BID_TITLE         — opportunity name
    BID_CLIENT        — client name
    BID_DATE          — export date
    BID_REFERENCE     — procurement reference
    BID_INDUSTRY      — industry vertical
    SECTION_n         — content for section n (n = 1, 2, 3 …)
    SECTION_n_TITLE   — title for section n
    TOC_PLACEHOLDER   — replaced with a list of section titles

  If none of these bookmarks are found the engine falls back to
  appending sections after the last paragraph in the template.
"""
import io
import re
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────

def _parse_markdown(doc, content: str, font_size_pt: int = 11):
    """Convert markdown-like text into python-docx paragraphs."""
    from docx.shared import Pt, RGBColor
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    for line in content.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("### "):
            doc.add_heading(line[4:], 3)
        elif line.startswith("## "):
            doc.add_heading(line[3:], 2)
        elif line.startswith("# "):
            doc.add_heading(line[2:], 1)
        elif line.startswith("- ") or line.startswith("• "):
            p = doc.add_paragraph(line[2:], style="List Bullet")
            if p.runs:
                p.runs[0].font.size = Pt(font_size_pt)
        elif re.match(r"^\d+\.\s", line):
            text = re.sub(r"^\d+\.\s", "", line)
            p = doc.add_paragraph(text, style="List Number")
            if p.runs:
                p.runs[0].font.size = Pt(font_size_pt)
        elif "**" in line:
            p = doc.add_paragraph()
            parts = line.split("**")
            for i, part in enumerate(parts):
                if part:
                    run = p.add_run(part)
                    run.bold = (i % 2 == 1)
                    run.font.size = Pt(font_size_pt)
        else:
            p = doc.add_paragraph(line)
            if p.runs:
                p.runs[0].font.size = Pt(font_size_pt)


def _set_cell_shading(cell, hex_color: str):
    """Apply background shading to a table cell."""
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'),   'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'),  hex_color)
    tc_pr.append(shd)


# ── Bookmark utilities ────────────────────────────────────────────

def _find_bookmark_paragraph(doc, bookmark_name: str):
    """Return the paragraph containing the named bookmark, or None."""
    from docx.oxml.ns import qn
    for para in doc.paragraphs:
        for child in para._p.iter():
            if child.tag == qn('w:bookmarkStart'):
                if child.get(qn('w:name')) == bookmark_name:
                    return para
    return None


def _replace_bookmark_text(doc, bookmark_name: str, replacement: str) -> bool:
    """Replace the paragraph text of a named bookmark. Returns True if found."""
    para = _find_bookmark_paragraph(doc, bookmark_name)
    if para is None:
        return False
    # Clear existing runs and replace with new text
    for run in para.runs:
        run.text = ""
    if para.runs:
        para.runs[0].text = replacement
    else:
        para.add_run(replacement)
    return True


def _replace_bookmark_with_content(doc, bookmark_name: str, content: str,
                                    section_title: str = "") -> bool:
    """
    Replace a named bookmark paragraph with rendered section content.
    Inserts heading + parsed markdown paragraphs at that position.
    """
    from docx.oxml.ns import qn
    para = _find_bookmark_paragraph(doc, bookmark_name)
    if para is None:
        return False

    # Build a mini-doc fragment to insert
    from docx import Document as _Doc
    from docx.oxml import OxmlElement
    from docx.shared import Pt

    # Insert heading before the bookmark paragraph
    parent = para._p.getparent()
    idx    = list(parent).index(para._p)

    # Create heading element
    if section_title:
        h = doc.add_heading(section_title, 1)
        h._p.getparent().remove(h._p)
        parent.insert(idx, h._p)
        idx += 1

    # Insert content paragraphs
    tmp = _Doc()
    _parse_markdown(tmp, content)
    for tmp_para in tmp.paragraphs:
        new_p = tmp_para._p.__deepcopy__(tmp_para._p)
        parent.insert(idx, new_p)
        idx += 1

    # Remove the original bookmark placeholder paragraph
    parent.remove(para._p)
    return True


def _list_bookmarks(doc) -> list:
    """Return all bookmark names in the document."""
    from docx.oxml.ns import qn
    names = []
    for para in doc.paragraphs:
        for child in para._p.iter():
            if child.tag == qn('w:bookmarkStart'):
                name = child.get(qn('w:name'))
                if name and not name.startswith('_'):
                    names.append(name)
    return names


# ── Default export (no template) ─────────────────────────────────

def build_default_docx(opp, sections: list, include_sources: bool = False) -> bytes:
    """Build a clean, well-formatted .docx from scratch."""
    from docx import Document
    from docx.shared import Pt, RGBColor, Inches
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    CLAY  = RGBColor(0xC8, 0xA8, 0x82)
    INK   = RGBColor(0x2C, 0x26, 0x20)
    SMOKE = RGBColor(0x88, 0x80, 0x78)

    doc = Document()
    sec = doc.sections[0]
    sec.top_margin    = Inches(1.0)
    sec.bottom_margin = Inches(1.0)
    sec.left_margin   = Inches(1.25)
    sec.right_margin  = Inches(1.25)

    # ── Cover ─────────────────────────────────────────────────────
    title = doc.add_heading(opp.name, 0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    sub = doc.add_paragraph(f"RFP Response — {opp.client_name}")
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub.runs[0].font.size  = Pt(14)
    sub.runs[0].font.color.rgb = CLAY

    meta_lines = [
        f"Date: {datetime.utcnow().strftime('%d %B %Y')}",
        f"Reference: {opp.procurement_reference or 'N/A'}",
        f"Industry: {(opp.industry_vertical or '').replace('_', ' ').title()}",
    ]
    meta = doc.add_paragraph("\n".join(meta_lines))
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in meta.runs:
        run.font.size  = Pt(10)
        run.font.color.rgb = SMOKE

    doc.add_page_break()

    # ── Table of contents ─────────────────────────────────────────
    doc.add_heading("Table of Contents", 1)
    for s in sections:
        toc = doc.add_paragraph(f"{s.section_order}.  {s.section_title}")
        toc.paragraph_format.left_indent = Inches(0.2)
        if toc.runs:
            toc.runs[0].font.size = Pt(10)

    doc.add_page_break()

    # ── Sections ──────────────────────────────────────────────────
    for s in sections:
        doc.add_heading(s.section_title, 1)
        content = s.edited_content or s.generated_content or ""
        if content:
            _parse_markdown(doc, content, font_size_pt=11)
        else:
            p = doc.add_paragraph("[No content generated for this section]")
            p.runs[0].font.color.rgb = SMOKE

        # Sources footer
        if include_sources and s.kb_sources:
            try:
                import json
                sources = json.loads(s.kb_sources)
                if sources:
                    footer = doc.add_paragraph(f"Sources: {len(sources)} KB document(s) referenced")
                    footer.paragraph_format.left_indent = Inches(0.2)
                    for run in footer.runs:
                        run.font.size  = Pt(9)
                        run.font.color.rgb = SMOKE
                        run.font.italic = True
            except Exception:
                pass

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ── Template export ───────────────────────────────────────────────

def build_from_template(opp, sections: list, template_path: str,
                         include_sources: bool = False) -> bytes:
    """
    Fill a client-supplied .docx template.

    Strategy:
      1. Open the template.
      2. Scan for known bookmarks (BID_TITLE, SECTION_1, SECTION_1_TITLE, etc.)
      3. Replace each found bookmark with the appropriate content.
      4. If NO bid bookmarks found — fall back to appending sections
         after the template body, preserving branding/styles.
      5. If template is corrupt — fall back to build_default_docx().
    """
    try:
        from docx import Document
        from docx.shared import Pt, RGBColor, Inches
        from docx.enum.text import WD_ALIGN_PARAGRAPH

        SMOKE = RGBColor(0x88, 0x80, 0x78)

        doc = Document(template_path)
        bookmarks = _list_bookmarks(doc)
        logger.info(f"Template bookmarks found: {bookmarks}")

        has_bid_bookmarks = any(
            b.startswith(("BID_", "SECTION_", "TOC_")) for b in bookmarks
        )

        if has_bid_bookmarks:
            # ── Bookmark mode ─────────────────────────────────────
            logger.info("Template mode: bookmark-based")

            _replace_bookmark_text(doc, "BID_TITLE",     opp.name)
            _replace_bookmark_text(doc, "BID_CLIENT",    opp.client_name)
            _replace_bookmark_text(doc, "BID_DATE",      datetime.utcnow().strftime('%d %B %Y'))
            _replace_bookmark_text(doc, "BID_REFERENCE", opp.procurement_reference or "N/A")
            _replace_bookmark_text(doc, "BID_INDUSTRY",  (opp.industry_vertical or "").replace("_", " ").title())

            # TOC placeholder
            toc_text = "\n".join(f"{s.section_order}. {s.section_title}" for s in sections)
            _replace_bookmark_text(doc, "TOC_PLACEHOLDER", toc_text)

            # Section content and titles
            for s in sections:
                n = s.section_order
                _replace_bookmark_text(doc, f"SECTION_{n}_TITLE", s.section_title)
                content = s.edited_content or s.generated_content or ""
                filled = _replace_bookmark_with_content(
                    doc, f"SECTION_{n}", content, section_title=""
                )
                if not filled:
                    logger.debug(f"Bookmark SECTION_{n} not found in template")

        else:
            # ── Append mode — no bookmarks, preserve template branding ──
            logger.info("Template mode: append (no bid bookmarks found)")

            # Add a page break after template content then append sections
            doc.add_page_break()

            cover = doc.add_paragraph(opp.name)
            cover.runs[0].font.size = Pt(18)
            cover.runs[0].font.bold = True

            for s in sections:
                doc.add_heading(s.section_title, 1)
                content = s.edited_content or s.generated_content or ""
                if content:
                    _parse_markdown(doc, content, font_size_pt=11)
                else:
                    p = doc.add_paragraph("[No content generated for this section]")
                    if p.runs:
                        p.runs[0].font.color.rgb = SMOKE

        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    except Exception as e:
        logger.warning(f"Template export failed ({e}), falling back to default export")
        return build_default_docx(opp, sections, include_sources)


# ── Public entry point ────────────────────────────────────────────

def build_docx(opp, sections: list, include_sources: bool = False,
               template_path: Optional[str] = None) -> bytes:
    """
    Main export function.
    Uses template if provided and valid, otherwise builds from scratch.
    """
    if template_path and __import__('os').path.exists(template_path):
        logger.info(f"Exporting with template: {template_path}")
        return build_from_template(opp, sections, template_path, include_sources)
    return build_default_docx(opp, sections, include_sources)
