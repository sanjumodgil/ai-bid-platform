from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List
from datetime import datetime
from enum import Enum
import uuid

def gen_uuid():
    return str(uuid.uuid4())

# ── Enums ──────────────────────────────────────────────────────────

class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    BID_LEAD = "bid_lead"
    REVIEWER = "reviewer"
    VIEWER = "viewer"

class OpportunityStatus(str, Enum):
    DRAFT = "draft"
    UNDER_REVIEW = "under_review"
    SUBMITTED = "submitted"
    UNDER_EVALUATION = "under_evaluation"
    WON_DIRECT = "won_direct"
    LOST_AT_RFP = "lost_at_rfp"
    SHORTLISTED = "shortlisted"
    CANCELLED = "cancelled"

class OralStatus(str, Enum):
    PREPARING = "preparing"
    READY = "ready"
    DELIVERED = "delivered"
    WON_AT_ORALS = "won_at_orals"
    LOST_AT_ORALS = "lost_at_orals"
    CANCELLED = "cancelled"

class DocumentType(str, Enum):
    RFP = "rfp"
    REQUIREMENTS_EXCEL = "requirements_excel"
    PAST_PROPOSAL = "past_proposal"
    SUPPORTING = "supporting"

class DocumentStatus(str, Enum):
    UPLOADING = "uploading"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class IndustryVertical(str, Enum):
    RETAIL              = "retail"
    FINANCIAL_SERVICES  = "financial_services"
    HEALTHCARE          = "healthcare"
    PUBLIC_SECTOR       = "public_sector"
    MANUFACTURING       = "manufacturing"
    TECHNOLOGY          = "technology"
    ENERGY              = "energy"
    TELECOMS            = "telecoms"
    TRANSPORT           = "transport"
    EDUCATION           = "education"
    MEDIA               = "media"
    OTHER               = "other"

class GoNoGoStatus(str, Enum):
    GO = "go"
    PURSUE_WITH_CAVEATS = "pursue_with_caveats"
    NO_GO = "no_go"
    PENDING = "pending"

class LLMProvider(str, Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    AZURE_OPENAI = "azure_openai"
    MISTRAL = "mistral"
    OLLAMA = "ollama"

# ── Platform Config (single row) ──────────────────────────────────

class PlatformConfig(SQLModel, table=True):
    __tablename__ = "platform_config"
    id: str = Field(default_factory=gen_uuid, primary_key=True)
    platform_name: str = Field(default="AI-Powered Bid Platform")
    accent_color: str = Field(default="#C8A882")
    first_run_completed: bool = Field(default=False)
    default_llm_provider: Optional[str] = None
    default_llm_model: Optional[str] = None
    vector_db_backend: str = Field(default="chroma")
    embedding_backend: str = Field(default="local")
    sso_enabled: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

# ── LLM Provider Config ───────────────────────────────────────────

class LLMProviderConfig(SQLModel, table=True):
    __tablename__ = "llm_provider_config"
    id: str = Field(default_factory=gen_uuid, primary_key=True)
    provider: str  # openai, anthropic, google, azure_openai, mistral, ollama
    display_name: str
    api_key_encrypted: Optional[str] = None
    endpoint: Optional[str] = None
    api_version: Optional[str] = None           # Azure API version
    model: str
    embedding_model: Optional[str] = None       # embedding model for this provider
    is_default: bool = Field(default=False)
    is_active: bool = Field(default=True)
    data_residency: Optional[str] = None
    capabilities: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

# ── Users ─────────────────────────────────────────────────────────

class User(SQLModel, table=True):
    __tablename__ = "users"
    id: str = Field(default_factory=gen_uuid, primary_key=True)
    email: str = Field(unique=True, index=True)
    full_name: str
    hashed_password: Optional[str] = None
    role: UserRole = Field(default=UserRole.VIEWER)
    is_active: bool = Field(default=True)
    is_verified: bool = Field(default=False)
    must_change_password: bool = Field(default=False)
    avatar_initials: Optional[str] = None  # derived from name
    last_login: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    opportunities: List["Opportunity"] = Relationship(back_populates="bid_lead")
    assignments: List["ReviewAssignment"] = Relationship(back_populates="reviewer")

# ── Opportunities ──────────────────────────────────────────────────

class Opportunity(SQLModel, table=True):
    __tablename__ = "opportunities"
    id: str = Field(default_factory=gen_uuid, primary_key=True)
    name: str
    client_name: str
    procurement_reference: Optional[str] = None
    industry_vertical: IndustryVertical = Field(default=IndustryVertical.OTHER)
    sub_domain: Optional[str] = None        # e.g. 'point_of_sale', 'cyber_security'
    solution_type: Optional[str] = None
    geography: Optional[str] = None
    submission_deadline: Optional[datetime] = None
    estimated_value: Optional[float] = None
    status: OpportunityStatus = Field(default=OpportunityStatus.DRAFT)
    oral_status: Optional[OralStatus] = None
    go_no_go_status: GoNoGoStatus = Field(default=GoNoGoStatus.PENDING)
    cfav_score: Optional[float] = None  # 0-100 aggregate
    complexity_score: Optional[float] = None
    feasibility_score: Optional[float] = None
    alignment_score: Optional[float] = None
    value_score: Optional[float] = None
    notes: Optional[str] = None
    crm_reference: Optional[str] = None
    bid_lead_id: Optional[str] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    bid_lead: Optional[User] = Relationship(back_populates="opportunities")
    documents: List["Document"] = Relationship(back_populates="opportunity")
    requirements: List["Requirement"] = Relationship(back_populates="opportunity")
    assignments: List["ReviewAssignment"] = Relationship(back_populates="opportunity")
    activity_log: List["ActivityLog"] = Relationship(back_populates="opportunity")

# ── Documents ─────────────────────────────────────────────────────

class Document(SQLModel, table=True):
    __tablename__ = "documents"
    id: str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id: Optional[str] = Field(default=None, foreign_key="opportunities.id")
    filename: str
    original_filename: str
    display_name: Optional[str] = None       # friendly name set by user at upload
    uploaded_by_name: Optional[str] = None   # display name of uploader
    uploaded_by_id: Optional[str] = None     # user id of uploader
    owning_team: Optional[str] = None        # team or group responsible
    file_type: str  # pdf, docx, xlsx
    doc_type: DocumentType
    file_size_bytes: int = Field(default=0)
    file_path: str
    status: DocumentStatus = Field(default=DocumentStatus.UPLOADING)
    processing_error: Optional[str] = None
    chunk_count: int = Field(default=0)
    page_count: Optional[int] = None
    word_count: Optional[int] = None
    celery_task_id: Optional[str] = None
    industry_vertical: Optional[str] = None
    sub_domain: Optional[str] = None        # e.g. 'point_of_sale', 'cyber_security'
    solution_type: Optional[str] = None
    geography: Optional[str] = None
    outcome: Optional[str] = None  # won, lost, pipeline, internal
    content_type: Optional[str] = None  # case_study, capability, compliance, etc
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    opportunity: Optional[Opportunity] = Relationship(back_populates="documents")
    chunks: List["DocumentChunk"] = Relationship(back_populates="document")

# ── Document Chunks ────────────────────────────────────────────────

class DocumentChunk(SQLModel, table=True):
    __tablename__ = "document_chunks"
    id: str = Field(default_factory=gen_uuid, primary_key=True)
    document_id: str = Field(foreign_key="documents.id")
    chunk_index: int
    text: str
    section_path: Optional[str] = None
    quality_score: float = Field(default=0.5)
    token_count: int = Field(default=0)
    vector_id: Optional[str] = None  # ID in vector store
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    document: Document = Relationship(back_populates="chunks")

# ── Requirements ──────────────────────────────────────────────────

class Requirement(SQLModel, table=True):
    __tablename__ = "requirements"
    id: str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id: str = Field(foreign_key="opportunities.id")
    req_id: Optional[str] = None  # e.g. REQ-001
    description: str
    category: Optional[str] = None
    priority: Optional[str] = None  # High, Medium, Low
    section: Optional[str] = None
    is_mandatory: bool = Field(default=True)
    # CFAV per requirement
    complexity_score: Optional[float] = None
    feasibility_score: Optional[float] = None
    alignment_score: Optional[float] = None
    value_score: Optional[float] = None
    cfav_aggregate: Optional[float] = None
    source_document_id: Optional[str] = Field(default=None, foreign_key="documents.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    opportunity: Opportunity = Relationship(back_populates="requirements")

# ── Review Assignments ────────────────────────────────────────────

class ReviewAssignment(SQLModel, table=True):
    __tablename__ = "review_assignments"
    id: str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id: str = Field(foreign_key="opportunities.id")
    reviewer_id: str = Field(foreign_key="users.id")
    section_type: Optional[str] = None  # technical, commercial, legal
    status: str = Field(default="pending")  # pending, in_review, approved, changes_requested
    assigned_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    notes: Optional[str] = None

    # Relationships
    opportunity: Opportunity = Relationship(back_populates="assignments")
    reviewer: User = Relationship(back_populates="assignments")

# ── Activity Log ──────────────────────────────────────────────────

class ActivityLog(SQLModel, table=True):
    __tablename__ = "activity_log"
    id: str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id: Optional[str] = Field(default=None, foreign_key="opportunities.id")
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    action: str
    detail: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    opportunity: Optional[Opportunity] = Relationship(back_populates="activity_log")

# ── Integration Config ────────────────────────────────────────────

class IntegrationConfig(SQLModel, table=True):
    __tablename__ = "integration_config"
    id:           str = Field(default_factory=gen_uuid, primary_key=True)
    name:         str = Field(unique=True)   # e.g. "azure_ad", "smtp", "sharepoint"
    enabled:      bool = Field(default=False)
    verified:     bool = Field(default=False)  # last test connection passed
    config_json:  Optional[str] = None          # JSON blob — encrypted in production
    created_at:   datetime = Field(default_factory=datetime.utcnow)
    updated_at:   datetime = Field(default_factory=datetime.utcnow)

# ── Bid Team ──────────────────────────────────────────────────────

class BidRole(str, Enum):
    BID_LEAD            = "bid_lead"
    SOLUTION_ARCHITECT  = "solution_architect"
    COMMERCIAL_LEAD     = "commercial_lead"
    SME                 = "sme"
    REVIEWER            = "reviewer"
    EXEC_SPONSOR        = "exec_sponsor"
    DELIVERY_LEAD       = "delivery_lead"
    OTHER               = "other"

class BidTeamMember(SQLModel, table=True):
    __tablename__ = "bid_team_members"
    id:               str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id:   str = Field(foreign_key="opportunities.id", index=True)
    display_name:     str
    email:            Optional[str] = None
    job_title:        Optional[str] = None
    department:       Optional[str] = None
    role:             BidRole = Field(default=BidRole.OTHER)
    ad_object_id:     Optional[str] = None   # Azure AD object ID if from AD
    added_by:         Optional[str] = Field(default=None, foreign_key="users.id")
    created_at:       datetime = Field(default_factory=datetime.utcnow)

# ── KB Document Contributors ──────────────────────────────────────

class KBContributor(SQLModel, table=True):
    __tablename__ = "kb_contributors"
    id:             str = Field(default_factory=gen_uuid, primary_key=True)
    document_id:    str = Field(foreign_key="documents.id", index=True)
    display_name:   str
    email:          Optional[str] = None
    job_title:      Optional[str] = None
    department:     Optional[str] = None
    role:           Optional[str] = None   # e.g. "Bid Lead", "Solution Architect"
    ad_object_id:   Optional[str] = None
    added_by:       Optional[str] = Field(default=None, foreign_key="users.id")
    created_at:     datetime = Field(default_factory=datetime.utcnow)

# ── KB Lessons Learned ────────────────────────────────────────────

class LessonStatus(str, Enum):
    DRAFT     = "draft"
    PUBLISHED = "published"

class KBLesson(SQLModel, table=True):
    __tablename__ = "kb_lessons"
    id:                 str = Field(default_factory=gen_uuid, primary_key=True)
    document_id:        str = Field(foreign_key="documents.id", index=True)
    # Core feedback
    went_well:          Optional[str] = None   # what worked
    went_poorly:        Optional[str] = None   # what didn't work
    do_differently:     Optional[str] = None   # recommendations for next time
    evaluator_feedback: Optional[str] = None   # client/assessor comments
    # Outcome context
    bid_outcome:        Optional[str] = None   # won / lost / partial / withdrawn
    score_received:     Optional[str] = None   # e.g. "78/100", "3rd out of 5"
    # Flags
    flag_for_attention: bool = Field(default=False)  # must-read for similar bids
    status:             LessonStatus = Field(default=LessonStatus.DRAFT)
    # Authorship
    created_by:         Optional[str] = Field(default=None, foreign_key="users.id")
    created_by_name:    Optional[str] = None
    created_at:         datetime = Field(default_factory=datetime.utcnow)
    updated_at:         datetime = Field(default_factory=datetime.utcnow)

# ── Phase 2 Models ────────────────────────────────────────────────

class GenerationStatus(str, Enum):
    PENDING    = "pending"
    GENERATING = "generating"
    COMPLETED  = "completed"
    FAILED     = "failed"
    SKIPPED    = "skipped"

class ReviewStatus(str, Enum):
    PENDING          = "pending"
    IN_REVIEW        = "in_review"
    APPROVED         = "approved"
    CHANGES_REQUESTED = "changes_requested"
    REWRITTEN        = "rewritten"

class BidSection(SQLModel, table=True):
    __tablename__ = "bid_sections"
    id:                str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id:    str = Field(foreign_key="opportunities.id", index=True)
    requirement_id:    Optional[str] = Field(default=None, foreign_key="requirements.id")
    section_title:     str                        # e.g. "Technical Approach", "REQ-001"
    section_type:      Optional[str] = None       # technical, commercial, legal, executive
    generated_content: Optional[str] = None       # AI-generated markdown text
    edited_content:    Optional[str] = None       # human-edited version (if changed)
    prompt_used:       Optional[str] = None       # for audit/debugging
    kb_sources:        Optional[str] = None       # JSON list of chunk IDs used
    # Confidence scores (0-100 each)
    confidence_overall:    Optional[float] = None
    confidence_complete:   Optional[float] = None  # requirement coverage
    confidence_relevance:  Optional[float] = None  # KB evidence quality
    confidence_tone:       Optional[float] = None  # tone/compliance
    confidence_risk:       Optional[float] = None  # risk flags
    # Status
    generation_status:  GenerationStatus = Field(default=GenerationStatus.PENDING)
    review_status:      ReviewStatus     = Field(default=ReviewStatus.PENDING)
    generation_error:   Optional[str]    = None
    # Assignment
    reviewer_id:       Optional[str] = Field(default=None, foreign_key="users.id")
    reviewer_name:     Optional[str] = None
    # Ordering
    section_order:     int = Field(default=0)
    word_count:        Optional[int] = None
    created_at:        datetime = Field(default_factory=datetime.utcnow)
    updated_at:        datetime = Field(default_factory=datetime.utcnow)

class SectionAnnotation(SQLModel, table=True):
    __tablename__ = "section_annotations"
    id:           str = Field(default_factory=gen_uuid, primary_key=True)
    section_id:   str = Field(foreign_key="bid_sections.id", index=True)
    author_id:    str = Field(foreign_key="users.id")
    author_name:  str
    content:      str                          # comment text
    annotation_type: str = Field(default="comment")  # comment, suggestion, approval, rejection
    resolved:     bool = Field(default=False)
    created_at:   datetime = Field(default_factory=datetime.utcnow)

class ComplianceCheck(SQLModel, table=True):
    __tablename__ = "compliance_checks"
    id:              str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id:  str = Field(foreign_key="opportunities.id", index=True)
    check_name:      str
    check_category:  str   # coverage, review, content, format
    status:          str   # pass, warn, fail
    detail:          Optional[str] = None
    auto_fixable:    bool = Field(default=False)
    ran_at:          datetime = Field(default_factory=datetime.utcnow)

class Submission(SQLModel, table=True):
    __tablename__ = "submissions"
    id:                  str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id:      str = Field(foreign_key="opportunities.id", index=True)
    submitted_at:        Optional[datetime] = None
    submission_method:   Optional[str] = None   # portal, email, physical
    confirmation_ref:    Optional[str] = None
    submitted_by_id:     Optional[str] = Field(default=None, foreign_key="users.id")
    submitted_by_name:   Optional[str] = None
    capture_result:      Optional[str] = None   # won, lost, shortlisted, withdrawn, no_bid
    capture_date:        Optional[datetime] = None
    capture_notes:       Optional[str] = None
    score_received:      Optional[str] = None   # e.g. "78/100", "2nd of 5"
    feedback_received:   Optional[str] = None   # evaluator feedback
    kb_promoted:         bool = Field(default=False)
    lessons_added:       bool = Field(default=False)
    created_at:          datetime = Field(default_factory=datetime.utcnow)
    updated_at:          datetime = Field(default_factory=datetime.utcnow)

# ── Phase 3 — Orals Track ─────────────────────────────────────────

class OralSession(SQLModel, table=True):
    __tablename__ = "oral_sessions"
    id:               str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id:   str = Field(foreign_key="opportunities.id", index=True)
    # Event details
    oral_date:        Optional[datetime] = None
    venue:            Optional[str] = None
    format:           Optional[str] = None   # in_person, virtual, hybrid
    duration_minutes: Optional[int] = None
    evaluator_names:  Optional[str] = None   # comma-separated
    evaluator_count:  Optional[int] = None
    # Presentation team
    presenter_ids:    Optional[str] = None   # JSON list of user IDs
    presenter_names:  Optional[str] = None   # JSON list of display names
    # Status
    oral_status:      OralStatus = Field(default=OralStatus.PREPARING)
    readiness_score:  Optional[float] = None  # 0-100
    # Post-oral capture
    delivered_at:     Optional[datetime] = None
    delivery_notes:   Optional[str] = None
    result:           Optional[str] = None   # won_at_orals, lost_at_orals
    result_notes:     Optional[str] = None
    evaluator_feedback: Optional[str] = None
    # Metadata
    created_by:       Optional[str] = Field(default=None, foreign_key="users.id")
    created_at:       datetime = Field(default_factory=datetime.utcnow)
    updated_at:       datetime = Field(default_factory=datetime.utcnow)

class PresentationSlide(SQLModel, table=True):
    __tablename__ = "presentation_slides"
    id:              str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id:  str = Field(foreign_key="opportunities.id", index=True)
    slide_order:     int = Field(default=0)
    title:           str
    slide_type:      Optional[str] = None   # cover, agenda, section, qa, close
    talking_points:  Optional[str] = None   # AI-generated markdown bullet points
    source_section_id: Optional[str] = Field(default=None, foreign_key="bid_sections.id")
    speaker_notes:   Optional[str] = None   # human-edited notes
    duration_minutes: Optional[int] = None  # planned time on this slide
    status:          str = Field(default="pending")  # pending, generated, edited
    created_at:      datetime = Field(default_factory=datetime.utcnow)
    updated_at:      datetime = Field(default_factory=datetime.utcnow)

class AnticipatedQuestion(SQLModel, table=True):
    __tablename__ = "anticipated_questions"
    id:              str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id:  str = Field(foreign_key="opportunities.id", index=True)
    question:        str
    category:        Optional[str] = None   # technical, commercial, governance, risk, team, general
    difficulty:      Optional[str] = None   # easy, medium, hard
    model_answer:    Optional[str] = None   # AI-drafted answer
    edited_answer:   Optional[str] = None   # human-edited answer
    source:          str = Field(default="ai")  # ai, manual
    rehearsed:       bool = Field(default=False)
    rehearsal_notes: Optional[str] = None
    question_order:  int = Field(default=0)
    created_at:      datetime = Field(default_factory=datetime.utcnow)
    updated_at:      datetime = Field(default_factory=datetime.utcnow)

class RehearsalSession(SQLModel, table=True):
    __tablename__ = "rehearsal_sessions"
    id:               str = Field(default_factory=gen_uuid, primary_key=True)
    opportunity_id:   str = Field(foreign_key="opportunities.id", index=True)
    rehearsal_date:   datetime = Field(default_factory=datetime.utcnow)
    duration_minutes: Optional[int] = None
    attendee_names:   Optional[str] = None   # comma-separated
    facilitator_name: Optional[str] = None
    feedback:         Optional[str] = None   # general feedback
    strengths:        Optional[str] = None
    improvements:     Optional[str] = None
    questions_covered: Optional[str] = None  # JSON list of question IDs tested
    readiness_rating: Optional[int] = None   # 1-5
    created_by:       Optional[str] = Field(default=None, foreign_key="users.id")
    created_at:       datetime = Field(default_factory=datetime.utcnow)
