import { OUTREACH_PLUGIN_LINES } from "@/features/permit-pulse/data/plugin-lines"
import {
  type AutomationSummary,
  type ChannelDecision,
  type CompanyProfile,
  type ContactabilityBreakdown,
  type ContactRecord,
  type EnrichmentData,
  type EnrichmentFact,
  type LeadActivity,
  type LeadActivityType,
  type LeadTier,
  type LeadWorkflowState,
  type NextActionRecommendation,
  type OutreachDraft,
  type OutreachHistoryItem,
  type OutreachReadiness,
  type PermitLead,
  type PermitRecord,
  type PropertyProfile,
  type PriorityLabel,
  type ProjectTag,
  type ScoreBreakdown,
  type TenantProfile,
} from "@/types/permit-pulse"
import {
  formatCurrency,
  formatDate,
  getApplicantDisplay,
  getFilingRepDisplay,
  getLeadAgeDays,
} from "@/features/permit-pulse/lib/format"

function normalize(value?: string): string {
  return (value ?? "").toLowerCase()
}

function parseCost(value?: string): number {
  const amount = Number.parseInt(value ?? "0", 10)
  return Number.isNaN(amount) ? 0 : amount
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value))
}

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function hashValue(value: string): number {
  return Array.from(value).reduce((total, character) => total + character.charCodeAt(0), 0)
}

function includesAny(text: string, entries: string[]): string[] {
  return entries.filter((entry) => text.includes(normalize(entry)))
}

function getProjectTags(permit: PermitRecord, breakdown: ScoreBreakdown): ProjectTag[] {
  const description = normalize(permit.job_description)
  const tags: ProjectTag[] = []

  if (description.includes("shower") || description.includes("bathroom")) {
    tags.push("shower")
  }

  if (description.includes("mirror")) {
    tags.push("mirror")
  }

  if (description.includes("storefront") || description.includes("curtain wall")) {
    tags.push("storefront")
  }

  if (description.includes("partition") || description.includes("divider")) {
    tags.push("partitions")
  }

  if (breakdown.commercialSignal > 0) {
    tags.push("commercial")
  }

  if (breakdown.inferredNeed > 0 || description.includes("renovation") || description.includes("alteration")) {
    tags.push("renovation")
  }

  return uniq(tags)
}

export function createEmptyEnrichment(): EnrichmentData {
  return {
    companyWebsite: "",
    directEmail: "",
    genericEmail: "",
    phone: "",
    linkedInUrl: "",
    instagramUrl: "",
    contactFormUrl: "",
    contactPersonName: "",
    contactRole: "",
    notes: "",
    researchNotes: "",
    sourceTags: [],
    confidenceTags: [],
    followUpDate: "",
  }
}

export function createEmptyOutreachDraft(): OutreachDraft {
  return {
    subject: "",
    introLine: "",
    shortEmail: "",
    callOpener: "",
    followUpNote: "",
    updatedAt: null,
  }
}

export function createEmptyPropertyProfile(): PropertyProfile {
  return {
    normalizedAddress: "",
    neighborhood: "",
    buildingType: "",
    propertyClass: "",
    boroughConfidence: 0,
    placeName: "",
    placeId: "",
    bin: "",
    bbl: "",
    block: "",
    lot: "",
    hpdSignal: "",
    acrisSignal: "",
    confidence: 0,
    sourceTags: [],
  }
}

export function createEmptyCompanyProfile(): CompanyProfile {
  return {
    name: "",
    normalizedName: "",
    role: "",
    website: "",
    domain: "",
    confidence: 0,
    description: "",
    searchQuery: "",
    matchStrength: "weak",
    linkedInUrl: "",
    instagramUrl: "",
  }
}

export function createEmptyOutreachReadiness(): OutreachReadiness {
  return {
    score: 0,
    label: "Needs Review",
    explanation: "Automation has not evaluated this lead yet.",
    blockers: ["Automation not yet run"],
  }
}

export function createEmptyChannelDecision(): ChannelDecision {
  return {
    primary: "email",
    reason: "No remote automation signal yet.",
    alternatives: [],
    autoSendEligible: false,
  }
}

export function createEmptyAutomationSummary(): AutomationSummary {
  return {
    companyMatchStrength: "weak",
    enrichmentConfidence: 0,
    autoSendEligible: false,
    autoSendReason: "Automation has not evaluated this lead yet.",
    lastAutomationRunAt: null,
  }
}

export function createEmptyContactRecords(): ContactRecord[] {
  return []
}

export function createEmptyEnrichmentFacts(): EnrichmentFact[] {
  return []
}

export function createEmptyOutreachHistory(): OutreachHistoryItem[] {
  return []
}

export function createDefaultWorkflow(): LeadWorkflowState {
  return {
    status: "new",
    ignored: false,
    nextActionDue: "",
    lastReviewedAt: null,
  }
}

export function createActivity(
  type: LeadActivityType,
  title: string,
  detail: string,
  createdAt = new Date().toISOString(),
): LeadActivity {
  return {
    id: `${type}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    detail,
    createdAt,
  }
}

function appendActivity(existing: LeadActivity[], activity: LeadActivity): LeadActivity[] {
  return [activity, ...existing]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 40)
}

export function scorePermitForTenant(permit: PermitRecord, tenant: TenantProfile): ScoreBreakdown {
  const description = normalize(permit.job_description)
  const searchable = normalize(
    [
      permit.job_description,
      permit.owner_name,
      permit.owner_business_name,
      permit.applicant_business_name,
      getApplicantDisplay(permit),
      getFilingRepDisplay(permit),
    ].join(" "),
  )

  const reasons: string[] = []
  const disqualifiers: string[] = []

  const directHits = includesAny(description, tenant.directKeywords)
  const inferredHits = includesAny(description, tenant.inferredKeywords)
  const commercialHits = includesAny(description, tenant.commercialSignals)
  const buildingHits = includesAny(description, tenant.buildingSignals)
  const excludeHits = includesAny(searchable, [...tenant.excludeKeywords, ...tenant.blacklist])

  if (excludeHits.length > 0) {
    disqualifiers.push(`Excluded by profile: ${excludeHits[0]}`)
    return {
      directKeyword: 0,
      inferredNeed: 0,
      costSignal: 0,
      commercialSignal: 0,
      buildingTypeSignal: 0,
      recencyBonus: 0,
      locationBonus: 0,
      negativeSignals: 0,
      total: 0,
      reasons: ["Permit is outside the MetroGlassPro scope profile."],
      disqualifiers,
      summary: "Excluded by MetroGlassPro scoring rules.",
    }
  }

  let directKeyword = 0
  let inferredNeed = 0
  let costSignal = 0
  let commercialSignal = 0
  let buildingTypeSignal = 0
  let recencyBonus = 0
  let locationBonus = 0
  let negativeSignals = 0

  if (directHits.length >= 3) {
    directKeyword = tenant.scoringWeights.directKeyword
    reasons.push(`Strong direct trade signal: ${directHits.slice(0, 3).join(", ")}`)
  } else if (directHits.length === 2) {
    directKeyword = 32
    reasons.push(`Direct trade signal: ${directHits.join(", ")}`)
  } else if (directHits.length === 1) {
    directKeyword = 22
    reasons.push(`Explicit glazing signal: ${directHits[0]}`)
  }

  if (inferredHits.length >= 2) {
    inferredNeed = tenant.scoringWeights.inferredNeed
    reasons.push(`Renovation likely creates glass scope: ${inferredHits.slice(0, 2).join(", ")}`)
  } else if (inferredHits.length === 1) {
    inferredNeed = 12
    reasons.push(`Inferred need from permit scope: ${inferredHits[0]}`)
  }

  const cost = parseCost(permit.estimated_job_costs)
  if (cost >= tenant.sweetSpotCostMin && cost <= tenant.sweetSpotCostMax) {
    costSignal = tenant.scoringWeights.costSignal
    reasons.push(`Budget lands in the MetroGlassPro sweet spot at ${formatCurrency(cost)}`)
  } else if (cost >= tenant.sweetSpotCostMax) {
    costSignal = 10
    reasons.push(`Large project value at ${formatCurrency(cost)}`)
  } else if (cost >= tenant.minCostThreshold) {
    costSignal = 5
    reasons.push(`Budget clears the floor at ${formatCurrency(cost)}`)
  } else {
    negativeSignals += tenant.scoringWeights.negativeSignal
    reasons.push("Estimated cost looks light for MetroGlassPro's preferred scope.")
  }

  if (commercialHits.length > 0) {
    commercialSignal = tenant.scoringWeights.commercialSignal
    reasons.push(`Commercial fit: ${commercialHits[0]}`)
  }

  if (buildingHits.length > 0) {
    buildingTypeSignal = tenant.scoringWeights.buildingTypeSignal
    reasons.push(`Target building type: ${buildingHits[0]}`)
  }

  const ageDays = getLeadAgeDays(permit.issued_date)
  if (ageDays <= 3) {
    recencyBonus = tenant.scoringWeights.recencyBonus
    reasons.push("Fresh permit issued within the last three days.")
  } else if (ageDays <= 7) {
    recencyBonus = 7
    reasons.push("Permit is still in the best first-outreach window.")
  } else if (ageDays <= 14) {
    recencyBonus = 4
  } else if (ageDays > 30) {
    negativeSignals += 6
    reasons.push("Permit is getting stale and may already be covered.")
  }

  if (tenant.primaryBoroughs.includes(permit.borough)) {
    locationBonus += 4
    const nta = normalize(permit.nta)
    if (tenant.primaryNeighborhoods.some((entry) => nta.includes(normalize(entry)))) {
      locationBonus += 3
      reasons.push(`Priority submarket match in ${permit.nta}`)
    } else {
      reasons.push(`Primary borough match in ${permit.borough}`)
    }
  } else if (tenant.secondaryBoroughs.includes(permit.borough)) {
    locationBonus += 2
    reasons.push(`Secondary borough coverage in ${permit.borough}`)
  } else {
    negativeSignals += 4
    reasons.push(`Outside the current borough focus in ${permit.borough}`)
  }

  const positiveTotal =
    directKeyword +
    inferredNeed +
    costSignal +
    commercialSignal +
    buildingTypeSignal +
    recencyBonus +
    locationBonus

  const total = clamp(positiveTotal - negativeSignals)

  const summaryParts: string[] = []

  if (directKeyword >= 22) {
    summaryParts.push("Strong glazing signal in permit description")
  } else if (inferredNeed >= 12) {
    summaryParts.push("Renovation scope points to likely glass work")
  } else if (commercialSignal > 0) {
    summaryParts.push("Commercial fit is better than the wording alone suggests")
  }

  if (negativeSignals >= 10) {
    summaryParts.push("there are still clear fit risks to sanity-check")
  } else if (recencyBonus >= 7) {
    summaryParts.push("the timing is still favorable for early outreach")
  }

  return {
    directKeyword,
    inferredNeed,
    costSignal,
    commercialSignal,
    buildingTypeSignal,
    recencyBonus,
    locationBonus,
    negativeSignals,
    total,
    reasons,
    disqualifiers,
    summary: summaryParts.length > 0 ? summaryParts.join(", ") : "Moderate fit with room for manual qualification.",
  }
}

export function getLeadTier(score: number): LeadTier {
  if (score >= 45) {
    return "hot"
  }

  if (score >= 25) {
    return "warm"
  }

  return "cold"
}

export function getContactabilityBreakdown(
  permit: PermitRecord,
  enrichment: EnrichmentData,
): ContactabilityBreakdown {
  let ownerPresent = 0
  let ownerBusinessPresent = 0
  let gcPresent = 0
  let filingRepPresent = 0
  let websiteFound = 0
  let directEmailFound = 0
  let genericEmailFound = 0
  let phoneFound = 0
  let contactFormFound = 0
  let linkedInFound = 0
  let instagramFound = 0

  const reasons: string[] = []
  const missing: string[] = []

  if (permit.owner_name) {
    ownerPresent = 8
    reasons.push("Owner name is already on the permit.")
  } else {
    missing.push("owner name")
  }

  if (permit.owner_business_name) {
    ownerBusinessPresent = 10
    reasons.push("Owner business is named.")
  } else {
    missing.push("owner business")
  }

  if (getApplicantDisplay(permit) !== "—") {
    gcPresent = 12
    reasons.push("A GC or applicant is already on file.")
  } else {
    missing.push("GC / applicant")
  }

  if (getFilingRepDisplay(permit) !== "—") {
    filingRepPresent = 6
    reasons.push("Filing rep is available for secondary research.")
  }

  if (enrichment.companyWebsite) {
    websiteFound = 12
    reasons.push("Company website is saved.")
  } else {
    missing.push("website")
  }

  if (enrichment.directEmail) {
    directEmailFound = 16
    reasons.push("Direct email is available.")
  } else {
    missing.push("direct email")
  }

  if (enrichment.genericEmail) {
    genericEmailFound = 8
    reasons.push("Generic email is available.")
  }

  if (enrichment.phone) {
    phoneFound = 12
    reasons.push("Phone number is on file.")
  } else {
    missing.push("phone")
  }

  if (enrichment.contactFormUrl) {
    contactFormFound = 6
    reasons.push("Contact form route is available.")
  }

  if (enrichment.linkedInUrl) {
    linkedInFound = 6
    reasons.push("LinkedIn research is linked.")
  }

  if (enrichment.instagramUrl) {
    instagramFound = 4
    reasons.push("Instagram route is saved.")
  }

  const total = clamp(
    ownerPresent +
      ownerBusinessPresent +
      gcPresent +
      filingRepPresent +
      websiteFound +
      directEmailFound +
      genericEmailFound +
      phoneFound +
      contactFormFound +
      linkedInFound +
      instagramFound,
  )

  let label: ContactabilityBreakdown["label"] = "Weak"
  if (total >= 80) {
    label = "Excellent"
  } else if (total >= 60) {
    label = "Good"
  } else if (total >= 35) {
    label = "Fair"
  }

  const explanation =
    label === "Excellent"
      ? "Multiple clean outreach paths are already in place."
      : label === "Good"
        ? "Reachable enough to move into drafting or calling with light research."
        : label === "Fair"
          ? "Scored high, but contact data still needs work before outreach is efficient."
          : "Research is still the bottleneck. Build the contact layer before outreach."

  return {
    ownerPresent,
    ownerBusinessPresent,
    gcPresent,
    filingRepPresent,
    websiteFound,
    directEmailFound,
    genericEmailFound,
    phoneFound,
    contactFormFound,
    linkedInFound,
    instagramFound,
    total,
    label,
    reasons,
    missing,
    explanation,
  }
}

function getPriorityScore(
  permit: PermitRecord,
  scoreBreakdown: ScoreBreakdown,
  contactabilityTotal: number,
  tenant: TenantProfile,
): number {
  const scoreComponent = scoreBreakdown.total * 0.5
  const contactabilityComponent = contactabilityTotal * 0.22
  const cost = parseCost(permit.estimated_job_costs)

  let sizeComponent = 1
  if (cost >= 250000) {
    sizeComponent = 12
  } else if (cost >= 150000) {
    sizeComponent = 10
  } else if (cost >= 75000) {
    sizeComponent = 8
  } else if (cost >= tenant.minCostThreshold) {
    sizeComponent = 4
  }

  let locationComponent = 2
  if (tenant.primaryBoroughs.includes(permit.borough)) {
    locationComponent = 8
  } else if (tenant.secondaryBoroughs.includes(permit.borough)) {
    locationComponent = 5
  }

  const ageDays = getLeadAgeDays(permit.issued_date)
  let recencyComponent = 0
  if (ageDays <= 3) {
    recencyComponent = 8
  } else if (ageDays <= 7) {
    recencyComponent = 6
  } else if (ageDays <= 14) {
    recencyComponent = 4
  } else if (ageDays <= 30) {
    recencyComponent = 2
  }

  return Math.round(scoreComponent + contactabilityComponent + sizeComponent + locationComponent + recencyComponent)
}

function getPriorityLabel(
  permit: PermitRecord,
  scoreBreakdown: ScoreBreakdown,
  contactability: ContactabilityBreakdown,
  tenant: TenantProfile,
): { priorityLabel: PriorityLabel; priorityScore: number } {
  const priorityScore = getPriorityScore(permit, scoreBreakdown, contactability.total, tenant)

  if (scoreBreakdown.disqualifiers.length > 0 || scoreBreakdown.total < 12) {
    return { priorityLabel: "Ignore", priorityScore }
  }

  if (priorityScore >= 78) {
    return { priorityLabel: "Attack Now", priorityScore }
  }

  if (priorityScore >= 58) {
    return { priorityLabel: "Research Today", priorityScore }
  }

  if (priorityScore >= 40) {
    return { priorityLabel: "Worth a Try", priorityScore }
  }

  if (priorityScore >= 20) {
    return { priorityLabel: "Monitor", priorityScore }
  }

  return { priorityLabel: "Ignore", priorityScore }
}

function buildNextAction(
  permit: PermitRecord,
  leadTier: LeadTier,
  scoreBreakdown: ScoreBreakdown,
  contactability: ContactabilityBreakdown,
  enrichment: EnrichmentData,
  workflow: LeadWorkflowState,
  priorityLabel: PriorityLabel,
): NextActionRecommendation {
  const hasWebsite = Boolean(enrichment.companyWebsite)
  const hasAnyEmail = Boolean(enrichment.directEmail || enrichment.genericEmail)
  const hasPhone = Boolean(enrichment.phone)
  const hasForm = Boolean(enrichment.contactFormUrl)
  const hasGc = getApplicantDisplay(permit) !== "—"
  const hasOwnerBusiness = Boolean(permit.owner_business_name)

  if (priorityLabel === "Ignore" || scoreBreakdown.disqualifiers.length > 0) {
    return {
      label: "Discard / low fit",
      detail: "The permit is either out of scope or too weak to justify active effort right now.",
      queue: "discard",
      urgency: "low",
    }
  }

  const followUpDue = workflow.nextActionDue && new Date(workflow.nextActionDue).getTime() <= Date.now()
  if (followUpDue || workflow.status === "follow-up-due") {
    return {
      label: "Follow up today",
      detail: "A previous touchpoint already exists. Re-open the thread while the permit is still fresh.",
      queue: "email",
      urgency: "high",
    }
  }

  if (leadTier === "hot" && hasPhone && hasGc) {
    return {
      label: "Call GC",
      detail: "Best chance to win this early is a contractor-to-contractor call while scope is still forming.",
      queue: "call",
      urgency: "high",
    }
  }

  if (leadTier === "hot" && hasAnyEmail) {
    return {
      label: "Draft email to owner business",
      detail: "You already have enough reachability to move this into outreach today.",
      queue: "email",
      urgency: "high",
    }
  }

  if (hasGc && !hasPhone) {
    return {
      label: "Search GC phone",
      detail: "The GC is known, but the contact path is still incomplete.",
      queue: "research",
      urgency: leadTier === "hot" ? "high" : "medium",
    }
  }

  if (hasOwnerBusiness && !hasWebsite) {
    return {
      label: "Visit owner website",
      detail: "A website is the fastest way to unlock phone, email, and contact form routes.",
      queue: "research",
      urgency: "medium",
    }
  }

  if (hasForm && contactability.total >= 45) {
    return {
      label: "Submit contact form",
      detail: "You have enough context to send a clean first-touch note through the site.",
      queue: "form",
      urgency: "medium",
    }
  }

  if (hasGc && !enrichment.linkedInUrl) {
    return {
      label: "Search LinkedIn for applicant",
      detail: "LinkedIn can unlock a faster route when the permit fit is strong but contact data is thin.",
      queue: "research",
      urgency: "medium",
    }
  }

  if (leadTier === "warm" && scoreBreakdown.inferredNeed >= 12) {
    return {
      label: "Research owner contact",
      detail: "The renovation signal is good. Build a reachable path before spending time on copy.",
      queue: "research",
      urgency: "medium",
    }
  }

  return {
    label: "Monitor only",
    detail: "Keep the permit visible, but let stronger and more reachable work move first.",
    queue: "monitor",
    urgency: "low",
  }
}

function buildHumanSummary(
  permit: PermitRecord,
  scoreBreakdown: ScoreBreakdown,
  contactability: ContactabilityBreakdown,
  nextAction: NextActionRecommendation,
): string {
  const summary: string[] = []

  if (scoreBreakdown.directKeyword >= 22) {
    summary.push("Strong glazing signal in permit description.")
  } else if (scoreBreakdown.inferredNeed >= 12) {
    summary.push("Renovation scope likely needs glass or mirror work.")
  } else if (scoreBreakdown.commercialSignal > 0) {
    summary.push("Commercial fit is worth a closer look.")
  }

  if (contactability.label === "Weak") {
    summary.push("Contact data is still weak.")
  } else if (contactability.label === "Excellent") {
    summary.push("Reachability is already strong enough for fast outreach.")
  }

  if (permit.owner_business_name && !summary.some((entry) => entry.includes("Contact data"))) {
    summary.push(`Owner business on file: ${permit.owner_business_name}.`)
  }

  summary.push(`Best next step: ${nextAction.label}.`)
  return summary.join(" ")
}

export function refreshDerivedLead(lead: PermitLead, tenant: TenantProfile): PermitLead {
  const scoreBreakdown = scorePermitForTenant(lead, tenant)
  const leadTier = getLeadTier(scoreBreakdown.total)
  const contactability = getContactabilityBreakdown(lead, lead.enrichment)
  const { priorityLabel, priorityScore } = getPriorityLabel(lead, scoreBreakdown, contactability, tenant)
  const nextAction = buildNextAction(
    lead,
    leadTier,
    scoreBreakdown,
    contactability,
    lead.enrichment,
    lead.workflow,
    priorityLabel,
  )
  const hasEmail = Boolean(lead.enrichment.directEmail || lead.enrichment.genericEmail || lead.contacts.some((contact) => contact.email))
  const hasPhone = Boolean(lead.enrichment.phone || lead.contacts.some((contact) => contact.phone))
  const hasForm = Boolean(lead.enrichment.contactFormUrl || lead.contacts.some((contact) => contact.contactFormUrl))
  const readinessScore = clamp(Math.round((scoreBreakdown.total * 0.48) + (contactability.total * 0.4) + ((lead.companyProfile.confidence || 0) * 0.12)))
  const outreachReadiness: OutreachReadiness = {
    score: readinessScore,
    label: readinessScore >= 75 ? "Ready" : readinessScore >= 55 ? "Almost Ready" : readinessScore >= 35 ? "Needs Review" : "Blocked",
    explanation:
      readinessScore >= 75
        ? "Enough context and contact data exist to move directly into outreach."
        : readinessScore >= 55
          ? "Close to ready, but still worth one more research pass."
          : readinessScore >= 35
            ? "The lead has promise, but the contact layer is still thin."
            : "The lead still needs core research before outreach should move.",
    blockers: [
      !hasEmail && !hasPhone && !hasForm ? "No contact route saved" : "",
      lead.companyProfile.matchStrength === "weak" ? "Company match is still weak" : "",
    ].filter(Boolean),
  }
  const channelDecision: ChannelDecision = {
    primary: hasEmail ? "email" : hasPhone ? "phone" : hasForm ? "form" : "linkedin",
    reason:
      hasEmail
        ? "Email is available, so it remains the cleanest first channel."
        : hasPhone
          ? "Phone is available before email, so contractor-to-contractor outreach should move first."
          : hasForm
            ? "Contact form is the only reliable route saved right now."
            : "No email was found yet, so LinkedIn remains a research draft rather than an auto-send path.",
    alternatives: [hasPhone ? "phone" : null, hasForm ? "form" : null].filter(Boolean) as ChannelDecision["alternatives"],
    autoSendEligible: hasEmail && scoreBreakdown.total >= 55 && contactability.total >= 55 && lead.companyProfile.matchStrength !== "weak",
  }

  return {
    ...lead,
    score: scoreBreakdown.total,
    scoreBreakdown,
    leadTier,
    contactability,
    priorityLabel,
    priorityScore,
    nextAction,
    projectTags: getProjectTags(lead, scoreBreakdown),
    humanSummary: buildHumanSummary(lead, scoreBreakdown, contactability, nextAction),
    outreachReadiness,
    channelDecision,
    automationSummary: {
      ...lead.automationSummary,
      companyMatchStrength: lead.companyProfile.matchStrength,
      enrichmentConfidence: Math.round(((lead.companyProfile.confidence || 0) * 0.45) + ((lead.propertyProfile.confidence || 0) * 0.25) + (outreachReadiness.score * 0.3)),
      autoSendEligible: channelDecision.autoSendEligible,
      autoSendReason: channelDecision.autoSendEligible
        ? "Lead passes local automation heuristics."
        : "Lead still needs stronger contactability or company confidence.",
    },
  }
}

export function buildLeadFromPermit(
  permit: PermitRecord,
  tenant: TenantProfile,
  existingLead: PermitLead | undefined,
  scannedAt: string,
): PermitLead {
  const enrichment = existingLead?.enrichment ?? createEmptyEnrichment()
  const outreachDraft = existingLead?.outreachDraft ?? createEmptyOutreachDraft()
  const workflow = existingLead?.workflow ?? createDefaultWorkflow()
  const propertyProfile = existingLead?.propertyProfile ?? createEmptyPropertyProfile()
  const companyProfile = existingLead?.companyProfile ?? createEmptyCompanyProfile()
  const baseLead: PermitLead = {
    ...permit,
    id:
      permit.job_filing_number ||
      existingLead?.id ||
      `${permit.block}-${permit.lot}-${permit.house_no}-${permit.street_name}`,
    score: 0,
    scoreBreakdown: {
      directKeyword: 0,
      inferredNeed: 0,
      costSignal: 0,
      commercialSignal: 0,
      buildingTypeSignal: 0,
      recencyBonus: 0,
      locationBonus: 0,
      negativeSignals: 0,
      total: 0,
      reasons: [],
      disqualifiers: [],
      summary: "",
    },
    leadTier: "cold",
    contactability: getContactabilityBreakdown(permit, enrichment),
    nextAction: {
      label: "Monitor only",
      detail: "Lead has not been fully scored yet.",
      queue: "monitor",
      urgency: "low",
    },
    priorityLabel: "Monitor",
    priorityScore: 0,
    humanSummary: "",
    projectTags: [],
    enrichment,
    outreachDraft,
    activities: existingLead?.activities ?? [],
    workflow,
    lastScannedAt: scannedAt,
    scannedCount: (existingLead?.scannedCount ?? 0) + 1,
    propertyProfile,
    companyProfile,
    contacts: existingLead?.contacts ?? createEmptyContactRecords(),
    enrichmentFacts: existingLead?.enrichmentFacts ?? createEmptyEnrichmentFacts(),
    outreachReadiness: existingLead?.outreachReadiness ?? createEmptyOutreachReadiness(),
    channelDecision: existingLead?.channelDecision ?? createEmptyChannelDecision(),
    outreachHistory: existingLead?.outreachHistory ?? createEmptyOutreachHistory(),
    automationSummary: existingLead?.automationSummary ?? createEmptyAutomationSummary(),
  }

  const derivedLead = refreshDerivedLead(baseLead, tenant)
  const scannedDetail = `${formatDate(permit.issued_date)} issued permit synced into the workspace.`
  const scannedActivity = createActivity(
    "scanned",
    existingLead ? "Permit rescanned" : "Permit scanned",
    scannedDetail,
    scannedAt,
  )

  return {
    ...derivedLead,
    activities: appendActivity(existingLead?.activities ?? [], scannedActivity),
  }
}

function getPrimaryProjectPhrase(projectTags: ProjectTag[]): string {
  if (projectTags.includes("storefront")) {
    return "storefront or entry glass scope"
  }

  if (projectTags.includes("partitions")) {
    return "glass partition work"
  }

  if (projectTags.includes("mirror")) {
    return "mirror package"
  }

  if (projectTags.includes("shower")) {
    return "shower glass scope"
  }

  return "glass scope"
}

export function generateDraftFromLead(lead: PermitLead): OutreachDraft {
  const address = `${lead.house_no} ${lead.street_name}`.trim()
  const projectPhrase = getPrimaryProjectPhrase(lead.projectTags)
  const target = lead.enrichment.contactPersonName || lead.owner_business_name || getApplicantDisplay(lead)
  const introTarget = target === "—" ? "your team" : target
  const pluginLine = OUTREACH_PLUGIN_LINES[hashValue(lead.id) % OUTREACH_PLUGIN_LINES.length]
  const subject = `${address}, glass scope`
  const introLine = `I saw the DOB permit at ${address}, and the scope looks like a possible fit for ${projectPhrase}.`
  const shortEmail = [
    `Hi ${introTarget},`,
    "",
    `I came across the permit at ${address}. The scope reads like a real fit for ${projectPhrase}. MetroGlassPro handles shower glass, mirrors, storefronts, and interior glazing work across Manhattan, Brooklyn, and Queens.`,
    "",
    pluginLine,
    "",
    "If the glass package is still open, would it be useful if I sent over pricing or a quick takeoff?",
    "",
    "Donald",
    "MetroGlass Pro",
    "332 999 3846",
  ].join("\n")
  const callOpener = `This is Donald from MetroGlass Pro. I saw the permit at ${address}, and wanted to ask who is handling the ${projectPhrase} on that job.`
  const followUpNote = `Following up on the permit at ${address}. If the ${projectPhrase} is still open, I can send over a quick number.`

  return {
    subject,
    introLine,
    shortEmail,
    callOpener,
    followUpNote,
    updatedAt: new Date().toISOString(),
  }
}
