import { RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BOROUGH_OPTIONS, STATUS_LABELS } from "@/features/permit-pulse/lib/format"
import type { LeadFilters, LeadStatus, SavedView } from "@/types/permit-pulse"
import { cn } from "@/lib/utils"

const STATUS_OPTIONS: LeadStatus[] = [
  "new",
  "reviewed",
  "researching",
  "email-required",
  "enriched",
  "outreach-ready",
  "drafted",
  "contacted",
  "follow-up-due",
  "replied",
  "qualified",
  "quoted",
  "won",
  "lost",
  "archived",
]

interface SavedViewTabsProps {
  views: Array<SavedView & { count: number }>
  activeViewId: string
  onSelect: (viewId: string) => void
}

export function SavedViewTabs({ views, activeViewId, onSelect }: SavedViewTabsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {views.map((view) => (
        <button
          key={view.id}
          className={cn(
            "rounded-full border px-4 py-2 text-left transition-colors",
            activeViewId === view.id
              ? "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800/50 dark:bg-orange-900/20 dark:text-orange-200"
              : "border-navy-200 bg-white/75 text-navy-600 hover:border-navy-300 hover:bg-cream-100 dark:border-dark-border dark:bg-dark-card dark:text-dark-text",
          )}
          onClick={() => onSelect(view.id)}
          type="button"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{view.name}</span>
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] dark:bg-white/10">{view.count}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

interface SmartFilterBarProps {
  filters: LeadFilters
  onChange: (patch: Partial<LeadFilters>) => void
  onReset: () => void
  showSearch?: boolean
  layout?: "desktop" | "mobile"
}

export function SmartFilterBar({
  filters,
  onChange,
  onReset,
  showSearch = true,
  layout = "desktop",
}: SmartFilterBarProps) {
  if (layout === "mobile") {
    return (
      <div className="space-y-3">
        {showSearch ? (
          <Input
            className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg"
            onChange={(event) => onChange({ search: event.target.value })}
            placeholder="GC, owner, job description, notes..."
            value={filters.search}
          />
        ) : null}

        <Select onValueChange={(value) => onChange({ borough: value })} value={filters.borough}>
          <SelectTrigger className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg">
            <SelectValue placeholder="Borough" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All boroughs</SelectItem>
            {BOROUGH_OPTIONS.map((borough) => (
              <SelectItem key={borough} value={borough}>
                {borough}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={(value) => onChange({ tier: value as LeadFilters["tier"] })} value={filters.tier}>
          <SelectTrigger className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg">
            <SelectValue placeholder="Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All tiers</SelectItem>
            <SelectItem value="hot">Hot</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
          </SelectContent>
        </Select>

        <Select onValueChange={(value) => onChange({ status: value as LeadFilters["status"] })} value={filters.status}>
          <SelectTrigger className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="grid grid-cols-2 gap-3">
          <Select
            onValueChange={(value) => onChange({ daysBack: Number.parseInt(value, 10) })}
            value={String(filters.daysBack)}
          >
            <SelectTrigger className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Last 3 days</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
            </SelectContent>
          </Select>

          <Select
            onValueChange={(value) => onChange({ minCost: Number.parseInt(value, 10) })}
            value={String(filters.minCost)}
          >
            <SelectTrigger className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg">
              <SelectValue placeholder="Budget floor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10000">$10k+</SelectItem>
              <SelectItem value="25000">$25k+</SelectItem>
              <SelectItem value="50000">$50k+</SelectItem>
              <SelectItem value="100000">$100k+</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button className="h-11 w-full rounded-full" onClick={onReset} type="button" variant="outline">
          <RotateCcw className="h-4 w-4" />
          Reset filters
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-[28px] border border-navy-200/70 bg-white/80 p-4 shadow-sm backdrop-blur-xl dark:border-dark-border/70 dark:bg-dark-card/90">
      <div className={cn("grid gap-3 xl:grid-cols-[1.6fr_repeat(5,minmax(0,1fr))_auto]", !showSearch && "xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]")}>
        {showSearch ? (
          <Input
            className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg"
            onChange={(event) => onChange({ search: event.target.value })}
            placeholder="GC, owner, job description, notes..."
            value={filters.search}
          />
        ) : null}

        <Select onValueChange={(value) => onChange({ borough: value })} value={filters.borough}>
          <SelectTrigger className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg">
            <SelectValue placeholder="Borough" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All boroughs</SelectItem>
            {BOROUGH_OPTIONS.map((borough) => (
              <SelectItem key={borough} value={borough}>
                {borough}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={(value) => onChange({ tier: value as LeadFilters["tier"] })} value={filters.tier}>
          <SelectTrigger className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg">
            <SelectValue placeholder="Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All tiers</SelectItem>
            <SelectItem value="hot">Hot</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
          </SelectContent>
        </Select>

        <Select onValueChange={(value) => onChange({ status: value as LeadFilters["status"] })} value={filters.status}>
          <SelectTrigger className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          onValueChange={(value) => onChange({ daysBack: Number.parseInt(value, 10) })}
          value={String(filters.daysBack)}
        >
          <SelectTrigger className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg">
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Last 3 days</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
          </SelectContent>
        </Select>

        <Select
          onValueChange={(value) => onChange({ minCost: Number.parseInt(value, 10) })}
          value={String(filters.minCost)}
        >
          <SelectTrigger className="h-11 rounded-full border-navy-200 bg-cream-50 dark:border-dark-border dark:bg-dark-bg">
            <SelectValue placeholder="Budget floor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10000">$10k+</SelectItem>
            <SelectItem value="25000">$25k+</SelectItem>
            <SelectItem value="50000">$50k+</SelectItem>
            <SelectItem value="100000">$100k+</SelectItem>
          </SelectContent>
        </Select>

        <Button className="h-11 rounded-full" onClick={onReset} type="button" variant="outline">
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
      </div>
    </div>
  )
}
