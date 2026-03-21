import type { AutomationHealth, AutomationJob, PermitLead } from "@/types/permit-pulse"
import { formatRelativeDate, getPermitAddress } from "@/features/permit-pulse/lib/format"
import { isOutreachReady, needsEnrichment, sortLeads } from "@/features/permit-pulse/lib/views"

export interface AttentionItem {
  id: string
  title: string
  count: number
  description: string
  actionLabel: string
  lane: "feed" | "research" | "ready" | "sent"
  tone: "warm" | "bronze" | "olive" | "neutral"
}

export interface PipelineColumn {
  id: string
  title: string
  description: string
  count: number
  leads: PermitLead[]
}

export interface SystemAlert {
  id: string
  title: string
  description: string
  tone: "warning" | "success" | "neutral"
}

export function getAttentionItems(leads: PermitLead[], health: AutomationHealth | null): AttentionItem[] {
  const activeLeads = leads.filter((lead) => !lead.workflow.ignored)
  const reviewCount = activeLeads.filter(
    (lead) =>
      (lead.workflow.status === "new" || lead.workflow.status === "reviewed") &&
      (lead.leadTier === "hot" || lead.leadTier === "warm"),
  ).length
  const researchCount = activeLeads.filter(needsEnrichment).length
  const readyCount = activeLeads.filter(isOutreachReady).length
  const sentToday = activeLeads.filter((lead) => {
    const latestSent = lead.outreachHistory.find((item) => item.status === "sent")?.sentAt
    return latestSent ? formatRelativeDate(latestSent).includes("today") : false
  }).length

  const items: AttentionItem[] = [
    {
      id: "review",
      title: "Review fresh opportunities",
      count: reviewCount,
      description: "High-signal permits that still need a yes, no, or research decision.",
      actionLabel: "Open queue",
      lane: "feed",
      tone: "warm",
    },
    {
      id: "research",
      title: "Resolve contact gaps",
      count: researchCount,
      description: "Strong permits where the company or route still needs a cleaner match.",
      actionLabel: "Open research",
      lane: "research",
      tone: "bronze",
    },
    {
      id: "ready",
      title: "Move ready leads",
      count: readyCount,
      description: "Leads with enough fit and contactability to move into outreach now.",
      actionLabel: "Open outreach",
      lane: "ready",
      tone: "olive",
    },
    {
      id: "sent",
      title: health?.hasGmail ? "Check sent history" : "Confirm send setup",
      count: health?.hasGmail ? sentToday : 0,
      description: health?.hasGmail
        ? "Recent delivery history, follow-ups, and anything that needs the next touch."
        : "Gmail is not configured, so the machine can draft but should not send yet.",
      actionLabel: "Open sent log",
      lane: "sent",
      tone: "neutral",
    },
  ]

  return items
}

export function getPipelineColumns(leads: PermitLead[]): PipelineColumn[] {
  const activeLeads = sortLeads(leads.filter((lead) => !lead.workflow.ignored), "priority")

  const buckets = [
    {
      id: "research",
      title: "Research",
      description: "Still being qualified, enriched, or held for a stronger route.",
      filter: (lead: PermitLead) =>
        ["new", "reviewed", "researching", "enriched"].includes(lead.workflow.status) || needsEnrichment(lead),
    },
    {
      id: "ready",
      title: "Ready",
      description: "Clear next move, good enough route, and worth acting on soon.",
      filter: (lead: PermitLead) => ["outreach-ready", "drafted"].includes(lead.workflow.status) || isOutreachReady(lead),
    },
    {
      id: "active",
      title: "Active",
      description: "Already contacted or in an open follow-up and qualification loop.",
      filter: (lead: PermitLead) =>
        ["contacted", "follow-up-due", "replied", "qualified", "quoted"].includes(lead.workflow.status),
    },
    {
      id: "closed",
      title: "Closed",
      description: "Outcome captured, archived, or no longer worth active time.",
      filter: (lead: PermitLead) => ["won", "lost", "archived"].includes(lead.workflow.status),
    },
  ]

  return buckets.map((bucket) => {
    const columnLeads = activeLeads.filter(bucket.filter)

    return {
      id: bucket.id,
      title: bucket.title,
      description: bucket.description,
      count: columnLeads.length,
      leads: columnLeads.slice(0, 8),
    }
  })
}

export function getSystemAlerts(
  leads: PermitLead[],
  health: AutomationHealth | null,
  jobs: AutomationJob[],
  error: string | null,
  lastScanAt: string | null,
): SystemAlert[] {
  const alerts: SystemAlert[] = []
  const latestFailedJob = [...jobs].find((job) => job.status === "failed")
  const latestSuccessfulIngest = [...jobs].find(
    (job) => job.jobType === "permit_ingest" && job.status === "succeeded",
  )

  if (error) {
    alerts.push({
      id: "scan-error",
      title: "Scan attention needed",
      description: error,
      tone: "warning",
    })
  }

  if (!health) {
    alerts.push({
      id: "health-pending",
      title: "Worker health still loading",
      description: "PermitPulse has not finished checking provider and automation status yet.",
      tone: "neutral",
    })
  } else {
    if (!health.hasSupabase) {
      alerts.push({
        id: "supabase",
        title: "Supabase is missing",
        description: "Remote lead memory, enrichment history, and automation state will not persist correctly.",
        tone: "warning",
      })
    } else if (health.supabaseAuthMode === "anon") {
      alerts.push({
        id: "supabase-auth",
        title: "Supabase is using anon fallback",
        description: "The worker is still talking to Supabase with the anon key. Move it to the service-role key before locking RLS down.",
        tone: "warning",
      })
    }

    const missingProviders = [
      !health.hasBrave ? "Brave" : "",
      !health.hasGoogleMaps ? "Google Maps" : "",
      !health.hasFirecrawl ? "Firecrawl" : "",
      !health.hasZeroBounce ? "ZeroBounce" : "",
    ].filter(Boolean)

    if (missingProviders.length > 0) {
      alerts.push({
        id: "providers",
        title: "Enrichment providers are incomplete",
        description: `${missingProviders.join(", ")} are unavailable, so company and contact resolution will be weaker.`,
        tone: "warning",
      })
    } else {
      alerts.push({
        id: "providers-live",
        title: "Automation stack is online",
        description: "Supabase, Brave, Maps, Firecrawl, and ZeroBounce are available for live enrichment.",
        tone: "success",
      })
    }

    if (!health.hasGmail) {
      alerts.push({
        id: "gmail",
        title: "Gmail send is offline",
        description: "Drafts can be generated, but direct send and auto-send should stay off.",
        tone: "warning",
      })
    } else if (!health.hasDefaultAttachment) {
      alerts.push({
        id: "attachment",
        title: "Outreach attachment is not loaded",
        description: "Emails can send now, but the default PDF attachment is still missing from the worker.",
        tone: "warning",
      })
    }
  }

  if (latestFailedJob) {
    alerts.unshift({
      id: `job-${latestFailedJob.id}`,
      title: "Latest automation needs attention",
      description: latestFailedJob.detail || latestFailedJob.summary,
      tone: "warning",
    })
  } else if (jobs.length > 0) {
    alerts.unshift({
      id: "jobs-healthy",
      title: "Latest automation completed cleanly",
      description: jobs[0]?.summary || "Recent ingest and enrichment steps finished without a logged failure.",
      tone: "success",
    })
  }

  if (health?.hasSupabase && leads.length > 0 && !latestSuccessfulIngest) {
    alerts.push({
      id: "ingest-missing",
      title: "No successful ingest logged yet",
      description: "The workspace has lead memory, but this environment has not logged a clean permit ingest run yet.",
      tone: "warning",
    })
  }

  if (!lastScanAt && leads.length === 0) {
    alerts.push({
      id: "empty",
      title: "No lead memory yet",
      description: "Run a scan to populate the workspace and start the enrichment loop.",
      tone: "neutral",
    })
  }

  return alerts.slice(0, 4)
}

export function getLeadBlocker(lead: PermitLead): string {
  if (lead.outreachReadiness.blockers.length > 0) {
    return lead.outreachReadiness.blockers[0]
  }

  if (needsEnrichment(lead)) {
    return "Contact data still needs work"
  }

  if (lead.companyProfile.matchStrength === "weak") {
    return "Company match is still weak"
  }

  return "No obvious blocker"
}

export function getLeadEvidence(lead: PermitLead): string {
  return lead.scoreBreakdown.reasons[0] || lead.humanSummary || getPermitAddress(lead)
}
