import { AlertCircle, CheckCircle2, Clock3, Inbox, Layers3 } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/features/permit-pulse/components/empty-state"
import {
  BoroughBadge,
  ContactabilityBadge,
  LeadScoreBadge,
  PriorityBadge,
  StatusBadge,
} from "@/features/permit-pulse/components/badges"
import { formatCurrency, formatRelativeDate, getPermitAddress } from "@/features/permit-pulse/lib/format"
import { getLeadBlocker, getLeadEvidence } from "@/features/permit-pulse/lib/operator"
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
      <div className="border-b border-navy-200/70 p-3.5 dark:border-dark-border/70">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">{title}</div>
            <div className="mt-1 text-sm leading-5 text-navy-500 dark:text-dark-muted">{description}</div>
            <div className="mt-2.5 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
              <span>{leads.length} visible</span>
              <span>{selectedIds.length} selected</span>
            </div>
          </div>
          <button
            className="rounded-full border border-navy-200 bg-cream-50 px-3 py-1.5 text-sm dark:border-dark-border dark:bg-dark-bg"
            onClick={onToggleAll}
            type="button"
          >
            {allSelected ? "Clear" : "Select"} all
          </button>
        </div>

        {selectedIds.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-full border border-navy-200 bg-white px-3 py-2 text-sm dark:border-dark-border dark:bg-dark-bg"
              onClick={() => onBulkSetStatus("reviewed")}
              type="button"
            >
              Mark reviewed
            </button>
            <button
              className="rounded-full border border-navy-200 bg-white px-3 py-2 text-sm dark:border-dark-border dark:bg-dark-bg"
              onClick={() => onBulkSetStatus("enriched")}
              type="button"
            >
              Move to enriched
            </button>
            <button
              className="rounded-full border border-navy-200 bg-white px-3 py-2 text-sm dark:border-dark-border dark:bg-dark-bg"
              onClick={() => onBulkSetStatus("archived")}
              type="button"
            >
              Archive
            </button>
          </div>
      ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2.5">
          {leads.map((lead, index) => {
            const isActive = lead.id === selectedLeadId
            const isChecked = selectedIds.includes(lead.id)
            const blocker = getLeadBlocker(lead)
            const evidence = getLeadEvidence(lead)

            return (
              <button
                key={lead.id}
                className={cn(
                  "group w-full rounded-[24px] border p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-sm dark:hover:border-orange-800/40",
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
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text sm:text-base">
                          {getPermitAddress(lead)}
                        </div>
                        <p className="mt-1.5 line-clamp-1 text-sm leading-5 text-navy-500 dark:text-dark-muted">
                          {evidence}
                        </p>
                      </div>
                      <div className="flex items-start gap-3 xl:flex-col xl:text-right">
                        <div>
                          <div className="text-xs uppercase tracking-[0.2em] text-navy-400 dark:text-dark-muted">
                            Cost
                          </div>
                          <div className="mt-1 text-lg font-semibold tracking-[-0.03em] text-navy-800 dark:text-dark-text">
                            {formatCurrency(lead.estimated_job_costs)}
                          </div>
                        </div>
                        <div className="text-sm text-navy-500 dark:text-dark-muted">
                          {formatRelativeDate(lead.issued_date)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <LeadScoreBadge score={lead.score} tier={lead.leadTier} />
                      <ContactabilityBadge contactability={lead.contactability} />
                      <PriorityBadge label={lead.priorityLabel} />
                      <StatusBadge status={lead.workflow.status} />
                      <BoroughBadge borough={lead.borough} />
                    </div>

                    <div className="mt-3 grid gap-2 rounded-[20px] border border-navy-200/70 bg-white/70 p-3 dark:border-dark-border/70 dark:bg-dark-card/80">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-navy-800 dark:text-dark-text">
                          <Layers3 className="h-4 w-4 shrink-0 text-orange-500" />
                          <span className="truncate">{lead.nextAction.label}</span>
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                          {lead.nextAction.urgency}
                        </div>
                      </div>
                      <div className="flex items-start gap-2 text-sm leading-5 text-navy-500 dark:text-dark-muted">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-navy-400 dark:text-dark-muted" />
                        <span className="line-clamp-2">{blocker}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {lead.channelDecision.primary} first
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {lead.outreachReadiness.label}
                        </span>
                      </div>
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
