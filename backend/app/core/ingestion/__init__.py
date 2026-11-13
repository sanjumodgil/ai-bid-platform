import os
import logging
from typing import List, Dict, Tuple, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

def extract_text_from_pdf(file_path: str) -> Tuple[str, int]:
    """Extract text from PDF. Uses PyMuPDF (fast) with pypdf as fallback."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(file_path)
        pages = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text("text")
            if text.strip():
                pages.append(f"[Page {page_num + 1}]\n{text}")
        page_count = len(doc)
        doc.close()
        return "\n\n".join(pages), page_count
    except ImportError:
        logger.warning("PyMuPDF not available, falling back to pypdf")
        return _extract_pdf_pypdf(file_path)

def _extract_pdf_pypdf(file_path: str) -> Tuple[str, int]:
    """Pure-Python PDF fallback — no C compiler needed. pip install pypdf"""
    try:
        from pypdf import PdfReader
        reader = PdfReader(file_path)
        pages = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                pages.append(f"[Page {i + 1}]\n{text}")
        return "\n\n".join(pages), len(reader.pages)
    except ImportError:
        raise RuntimeError(
            "No PDF parser available. Install either PyMuPDF or pypdf:\n"
            "  pip install PyMuPDF   (recommended, faster)\n"
            "  pip install pypdf     (pure Python, no build step)"
        )

def extract_text_from_docx(file_path: str) -> Tuple[str, int]:
    """Extract text from DOCX preserving paragraph structure."""
    from docx import Document
    doc = Document(file_path)
    sections = []
    current_section = []
    for para in doc.paragraphs:
        if para.style.name.startswith("Heading"):
            if current_section:
                sections.append("\n".join(current_section))
                current_section = []
            current_section.append(f"\n## {para.text}\n")
        elif para.text.strip():
            current_section.append(para.text)
    if current_section:
        sections.append("\n".join(current_section))
    full_text = "\n\n".join(sections)
    return full_text, len(doc.paragraphs) // 30  # rough page estimate

def extract_requirements_from_excel(file_path: str) -> List[Dict]:
    """Extract requirements from Excel. Auto-detects common column patterns."""
    import openpyxl
    wb = openpyxl.load_workbook(file_path, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []

    # Find header row (first non-empty row)
    header_row = None
    header_idx = 0
    for i, row in enumerate(rows):
        if any(cell for cell in row):
            header_row = [str(c).lower().strip() if c else "" for c in row]
            header_idx = i
            break

    if not header_row:
        return []

    # Map column names flexibly
    col_map = {}
    id_patterns = ["req id", "requirement id", "id", "ref", "reference", "no."]
    desc_patterns = ["description", "requirement", "detail", "requirement description", "text"]
    priority_patterns = ["priority", "importance", "criticality"]
    category_patterns = ["category", "type", "area", "domain"]
    section_patterns = ["section", "chapter", "part"]

    for i, h in enumerate(header_row):
        if any(p in h for p in id_patterns) and "id" not in col_map:
            col_map["id"] = i
        elif any(p in h for p in desc_patterns) and "description" not in col_map:
            col_map["description"] = i
        elif any(p in h for p in priority_patterns) and "priority" not in col_map:
            col_map["priority"] = i
        elif any(p in h for p in category_patterns) and "category" not in col_map:
            col_map["category"] = i
        elif any(p in h for p in section_patterns) and "section" not in col_map:
            col_map["section"] = i

    if "description" not in col_map:
        # Fall back: use second column as description if no match
        col_map["description"] = min(1, len(header_row) - 1)

    requirements = []
    for i, row in enumerate(rows[header_idx + 1:], 1):
        desc_val = row[col_map["description"]] if col_map.get("description") is not None else None
        if not desc_val:
            continue
        req = {
            "req_id": str(row[col_map["id"]]) if "id" in col_map and row[col_map["id"]] else f"REQ-{i:03d}",
            "description": str(desc_val).strip(),
            "priority": str(row[col_map["priority"]]).strip() if "priority" in col_map and row[col_map["priority"]] else "Medium",
            "category": str(row[col_map["category"]]).strip() if "category" in col_map and row[col_map["category"]] else None,
            "section": str(row[col_map["section"]]).strip() if "section" in col_map and row[col_map["section"]] else None,
        }
        requirements.append(req)

    wb.close()
    logger.info(f"Extracted {len(requirements)} requirements from Excel")
    return requirements

def semantic_chunk_text(text: str, chunk_size: int = 512, chunk_overlap: int = 64) -> List[Dict]:
    """Chunk text at semantic boundaries with overlap."""
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size * 4,  # chars approximation (4 chars ≈ 1 token)
        chunk_overlap=chunk_overlap * 4,
        separators=["\n\n## ", "\n\n", "\n", ". ", " "],
        length_function=len,
    )
    chunks = splitter.split_text(text)
    result = []
    for i, chunk_text in enumerate(chunks):
        if chunk_text.strip():
            # Extract section path from chunk if it has a heading
            section_path = None
            lines = chunk_text.split("\n")
            for line in lines[:3]:
                if line.startswith("##") or line.startswith("[Page"):
                    section_path = line.strip("# []\n")
                    break
            result.append({
                "index": i,
                "text": chunk_text.strip(),
                "section_path": section_path,
                "token_count": len(chunk_text.split()) * 1.3,  # rough token estimate
            })
    logger.info(f"Created {len(result)} chunks from text ({len(text)} chars)")
    return result

def process_document(file_path: str, file_type: str) -> Tuple[str, int, int]:
    """
    Process a document and return (full_text, page_count, word_count).
    file_type: 'pdf', 'docx', 'xlsx'
    """
    if file_type == "pdf":
        text, pages = extract_text_from_pdf(file_path)
    elif file_type in ("docx", "doc"):
        text, pages = extract_text_from_docx(file_path)
    else:
        raise ValueError(f"Unsupported file type for text extraction: {file_type}")

    word_count = len(text.split())
    return text, pages, word_count
