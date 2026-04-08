export type LeadStatus = "new" | "ready" | "review" | "email_required" | "sent" | "archived"
export type QualityTier = "hot" | "warm" | "cold"
export type AppTab = "today" | "leads" | "prospects" | "settings"
export type ProspectCategory = "interior_designer" | "gc" | "property_manager" | "project_manager" | "architect"
export type ProspectStatus = "new" | "drafted" | "sent" | "replied" | "opted_out" | "archived"
export type ProspectQueueState = "queued_initial" | "sent" | "queued_follow_up" | "follow_up_sent" | "replied" | "opted_out" | "archived" | "suppressed" | "pending_review"

export type WorkspaceRole = "owner" | "admin" | "member"
export type WorkspaceStatus = "active" | "invited" | "disabled"

export interface WorkspaceCapabilities {
  mailbox_self_serve_connect: boolean
  billing_self_serve_enabled: boolean
}

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

export interface ProspectRow {
  id: string
  category: ProspectCategory
  company_name: string | null
  contact_name: string | null
  contact_role: string | null
  email_address: string
  email_normalized: string
  phone: string | null
  website: string | null
  company_domain?: string | null
  city: string | null
  state: string | null
  source: string
  import_batch_id: string | null
  company_id?: string | null
  campaign_id?: string | null
  status: ProspectStatus
  draft_subject: string | null
  draft_body: string | null
  notes: string | null
  gmail_thread_id: string | null
  sent_count: number
  do_not_contact?: boolean
  opted_out_at?: string | null
  first_sent_at?: string | null
  last_sent_at: string | null
  last_follow_up_at?: string | null
  last_replied_at: string | null
  personalization_summary?: string | null
  queue_state?: ProspectQueueState
  automation_block_reason?: string | null
  next_follow_up?: ProspectFollowUp | null
  company?: ProspectCompany | null
  campaign?: ProspectCampaign | null
  created_at: string
  updated_at: string
}

export interface ProspectCompany {
  id: string | null
  name: string
  domain: string | null
  website: string | null
  category: ProspectCategory | null
  suppressed?: boolean
  suppressed_reason?: string | null
}

export interface ProspectCampaign {
  id: string | null
  name: string
  category: ProspectCategory | null
  status: string
  template_variant: string
  daily_cap: number
  timezone: string
  send_time_local: string
}

export interface ProspectEvent {
  id: string
  event_type: string
  actor_type: string
  actor_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

export interface ProspectImportBatch {
  id: string
  filename: string
  category: ProspectCategory
  row_count: number
  imported_count: number
  skipped_count: number
  actor_id: string | null
  created_at: string
}

export interface ProspectFollowUp {
  id: string
  prospect_id: string
  step_number: number
  scheduled_at: string
  status: "pending" | "sent" | "skipped" | "cancelled"
  slot_key?: string | null
  draft_subject?: string | null
  draft_body?: string | null
  sent_at?: string | null
  category?: ProspectCategory | null
  contact_name?: string | null
  company_name?: string | null
  email_address?: string | null
}

export interface ReplySyncSummary {
  checked_at: string
  scanned_messages: number
  processed_messages: number
  prospect_replies: number
  lead_replies: number
  opt_outs: number
  positive_replies: number
  unmatched_messages: number
  bounces?: number
  review_items?: number
}

export interface ProspectSuppression {
  id: string
  scope_type: "email" | "domain" | "company"
  scope_value: string
  reason: string | null
  source?: string | null
  active: boolean
  company_id?: string | null
  prospect_id?: string | null
  created_at: string
  updated_at?: string | null
}

export interface OutreachReviewItem {
  id: string
  prospect_id?: string | null
  category?: ProspectCategory | null
  company_name?: string | null
  contact_name?: string | null
  email_address?: string | null
  reason: string | null
  created_at: string
  gmail_thread_id?: string | null
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

export interface ProspectDetailResponse {
  prospect: ProspectRow
  draft: {
    subject: string
    body: string
  }
  timeline: ProspectEvent[]
  import_batch: ProspectImportBatch | null
  follow_ups: ProspectFollowUp[]
  suppressions?: ProspectSuppression[]
  review_items?: Array<{
    id: string
    reason?: string | null
    subject?: string | null
    sender_email?: string | null
    target_email?: string | null
    gmail_thread_id?: string | null
    created_at?: string
  }>
}

export interface RunCounters {
  permits_found?: number
  permits_skipped_low_relevance?: number
  permits_deduplicated?: number
  leads_created?: number
  leads_enriched?: number
  leads_ready?: number
  leads_review?: number
  drafts_generated?: number
  sends_attempted?: number
  sends_succeeded?: number
  sends_failed?: number
}

export interface RunProgress {
  backlog_pending: number
  claimed: number
  processed: number
  fresh_inserted: number
  remaining: number
  ready?: number
  review?: number
  email_required?: number
  archived_no_email?: number
  sent?: number
}

export interface AutomationRun {
  id: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  current_stage: string | null
  started_at: string | null
  completed_at?: string | null
  mode?: string | null
  slot_key?: string | null
  target_claim_count?: number
  backlog_pending_at_start?: number
  counters?: RunCounters
  progress?: RunProgress
  summary?: Record<string, number>
  per_category?: {
    attempted_by_category: Record<ProspectCategory, number>
    sent_by_category: Record<ProspectCategory, number>
    skipped_by_category: Record<ProspectCategory, number>
    selected_count: number
  } | null
}

export interface ProspectAutomationSummary {
  pilot_enabled: boolean
  permit_auto_send_enabled: boolean
  timezone: string
  initial_send_time: string
  follow_up_send_time: string
  initial_daily_per_category: number
  follow_up_daily_per_category: number
  follow_up_delay_days: number
  follow_up_offsets_days?: number[]
  initial_sent_today: Record<ProspectCategory, number>
  follow_up_sent_today: Record<ProspectCategory, number>
  sent_today_by_category?: Record<ProspectCategory, number>
  initial_queue_by_category: Record<ProspectCategory, number>
  follow_up_due_by_category: Record<ProspectCategory, number>
  opted_out_by_category: Record<ProspectCategory, number>
  positive_replies_by_category?: Record<ProspectCategory, number>
  suppressed_by_category?: Record<ProspectCategory, number>
  initial_queue: ProspectRow[]
  follow_up_queue: ProspectFollowUp[]
  metrics?: {
    contacts_total: number
    sent_total: number
    delivered_total: number
    replied_total?: number
    positive_replies_total: number
    opted_out_total?: number
    bounced_total?: number
    suppressed_total: number
  }
  campaigns?: Array<{
    key: string
    label: string
    category: ProspectCategory
    contacts: number
    queued_initial: number
    follow_ups_due: number
    sent_today: number
    sent_total: number
    delivered_total: number
    positive_replies: number
    suppressed_total: number
  }>
  campaign_batches?: Array<{
    id: string
    filename: string
    category: ProspectCategory
    imported_count: number
    skipped_count: number
    created_at: string
    sent_total: number
    delivered_total: number
    replied_total: number
    positive_replies_total: number
    opted_out_total: number
    bounced_total: number
    contacts_total: number
  }>
  suppressed_contacts?: Array<{
    id: string
    category: ProspectCategory
    company_name: string | null
    contact_name: string | null
    email_address: string
    reason: string | null
    updated_at: string
  }>
  suppression_entries?: ProspectSuppression[]
  review_queue?: OutreachReviewItem[]
  companies?: Array<{
    id: string
    name: string
    domain: string | null
    website: string | null
    category: ProspectCategory | null
    suppressed: boolean
    suppressed_reason: string | null
    contact_count: number
    sent_total: number
    replied_total: number
    positive_replies_total: number
  }>
  campaign_catalog?: Array<{
    id: string
    name: string
    category: ProspectCategory
    status: string
    daily_cap: number
    send_time_local: string
    timezone: string
    contacts_total: number
    sent_total: number
    delivered_total: number
    replied_total: number
    positive_replies_total: number
    bounced_total: number
    suppressed_total: number
  }>
  reply_sync?: ReplySyncSummary | null
  recent_sends: Array<{
    id: string
    prospect_id: string
    category: ProspectCategory | null
    contact_name: string
    email_address: string
    sent_at: string
    kind: "initial" | "follow_up"
  }>
  exceptions: Array<{
    id: string
    prospect_id: string
    label: string
    category: ProspectCategory | null
    event_type: string
    created_at: string
  }>
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
  automation_backlog_pending: number
  counts: {
    new: number
    ready: number
    review: number
    email_required: number
  }
  new_leads: LeadRow[]
  automation_backlog: LeadRow[]
  processed_this_run: LeadRow[]
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
  prospect_automation: ProspectAutomationSummary
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

export interface WorkspaceAccount {
  id: string
  slug: string
  name: string
  business_name: string
  website: string | null
  primary_login_domain: string
  icon: string | null
  accent_color: string | null
  sender_name: string | null
  sender_email: string | null
  billing_email?: string | null
  phone?: string | null
  attachment_filename: string | null
  plan_name: string
  plan_price_cents: number
  subscription_status: "trialing" | "active" | "past_due" | "cancelled"
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  onboarding_status?: "pending" | "in_progress" | "completed"
  outreach_pitch?: string | null
  outreach_focus?: string | null
  outreach_cta?: string | null
  default_attachment?: WorkspaceAttachment | null
  default_mailbox?: WorkspaceMailbox | null
  brand?: {
    icon: string | null
    accent_color: string | null
  }
}

export interface WorkspaceMember {
  id: string | null
  email: string
  full_name: string | null
  role: WorkspaceRole
  status: WorkspaceStatus
  can_manage_billing: boolean
  invited_at?: string | null
  invite_expires_at?: string | null
  accepted_at?: string | null
  disabled_at?: string | null
}

export interface WorkspaceAttachment {
  id: string
  filename: string
  content_type: string
  file_size_bytes: number
  status: "active" | "archived"
  is_default: boolean
  uploaded_by: string | null
  storage_key: string
  archived_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface WorkspaceMailbox {
  id: string
  provider: "gmail" | string
  email: string
  display_name: string | null
  status: "active" | "disabled" | "error" | string
  is_default: boolean
  connected_by: string | null
  last_synced_at: string | null
  last_sent_at: string | null
  last_error: string | null
  metadata: Record<string, unknown>
  archived_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface OnboardingState {
  status: "pending" | "in_progress" | "completed"
  business_info_completed: boolean
  sender_identity_completed: boolean
  attachment_completed: boolean
  mailbox_completed: boolean
  first_campaign_ready: boolean
  completed_at: string | null
  business_info_completed_at: string | null
  sender_identity_completed_at: string | null
  attachment_completed_at: string | null
  mailbox_completed_at: string | null
  first_campaign_ready_at: string | null
  attachment_count: number
  mailbox_count: number
  has_default_attachment: boolean
  has_default_mailbox: boolean
}

export interface WorkspaceHealth {
  mailbox_connected: boolean
  mailbox_email: string | null
  attachment_loaded: boolean
  attachment_filename: string | null
  billing_status: WorkspaceAccount["subscription_status"]
  run_freshness: {
    status: "healthy" | "warning" | "stale" | "missing"
    age_minutes: number | null
  }
  reply_sync_freshness: {
    status: "healthy" | "warning" | "stale" | "missing"
    age_minutes: number | null
  }
  outbound_safety: {
    permit_auto_send_enabled: boolean
    daily_send_cap: number
    auto_send_trust_threshold: number
    follow_up_enabled: boolean
  }
}

export interface WorkspaceMetricSeries {
  lead_sends_30d: number
  prospect_sends_30d: number
  prospect_positive_replies_30d: number
  prospect_opt_outs_30d: number
  runs_30d: number
  runs_failed_30d: number
}

export interface AuditEvent {
  id: string
  actor_type: string
  actor_id: string | null
  event_type: string
  target_type: string | null
  target_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

export interface OnboardingPayload {
  requires_bootstrap: boolean
  email?: string
  suggested_slug?: string
  capabilities?: WorkspaceCapabilities
  account?: WorkspaceAccount
  current_member?: WorkspaceMember
  onboarding?: OnboardingState | null
  attachments?: WorkspaceAttachment[]
  mailboxes?: WorkspaceMailbox[]
}

export interface InvitePreviewPayload {
  invite: {
    token: string
    email: string
    full_name: string | null
    role: WorkspaceRole
    status: WorkspaceStatus
    invite_expires_at: string | null
  }
  account: WorkspaceAccount
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
  prospect_pilot_enabled: boolean
  prospect_initial_daily_per_category: number
  prospect_follow_up_daily_per_category: number
  prospect_timezone: string
  prospect_initial_send_time: string
  prospect_follow_up_send_time: string
  prospect_follow_up_delay_days: number
  prospect_daily_per_category?: number
  prospect_follow_up_offsets_days?: number[]
  permit_auto_send_enabled: boolean
}

export interface LeadsPayload {
  leads: LeadRow[]
  page: number
  limit: number
}

export interface ProspectsPayload {
  prospects: ProspectRow[]
  page: number
  limit: number
  counts: Record<"all" | ProspectStatus, number>
  categories: Record<ProspectCategory, number>
  recent_imports: ProspectImportBatch[]
  initial_queue: ProspectRow[]
  follow_up_queue: ProspectFollowUp[]
  automation: ProspectAutomationSummary
}

export interface SystemPayload {
  account: WorkspaceAccount
  current_member: WorkspaceMember
  members: WorkspaceMember[]
  capabilities?: WorkspaceCapabilities
  onboarding?: OnboardingState | null
  attachments?: WorkspaceAttachment[]
  default_attachment?: WorkspaceAttachment | null
  mailboxes?: WorkspaceMailbox[]
  default_mailbox?: WorkspaceMailbox | null
  billing?: {
    status: WorkspaceAccount["subscription_status"]
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
    owner_only: boolean
  }
  worker: {
    ok: boolean
    has_gmail_client: boolean
  }
  health: WorkspaceHealth
  metrics?: WorkspaceMetricSeries
  total_leads: number
  total_prospects?: number
  recent_failures: Array<{
    id: string
    job_type: string
    error_message: string | null
    error_code: string | null
    created_at: string
  }>
  domain_health_reference: Array<{
    domain: string
    health_score: number
    checked_at: string
  }>
  recent_runs: Array<AutomationRun>
  reply_sync?: ReplySyncSummary | null
}
