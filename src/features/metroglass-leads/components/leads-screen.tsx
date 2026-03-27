import { useMemo, useState } from "react"
import { ArrowUpRight, CheckSquare, Globe, Mail, Phone, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { formatLeadStatus, formatScore } from "@/features/metroglass-leads/lib/format"
import type { LeadRow } from "@/features/metroglass-leads/types/api"

interface LeadsScreenProps {
  leads: LeadRow[]
  filter: string
  onFilterChange: (filter: string) => void
  onOpenLead: (lead: LeadRow) => void
  onEnrich: (leadId: string) => void
  onEnrichMany: (leadIds: string[]) => void
  actionLeadId: string | null
}

const FILTERS = ["all", "new", "ready", "review", "email_required", "sent", "archived"]

function statusTone(status: string) {
  if (status === "ready") return "border-[#C6E1D3] bg-[#F3FBF7] text-[#2D6A4F]"
  if (status === "email_required") return "border-[#E2D4C5] bg-[#F8F1E8] text-[#6B5A48]"
  if (status === "review") return "border-[#E9D7BE] bg-[#FFF7ED] text-[#9A6A2C]"
  if (status === "sent") return "border-[#D3D8E8] bg-[#F5F7FC] text-[#44557A]"
  if (status === "archived") return "border-[#E0DED9] bg-[#F7F7F5] text-[#6F6A63]"
  return "border-[#F0D8C1] bg-[#FFF2E5] text-[#9A5A12]"
}

function routeSummary(lead: LeadRow) {
  if (lead.contact_email) {
    return lead.contact_email
  }
  if (lead.status === "email_required") {
    return "Needs manual email research"
  }
  if (lead.status === "review") {
    return "System found evidence but no approved route"
  }
  return "No verified email selected"
}

function websiteLabel(value: string | null | undefined) {
  if (!value) {
    return "No website"
  }

  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.replace(/^www\./, "")
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/^www\./, "")
  }
}

function emailTone(lead: LeadRow) {
  if (lead.contact_email) return "text-[#1A1A1A]"
  if (lead.status === "email_required") return "text-[#6B5A48]"
  return "text-[#7A6A59]"
}

export function LeadsScreen({ leads, filter, onFilterChange, onOpenLead, onEnrich, onEnrichMany, actionLeadId }: LeadsScreenProps) {
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])
  const visibleSelectedLeadIds = useMemo(
    () => selectedLeadIds.filter((leadId) => leads.some((lead) => lead.id === leadId)),
    [leads, selectedLeadIds],
  )
  const selectedCount = visibleSelectedLeadIds.length
  const allVisibleSelected = useMemo(
    () => leads.length > 0 && leads.every((lead) => visibleSelectedLeadIds.includes(lead.id)),
    [leads, visibleSelectedLeadIds],
  )

  const toggleLead = (leadId: string, checked: boolean) => {
    setSelectedLeadIds((current) => (
      checked
        ? Array.from(new Set([...current, leadId]))
        : current.filter((currentLeadId) => currentLeadId !== leadId)
    ))
  }

  const toggleAllVisible = (checked: boolean) => {
    setSelectedLeadIds(checked ? leads.map((lead) => lead.id) : [])
  }

  return (
    <div className="space-y-5 pb-32">
      <section className="overflow-hidden rounded-[28px] border border-[#E5D7C8] bg-[linear-gradient(160deg,#fffaf3,#fffdf9_56%,#f1e7da)] px-4 py-5 shadow-[0_22px_48px_rgba(26,26,26,0.07)] sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[#D4691A]">Lead queue</div>
            <h1 className="mt-2 font-['Instrument_Serif'] text-[2rem] leading-none text-[#1A1A1A] sm:text-[2.6rem]">
              Review with control
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5F564C]">
              Work the queue like an operator, not a dashboard. Pick the right route, park dead ends honestly, and keep the list tight enough to scan fast from your phone.
            </p>
          </div>

          <div className="rounded-[18px] border border-[#E8DACA] bg-white/80 px-4 py-3 text-right">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Showing</div>
            <div className="mt-1 text-2xl font-semibold text-[#1A1A1A]">{leads.length}</div>
            <div className="mt-1 text-xs text-[#6E645A]">{formatLeadStatus(filter)}</div>
          </div>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((value) => (
            <button
              key={value}
              className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition ${
                filter === value
                  ? "border-[#1A1A1A] bg-[#1A1A1A] text-white shadow-[0_10px_22px_rgba(26,26,26,0.18)]"
                  : "border-[#D6C6B6] bg-white/90 text-[#5F564C] hover:bg-white"
              }`}
              onClick={() => {
                setSelectedLeadIds([])
                onFilterChange(value)
              }}
              type="button"
            >
              {formatLeadStatus(value)}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-[24px] border border-[#E5D7C8] bg-[rgba(255,255,255,0.88)] px-4 py-4 shadow-[0_16px_36px_rgba(26,26,26,0.05)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#8B7D6B]">Batch enrich</div>
            <div className="mt-1 text-sm text-[#5F564C]">
              Select only the leads you want to re-run. I do not recommend a blind enrich-everything button.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]"
              onClick={() => toggleAllVisible(!allVisibleSelected)}
              type="button"
              variant="outline"
            >
              <CheckSquare className="h-4 w-4" />
              {allVisibleSelected ? "Clear visible" : "Select visible"}
            </Button>
            <Button
              className="h-10 rounded-full bg-[#D4691A] px-4 text-white hover:bg-[#BA5A12]"
              disabled={selectedCount === 0 || actionLeadId === "enrich-batch"}
              onClick={() => onEnrichMany(visibleSelectedLeadIds)}
              type="button"
            >
              {actionLeadId === "enrich-batch" ? "Working" : `Enrich selected${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
            </Button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[26px] border border-[#E5D7C8] bg-[rgba(255,255,255,0.9)] shadow-[0_18px_40px_rgba(26,26,26,0.06)]">
        {leads.map((lead, index) => (
          <article
            className={`group px-4 py-4 transition hover:bg-[#FFFCF8] sm:px-5 ${index !== leads.length - 1 ? "border-b border-[#EEE4D7]" : ""}`}
            key={lead.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="pt-1">
                <Checkbox
                  checked={selectedLeadIds.includes(lead.id)}
                  className="h-5 w-5 rounded-[6px] border-[#D2C2B1] data-[state=checked]:border-[#1A1A1A] data-[state=checked]:bg-[#1A1A1A]"
                  onCheckedChange={(checked) => toggleLead(lead.id, Boolean(checked))}
                />
              </div>
              <button className="min-w-0 flex-1 text-left" onClick={() => onOpenLead(lead)} type="button">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-[15px] font-semibold tracking-[-0.02em] text-[#1A1A1A]">
                    {lead.company_name || lead.applicant_name || lead.address}
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] ${statusTone(lead.status)}`}>
                    {formatLeadStatus(lead.status)}
                  </span>
                  {lead.contact_email ? (
                    <span className="rounded-full border border-[#E1D6C9] bg-[#FAF5EE] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#6C6156]">
                      Trust {Math.round(lead.contact_email_trust || 0)}
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 text-sm text-[#5F564C]">{lead.address}</div>
                <div className="mt-2 text-sm leading-6 text-[#6A5F54]">
                  {lead.work_description || "No work description on file"}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-[#E4D8CA] bg-white px-3 py-1 text-[#7A6F63]">
                    Relevance {formatScore(lead.relevance_score)}{lead.relevance_keyword ? ` • ${lead.relevance_keyword}` : ""}
                  </span>
                  <span className={`rounded-full border border-[#E4D8CA] bg-white px-3 py-1 ${emailTone(lead)}`}>
                    {routeSummary(lead)}
                  </span>
                  <span className="rounded-full border border-[#E4D8CA] bg-white px-3 py-1 text-[#7A6F63]">
                    {lead.contact_phone || "No phone"}
                  </span>
                  <span className="rounded-full border border-[#E4D8CA] bg-white px-3 py-1 text-[#7A6F63]">
                    {websiteLabel(lead.company_website)}
                  </span>
                </div>
              </button>

              <div className="shrink-0">
                <Button
                  className="h-9 rounded-full border border-[#D6C6B6] bg-white px-3 text-[#5F564C] hover:bg-[#F7F0E8]"
                  onClick={() => onOpenLead(lead)}
                  type="button"
                  variant="outline"
                >
                  <ArrowUpRight className="h-4 w-4" />
                  Open
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="rounded-[18px] bg-[#FCF7F1] px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">
                  <Mail className="h-3.5 w-3.5" />
                  Active route
                </div>
                <div className="mt-2 break-all text-sm font-medium text-[#1A1A1A]">
                  {lead.contact_email || "No verified route chosen"}
                </div>
                <div className="mt-1 text-xs text-[#7A6F63]">
                  {lead.fallback_email ? `Fallback: ${lead.fallback_email}` : "No alternate route stored"}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 sm:gap-2">
                <div className="rounded-[18px] bg-[#FCF7F1] px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">
                    <Phone className="h-3.5 w-3.5" />
                    Phone
                  </div>
                  <div className="mt-2 text-sm font-medium text-[#1A1A1A]">{lead.contact_phone || "Missing"}</div>
                </div>
                <div className="rounded-[18px] bg-[#FCF7F1] px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">
                    <Globe className="h-3.5 w-3.5" />
                    Website
                  </div>
                  <div className="mt-2 text-sm font-medium text-[#1A1A1A]">{websiteLabel(lead.company_website)}</div>
                </div>
                <div className="rounded-[18px] bg-[#FCF7F1] px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">
                    <Sparkles className="h-3.5 w-3.5" />
                    Next step
                  </div>
                  <div className="mt-2 text-sm font-medium text-[#1A1A1A]">
                    {lead.status === "new"
                      ? "Enrich"
                      : lead.status === "email_required"
                        ? "Research email"
                        : lead.status === "review"
                          ? "Pick route"
                          : lead.status === "ready"
                            ? "Send or inspect"
                            : "Open"}
                  </div>
                </div>
              </div>
            </div>

            {lead.status === "new" ? (
              <div className="mt-4 flex gap-2">
                <Button
                  className="h-10 rounded-full bg-[#D4691A] px-4 text-white hover:bg-[#BA5A12]"
                  disabled={actionLeadId === lead.id}
                  onClick={() => onEnrich(lead.id)}
                  type="button"
                >
                  {actionLeadId === lead.id ? "Working" : "Enrich"}
                </Button>
              </div>
            ) : null}
          </article>
        ))}

        {!leads.length ? (
          <div className="px-5 py-10">
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#8B7D6B]">Queue clear</div>
            <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">Nothing in {formatLeadStatus(filter)} right now</div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5F564C]">
              Try another filter, run a fresh scan, or move blocked leads into Email Required from the drawer so they do not get buried in general review.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  )
}
