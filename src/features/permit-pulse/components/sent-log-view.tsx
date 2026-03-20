import { MailCheck, PhoneCall, Send, Sparkles } from "lucide-react"

import { EmptyState } from "@/features/permit-pulse/components/empty-state"
import { PageHeader } from "@/features/permit-pulse/components/page-header"
import { SectionCard } from "@/features/permit-pulse/components/section-card"
import { formatDate, formatRelativeDate } from "@/features/permit-pulse/lib/format"
import type { PermitLead, SentLogEntry } from "@/types/permit-pulse"

const CHANNEL_LABELS: Record<SentLogEntry["channel"], string> = {
  email: "Email",
  phone: "Phone",
  form: "Contact Form",
  linkedin: "LinkedIn",
}

const CHANNEL_ICONS = {
  email: MailCheck,
  phone: PhoneCall,
  form: Send,
  linkedin: Sparkles,
}

export function SentLogView({
  entries,
  leads,
  onOpenLead,
  showHeader = true,
}: {
  entries: SentLogEntry[]
  leads: PermitLead[]
  onOpenLead: (leadId: string) => void
  showHeader?: boolean
}) {
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]))

  return (
    <div className="space-y-6">
      {showHeader ? (
        <PageHeader
          description="Track what went out, which channel it used, and which leads have already been touched inside the active duplicate window."
          eyebrow="Sent Log"
          title="Keep every outbound touch visible."
        />
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          title="No sent outreach yet"
          description="The send log will populate as the automation layer or manual sends move leads into contacted status."
        />
      ) : (
        <div className="grid gap-4">
          {entries.map((entry) => {
            const lead = leadMap.get(entry.leadId)
            const Icon = CHANNEL_ICONS[entry.channel]

            return (
              <SectionCard
                key={entry.id}
                className="cursor-pointer transition-transform duration-200 hover:-translate-y-0.5"
                onClick={() => onOpenLead(entry.leadId)}
                title={lead ? `${lead.house_no} ${lead.street_name}`.trim() : entry.subject}
                description={`${CHANNEL_LABELS[entry.channel]} sent ${entry.sentAt ? formatRelativeDate(entry.sentAt) : "recently"}`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-orange-100 p-2 text-orange-700 dark:bg-orange-900/20 dark:text-orange-200">
                        <Icon className="h-4 w-4" />
                      </div>
                    </div>

                    <div className="text-sm leading-6 text-navy-600 dark:text-dark-muted">
                      <div>{entry.subject}</div>
                      <div className="mt-1 text-xs text-navy-500 dark:text-dark-muted">{entry.recipient}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs text-navy-500 dark:text-dark-muted">
                    <span className="rounded-full border border-navy-200 bg-white/80 px-3 py-1 dark:border-dark-border dark:bg-dark-card">
                      {entry.sentAt ? formatDate(entry.sentAt) : "Pending timestamp"}
                    </span>
                    <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-orange-700 dark:border-orange-800/50 dark:bg-orange-900/20 dark:text-orange-200">
                      {entry.status}
                    </span>
                    {lead ? (
                      <span className="rounded-full border border-navy-200 bg-white/80 px-3 py-1 dark:border-dark-border dark:bg-dark-card">
                        Score {lead.score}
                      </span>
                    ) : null}
                  </div>
                </div>
              </SectionCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
