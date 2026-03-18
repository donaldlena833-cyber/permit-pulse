export type LeadTier = "hot" | "warm" | "cold"

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
  | "scanner"
  | "workspace"
  | "enrichment"
  | "outreach"
  | "profile"

export type AppTheme = "light" | "dark"

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
  activeViewId: string
  enrichmentQueueId: string
  outreachQueueId: string
  filters: LeadFilters
  profile: TenantProfile
  leads: Record<string, PermitLead>
  selectedLeadId: string | null
  lastScanAt: string | null
}
