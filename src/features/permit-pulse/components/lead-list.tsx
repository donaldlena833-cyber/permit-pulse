import { Clock3, Inbox } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/features/permit-pulse/components/empty-state"
import {
  BoroughBadge,
  LeadScoreBadge,
  StatusBadge,
} from "@/features/permit-pulse/components/badges"
import { formatCurrency, formatRelativeDate, getPermitAddress } from "@/features/permit-pulse/lib/format"
import type { LeadStatus, PermitLead } from "@/types/permit-pulse"
import { cn } from "@/lib/utils"

interface LeadListProps {
  leads: PermitLead[]
  selectedLeadId: string | null
  selectedIds: string[]
  onSelectLead: (leadId: string) => void
  onToggleLead: (leadId: string) => void
  onToggleAll: () => void
  onBulkSetStatus: (status: LeadStatus) => void
  title: string
  description: string
  emptyTitle: string
  emptyDescription: string
}

export function LeadList({
  leads,
  selectedLeadId,
  selectedIds,
  onSelectLead,
  onToggleLead,
  onToggleAll,
  onBulkSetStatus,
  title,
  description,
  emptyTitle,
  emptyDescription,
}: LeadListProps) {
  const allSelected = leads.length > 0 && leads.every((lead) => selectedIds.includes(lead.id))

  if (leads.length === 0) {
    return <EmptyState description={emptyDescription} icon={Inbox} title={emptyTitle} />
  }

  return (
    <div className="flex h-full flex-col rounded-[30px] border border-navy-200/70 bg-white/80 shadow-sm backdrop-blur-xl dark:border-dark-border/70 dark:bg-dark-card/90">
      <div className="border-b border-navy-200/70 p-3 dark:border-dark-border/70">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">{title}</div>
            <div className="mt-1 text-[11px] leading-5 text-navy-500 dark:text-dark-muted">{description}</div>
            <div className="mt-2 flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
              <span>{leads.length} visible</span>
              <span>{selectedIds.length} selected</span>
            </div>
          </div>
          <button
            className="rounded-full border border-navy-200 bg-cream-50 px-3 py-1.5 text-[11px] font-medium dark:border-dark-border dark:bg-dark-bg"
            onClick={onToggleAll}
            type="button"
          >
            {allSelected ? "Clear" : "Select"} all
          </button>
        </div>

        {selectedIds.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-full border border-navy-200 bg-white px-3 py-1.5 text-[11px] dark:border-dark-border dark:bg-dark-bg"
              onClick={() => onBulkSetStatus("reviewed")}
              type="button"
            >
              Mark reviewed
            </button>
            <button
              className="rounded-full border border-navy-200 bg-white px-3 py-1.5 text-[11px] dark:border-dark-border dark:bg-dark-bg"
              onClick={() => onBulkSetStatus("enriched")}
              type="button"
            >
              Move to enriched
            </button>
            <button
              className="rounded-full border border-navy-200 bg-white px-3 py-1.5 text-[11px] dark:border-dark-border dark:bg-dark-bg"
              onClick={() => onBulkSetStatus("archived")}
              type="button"
            >
              Archive
            </button>
          </div>
      ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          {leads.map((lead, index) => {
            const isActive = lead.id === selectedLeadId
            const isChecked = selectedIds.includes(lead.id)

            return (
              <button
                key={lead.id}
                className={cn(
                  "group w-full rounded-[20px] border px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-sm dark:hover:border-orange-800/40",
                  isActive
                    ? "border-orange-200 bg-orange-50/80 shadow-sm dark:border-orange-800/50 dark:bg-orange-900/10"
                    : "border-navy-200/70 bg-cream-50/70 dark:border-dark-border/70 dark:bg-dark-bg",
                )}
                onClick={() => onSelectLead(lead.id)}
                style={{ animationDelay: `${index * 35}ms` }}
                type="button"
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => onToggleLead(lead.id)}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text sm:text-base">
                        {getPermitAddress(lead)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-navy-500 dark:text-dark-muted">
                        <span>{formatCurrency(lead.estimated_job_costs)}</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatRelativeDate(lead.issued_date)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <LeadScoreBadge score={lead.score} tier={lead.leadTier} />
                      <StatusBadge status={lead.workflow.status} />
                      <BoroughBadge borough={lead.borough} />
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
