import type { ReactNode } from "react"
import { MailCheck, Radar, Rows3, SendHorizontal } from "lucide-react"

import { SavedViewTabs, SmartFilterBar } from "@/features/permit-pulse/components/filters"
import { PageHeader } from "@/features/permit-pulse/components/page-header"
import { SectionCard } from "@/features/permit-pulse/components/section-card"
import { SentLogView } from "@/features/permit-pulse/components/sent-log-view"
import type { LeadFilters, PermitLead, SavedView, SentLogEntry } from "@/types/permit-pulse"
import { cn } from "@/lib/utils"

type PipelineLane = "scanner" | "enrichment" | "outreach" | "sent-log"

const PIPELINE_LANES: Array<{
  id: PipelineLane
  label: string
  description: string
  icon: typeof Rows3
}> = [
  { id: "scanner", label: "Scanner", description: "Raw permit feed", icon: Rows3 },
  { id: "enrichment", label: "Enrichment", description: "Research queue", icon: Radar },
  { id: "outreach", label: "Outreach", description: "Ready to act", icon: SendHorizontal },
  { id: "sent-log", label: "Sent", description: "Delivery history", icon: MailCheck },
]

function LaneTabButton({
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
        "flex min-w-[180px] flex-1 items-start gap-3 rounded-[26px] border p-4 text-left transition-all duration-200",
        active
          ? "border-orange-200 bg-orange-50 shadow-sm dark:border-orange-800/50 dark:bg-orange-900/20"
          : "border-navy-200/70 bg-white/70 hover:border-navy-300 hover:bg-cream-50 dark:border-dark-border/70 dark:bg-dark-card/80 dark:hover:border-dark-muted/40",
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

function CompactMetric({
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

export function PipelineWorkspace({
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
}: {
  lane: PipelineLane
  onLaneChange: (lane: PipelineLane) => void
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
}) {
  const laneMeta = PIPELINE_LANES.find((item) => item.id === lane) ?? PIPELINE_LANES[0]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pipeline"
        title="One operating surface for scanning, research, and outreach."
        description="Instead of jumping across fragmented screens, work the lead from the same place. Pick the lane, review the list, and keep the detail panel open while you qualify and act."
      />

      <div className="grid gap-3 xl:grid-cols-4">
        {PIPELINE_LANES.map((item) => (
          <LaneTabButton
            key={item.id}
            active={item.id === lane}
            count={
              item.id === "scanner"
                ? scannerCount
                : item.id === "enrichment"
                  ? enrichmentCount
                  : item.id === "outreach"
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
        title={`${laneMeta.label} lane`}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CompactMetric label="Visible now" value={String(lane === "scanner" ? scannerCount : lane === "enrichment" ? enrichmentCount : lane === "outreach" ? outreachCount : sentCount)} />
          <CompactMetric label="Saved view" value={lane === "scanner" ? savedViews.find((view) => view.id === activeScannerViewId)?.name ?? "Hot Today" : lane === "enrichment" ? enrichmentViews.find((view) => view.id === activeEnrichmentViewId)?.name ?? "Research queue" : lane === "outreach" ? outreachViews.find((view) => view.id === activeOutreachViewId)?.name ?? "Outreach lane" : "Sent log"} />
          <CompactMetric label="Search" value={filters.search ? "Filtered" : "All leads"} />
          <CompactMetric label="Focus" value={lane === "scanner" ? "Qualify fast" : lane === "enrichment" ? "Build contact layer" : lane === "outreach" ? "Send with confidence" : "Track touches"} />
        </div>

        {lane === "scanner" ? (
          <>
            <SavedViewTabs activeViewId={activeScannerViewId} onSelect={onScannerViewChange} views={savedViews} />
            <SmartFilterBar filters={filters} onChange={onFiltersChange} onReset={onResetFilters} />
          </>
        ) : null}

        {lane === "enrichment" ? (
          <SavedViewTabs activeViewId={activeEnrichmentViewId} onSelect={onEnrichmentViewChange} views={enrichmentViews} />
        ) : null}

        {lane === "outreach" ? (
          <SavedViewTabs activeViewId={activeOutreachViewId} onSelect={onOutreachViewChange} views={outreachViews} />
        ) : null}
      </SectionCard>

      {lane === "sent-log" ? (
        <SentLogView entries={sentLog} leads={allLeads} onOpenLead={onOpenLead} showHeader={false} />
      ) : (
        workspace
      )}
    </div>
  )
}
