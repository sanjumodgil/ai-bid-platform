export type UserRole = 'super_admin' | 'bid_lead' | 'reviewer' | 'viewer'

export type OpportunityStatus =
  | 'draft' | 'under_review' | 'submitted' | 'under_evaluation'
  | 'won_direct' | 'lost_at_rfp' | 'shortlisted' | 'cancelled'

export type OralStatus =
  | 'preparing' | 'ready' | 'delivered'
  | 'won_at_orals' | 'lost_at_orals' | 'cancelled'

export type GoNoGoStatus = 'go' | 'pursue_with_caveats' | 'no_go' | 'pending'

export type DocumentType =
  | 'rfp' | 'requirements_excel' | 'past_proposal' | 'supporting'

export type DocumentStatus = 'uploading' | 'processing' | 'completed' | 'failed'

export interface User {
  id: string
  email: string
  full_name: string
  role: UserRole
  is_active: boolean
  avatar_initials: string
  last_login: string | null
  created_at: string
}

export interface AuthState {
  user: User | null
  access_token: string | null
  refresh_token: string | null
  isAuthenticated: boolean
}

export interface Opportunity {
  id: string
  name: string
  client_name: string
  procurement_reference: string | null
  industry_vertical: string
  sub_domain: string | null
  solution_type: string | null
  geography: string | null
  submission_deadline: string | null
  estimated_value: number | null
  status: OpportunityStatus
  oral_status: OralStatus | null
  go_no_go_status: GoNoGoStatus
  cfav_score: number | null
  complexity_score: number | null
  feasibility_score: number | null
  alignment_score: number | null
  value_score: number | null
  capture_result: string | null
  notes: string | null
  bid_lead_id: string | null
  bid_lead_name: string | null
  document_count: number
  requirement_count: number
  created_at: string
  updated_at: string
}

export interface Document {
  id: string
  filename: string
  original_filename: string
  display_name: string | null
  owning_team: string | null
  uploaded_by_name: string | null
  uploaded_by_id: string | null
  file_type: string
  doc_type: DocumentType
  file_size_bytes: number
  status: DocumentStatus
  processing_error: string | null
  chunk_count: number
  page_count: number | null
  word_count: number | null
  opportunity_id: string | null
  industry_vertical: string | null
  sub_domain: string | null
  solution_type: string | null
  outcome: string | null
  created_at: string
  updated_at: string
}

export interface Requirement {
  id: string
  req_id: string | null
  description: string
  priority: string | null
  category: string | null
  section: string | null
  cfav_aggregate: number | null
  is_mandatory: boolean
  created_at: string
}

export interface DashboardStats {
  total_opportunities: number
  active_opportunities: number
  won_opportunities: number
  total_users: number
  kb_documents: number
  kb_chunks: number
  recent_opportunities: Array<{
    id: string
    name: string
    client: string
    status: OpportunityStatus
    updated_at: string
  }>
  phase2?: {
    sections_pending_review:  number
    sections_approved_week:   number
    sections_low_confidence:  number
    my_review_count:          number
    upcoming_deadlines: Array<{
      id: string; name: string; client: string
      deadline: string; days_left: number
    }>
  }
  config_status?: {
    llm?: { configured: boolean; reason?: string; provider?: string; model?: string }
  }
}

export interface PlatformConfig {
  id: string
  platform_name: string
  accent_color: string
  first_run_completed: boolean
  vector_db_backend: string
  embedding_backend: string
  sso_enabled: boolean
}
