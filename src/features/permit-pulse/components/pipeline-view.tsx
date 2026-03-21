import { ArrowRight, Clock3 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { LeadScoreBadge, PriorityBadge, StatusBadge } from "@/features/permit-pulse/components/badges"
import { EmptyState } from "@/features/permit-pulse/components/empty-state"
import { PageHeader } from "@/features/permit-pulse/components/page-header"
import { SectionCard } from "@/features/permit-pulse/components/section-card"
import { formatCurrency, formatRelativeDate, getPermitAddress } from "@/features/permit-pulse/lib/format"
import type { PipelineColumn } from "@/features/permit-pulse/lib/operator"
import { Inbox } from "lucide-react"

interface PipelineViewProps {
  columns: PipelineColumn[]
  onOpenLead: (leadId: string) => void
  onOpenOpportunities: () => void
}

export function PipelineView({ columns, onOpenLead, onOpenOpportunities }: PipelineViewProps) {
  const totalLeads = columns.reduce((total, column) => total + column.count, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        action={
          <Button className="rounded-full" onClick={onOpenOpportunities} type="button" variant="outline">
            Go to opportunities
          </Button>
        }
        description="This is the operating picture after triage. Keep research, ready-to-act work, active touches, and closed outcomes visually separate."
        eyebrow="Pipeline"
        title="Track the work after a lead is worth keeping."
      />

      {totalLeads === 0 ? (
        <EmptyState
          description="Nothing has been kept in the pipeline yet. Review the opportunity queue and move a few leads forward first."
          icon={Inbox}
          title="Pipeline is empty"
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-4">
          {columns.map((column) => (
            <SectionCard
              key={column.id}
              className="h-full"
              contentClassName="space-y-3"
              description={column.description}
              title={`${column.title} (${column.count})`}
            >
              {column.leads.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-navy-200/70 bg-cream-50/70 px-4 py-6 text-sm text-navy-500 dark:border-dark-border/70 dark:bg-dark-bg dark:text-dark-muted">
                  Nothing sitting here right now.
                </div>
              ) : (
                column.leads.map((lead) => (
                  <button
                    key={lead.id}
                    className="w-full rounded-[22px] border border-navy-200/70 bg-cream-50/80 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-sm dark:border-dark-border/70 dark:bg-dark-bg"
                    onClick={() => onOpenLead(lead.id)}
                    type="button"
                  >
                    <div className="text-sm font-semibold tracking-[-0.02em] text-navy-900 dark:text-dark-text">
                      {getPermitAddress(lead)}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-navy-500 dark:text-dark-muted">{lead.nextAction.label}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <LeadScoreBadge score={lead.score} tier={lead.leadTier} />
                      <PriorityBadge label={lead.priorityLabel} />
                      <StatusBadge status={lead.workflow.status} />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-navy-500 dark:text-dark-muted">
                      <span>{formatCurrency(lead.estimated_job_costs)}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatRelativeDate(lead.issued_date)}
                      </span>
                    </div>
                    <div className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-navy-700 dark:text-dark-text">
                      Open lead
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </button>
                ))
              )}
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  )
}
