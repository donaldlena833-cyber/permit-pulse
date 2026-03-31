import { type KeyboardEvent, type PointerEvent, useMemo, useRef, useState } from "react"
import { ArrowLeftRight, ArrowUpRight, CheckSquare, Globe, Mail, Phone, Sparkles } from "lucide-react"

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
const MOBILE_ACTION_WIDTH = 148

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
    return "Resolver or delivery exception"
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

function nextStepLabel(status: string) {
  if (status === "new") return "Automate"
  if (status === "email_required") return "Research email"
  if (status === "review") return "Inspect exception"
  if (status === "ready") return "Send or inspect"
  return "Open"
}

function leadLabel(lead: LeadRow) {
  return lead.company_name || lead.applicant_name || lead.address
}

interface LeadRowCardProps {
  lead: LeadRow
  index: number
  isSelected: boolean
  actionLeadId: string | null
  swipeOpen: boolean
  onSwipeOpenChange: (leadId: string | null) => void
  onToggleSelected: (checked: boolean) => void
  onOpenLead: (lead: LeadRow) => void
  onEnrich: (leadId: string) => void
}

function LeadRowCard({
  lead,
  index,
  isSelected,
  actionLeadId,
  swipeOpen,
  onSwipeOpenChange,
  onToggleSelected,
  onOpenLead,
  onEnrich,
}: LeadRowCardProps) {
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const gestureRef = useRef<{ startX: number; startY: number; startOffset: number } | null>(null)
  const draggingRef = useRef(false)
  const suppressTapRef = useRef(false)
  const offset = dragOffset ?? (swipeOpen ? -MOBILE_ACTION_WIDTH : 0)

  const isMobileSurface = () => typeof window !== "undefined" && window.innerWidth < 640

  const finishGesture = () => {
    if (!draggingRef.current) {
      return
    }

    draggingRef.current = false
    gestureRef.current = null
    const shouldOpen = offset <= -72
    setDragOffset(null)
    onSwipeOpenChange(shouldOpen ? lead.id : null)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMobileSurface()) {
      return
    }

    const target = event.target as HTMLElement
    if (target.closest("[data-no-swipe='true']")) {
      return
    }

    gestureRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offset,
    }
    draggingRef.current = true
    suppressTapRef.current = false
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !gestureRef.current || !isMobileSurface()) {
      return
    }

    const deltaX = event.clientX - gestureRef.current.startX
    const deltaY = event.clientY - gestureRef.current.startY

    if (!suppressTapRef.current && Math.abs(deltaX) < 10) {
      return
    }

    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 12) {
      draggingRef.current = false
      gestureRef.current = null
      setDragOffset(null)
      return
    }

    suppressTapRef.current = true
    onSwipeOpenChange(lead.id)
    const nextOffset = Math.max(-MOBILE_ACTION_WIDTH, Math.min(0, gestureRef.current.startOffset + deltaX))
    setDragOffset(nextOffset)
  }

  const handlePointerUp = () => {
    finishGesture()
  }

  const handlePointerCancel = () => {
    finishGesture()
  }

  const handleSurfaceOpen = () => {
    if (suppressTapRef.current) {
      suppressTapRef.current = false
      return
    }

    if (swipeOpen) {
      onSwipeOpenChange(null)
      return
    }

    onOpenLead(lead)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return
    }
    event.preventDefault()
    handleSurfaceOpen()
  }

  const handleSelectAction = () => {
    onToggleSelected(!isSelected)
    onSwipeOpenChange(null)
  }

  const handlePrimaryAction = () => {
    if (lead.status === "new") {
      onEnrich(lead.id)
    } else {
      onOpenLead(lead)
    }
    onSwipeOpenChange(null)
  }

  return (
    <article
      className={`relative overflow-hidden ${index !== 0 ? "border-t border-[#EEE4D7]" : ""}`}
      key={lead.id}
    >
      <div className="absolute inset-y-0 right-0 flex w-[148px] items-stretch justify-end sm:hidden">
        <button
          className={`flex w-[72px] flex-col items-center justify-center gap-1 border-l border-[#E8D9C8] text-[11px] font-medium tracking-[0.08em] transition ${
            isSelected
              ? "bg-[#F2E7DB] text-[#6B5A48]"
              : "bg-[#FAF2E8] text-[#8B7D6B]"
          }`}
          onClick={handleSelectAction}
          type="button"
        >
          <CheckSquare className="h-4 w-4" />
          {isSelected ? "Clear" : "Select"}
        </button>
        <button
          className={`flex w-[76px] flex-col items-center justify-center gap-1 text-[11px] font-medium tracking-[0.08em] text-white transition ${
            lead.status === "new" ? "bg-[#D4691A]" : "bg-[#1A1A1A]"
          }`}
          disabled={lead.status === "new" && actionLeadId === lead.id}
          onClick={handlePrimaryAction}
          type="button"
        >
          {lead.status === "new" ? <Sparkles className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
          {lead.status === "new" ? (actionLeadId === lead.id ? "Wait" : "Automate") : "Inspect"}
        </button>
      </div>

      <div
        className="relative bg-[rgba(255,255,255,0.9)] transition-transform duration-200 ease-out sm:translate-x-0"
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ transform: `translateX(${offset}px)` }}
      >
        <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
          <div className="pt-1" data-no-swipe="true">
            <Checkbox
              checked={isSelected}
              className="h-5 w-5 rounded-[6px] border-[#D2C2B1] data-[state=checked]:border-[#1A1A1A] data-[state=checked]:bg-[#1A1A1A]"
              onCheckedChange={(checked) => onToggleSelected(Boolean(checked))}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div
                className="min-w-0 flex-1 cursor-pointer rounded-[22px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4691A]/30"
                onClick={handleSurfaceOpen}
                onKeyDown={handleKeyDown}
                role="button"
                tabIndex={0}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-[15px] font-semibold tracking-[-0.02em] text-[#1A1A1A]">
                    {leadLabel(lead)}
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

                <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">{lead.address}</div>
                <div className="mt-2 text-sm leading-6 text-[#5F564C]">
                  {lead.work_description || "No work description on file"}
                </div>

                <div className="mt-4 border-t border-[#EEE4D7] pt-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">
                        <Mail className="h-3.5 w-3.5" />
                        Active route
                      </div>
                      <div className={`mt-2 break-all text-sm font-medium ${emailTone(lead)}`}>{routeSummary(lead)}</div>
                      <div className="mt-1 text-xs text-[#7A6F63]">
                        {lead.fallback_email ? `Fallback: ${lead.fallback_email}` : "No alternate route stored"}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-[16px] bg-[#FCF7F1] px-3 py-2.5">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[#8B7D6B]">
                          <Phone className="h-3.5 w-3.5" />
                          Phone
                        </div>
                        <div className="mt-1.5 text-xs font-medium leading-5 text-[#1A1A1A]">{lead.contact_phone || "Missing"}</div>
                      </div>

                      <div className="rounded-[16px] bg-[#FCF7F1] px-3 py-2.5">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[#8B7D6B]">
                          <Globe className="h-3.5 w-3.5" />
                          Website
                        </div>
                        <div className="mt-1.5 text-xs font-medium leading-5 text-[#1A1A1A]">{websiteLabel(lead.company_website)}</div>
                      </div>

                      <div className="rounded-[16px] bg-[#FCF7F1] px-3 py-2.5">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[#8B7D6B]">
                          <Sparkles className="h-3.5 w-3.5" />
                          Next
                        </div>
                        <div className="mt-1.5 text-xs font-medium leading-5 text-[#1A1A1A]">{nextStepLabel(lead.status)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full border border-[#E4D8CA] bg-white px-3 py-1 text-xs text-[#7A6F63]">
                      Relevance {formatScore(lead.relevance_score)}{lead.relevance_keyword ? ` • ${lead.relevance_keyword}` : ""}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#E6D7C7] bg-[#FFF9F2] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[#8B7D6B] sm:hidden">
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Swipe for actions
                    </span>
                  </div>
                </div>
              </div>

              <div className="hidden shrink-0 sm:flex sm:items-center sm:gap-2" data-no-swipe="true">
                {lead.status === "new" ? (
                  <Button
                    className="rounded-full px-4"
                    disabled={actionLeadId === lead.id}
                    onClick={() => onEnrich(lead.id)}
                    size="sm"
                    type="button"
                  >
                    {actionLeadId === lead.id ? "Working" : "Automate"}
                  </Button>
                ) : null}
                <Button
                  className="rounded-full px-4"
                  onClick={() => onOpenLead(lead)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ArrowUpRight className="h-4 w-4" />
                  Open
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

export function LeadsScreen({ leads, filter, onFilterChange, onOpenLead, onEnrich, onEnrichMany, actionLeadId }: LeadsScreenProps) {
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])
  const [swipeLeadId, setSwipeLeadId] = useState<string | null>(null)
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
            <h1 className="mt-2 font-['Instrument_Serif'] text-[1.85rem] leading-none text-[#1A1A1A] sm:text-[2.4rem]">
              Work the automation queue
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5F564C]">
              Keep the queue fast to scan. Tap to inspect, swipe on mobile for quick actions, and batch automate the leads that still need the full machine pass.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="rounded-full border border-[#E1D3C4] bg-white/84 px-3 py-2 text-xs text-[#6E645A]">
              <span className="font-medium text-[#1A1A1A]">{leads.length}</span> in {formatLeadStatus(filter)}
            </div>
            <div className="rounded-full border border-[#E1D3C4] bg-white/84 px-3 py-2 text-xs text-[#6E645A]">
              <span className="font-medium text-[#1A1A1A]">{selectedCount}</span> selected
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[22px] border border-[#E5D7C8] bg-white/78 p-3 shadow-[0_14px_30px_rgba(26,26,26,0.05)]">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((value) => (
              <button
                key={value}
                className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition ${
                  filter === value
                    ? "border-[#1A1A1A] bg-[#1A1A1A] text-white shadow-[0_10px_22px_rgba(26,26,26,0.18)]"
                    : "border-[#D6C6B6] bg-white/92 text-[#5F564C] hover:bg-white"
                }`}
                onClick={() => {
                  setSelectedLeadIds([])
                  setSwipeLeadId(null)
                  onFilterChange(value)
                }}
                type="button"
              >
                {formatLeadStatus(value)}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-col gap-3 border-t border-[#EEE4D7] pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#E6D7C7] bg-[#FFF9F2] px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Swipe rows on mobile for quick actions
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                className="rounded-full px-4"
                onClick={() => toggleAllVisible(!allVisibleSelected)}
                type="button"
                variant="outline"
              >
                <CheckSquare className="h-4 w-4" />
                {allVisibleSelected ? "Clear visible" : "Select visible"}
              </Button>
              <Button
                className="rounded-full bg-[#D4691A] px-4 text-white hover:bg-[#BA5A12]"
                disabled={selectedCount === 0 || actionLeadId === "automate-batch"}
                onClick={() => onEnrichMany(visibleSelectedLeadIds)}
                type="button"
              >
                {actionLeadId === "automate-batch" ? "Working" : `Automate selected${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[26px] border border-[#E5D7C8] bg-[rgba(255,255,255,0.9)] shadow-[0_18px_40px_rgba(26,26,26,0.06)]">
        {leads.map((lead, index) => (
          <LeadRowCard
            actionLeadId={actionLeadId}
            index={index}
            isSelected={selectedLeadIds.includes(lead.id)}
            key={lead.id}
            lead={lead}
            onEnrich={onEnrich}
            onOpenLead={onOpenLead}
            onSwipeOpenChange={setSwipeLeadId}
            onToggleSelected={(checked) => toggleLead(lead.id, checked)}
            swipeOpen={swipeLeadId === lead.id}
          />
        ))}

        {!leads.length ? (
          <div className="px-5 py-10">
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#8B7D6B]">Queue clear</div>
            <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">Nothing in {formatLeadStatus(filter)} right now</div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5F564C]">
              Try another filter, run a fresh scan, or move no-email leads into Email Required so the real exceptions do not get buried.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  )
}
