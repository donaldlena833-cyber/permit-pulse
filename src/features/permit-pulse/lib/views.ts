import type {
  DashboardActivity,
  DashboardStats,
  LeadFilters,
  PermitLead,
  QueuePreset,
  SavedView,
  SavedViewRule,
  SortMode,
} from "@/types/permit-pulse"
import {
  formatRelativeDate,
  getLeadAgeDays,
  getPermitAddress,
  getSearchableLeadText,
} from "@/features/permit-pulse/lib/format"

export const SYSTEM_SAVED_VIEWS: SavedView[] = [
  {
    id: "hot-today",
    name: "Hot Today",
    description: "Fresh high-signal permits worth looking at first.",
    accent: "warm",
    rule: { tiers: ["hot"], maxAgeDays: 3 },
  },
  {
    id: "manhattan-priority",
    name: "Manhattan Priority",
    description: "Work inside the primary borough focus.",
    accent: "bronze",
    rule: { boroughs: ["MANHATTAN"], tiers: ["hot", "warm"] },
  },
  {
    id: "high-score-low-contactability",
    name: "High Score / Low Contactability",
    description: "Strong fit, but still thin on outreach paths.",
    accent: "neutral",
    rule: { minScore: 45, maxContactability: 45 },
  },
  {
    id: "outreach-ready",
    name: "Outreach Ready",
    description: "Ready to email, call, or submit today.",
    accent: "olive",
    rule: { outreachReady: true },
  },
  {
    id: "needs-enrichment",
    name: "Needs Enrichment",
    description: "Promising work that still needs contact research.",
    accent: "neutral",
    rule: { needsEnrichment: true, tiers: ["hot", "warm"] },
  },
  {
    id: "follow-up-due",
    name: "Follow Up Due",
    description: "Leads that need a second touch.",
    accent: "bronze",
    rule: { followUpDue: true },
  },
  {
    id: "high-value-commercial",
    name: "High Value Commercial",
    description: "Commercial permits with better-than-average deal size.",
    accent: "bronze",
    rule: { minCost: 150000, requiresCommercial: true },
  },
  {
    id: "shower-glass-strong",
    name: "Shower / Glass Strong Match",
    description: "Bathroom-led projects with strong glazing pull.",
    accent: "warm",
    rule: { projectTags: ["shower", "mirror"], minScore: 30 },
  },
  {
    id: "storefront-commercial-strong",
    name: "Storefront / Commercial Strong Match",
    description: "Storefronts, partitions, and commercial glazing work.",
    accent: "bronze",
    rule: { projectTags: ["storefront", "partitions", "commercial"], minScore: 30 },
  },
]

export const ENRICHMENT_QUEUE_PRESETS: QueuePreset[] = [
  {
    id: "hot-missing-contact",
    name: "Hot, missing contact",
    description: "High-fit leads that still need a direct route.",
    accent: "warm",
    rule: { tiers: ["hot"], maxContactability: 55 },
  },
  {
    id: "has-gc-no-contact",
    name: "Has GC, no phone/email",
    description: "The GC is known, but outreach details are missing.",
    accent: "neutral",
    rule: { maxContactability: 55, nextActionQueue: "research" },
  },
  {
    id: "owner-biz-no-website",
    name: "Owner biz, no website",
    description: "Good owner signal but weak web footprint.",
    accent: "bronze",
    rule: { needsEnrichment: true },
  },
  {
    id: "manual-research",
    name: "Ready for manual research",
    description: "The next move is still research rather than outreach.",
    accent: "neutral",
    rule: { nextActionQueue: "research" },
  },
  {
    id: "needs-personalization",
    name: "Needs personalization angle",
    description: "Reachable, but the approach still needs a human angle.",
    accent: "bronze",
    rule: { minContactability: 50, maxContactability: 79 },
  },
  {
    id: "enriched-ready",
    name: "Enriched and ready",
    description: "Research is done and the lead can move out of the queue.",
    accent: "olive",
    rule: { outreachReady: true },
  },
]

export const OUTREACH_QUEUE_PRESETS: QueuePreset[] = [
  {
    id: "ready-email",
    name: "Ready to email",
    description: "Direct or generic email routes are available.",
    accent: "olive",
    rule: { outreachReady: true },
  },
  {
    id: "ready-call",
    name: "Ready to call",
    description: "Phone-based outreach should move first.",
    accent: "warm",
    rule: { nextActionQueue: "call", minContactability: 50 },
  },
  {
    id: "ready-form",
    name: "Ready to submit form",
    description: "Best next route is website-based outreach.",
    accent: "bronze",
    rule: { nextActionQueue: "form" },
  },
  {
    id: "follow-up-due",
    name: "Follow-up due",
    description: "Second touches that are ready now.",
    accent: "warm",
    rule: { followUpDue: true },
  },
  {
    id: "awaiting-response",
    name: "Awaiting response",
    description: "Already contacted, waiting on signal back.",
    accent: "neutral",
    rule: { statuses: ["contacted", "replied"] },
  },
  {
    id: "replied-interested-dead",
    name: "Replied / Interested / Dead",
    description: "Outcome tracking after first contact.",
    accent: "neutral",
    rule: { statuses: ["replied", "qualified", "lost"] },
  },
]

export function isFollowUpDue(lead: PermitLead): boolean {
  if (!lead.enrichment.followUpDate && !lead.workflow.nextActionDue) {
    return false
  }

  const nextDate = lead.workflow.nextActionDue || lead.enrichment.followUpDate
  return new Date(nextDate).getTime() <= Date.now()
}

export function isOutreachReady(lead: PermitLead): boolean {
  const hasRoute = Boolean(
    lead.enrichment.directEmail ||
      lead.enrichment.genericEmail ||
      lead.enrichment.phone ||
      lead.enrichment.contactFormUrl ||
      lead.contacts.some((contact) => contact.email || contact.phone || contact.contactFormUrl),
  )

  return (
    hasRoute &&
    lead.contactability.total >= 60 &&
    lead.score >= 30 &&
    lead.outreachReadiness.label !== "Blocked" &&
    !lead.workflow.ignored
  )
}

export function needsEnrichment(lead: PermitLead): boolean {
  const missingCoreRoute =
    !lead.enrichment.directEmail &&
    !lead.enrichment.genericEmail &&
    !lead.enrichment.phone &&
    !lead.enrichment.contactFormUrl

  return (
    !lead.workflow.ignored &&
    lead.leadTier !== "cold" &&
    (lead.contactability.total < 60 ||
      missingCoreRoute ||
      !lead.enrichment.companyWebsite ||
      lead.outreachReadiness.label === "Needs Review")
  )
}

function matchesRule(lead: PermitLead, rule: SavedViewRule): boolean {
  if (rule.boroughs && !rule.boroughs.includes(lead.borough)) {
    return false
  }

  if (rule.tiers && !rule.tiers.includes(lead.leadTier)) {
    return false
  }

  if (rule.statuses && !rule.statuses.includes(lead.workflow.status)) {
    return false
  }

  if (rule.priorityLabels && !rule.priorityLabels.includes(lead.priorityLabel)) {
    return false
  }

  if (rule.projectTags && !rule.projectTags.some((tag) => lead.projectTags.includes(tag))) {
    return false
  }

  if (rule.minScore && lead.score < rule.minScore) {
    return false
  }

  if (rule.minCost && Number.parseInt(lead.estimated_job_costs, 10) < rule.minCost) {
    return false
  }

  if (rule.minContactability && lead.contactability.total < rule.minContactability) {
    return false
  }

  if (rule.maxContactability && lead.contactability.total > rule.maxContactability) {
    return false
  }

  if (rule.maxAgeDays && getLeadAgeDays(lead.issued_date) > rule.maxAgeDays) {
    return false
  }

  if (rule.nextActionQueue && lead.nextAction.queue !== rule.nextActionQueue) {
    return false
  }

  if (rule.needsEnrichment && !needsEnrichment(lead)) {
    return false
  }

  if (rule.outreachReady && !isOutreachReady(lead)) {
    return false
  }

  if (rule.followUpDue && !isFollowUpDue(lead)) {
    return false
  }

  if (rule.requiresCommercial && lead.scoreBreakdown.commercialSignal <= 0) {
    return false
  }

  return !lead.workflow.ignored
}

export function sortLeads(leads: PermitLead[], sortBy: SortMode): PermitLead[] {
  return [...leads].sort((left, right) => {
    if (sortBy === "score") {
      return right.score - left.score
    }

    if (sortBy === "contactability") {
      return right.contactability.total - left.contactability.total
    }

    if (sortBy === "cost") {
      return Number.parseInt(right.estimated_job_costs, 10) - Number.parseInt(left.estimated_job_costs, 10)
    }

    if (sortBy === "recent") {
      return new Date(right.issued_date ?? 0).getTime() - new Date(left.issued_date ?? 0).getTime()
    }

    return right.priorityScore - left.priorityScore
  })
}

export function getFilteredLeads(
  leads: PermitLead[],
  filters: LeadFilters,
  activeView: SavedView,
): PermitLead[] {
  const trimmedSearch = filters.search.trim().toLowerCase()

  return sortLeads(
    leads.filter((lead) => {
      if (!matchesRule(lead, activeView.rule)) {
        return false
      }

      if (filters.borough !== "ALL" && lead.borough !== filters.borough) {
        return false
      }

      if (filters.tier !== "ALL" && lead.leadTier !== filters.tier) {
        return false
      }

      if (filters.status !== "ALL" && lead.workflow.status !== filters.status) {
        return false
      }

      if (Number.parseInt(lead.estimated_job_costs, 10) < filters.minCost) {
        return false
      }

      if (getLeadAgeDays(lead.issued_date) > filters.daysBack) {
        return false
      }

      if (trimmedSearch && !getSearchableLeadText(lead).includes(trimmedSearch)) {
        return false
      }

      return !lead.workflow.ignored
    }),
    filters.sortBy,
  )
}

export function getQueueLeads(leads: PermitLead[], preset: QueuePreset, sortBy: SortMode): PermitLead[] {
  return sortLeads(leads.filter((lead) => matchesRule(lead, preset.rule)), sortBy)
}

export function countForRule(leads: PermitLead[], rule: SavedViewRule): number {
  return leads.filter((lead) => matchesRule(lead, rule)).length
}

export function getDashboardStats(leads: PermitLead[]): DashboardStats {
  const activeLeads = leads.filter((lead) => !lead.workflow.ignored)
  const boroughCounts = new Map<string, number>()

  activeLeads.forEach((lead) => {
    boroughCounts.set(lead.borough, (boroughCounts.get(lead.borough) ?? 0) + 1)
  })

  return {
    totalScanned: activeLeads.length,
    hotLeads: activeLeads.filter((lead) => lead.leadTier === "hot").length,
    warmLeads: activeLeads.filter((lead) => lead.leadTier === "warm").length,
    needsEnrichment: activeLeads.filter(needsEnrichment).length,
    outreachReady: activeLeads.filter(isOutreachReady).length,
    followUpsDue: activeLeads.filter(isFollowUpDue).length,
    avgScore:
      activeLeads.length > 0
        ? Math.round(activeLeads.reduce((total, lead) => total + lead.score, 0) / activeLeads.length)
        : 0,
    boroughDistribution: Array.from(boroughCounts.entries())
      .map(([borough, count]) => ({ borough, count }))
      .sort((left, right) => right.count - left.count),
  }
}

export function getRecentActivities(leads: PermitLead[], limit = 10): DashboardActivity[] {
  return leads
    .flatMap((lead) =>
      lead.activities.map((activity) => ({
        id: `${lead.id}-${activity.id}`,
        leadId: lead.id,
        address: getPermitAddress(lead),
        title: activity.title,
        detail: `${activity.detail} • ${formatRelativeDate(activity.createdAt)}`,
        createdAt: activity.createdAt,
      })),
    )
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit)
}
