import { type ReactNode, useMemo, useState } from "react"
import { Filter, MailCheck, Radar, Rows3, SendHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { SavedViewTabs, SmartFilterBar } from "@/features/permit-pulse/components/filters"
import { SentLogView } from "@/features/permit-pulse/components/sent-log-view"
import type { LeadFilters, OpportunityLane, PermitLead, SavedView, SentLogEntry } from "@/types/permit-pulse"
import { cn } from "@/lib/utils"

const LANE_META: Array<{
  id: OpportunityLane
  label: string
  shortLabel: string
  description: string
  icon: typeof Rows3
}> = [
  { id: "feed", label: "Fresh feed", shortLabel: "Feed", description: "Review new permits and qualify fit.", icon: Rows3 },
  { id: "research", label: "Research", shortLabel: "Research", description: "Resolve company and contact gaps.", icon: Radar },
  { id: "ready", label: "Ready", shortLabel: "Ready", description: "Move usable leads toward outreach.", icon: SendHorizontal },
  { id: "sent", label: "Sent", shortLabel: "Sent", description: "Check delivery history and follow-ups.", icon: MailCheck },
]

function LanePill({
  active,
  count,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  count: number
  icon: typeof Rows3
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-2 rounded-full border px-4 py-2 text-sm whitespace-nowrap transition-all duration-200",
        active
          ? "border-orange-200 bg-orange-50 text-orange-700 shadow-sm dark:border-orange-800/40 dark:bg-orange-900/20 dark:text-orange-200"
          : "border-navy-200/70 bg-white/80 text-navy-600 hover:border-navy-300 hover:bg-cream-50 dark:border-dark-border/70 dark:bg-dark-card/80 dark:text-dark-text",
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" />
      <span className="font-medium">{label}</span>
      <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] dark:bg-white/10">{count}</span>
    </button>
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
  const [filtersOpen, setFiltersOpen] = useState(false)
  const laneMeta = LANE_META.find((item) => item.id === lane) ?? LANE_META[0]
  const visibleCount = lane === "feed" ? scannerCount : lane === "research" ? enrichmentCount : lane === "ready" ? outreachCount : sentCount
  const currentLens =
    lane === "feed"
      ? savedViews.find((view) => view.id === activeScannerViewId)?.name ?? "Hot Today"
      : lane === "research"
        ? enrichmentViews.find((view) => view.id === activeEnrichmentViewId)?.name ?? "Research"
        : lane === "ready"
          ? outreachViews.find((view) => view.id === activeOutreachViewId)?.name ?? "Ready to email"
          : "Sent history"
  const operatorFocus =
    lane === "feed"
      ? "Qualify fit"
      : lane === "research"
        ? "Resolve route"
        : lane === "ready"
        ? "Move to outreach"
          : "Track delivery"
  const activeViewOptions = useMemo(() => {
    if (lane === "feed") return savedViews
    if (lane === "research") return enrichmentViews
    if (lane === "ready") return outreachViews
    return []
  }, [enrichmentViews, lane, outreachViews, savedViews])
  const activeMobileViewId =
    lane === "feed"
      ? activeScannerViewId
      : lane === "research"
        ? activeEnrichmentViewId
        : lane === "ready"
          ? activeOutreachViewId
          : ""
  const handleMobileViewChange = (viewId: string) => {
    if (lane === "feed") {
      onScannerViewChange(viewId)
      return
    }

    if (lane === "research") {
      onEnrichmentViewChange(viewId)
      return
    }

    if (lane === "ready") {
      onOutreachViewChange(viewId)
    }
  }
  const mobileFilterSummary = [filters.borough === "ALL" ? "All boroughs" : filters.borough, `Last ${filters.daysBack} days`, `$${Math.round(filters.minCost / 1000)}k+`].join(" • ")

  return (
    <div className="space-y-4">
      <div className="space-y-4 md:hidden">
        <div className="rounded-[24px] border border-navy-200/70 bg-white/85 p-3 shadow-sm backdrop-blur-xl dark:border-dark-border/70 dark:bg-dark-card/90">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-600 dark:text-orange-300">
                Leads
              </div>
              <div className="mt-1 text-sm font-medium text-navy-800 dark:text-dark-text">{currentLens}</div>
              <div className="mt-1 text-xs text-navy-500 dark:text-dark-muted">{visibleCount} visible</div>
            </div>
            {lane === "feed" ? (
              <Button className="h-10 rounded-full px-4" onClick={() => setFiltersOpen(true)} type="button" variant="outline">
                <Filter className="h-4 w-4" />
                Filter
              </Button>
            ) : null}
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {LANE_META.map((item) => (
              <LanePill
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
                icon={item.icon}
                label={item.shortLabel}
                onClick={() => onLaneChange(item.id)}
              />
            ))}
          </div>

          {lane !== "sent" ? (
            <div className="mt-3 grid gap-3">
              <Select onValueChange={handleMobileViewChange} value={activeMobileViewId}>
                <SelectTrigger className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg">
                  <SelectValue placeholder="Lens" />
                </SelectTrigger>
                <SelectContent>
                  {activeViewOptions.map((view) => (
                    <SelectItem key={view.id} value={view.id}>
                      {view.name} ({view.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {lane === "feed" ? (
                <button
                  className="flex items-center justify-between rounded-[18px] border border-navy-200/70 bg-cream-50/80 px-4 py-3 text-left dark:border-dark-border/70 dark:bg-dark-bg"
                  onClick={() => setFiltersOpen(true)}
                  type="button"
                >
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                      Queue filters
                    </div>
                    <div className="mt-1 text-sm text-navy-700 dark:text-dark-text">{mobileFilterSummary}</div>
                  </div>
                  <Filter className="h-4 w-4 text-navy-500 dark:text-dark-muted" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {lane === "sent" ? (
          <SentLogView entries={sentLog} leads={allLeads} onOpenLead={onOpenLead} showHeader={false} />
        ) : (
          workspace
        )}

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent className="rounded-t-[28px] border-none px-5 pb-8 pt-8" side="bottom">
            <SheetHeader>
              <SheetTitle>Filter opportunities</SheetTitle>
              <SheetDescription>Keep the queue clean without leaving the lead list.</SheetDescription>
            </SheetHeader>
            <div className="mt-6">
              <SmartFilterBar
                filters={filters}
                layout="mobile"
                onChange={onFiltersChange}
                onReset={onResetFilters}
                showSearch
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="hidden space-y-4 md:block">
        <div className="rounded-[24px] border border-navy-200/70 bg-white/80 p-3 shadow-[0_20px_60px_rgba(70,55,37,0.08)] backdrop-blur-xl dark:border-dark-border/70 dark:bg-dark-card/90">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-600 dark:text-orange-300">
                Opportunities
              </div>
              <div className="rounded-full border border-navy-200/70 bg-cream-50/80 px-3 py-1 text-[11px] font-medium text-navy-700 dark:border-dark-border/70 dark:bg-dark-bg dark:text-dark-text">
                {visibleCount} visible
              </div>
              <div className="text-sm font-medium text-navy-800 dark:text-dark-text">{currentLens}</div>
              <div className="text-sm text-navy-500 dark:text-dark-muted">{operatorFocus}</div>
              <div className="text-sm text-navy-500 dark:text-dark-muted">{laneMeta.description}</div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {LANE_META.map((item) => (
                <LanePill
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
                  icon={item.icon}
                  label={item.shortLabel}
                  onClick={() => onLaneChange(item.id)}
                />
              ))}
            </div>
          </div>

          <div className="mt-3 space-y-3">
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
          </div>
        </div>

        {lane === "sent" ? (
          <SentLogView entries={sentLog} leads={allLeads} onOpenLead={onOpenLead} showHeader={false} />
        ) : (
          workspace
        )}
      </div>
    </div>
  )
}
