import { Button } from "@/components/ui/button"
import { Panel } from "@/features/metroglass-leads/components/panel"
import { formatScore } from "@/features/metroglass-leads/lib/format"
import type { LeadRow } from "@/features/metroglass-leads/types/api"

interface LeadsScreenProps {
  leads: LeadRow[]
  filter: string
  onFilterChange: (filter: string) => void
  onOpenLead: (lead: LeadRow) => void
  onEnrich: (leadId: string) => void
  actionLeadId: string | null
}

const FILTERS = ["all", "new", "ready", "review", "sent", "archived"]

export function LeadsScreen({ leads, filter, onFilterChange, onOpenLead, onEnrich, actionLeadId }: LeadsScreenProps) {
  return (
    <div className="space-y-5 pb-32">
      <Panel className="overflow-hidden bg-[linear-gradient(145deg,#fff9f2,#ffffff_52%,#f5ebde)]">
        <div className="text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">Lead queue</div>
        <h1 className="mt-3 font-['Instrument_Serif'] text-4xl text-[#1A1A1A] sm:text-5xl">Review with control</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5F564C]">
          Open a lead, pick the right recipient yourself when the system is unsure, and keep weak evidence from hijacking the route.
        </p>
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((value) => (
            <Button
              key={value}
              className={`h-10 rounded-full px-4 ${filter === value ? "bg-[#1A1A1A] text-white hover:bg-[#1A1A1A]" : "border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]"}`}
              onClick={() => onFilterChange(value)}
              type="button"
              variant="outline"
            >
              {value[0].toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {leads.map((lead) => (
          <Panel className="transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(26,26,26,0.12)]" key={lead.id}>
            <button className="block w-full text-left" onClick={() => onOpenLead(lead)} type="button">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold tracking-[-0.03em] text-[#1A1A1A]">{lead.company_name || "Unnamed lead"}</div>
                  <div className="mt-1 text-sm text-[#5F564C]">{lead.address}</div>
                </div>
                <div className="rounded-full border border-[#E4D5C5] bg-[#FBF5EC] px-3 py-1 text-xs font-medium capitalize text-[#6B5A48]">
                  {lead.status}
                </div>
              </div>

              <div className="mt-4 text-sm text-[#5F564C]">
                Relevance: {formatScore(lead.relevance_score)}{lead.relevance_keyword ? ` (${lead.relevance_keyword})` : ""}
              </div>
              <div className="mt-4 grid gap-3 text-sm text-[#5F564C] sm:grid-cols-2">
                <div className="rounded-[16px] border border-[#EEE4D7] bg-[#FFFCF8] px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Primary</div>
                  <div className="mt-2 font-medium text-[#1A1A1A]">{lead.contact_email || "None chosen"}</div>
                  {lead.contact_email ? <div className="mt-1 text-xs">Trust {Math.round(lead.contact_email_trust || 0)}</div> : null}
                </div>
                <div className="rounded-[16px] border border-[#EEE4D7] bg-[#FFFCF8] px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Fallback</div>
                  <div className="mt-2 font-medium text-[#1A1A1A]">{lead.fallback_email || "No alternate"}</div>
                  {lead.fallback_email ? <div className="mt-1 text-xs">Trust {Math.round(lead.fallback_email_trust || 0)}</div> : null}
                </div>
              </div>
            </button>
            {lead.status === "new" ? (
              <div className="mt-4 flex gap-2">
                <Button
                  className="h-9 rounded-[8px] bg-[#D4691A] px-3 text-white hover:bg-[#BA5A12]"
                  disabled={actionLeadId === lead.id}
                  onClick={() => onEnrich(lead.id)}
                  type="button"
                >
                  {actionLeadId === lead.id ? "Working" : "Enrich"}
                </Button>
                <Button
                  className="h-9 rounded-[8px] border border-[#D6C6B6] bg-white px-3 text-[#5F564C] hover:bg-[#F7F0E8]"
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
      </div>
    </div>
  )
}
