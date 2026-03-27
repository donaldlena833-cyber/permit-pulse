import {
  Activity,
  ArrowRight,
  BarChart3,
  Flame,
  Layers3,
  MailCheck,
  Radar,
  TimerReset,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ContactabilityBadge, LeadScoreBadge, PriorityBadge } from "@/features/permit-pulse/components/badges"
import { PageHeader } from "@/features/permit-pulse/components/page-header"
import { SectionCard } from "@/features/permit-pulse/components/section-card"
import { StatsGrid } from "@/features/permit-pulse/components/stats-grid"
import { formatCurrency, formatNumber, formatRelativeDate, getPermitAddress } from "@/features/permit-pulse/lib/format"
import type { AttentionItem, SystemAlert } from "@/features/permit-pulse/lib/operator"
import type { AutomationRunSummary, DashboardActivity, DashboardStat, PermitLead } from "@/types/permit-pulse"
import { cn } from "@/lib/utils"

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
  attentionItems: AttentionItem[]
  systemAlerts: SystemAlert[]
  topLeads: PermitLead[]
  activities: DashboardActivity[]
  lastScanAt: string | null
  runSummary?: AutomationRunSummary | null
  onScan: () => void
  scanning: boolean
  onOpenLead: (leadId: string) => void
  onOpenOpportunities: (lane?: AttentionItem["lane"]) => void
}

function AttentionCard({
  item,
  onClick,
}: {
  item: AttentionItem
  onClick: () => void
}) {
  const toneClasses =
    item.tone === "warm"
      ? "border-orange-200 bg-orange-50/90 dark:border-orange-800/40 dark:bg-orange-900/15"
      : item.tone === "bronze"
        ? "border-navy-200/80 bg-cream-50/80 dark:border-dark-border/80 dark:bg-dark-bg"
        : item.tone === "olive"
          ? "border-emerald-200/60 bg-emerald-50/75 dark:border-emerald-900/40 dark:bg-emerald-950/20"
          : "border-navy-200/70 bg-white/80 dark:border-dark-border/70 dark:bg-dark-card/80"

  return (
    <button
      className={cn(
        "group flex h-full flex-col rounded-[28px] border p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm",
        toneClasses,
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
            Attention now
          </div>
          <div className="mt-2 text-xl font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">
            {item.title}
          </div>
        </div>
        <div className="rounded-full bg-black/5 px-3 py-1 text-sm font-semibold dark:bg-white/10">
          {item.count}
        </div>
      </div>
      <p className="mt-3 flex-1 text-sm leading-6 text-navy-600 dark:text-dark-muted">{item.description}</p>
      <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-navy-800 dark:text-dark-text">
        {item.actionLabel}
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </div>
    </button>
  )
}

function EmptyPanel({
  title,
  description,
  actionLabel,
  onClick,
}: {
  title: string
  description: string
  actionLabel?: string
  onClick?: () => void
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-navy-200/80 bg-gradient-to-br from-white/90 to-cream-50/80 p-5 dark:border-dark-border/80 dark:from-dark-card/90 dark:to-dark-bg">
      <div className="text-sm font-semibold tracking-[-0.02em] text-navy-900 dark:text-dark-text">{title}</div>
      <p className="mt-2 max-w-xl text-sm leading-6 text-navy-500 dark:text-dark-muted">{description}</p>
      {actionLabel && onClick ? (
        <Button className="mt-4 rounded-full" onClick={onClick} type="button" variant="outline">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function DashboardView({
  stats,
  attentionItems,
  systemAlerts,
  topLeads,
  activities,
  lastScanAt,
  runSummary,
  onScan,
  scanning,
  onOpenLead,
  onOpenOpportunities,
}: DashboardViewProps) {
  const statItems: DashboardStat[] = [
    {
      id: "hot",
      label: "Hot leads",
      value: formatNumber(stats.hotLeads),
      helper: "Highest-fit permits worth looking at first.",
      tone: "warm",
    },
    {
      id: "needs-enrichment",
      label: "Needs research",
      value: formatNumber(stats.needsEnrichment),
      helper: "High-signal work with weak company or contact clarity.",
      tone: "bronze",
    },
    {
      id: "outreach-ready",
      label: "Ready to move",
      value: formatNumber(stats.outreachReady),
      helper: "Fit and contactability are strong enough to act on now.",
      tone: "olive",
    },
    {
      id: "follow-ups",
      label: "Follow-ups due",
      value: formatNumber(stats.followUpsDue),
      helper: "Active leads that already need the next touch.",
      tone: "bronze",
    },
    {
      id: "avg-score",
      label: "Average score",
      value: formatNumber(stats.avgScore),
      helper: "Overall quality level across active lead memory.",
      tone: "warm",
    },
    {
      id: "scanned",
      label: "Stored leads",
      value: formatNumber(stats.totalScanned),
      helper: lastScanAt ? `Latest intake ${formatRelativeDate(lastScanAt)}` : "No scan has been run yet.",
      tone: "neutral",
    },
  ]

  const statsWithIcons = [
    { ...statItems[0], icon: Flame },
    { ...statItems[1], icon: Radar },
    { ...statItems[2], icon: MailCheck },
    { ...statItems[3], icon: TimerReset },
    { ...statItems[4], icon: BarChart3 },
    { ...statItems[5], icon: Layers3 },
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-4 md:hidden">
        <SectionCard
          className="rounded-[28px]"
          contentClassName="space-y-4"
          description="Scan, review, send, and move on. Keep the phone flow brutally simple."
          title="Today"
        >
          <div className="flex items-center justify-between gap-3 rounded-[22px] border border-navy-200/70 bg-cream-50/80 p-4 dark:border-dark-border/70 dark:bg-dark-bg">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
                Latest intake
              </div>
              <div className="mt-1 text-sm font-medium text-navy-900 dark:text-dark-text">
                {lastScanAt ? `Last scan ${formatRelativeDate(lastScanAt)}` : "No scan yet"}
            </div>
          </div>

          {runSummary ? (
            <div className="rounded-[22px] border border-navy-200/70 bg-white/85 p-4 dark:border-dark-border/70 dark:bg-dark-card/80">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                Latest run
              </div>
              <div className="mt-2 text-sm font-semibold text-navy-900 dark:text-dark-text">
                {runSummary.latestSummary}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-navy-500 dark:text-dark-muted">
                <span>{runSummary.completedLeadCount}/{runSummary.queuedLeadCount} resolved</span>
                <span>{runSummary.sentCount} sent</span>
                <span>{runSummary.failedJobs} failed</span>
              </div>
            </div>
          ) : null}
            <Button className="rounded-full bg-orange-500 px-4 text-white hover:bg-orange-600" disabled={scanning} onClick={onScan}>
              {scanning ? "Scanning..." : "Scan"}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              className="rounded-[22px] border border-navy-200/70 bg-white/85 p-4 text-left dark:border-dark-border/70 dark:bg-dark-card/80"
              onClick={() => onOpenOpportunities("ready")}
              type="button"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">Ready to send</div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-navy-900 dark:text-dark-text">{stats.outreachReady}</div>
            </button>
            <button
              className="rounded-[22px] border border-navy-200/70 bg-white/85 p-4 text-left dark:border-dark-border/70 dark:bg-dark-card/80"
              onClick={() => onOpenOpportunities("research")}
              type="button"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">Needs review</div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-navy-900 dark:text-dark-text">{stats.needsEnrichment}</div>
            </button>
            <button
              className="rounded-[22px] border border-navy-200/70 bg-white/85 p-4 text-left dark:border-dark-border/70 dark:bg-dark-card/80"
              onClick={() => onOpenOpportunities("feed")}
              type="button"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">Fresh queue</div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-navy-900 dark:text-dark-text">{stats.totalScanned}</div>
            </button>
            <button
              className="rounded-[22px] border border-navy-200/70 bg-white/85 p-4 text-left dark:border-dark-border/70 dark:bg-dark-card/80"
              onClick={() => onOpenOpportunities("ready")}
              type="button"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">Follow-ups</div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-navy-900 dark:text-dark-text">{stats.followUpsDue}</div>
            </button>
          </div>
        </SectionCard>

        <SectionCard
          description="Open a lead, send the best email, and keep moving."
          title="Next leads"
        >
          <div className="space-y-3">
            {topLeads.length === 0 ? (
              <EmptyPanel
                actionLabel="Open opportunities"
                description="Run a scan or widen the search window. When the queue is light, this space should still tell you what to do next."
                onClick={() => onOpenOpportunities("feed")}
                title="No leads are staged right now"
              />
            ) : (
              topLeads.slice(0, 4).map((lead) => (
                <button
                  key={lead.id}
                  className="w-full rounded-[22px] border border-navy-200/70 bg-cream-50/80 p-4 text-left dark:border-dark-border/70 dark:bg-dark-bg"
                  onClick={() => onOpenLead(lead.id)}
                  type="button"
                >
                  <div className="text-sm font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">
                    {getPermitAddress(lead)}
                  </div>
                  <div className="mt-1 text-xs text-navy-500 dark:text-dark-muted">{lead.nextAction.label}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <LeadScoreBadge score={lead.score} tier={lead.leadTier} />
                    <PriorityBadge label={lead.priorityLabel} />
                  </div>
                </button>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard description="Only show system issues here when they need attention." title="Watch">
          <div className="space-y-3">
            {systemAlerts.filter((alert) => alert.tone !== "success").slice(0, 2).length > 0 ? (
              systemAlerts.filter((alert) => alert.tone !== "success").slice(0, 2).map((alert) => (
                <div
                  key={alert.id}
                  className={cn(
                    "rounded-[20px] border px-4 py-3",
                    alert.tone === "warning"
                      ? "border-orange-200 bg-orange-50/80 dark:border-orange-800/40 dark:bg-orange-900/15"
                      : "border-navy-200/70 bg-cream-50/80 dark:border-dark-border/70 dark:bg-dark-bg",
                  )}
                >
                  <div className="text-sm font-semibold text-navy-900 dark:text-dark-text">{alert.title}</div>
                  <p className="mt-1 text-sm leading-6 text-navy-600 dark:text-dark-muted">{alert.description}</p>
                </div>
              ))
            ) : (
              <EmptyPanel
                description="Worker health looks calm. Use this space for true exceptions, not background noise."
                title="No system issues need attention"
              />
            )}
          </div>
        </SectionCard>
      </div>

      <div className="hidden space-y-6 md:block">
        <PageHeader
          action={
            <Button className="rounded-full bg-orange-500 px-5 text-white hover:bg-orange-600" onClick={() => onOpenOpportunities("feed")}>
              Review opportunities
            </Button>
          }
          description="Start from what changed, what is blocked, and what is actually worth working next. The dashboard should answer that in one pass."
          eyebrow="Dashboard"
          title="A clean control tower for daily permit ops."
        />

        <div className="grid gap-4 xl:grid-cols-4">
          {attentionItems.map((item) => (
            <AttentionCard key={item.id} item={item} onClick={() => onOpenOpportunities(item.lane)} />
          ))}
        </div>

        <StatsGrid items={statsWithIcons} />

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <SectionCard
              description="These are the leads most likely to matter right now, based on fit, recency, contactability, and priority."
              title="Top opportunities"
            >
              <div className="space-y-3">
                {topLeads.length === 0 ? (
                  <EmptyPanel
                    actionLabel="Run scan"
                    description="No leads are staged locally right now. Kick off a scan, or move manual holds into Email Required so the queue stays honest."
                    onClick={onScan}
                    title="Top opportunities will show up here"
                  />
                ) : (
                  topLeads.slice(0, 5).map((lead) => (
                    <button
                      key={lead.id}
                      className="w-full rounded-[24px] border border-navy-200/70 bg-cream-50/80 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-sm dark:border-dark-border/70 dark:bg-dark-bg"
                      onClick={() => onOpenLead(lead.id)}
                      type="button"
                    >
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                          <div className="text-base font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">
                            {getPermitAddress(lead)}
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-navy-500 dark:text-dark-muted">
                            {lead.humanSummary}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <LeadScoreBadge score={lead.score} tier={lead.leadTier} />
                            <ContactabilityBadge contactability={lead.contactability} />
                            <PriorityBadge label={lead.priorityLabel} />
                          </div>
                        </div>
                        <div className="shrink-0 text-left xl:text-right">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                            Estimated cost
                          </div>
                          <div className="mt-1 text-lg font-semibold tracking-[-0.03em] text-navy-800 dark:text-dark-text">
                            {formatCurrency(lead.estimated_job_costs)}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </SectionCard>

          <div className="space-y-6">
            <SectionCard
              description="Only surface machine status here when it actually matters to the operator."
              title="System watch"
            >
              <div className="space-y-3">
                {systemAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={cn(
                      "rounded-[22px] border px-4 py-3",
                      alert.tone === "warning"
                        ? "border-orange-200 bg-orange-50/80 dark:border-orange-800/40 dark:bg-orange-900/15"
                        : alert.tone === "success"
                          ? "border-emerald-200/60 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                          : "border-navy-200/70 bg-cream-50/80 dark:border-dark-border/70 dark:bg-dark-bg",
                    )}
                  >
                    <div className="text-sm font-semibold text-navy-900 dark:text-dark-text">{alert.title}</div>
                    <p className="mt-1 text-sm leading-6 text-navy-600 dark:text-dark-muted">{alert.description}</p>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              description="Recent movements so nothing disappears after a rescan."
              title="Recent changes"
            >
              <div className="space-y-3">
                {activities.length === 0 ? (
                  <EmptyPanel
                    description="Once scans, enrichments, or manual moves happen, this feed becomes the operator memory for the day."
                    title="No activity has been recorded yet"
                  />
                ) : (
                  activities.slice(0, 6).map((activity) => (
                    <button
                      key={activity.id}
                      className="flex w-full items-start gap-3 rounded-[22px] border border-navy-200/70 bg-cream-50/75 p-4 text-left dark:border-dark-border/70 dark:bg-dark-bg"
                      onClick={() => onOpenLead(activity.leadId)}
                      type="button"
                    >
                      <div className="mt-1 rounded-full bg-orange-500/15 p-1.5 text-orange-600 dark:text-orange-300">
                        <Activity className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="font-medium text-navy-800 dark:text-dark-text">{activity.title}</div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                            {formatRelativeDate(activity.createdAt)}
                          </div>
                        </div>
                        <div className="mt-1 text-sm text-navy-600 dark:text-dark-muted">{activity.address}</div>
                        <div className="mt-2 text-sm leading-6 text-navy-500 dark:text-dark-muted">{activity.detail}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  )
}
