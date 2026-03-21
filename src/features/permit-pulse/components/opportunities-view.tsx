import type { ReactNode } from "react"
import { MailCheck, Radar, Rows3, SendHorizontal } from "lucide-react"

import { PageHeader } from "@/features/permit-pulse/components/page-header"
import { SavedViewTabs, SmartFilterBar } from "@/features/permit-pulse/components/filters"
import { SectionCard } from "@/features/permit-pulse/components/section-card"
import { SentLogView } from "@/features/permit-pulse/components/sent-log-view"
import type { LeadFilters, OpportunityLane, PermitLead, SavedView, SentLogEntry } from "@/types/permit-pulse"
import { cn } from "@/lib/utils"

const LANE_META: Array<{
  id: OpportunityLane
  label: string
  description: string
  icon: typeof Rows3
}> = [
  { id: "feed", label: "Fresh feed", description: "Review new permits and qualify fit quickly.", icon: Rows3 },
  { id: "research", label: "Research", description: "Resolve weak company or contact data.", icon: Radar },
  { id: "ready", label: "Ready", description: "Everything usable enough to move toward outreach.", icon: SendHorizontal },
  { id: "sent", label: "Sent", description: "Recent delivery history and follow-up context.", icon: MailCheck },
]

function LaneButton({
  active,
  count,
  description,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  count: number
  description: string
  icon: typeof Rows3
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        "flex min-w-[190px] flex-1 items-start gap-3 rounded-[26px] border p-4 text-left transition-all duration-200",
        active
          ? "border-orange-200 bg-orange-50 shadow-sm dark:border-orange-800/40 dark:bg-orange-900/20"
          : "border-navy-200/70 bg-white/75 hover:border-navy-300 hover:bg-cream-50 dark:border-dark-border/70 dark:bg-dark-card/80 dark:hover:border-dark-muted/40",
      )}
      onClick={onClick}
      type="button"
    >
      <div
        className={cn(
          "rounded-2xl p-2.5",
          active
            ? "bg-orange-500 text-white"
            : "bg-cream-100 text-navy-600 dark:bg-dark-border/70 dark:text-dark-text",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-navy-900 dark:text-dark-text">{label}</span>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] dark:bg-white/10">{count}</span>
        </div>
        <div className="mt-1 text-xs leading-5 text-navy-500 dark:text-dark-muted">{description}</div>
      </div>
    </button>
  )
}

function SummaryMetric({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-[22px] border border-navy-200/70 bg-cream-50/80 px-4 py-3 dark:border-dark-border/70 dark:bg-dark-bg">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">{value}</div>
    </div>
  )
}

interface OpportunitiesViewProps {
  lane: OpportunityLane
  onLaneChange: (lane: OpportunityLane) => void
  activeScannerViewId: string
  activeEnrichmentViewId: string
  activeOutreachViewId: string
  onScannerViewChange: (viewId: string) => void
  onEnrichmentViewChange: (viewId: string) => void
  onOutreachViewChange: (viewId: string) => void
  filters: LeadFilters
  onFiltersChange: (patch: Partial<LeadFilters>) => void
  onResetFilters: () => void
  savedViews: Array<SavedView & { count: number }>
  enrichmentViews: Array<SavedView & { count: number }>
  outreachViews: Array<SavedView & { count: number }>
  scannerCount: number
  enrichmentCount: number
  outreachCount: number
  sentCount: number
  sentLog: SentLogEntry[]
  allLeads: PermitLead[]
  onOpenLead: (leadId: string) => void
  workspace: ReactNode
}

export function OpportunitiesView({
  lane,
  onLaneChange,
  activeScannerViewId,
  activeEnrichmentViewId,
  activeOutreachViewId,
  onScannerViewChange,
  onEnrichmentViewChange,
  onOutreachViewChange,
  filters,
  onFiltersChange,
  onResetFilters,
  savedViews,
  enrichmentViews,
  outreachViews,
  scannerCount,
  enrichmentCount,
  outreachCount,
  sentCount,
  sentLog,
  allLeads,
  onOpenLead,
  workspace,
}: OpportunitiesViewProps) {
  const laneMeta = LANE_META.find((item) => item.id === lane) ?? LANE_META[0]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Opportunities"
        title="One place to review, research, and move leads forward."
        description="The feed, research queue, and ready-to-act lane all live here so you can keep context while deciding what matters and what still needs work."
      />

      <div className="grid gap-3 xl:grid-cols-4">
        {LANE_META.map((item) => (
          <LaneButton
            key={item.id}
            active={item.id === lane}
            count={
              item.id === "feed"
                ? scannerCount
                : item.id === "research"
                  ? enrichmentCount
                  : item.id === "ready"
                    ? outreachCount
                    : sentCount
            }
            description={item.description}
            icon={item.icon}
            label={item.label}
            onClick={() => onLaneChange(item.id)}
          />
        ))}
      </div>

      <SectionCard
        className="overflow-hidden"
        contentClassName="space-y-4"
        description={laneMeta.description}
        title={`${laneMeta.label} workspace`}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryMetric
            label="Visible now"
            value={String(lane === "feed" ? scannerCount : lane === "research" ? enrichmentCount : lane === "ready" ? outreachCount : sentCount)}
          />
          <SummaryMetric
            label="Current lens"
            value={
              lane === "feed"
                ? savedViews.find((view) => view.id === activeScannerViewId)?.name ?? "Hot Today"
                : lane === "research"
                  ? enrichmentViews.find((view) => view.id === activeEnrichmentViewId)?.name ?? "Research"
                  : lane === "ready"
                    ? outreachViews.find((view) => view.id === activeOutreachViewId)?.name ?? "Ready to email"
                    : "Sent history"
            }
          />
          <SummaryMetric label="Search" value={filters.search ? "Filtered" : "All active leads"} />
          <SummaryMetric
            label="Operator focus"
            value={lane === "feed" ? "Qualify fit" : lane === "research" ? "Resolve route" : lane === "ready" ? "Move to outreach" : "Track delivery"}
          />
        </div>

        {lane === "feed" ? (
          <>
            <SavedViewTabs activeViewId={activeScannerViewId} onSelect={onScannerViewChange} views={savedViews} />
            <SmartFilterBar filters={filters} onChange={onFiltersChange} onReset={onResetFilters} />
          </>
        ) : null}

        {lane === "research" ? (
          <SavedViewTabs activeViewId={activeEnrichmentViewId} onSelect={onEnrichmentViewChange} views={enrichmentViews} />
        ) : null}

        {lane === "ready" ? (
          <SavedViewTabs activeViewId={activeOutreachViewId} onSelect={onOutreachViewChange} views={outreachViews} />
        ) : null}
      </SectionCard>

      {lane === "sent" ? (
        <SentLogView entries={sentLog} leads={allLeads} onOpenLead={onOpenLead} showHeader={false} />
      ) : (
        workspace
      )}
    </div>
  )
}
