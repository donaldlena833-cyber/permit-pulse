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
    <div className="space-y-4 pb-28">
      <Panel>
        <div className="text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">Leads</div>
        <h1 className="mt-2 font-['Instrument_Serif'] text-4xl text-[#1A1A1A]">Active queue</h1>
        <p className="mt-2 text-sm text-[#5F564C]">Discovered contacts first, send route second, weak guesses kept out of the way.</p>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
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

      <div className="space-y-3">
        {leads.map((lead) => (
          <Panel className="transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(26,26,26,0.12)]" key={lead.id}>
            <button className="block w-full text-left" onClick={() => onOpenLead(lead)} type="button">
              <div className="font-semibold text-[#1A1A1A]">{lead.company_name || "Unnamed lead"}</div>
              <div className="mt-1 text-sm text-[#5F564C]">{lead.address}</div>
              <div className="mt-3 text-sm text-[#5F564C]">
                Relevance: {formatScore(lead.relevance_score)}{lead.relevance_keyword ? ` (${lead.relevance_keyword})` : ""}
              </div>
              <div className="mt-3 grid gap-2 text-sm text-[#5F564C]">
                <div>
                  Best contact: <span className="font-medium text-[#1A1A1A]">{lead.contact_email || "None found"}</span>
                  {lead.contact_email ? ` (trust ${Math.round(lead.contact_email_trust || 0)})` : ""}
                </div>
                <div>
                  Alternate: <span className="font-medium text-[#1A1A1A]">{lead.fallback_email || "None"}</span>
                  {lead.fallback_email ? ` (trust ${Math.round(lead.fallback_email_trust || 0)})` : ""}
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
