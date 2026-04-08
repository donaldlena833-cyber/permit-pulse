import { Button } from "@/components/ui/button"
import { Panel } from "@/features/operator-console/components/panel"
import { describeLeadDecision } from "@/features/operator-console/lib/explain"
import { formatLeadStatus, formatScore } from "@/features/operator-console/lib/format"
import type { LeadRow } from "@/features/operator-console/types/api"

interface LeadsScreenProps {
  leads: LeadRow[]
  filter: string
  onFilterChange: (filter: string) => void
  onOpenLead: (lead: LeadRow) => void
  onEnrich: (leadId: string) => void
  actionLeadId: string | null
}

const FILTERS = ["all", "new", "ready", "review", "email_required", "sent", "archived"]

export function LeadsScreen({ leads, filter, onFilterChange, onOpenLead, onEnrich, actionLeadId }: LeadsScreenProps) {
  return (
    <div className="space-y-5 pb-32">
      <Panel className="overflow-hidden bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Lead queue</div>
        <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.05em] text-steel-900 sm:text-5xl">Review with control</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-steel-600">
          Open a lead, pick the right recipient yourself when the system is unsure, and keep weak evidence from hijacking the route.
        </p>
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((value) => (
            <Button
              key={value}
              className="h-10 rounded-full px-4"
              onClick={() => onFilterChange(value)}
              type="button"
              variant={filter === value ? "default" : "outline"}
            >
              {formatLeadStatus(value)}
            </Button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {leads.map((lead) => (
          <Panel className="transition hover:-translate-y-0.5 hover:border-brand-300" key={lead.id}>
            <button className="block w-full text-left" onClick={() => onOpenLead(lead)} type="button">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold tracking-[-0.03em] text-steel-900">{lead.company_name || "Unnamed lead"}</div>
                  <div className="mt-1 text-sm text-steel-600">{lead.address}</div>
                </div>
                <div className="rounded-full border border-steel-200 bg-steel-50 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-steel-600">
                  {formatLeadStatus(lead.status)}
                </div>
              </div>

              <div className="mt-4 text-sm text-steel-600">
                Relevance: {formatScore(lead.relevance_score)}{lead.relevance_keyword ? ` (${lead.relevance_keyword})` : ""}
              </div>
              <div className="mt-2 text-sm text-steel-500">
                {describeLeadDecision(lead)}
              </div>
              <div className="mt-4 grid gap-3 text-sm text-steel-600 sm:grid-cols-2">
                <div className="rounded-[16px] border border-steel-200 bg-steel-50/60 px-3 py-3">
                  <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel-500">Primary</div>
                  <div className="mt-2 font-medium text-steel-900">{lead.contact_email || "None chosen"}</div>
                  {lead.contact_email ? <div className="mt-1 text-xs">Trust {Math.round(lead.contact_email_trust || 0)}</div> : null}
                </div>
                <div className="rounded-[16px] border border-steel-200 bg-steel-50/60 px-3 py-3">
                  <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel-500">Fallback</div>
                  <div className="mt-2 font-medium text-steel-900">{lead.fallback_email || "No alternate"}</div>
                  {lead.fallback_email ? <div className="mt-1 text-xs">Trust {Math.round(lead.fallback_email_trust || 0)}</div> : null}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-steel-500">
                <div className="rounded-full border border-steel-200 bg-white px-3 py-1">
                  {lead.contact_phone || "No phone"}
                </div>
                <div className="rounded-full border border-steel-200 bg-white px-3 py-1">
                  {lead.company_website || "No website"}
                </div>
              </div>
            </button>
            {lead.status === "new" ? (
              <div className="mt-4 flex gap-2">
                <Button
                  className="h-9 rounded-xl px-3"
                  disabled={actionLeadId === lead.id}
                  onClick={() => onEnrich(lead.id)}
                  type="button"
                >
                  {actionLeadId === lead.id ? "Working" : "Automate"}
                </Button>
                <Button
                  className="h-9 rounded-xl px-3"
                  onClick={() => onOpenLead(lead)}
                  type="button"
                  variant="outline"
                >
                  Open
                </Button>
              </div>
            ) : null}
          </Panel>
        ))}
        {!leads.length ? (
          <Panel className="lg:col-span-2">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Queue clear</div>
            <div className="mt-2 text-2xl font-semibold text-steel-900">Nothing in {formatLeadStatus(filter)} right now</div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-steel-600">
              Try another filter, run a fresh scan, or move blocked leads into Email Required from the drawer so they do not get buried in general review.
            </p>
          </Panel>
        ) : null}
      </div>
    </div>
  )
}
