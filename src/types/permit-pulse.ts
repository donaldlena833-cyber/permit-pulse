export type LeadTier = "hot" | "warm" | "cold"

export type QualityTier = "hot" | "warm" | "cold" | "dead"

export type ContactabilityLabel = "Excellent" | "Good" | "Fair" | "Weak"

export type PriorityLabel =
  | "Attack Now"
  | "Research Today"
  | "Worth a Try"
  | "Monitor"
  | "Ignore"

export type LeadStatus =
  | "new"
  | "reviewed"
  | "researching"
  | "enriched"
  | "outreach-ready"
  | "drafted"
  | "contacted"
  | "follow-up-due"
  | "replied"
  | "qualified"
  | "quoted"
  | "won"
  | "lost"
  | "archived"

export type NextActionQueue =
  | "call"
  | "research"
  | "email"
  | "form"
  | "dm"
  | "monitor"
  | "discard"

export type MainSection =
  | "dashboard"
  | "opportunities"
  | "pipeline"
  | "system"

export type OpportunityLane = "feed" | "research" | "ready" | "sent"

export type AppTheme = "light" | "dark"

export type ContactType = "verified" | "public" | "guessed"

export type OutreachChannel = "email" | "phone" | "form" | "linkedin"

export type OutreachStatus =
  | "draft"
  | "queued"
  | "scheduled"
  | "sent"
  | "failed"
  | "skipped"
  | "needs-review"

export type OutreachReadinessLabel = "Ready" | "Almost Ready" | "Needs Review" | "Blocked"

export type CompanyMatchStrength = "strong" | "medium" | "weak"

export type SortMode =
  | "priority"
  | "score"
  | "contactability"
  | "cost"
  | "recent"

export type SavedViewAccent = "warm" | "bronze" | "olive" | "neutral"

export type ProjectTag =
  | "shower"
  | "mirror"
  | "storefront"
  | "partitions"
  | "commercial"
  | "renovation"

export interface PermitRecord {
  job_filing_number: string
  work_permit?: string
  filing_reason: string
  house_no: string
  street_name: string
  borough: string
  lot: string
  bin: string
  block: string
  c_b_no?: string
  work_on_floor?: string
  work_type: string
  applicant_license?: string
  applicant_first_name?: string
  applicant_middle_name?: string
  applicant_last_name?: string
  applicant_business_name?: string
  applicant_business_address?: string
  filing_representative_first_name?: string
  filing_representative_last_name?: string
  filing_representative_business_name?: string
  approved_date?: string
  issued_date?: string
  expired_date?: string
  job_description: string
  estimated_job_costs: string
  owner_business_name?: string
  owner_name?: string
  permit_status: string
  tracking_number?: string
  zip_code?: string
  latitude?: string
  longitude?: string
  community_board?: string
  council_district?: string
  bbl?: string
  census_tract?: string
  nta?: string
}

export interface ScoreBreakdown {
  directKeyword: number
  inferredNeed: number
  costSignal: number
  commercialSignal: number
  buildingTypeSignal: number
  recencyBonus: number
  locationBonus: number
  negativeSignals: number
  total: number
  reasons: string[]
  disqualifiers: string[]
  summary: string
  relevanceScore?: number
  relevanceKeyword?: string
  serviceAngle?: string
}

export interface ContactabilityBreakdown {
  ownerPresent: number
  ownerBusinessPresent: number
  gcPresent: number
  filingRepPresent: number
  websiteFound: number
  directEmailFound: number
  genericEmailFound: number
  phoneFound: number
  contactFormFound: number
  linkedInFound: number
  instagramFound: number
  total: number
  label: ContactabilityLabel
  reasons: string[]
  missing: string[]
  explanation: string
}

export interface NextActionRecommendation {
  label: string
  detail: string
  queue: NextActionQueue
  urgency: "high" | "medium" | "low"
}

export interface EnrichmentData {
  companyWebsite: string
  directEmail: string
  genericEmail: string
  phone: string
  linkedInUrl: string
  instagramUrl: string
  contactFormUrl: string
  contactPersonName: string
  contactRole: string
  notes: string
  researchNotes: string
  sourceTags: string[]
  confidenceTags: string[]
  followUpDate: string
}

export interface PropertyProfile {
  normalizedAddress: string
  neighborhood: string
  buildingType: string
  propertyClass: string
  boroughConfidence: number
  placeName: string
  placeId: string
  bin: string
  bbl: string
  block: string
  lot: string
  hpdSignal: string
  acrisSignal: string
  confidence: number
  sourceTags: string[]
}

export interface CompanyProfile {
  name: string
  normalizedName: string
  role: string
  website: string
  domain: string
  confidence: number
  description: string
  searchQuery: string
  matchStrength: CompanyMatchStrength
  linkedInUrl: string
  instagramUrl: string
}

export interface ContactRecord {
  id: string
  name: string
  role: string
  email: string
  phone: string
  website: string
  linkedInUrl: string
  instagramUrl: string
  contactFormUrl: string
  source: string
  confidence: number
  type: ContactType
  verified: boolean
  isPrimary: boolean
}

export interface EnrichmentFact {
  id: string
  field: string
  value: string
  source: string
  confidence: number
  note: string
}

export interface OutreachReadiness {
  score: number
  label: OutreachReadinessLabel
  explanation: string
  blockers: string[]
}

export interface ChannelDecision {
  primary: OutreachChannel
  reason: string
  alternatives: OutreachChannel[]
  autoSendEligible: boolean
  routeConfidence?: number
  recipientType?: string
  targetRole?: string
  routeSource?: string
}

export interface OutreachHistoryItem {
  id: string
  channel: OutreachChannel
  status: OutreachStatus
  recipient: string
  recipientType: string
  subject: string
  body: string
  pluginLine: string
  callOpener: string
  followUpNote: string
  sentAt: string | null
  createdAt: string
  scheduledFor: string | null
  messageId: string
}

export interface AutomationSummary {
  companyMatchStrength: CompanyMatchStrength
  enrichmentConfidence: number
  autoSendEligible: boolean
  autoSendReason: string
  lastAutomationRunAt: string | null
}

export type ResolutionCandidateType = "company" | "person"

export type ResolutionCandidateStatus = "selected" | "rejected" | "candidate"

export interface ResolutionCandidate {
  id: string
  type: ResolutionCandidateType
  role: string
  label: string
  url: string
  domain: string
  source: string
  confidence: number
  status: ResolutionCandidateStatus
  detail: string
  matchedQuery: string
}

export interface AutomationHealth {
  ok: boolean
  hasSupabase: boolean
  supabaseAuthMode: "service_role" | "anon" | "missing"
  hasGmail: boolean
  hasBrave: boolean
  hasGoogleMaps: boolean
  hasFirecrawl: boolean
  hasZeroBounce: boolean
  hasDefaultAttachment: boolean
  defaultAttachmentName: string | null
}

export type AutomationJobType =
  | "permit_ingest"
  | "enrichment_batch"
  | "lead_enrichment"
  | "draft_refresh"
  | "send"
  | "status_update"
  | "manual_enrichment"
  | "candidate_select"
  | "candidate_reject"
  | "primary_contact"

export type AutomationJobStatus = "queued" | "running" | "retrying" | "succeeded" | "failed"

export interface AutomationJob {
  id: string
  leadId: string | null
  jobType: AutomationJobType
  status: AutomationJobStatus
  provider: string
  summary: string
  detail: string
  attemptCount: number
  retryable: boolean
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  metadata: Record<string, unknown>
}

export interface SentLogEntry {
  id: string
  leadId: string
  channel: OutreachChannel
  recipient: string
  subject: string
  sentAt: string | null
  status: string
}

export interface OutreachDraft {
  subject: string
  introLine: string
  shortEmail: string
  callOpener: string
  followUpNote: string
  updatedAt: string | null
}

export type LeadActivityType =
  | "scanned"
  | "reviewed"
  | "enriched"
  | "note-added"
  | "contact-found"
  | "draft-created"
  | "status-changed"
  | "follow-up-set"

export interface LeadActivity {
  id: string
  type: LeadActivityType
  title: string
  detail: string
  createdAt: string
}

export interface LeadWorkflowState {
  status: LeadStatus
  ignored: boolean
  nextActionDue: string
  lastReviewedAt: string | null
}

export interface ScoringWeights {
  directKeyword: number
  inferredNeed: number
  costSignal: number
  commercialSignal: number
  buildingTypeSignal: number
  recencyBonus: number
  locationBonus: number
  negativeSignal: number
}

export interface TenantProfile {
  id: string
  name: string
  businessName: string
  website: string
  icon: string
  accentColor: string
  targetServices: string[]
  directKeywords: string[]
  inferredKeywords: string[]
  commercialSignals: string[]
  buildingSignals: string[]
  buildingClientTypes: string[]
  excludeKeywords: string[]
  workTypes: string[]
  minCostThreshold: number
  sweetSpotCostMin: number
  sweetSpotCostMax: number
  primaryBoroughs: string[]
  secondaryBoroughs: string[]
  primaryNeighborhoods: string[]
  blacklist: string[]
  contactabilityWeight: number
  scoringWeights: ScoringWeights
  active: boolean
}

export interface PermitLead extends PermitRecord {
  id: string
  score: number
  scoreBreakdown: ScoreBreakdown
  relevanceScore: number
  relevanceKeyword: string
  serviceAngle: string
  qualityTier: QualityTier
  leadTier: LeadTier
  contactability: ContactabilityBreakdown
  nextAction: NextActionRecommendation
  priorityLabel: PriorityLabel
  priorityScore: number
  humanSummary: string
  projectTags: ProjectTag[]
  enrichment: EnrichmentData
  outreachDraft: OutreachDraft
  activities: LeadActivity[]
  workflow: LeadWorkflowState
  lastScannedAt: string
  scannedCount: number
  propertyProfile: PropertyProfile
  companyProfile: CompanyProfile
  resolutionCandidates: ResolutionCandidate[]
  contacts: ContactRecord[]
  enrichmentFacts: EnrichmentFact[]
  outreachReadiness: OutreachReadiness
  channelDecision: ChannelDecision
  outreachHistory: OutreachHistoryItem[]
  automationSummary: AutomationSummary
}

export interface LeadFilters {
  search: string
  borough: string
  tier: "ALL" | LeadTier
  status: "ALL" | LeadStatus
  sortBy: SortMode
  daysBack: number
  minCost: number
}

export interface SavedViewRule {
  boroughs?: string[]
  tiers?: LeadTier[]
  statuses?: LeadStatus[]
  priorityLabels?: PriorityLabel[]
  projectTags?: ProjectTag[]
  minScore?: number
  minCost?: number
  minContactability?: number
  maxContactability?: number
  maxAgeDays?: number
  nextActionQueue?: NextActionQueue
  needsEnrichment?: boolean
  outreachReady?: boolean
  followUpDue?: boolean
  requiresCommercial?: boolean
}

export interface SavedView {
  id: string
  name: string
  description: string
  accent: SavedViewAccent
  rule: SavedViewRule
}

export interface QueuePreset {
  id: string
  name: string
  description: string
  accent: SavedViewAccent
  rule: SavedViewRule
}

export interface DashboardStat {
  id: string
  label: string
  value: string
  helper: string
  tone: SavedViewAccent
}

export interface DashboardStats {
  totalScanned: number
  hotLeads: number
  warmLeads: number
  needsEnrichment: number
  outreachReady: number
  followUpsDue: number
  avgScore: number
  boroughDistribution: Array<{ borough: string; count: number }>
}

export interface DashboardActivity {
  id: string
  leadId: string
  address: string
  title: string
  detail: string
  createdAt: string
}

export interface PermitPulseStore {
  version: number
  theme: AppTheme
  section: MainSection
  opportunityLane: OpportunityLane
  activeViewId: string
  enrichmentQueueId: string
  outreachQueueId: string
  filters: LeadFilters
  profile: TenantProfile
  leads: Record<string, PermitLead>
  sentLog: SentLogEntry[]
  selectedLeadId: string | null
  lastScanAt: string | null
}
