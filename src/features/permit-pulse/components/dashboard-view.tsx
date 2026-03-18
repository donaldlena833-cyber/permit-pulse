import {
  Activity,
  BarChart3,
  Flame,
  Layers3,
  MapPinned,
  Radar,
  Send,
  TimerReset,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type { DashboardActivity, DashboardStat, PermitLead } from "@/types/permit-pulse"
import { formatCurrency, formatNumber, formatRelativeDate, getPermitAddress } from "@/features/permit-pulse/lib/format"
import { ContactabilityBadge, LeadScoreBadge, PriorityBadge } from "@/features/permit-pulse/components/badges"
import { PageHeader } from "@/features/permit-pulse/components/page-header"
import { SectionCard } from "@/features/permit-pulse/components/section-card"
import { StatsGrid } from "@/features/permit-pulse/components/stats-grid"

interface DashboardViewProps {
  stats: {
    totalScanned: number
    hotLeads: number
    warmLeads: number
    needsEnrichment: number
    outreachReady: number
    followUpsDue: number
    avgScore: number
    boroughDistribution: Array<{ borough: string; count: number }>
  }
  topLeads: PermitLead[]
  activities: DashboardActivity[]
  lastScanAt: string | null
  onOpenLead: (leadId: string) => void
  onOpenScanner: () => void
}

export function DashboardView({
  stats,
  topLeads,
  activities,
  lastScanAt,
  onOpenLead,
  onOpenScanner,
}: DashboardViewProps) {
  const statItems: DashboardStat[] = [
    {
      id: "scanned",
      label: "Total scanned permits",
      value: formatNumber(stats.totalScanned),
      helper: "All scored leads currently living in the workspace.",
      tone: "neutral",
    },
    {
      id: "hot",
      label: "Hot leads",
      value: formatNumber(stats.hotLeads),
      helper: "Strong fit permits that deserve fast attention.",
      tone: "warm",
    },
    {
      id: "needs-enrichment",
      label: "Needs enrichment",
      value: formatNumber(stats.needsEnrichment),
      helper: "High-signal work with weak contactability.",
      tone: "bronze",
    },
    {
      id: "outreach-ready",
      label: "Outreach ready",
      value: formatNumber(stats.outreachReady),
      helper: "Leads that can move into calling or drafting now.",
      tone: "olive",
    },
    {
      id: "follow-ups",
      label: "Follow-ups due",
      value: formatNumber(stats.followUpsDue),
      helper: "Next touches already scheduled and due now.",
      tone: "bronze",
    },
    {
      id: "warm",
      label: "Warm leads",
      value: formatNumber(stats.warmLeads),
      helper: "Worth a look, but not the first attack lane.",
      tone: "neutral",
    },
    {
      id: "avg-score",
      label: "Average score",
      value: formatNumber(stats.avgScore),
      helper: "The average fit signal across active leads.",
      tone: "warm",
    },
    {
      id: "scan-time",
      label: "Recent scan",
      value: lastScanAt ? formatRelativeDate(lastScanAt) : "Never",
      helper: "Live DOB intake cadence for the current workspace.",
      tone: "neutral",
    },
  ]

  const itemsWithIcons = [
    { ...statItems[0], icon: Layers3 },
    { ...statItems[1], icon: Flame },
    { ...statItems[2], icon: Radar },
    { ...statItems[3], icon: Send },
    { ...statItems[4], icon: TimerReset },
    { ...statItems[5], icon: Activity },
    { ...statItems[6], icon: BarChart3 },
    { ...statItems[7], icon: MapPinned },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        action={
          <Button className="rounded-full bg-orange-500 px-5 text-white hover:bg-orange-600" onClick={onOpenScanner}>
            Open lead scanner
          </Button>
        }
        description="PermitPulse now runs like a control tower: what is hot, what still needs research, what can move into outreach, and where MetroGlassPro should spend time first."
        eyebrow="Dashboard"
        title="Outbound permit operations, not just permit browsing."
      />

      <StatsGrid items={itemsWithIcons} />

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          description="These leads combine strong fit, location, value, and current contactability."
          title="Top opportunities today"
        >
          <div className="space-y-3">
            {topLeads.slice(0, 6).map((lead) => (
              <button
                key={lead.id}
                className="w-full rounded-[24px] border border-navy-200/70 bg-cream-50/80 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-sm dark:border-dark-border/70 dark:bg-dark-bg"
                onClick={() => onOpenLead(lead.id)}
                type="button"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="text-lg font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">
                      {getPermitAddress(lead)}
                    </div>
                    <p className="line-clamp-2 text-sm leading-6 text-navy-500 dark:text-dark-muted">{lead.humanSummary}</p>
                    <div className="flex flex-wrap gap-2">
                      <LeadScoreBadge score={lead.score} tier={lead.leadTier} />
                      <ContactabilityBadge contactability={lead.contactability} />
                      <PriorityBadge label={lead.priorityLabel} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-[0.2em] text-navy-400 dark:text-dark-muted">Estimated cost</div>
                    <div className="mt-1 text-xl font-semibold tracking-[-0.03em] text-navy-800 dark:text-dark-text">
                      {formatCurrency(lead.estimated_job_costs)}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          description="Borough concentration and recent movements across the lead memory."
          title="Control tower"
        >
          <div className="space-y-4">
            {stats.boroughDistribution.map((entry) => (
              <div key={entry.borough}>
                <div className="mb-2 flex items-center justify-between text-sm text-navy-600 dark:text-dark-muted">
                  <span>{entry.borough}</span>
                  <span>{entry.count}</span>
                </div>
                <div className="h-2 rounded-full bg-cream-100 dark:bg-dark-border/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-orange-300 to-orange-500"
                    style={{
                      width: `${Math.max(12, (entry.count / Math.max(stats.totalScanned, 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        description="Recent lead memory so nothing useful disappears after a rescan."
        title="Activity feed"
      >
        <div className="space-y-3">
          {activities.map((activity) => (
            <button
              key={activity.id}
              className="flex w-full items-start gap-4 rounded-[22px] border border-navy-200/70 bg-cream-50/70 p-4 text-left dark:border-dark-border/70 dark:bg-dark-bg"
              onClick={() => onOpenLead(activity.leadId)}
              type="button"
            >
              <div className="mt-1 h-2.5 w-2.5 rounded-full bg-orange-500" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="font-medium text-navy-800 dark:text-dark-text">{activity.title}</div>
                  <div className="text-xs uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                    {formatRelativeDate(activity.createdAt)}
                  </div>
                </div>
                <div className="mt-1 text-sm text-navy-600 dark:text-dark-muted">{activity.address}</div>
                <div className="mt-2 text-sm leading-6 text-navy-500 dark:text-dark-muted">{activity.detail}</div>
              </div>
            </button>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}
