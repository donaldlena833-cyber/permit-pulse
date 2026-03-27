export type LeadStatus = "new" | "ready" | "review" | "email_required" | "sent" | "archived"
export type QualityTier = "hot" | "warm" | "cold"
export type AppTab = "today" | "leads" | "settings"

export interface LeadRow {
  id: string
  permit_number: string
  permit_key: string
  address: string
  borough_or_municipality: string
  work_description: string
  filing_date: string | null
  applicant_name: string | null
  owner_name: string | null
  relevance_score: number
  relevance_keyword: string | null
  company_name: string | null
  company_domain: string | null
  company_website: string | null
  company_confidence: number
  contact_name: string | null
  contact_role: string | null
  contact_email: string | null
  contact_email_trust: number
  contact_phone: string | null
  fallback_email: string | null
  fallback_email_trust: number
  active_email_role: "primary" | "fallback"
  status: LeadStatus
  quality_tier: QualityTier
  draft_subject: string | null
  draft_body: string | null
  draft_cta_type: string | null
  operator_vouched: boolean
  operator_notes: string | null
  enriched_at: string | null
  sent_at: string | null
  updated_at: string
}

export interface CompanyCandidate {
  id: string
  company_name: string
  domain: string | null
  website: string | null
  source: string | null
  confidence: number
  reasons: string[] | null
  is_current: boolean
  is_chosen: boolean
  rejected_reason: string | null
}

export interface EmailCandidate {
  id: string
  email_address: string
  domain: string
  local_part: string
  person_name: string | null
  person_role: string | null
  trust_score: number
  trust_reasons: string[] | null
  is_auto_sendable: boolean
  is_manual_sendable: boolean
  is_research_only: boolean
  is_primary: boolean
  is_fallback: boolean
  selection_reason: string | null
  rejected_reason: string | null
  provenance_source: string
  provenance_url: string | null
  provenance_page_type: string | null
  provenance_extraction_method: string | null
  provenance_page_title: string | null
  provenance_page_heading: string | null
  provenance_raw_context: string | null
  provenance_stale_penalty: number
  provenance_stale_reasons: string[] | null
}

export interface LeadEvent {
  id: string
  event_type: string
  actor_type: string
  actor_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

export interface FollowUp {
  id: string
  lead_id: string
  step_number: number
  scheduled_at: string
  channel: "email" | "phone"
  status: "pending" | "sent" | "skipped" | "cancelled"
  cancelled_reason: string | null
  draft_content: string | null
  phone_script: string | null
  sent_at: string | null
  outcome_notes: string | null
}

export interface RelatedPermit {
  id: string
  permit_number: string
  work_description: string | null
  address: string | null
  relevance_score: number | null
  relevance_keyword: string | null
  discovered_at: string
}

export interface LeadDetailResponse {
  lead: LeadRow
  contacts: {
    phone: string
    primary: EmailCandidate | null
    fallback: EmailCandidate | null
    approved_primary: EmailCandidate | null
    approved_fallback: EmailCandidate | null
    discovered_emails: EmailCandidate[]
    guessed_emails: EmailCandidate[]
  }
  candidates: {
    companies: CompanyCandidate[]
    emails: EmailCandidate[]
  }
  draft: {
    subject: string
    body: string
    cta_type: string
  }
  follow_ups: FollowUp[]
  timeline: LeadEvent[]
  related_permits: RelatedPermit[]
}

export interface RunCounters {
  permits_found?: number
  leads_created?: number
  leads_ready?: number
  leads_review?: number
}

export interface AutomationRun {
  id: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  current_stage: string | null
  started_at: string | null
  completed_at?: string | null
  counters?: RunCounters
  summary?: Record<string, number>
}

export interface TodayPayload {
  greeting: string
  daily_cap: {
    sent: number
    cap: number
    remaining: number
  }
  warm_up: {
    enabled: boolean
    cap?: number
  }
  current_run: AutomationRun | null
  last_run: AutomationRun | null
  counts: {
    new: number
    ready: number
    review: number
    email_required: number
  }
  new_leads: LeadRow[]
  ready: LeadRow[]
  review: LeadRow[]
  email_required: LeadRow[]
  follow_ups_due: Array<{
    id: string
    lead_id: string
    company_name: string
    step: number
    channel: "email" | "phone"
    scheduled_at: string
    phone_script: string
  }>
  recent_sends: Array<{
    lead_id: string
    company_name: string
    email: string
    sent_at: string
    outcome: string
  }>
}

export interface HealthPayload {
  ok: boolean
  hasSupabase: boolean
  hasGmail: boolean
  hasBrave: boolean
  hasGoogleMaps: boolean
  hasFirecrawl: boolean
  hasDefaultAttachment: boolean
  defaultAttachmentName: string | null
}

export interface ConfigPayload {
  daily_send_cap: number
  min_relevance_threshold: number
  auto_send_trust_threshold: number
  manual_send_trust_threshold: number
  follow_up_enabled: boolean
  follow_up_sequence: string[]
  active_sources: string[]
  warm_up_mode: boolean
  warm_up_daily_cap: number
}

export interface LeadsPayload {
  leads: LeadRow[]
  page: number
  limit: number
}

export interface SystemPayload {
  worker: {
    ok: boolean
    has_gmail: boolean
  }
  total_leads: number
  recent_failures: Array<{
    id: string
    job_type: string
    error_message: string | null
    error_code: string | null
    created_at: string
  }>
  domain_health: Array<{
    domain: string
    health_score: number
    checked_at: string
  }>
  recent_runs: Array<AutomationRun>
}
