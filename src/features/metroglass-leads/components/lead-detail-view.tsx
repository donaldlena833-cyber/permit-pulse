import { useMemo, useState } from "react"
import { ArrowLeft, ChevronDown, LoaderCircle, Mail, Phone } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { formatDate, formatRelativeTime, formatScore } from "@/features/metroglass-leads/lib/format"
import type { EmailCandidate, LeadDetailResponse } from "@/features/metroglass-leads/types/api"

interface LeadDetailViewProps {
  detail: LeadDetailResponse | null
  open: boolean
  actionLeadId: string | null
  onClose: () => void
  onEnrich: (leadId: string) => void
  onSend: (leadId: string) => void
  onArchive: (leadId: string) => void
  onVouch: (leadId: string) => void
  onBounced: (leadId: string) => void
  onReplied: (leadId: string) => void
  onWon: (leadId: string) => void
  onLost: (leadId: string) => void
  onSwitchFallback: (leadId: string) => void
  onRefreshDraft: (leadId: string) => void
  onSaveDraft: (leadId: string, draft: { subject: string; body: string }) => void
  onSendFollowUp: (leadId: string, step: number) => void
  onSkipFollowUp: (leadId: string, step: number) => void
  onLogPhoneFollowUp: (leadId: string, step: number, notes: string) => void
}

function canSend(detail: LeadDetailResponse | null) {
  return Boolean(detail?.contacts.approved_primary)
}

function ContactCard({
  candidate,
  tone = "neutral",
}: {
  candidate: EmailCandidate
  tone?: "neutral" | "approved" | "guessed"
}) {
  const toneClasses =
    tone === "approved"
      ? "border-[#B8D2C2] bg-[#F3FBF7]"
      : tone === "guessed"
        ? "border-[#E9DDD0] bg-[#FBF7F2]"
        : "border-[#EEE4D7] bg-white"

  return (
    <div className={`rounded-[12px] border p-3 ${toneClasses}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">
            <Mail className="h-3.5 w-3.5" />
            {candidate.provenance_page_type || candidate.provenance_source}
          </div>
          <div className="mt-2 break-all text-base font-semibold text-[#1A1A1A]">{candidate.email_address}</div>
        </div>
        <div className="rounded-full bg-[#F6EFE6] px-2.5 py-1 text-xs font-medium text-[#5F564C]">
          Trust {Math.round(candidate.trust_score)}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#8B7D6B]">
        <span className="rounded-full border border-[#E6DACA] px-2 py-1">{candidate.provenance_extraction_method || "text_scrape"}</span>
        {candidate.is_auto_sendable || candidate.is_manual_sendable ? (
          <span className="rounded-full border border-[#B8D2C2] bg-[#EEF8F2] px-2 py-1 text-[#2D6A4F]">
            Send approved
          </span>
        ) : null}
      </div>
      {candidate.provenance_url ? (
        <div className="mt-2 break-all text-xs text-[#8B7D6B]">{candidate.provenance_url}</div>
      ) : null}
      {candidate.provenance_raw_context ? (
        <div className="mt-3 rounded-[10px] bg-[#F8F2EA] px-3 py-2 text-sm text-[#5F564C]">{candidate.provenance_raw_context}</div>
      ) : null}
    </div>
  )
}

export function LeadDetailView({
  detail,
  open,
  actionLeadId,
  onClose,
  onEnrich,
  onSend,
  onArchive,
  onVouch,
  onBounced,
  onReplied,
  onWon,
  onLost,
  onSwitchFallback,
  onRefreshDraft,
  onSaveDraft,
  onSendFollowUp,
  onSkipFollowUp,
  onLogPhoneFollowUp,
}: LeadDetailViewProps) {
  const [draft, setDraft] = useState({ subject: "", body: "" })
  const [draftDirty, setDraftDirty] = useState(false)

  const discoveredEmails = useMemo(() => detail?.contacts.discovered_emails ?? [], [detail])
  const guessedEmails = useMemo(() => detail?.contacts.guessed_emails ?? [], [detail])
  const primary = detail?.contacts.primary ?? null
  const fallback = detail?.contacts.fallback ?? null
  const approvedPrimary = detail?.contacts.approved_primary ?? null
  const approvedFallback = detail?.contacts.approved_fallback ?? null

  if (!open || !detail) {
    return null
  }

  const working = actionLeadId === detail.lead.id
  const visibleDraft = draftDirty
    ? draft
    : {
        subject: detail.draft.subject || "",
        body: detail.draft.body || "",
      }

  const primaryActionLabel = detail.lead.status === "sent"
    ? "Sent"
    : canSend(detail)
      ? "Send"
      : discoveredEmails.length > 0 || detail.contacts.phone
        ? "Refresh discovery"
        : "Enrich now"

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(19,17,15,0.45)]">
      <div className="absolute inset-x-0 bottom-0 top-0 overflow-y-auto bg-[#E8E2D9] md:left-auto md:w-[680px] md:border-l md:border-[#D9CCBE]">
        <div className="sticky top-0 z-20 border-b border-[#D9CCBE] bg-[#E8E2D9]/95 px-4 py-4 backdrop-blur">
          <button className="inline-flex items-center gap-2 text-sm font-medium text-[#5F564C]" onClick={onClose} type="button">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>

        <div className="space-y-4 px-4 pb-40 pt-4">
          <section className="overflow-hidden rounded-[18px] border border-[#E1D4C5] bg-[linear-gradient(160deg,#fffaf4,#fff_45%,#f6ebde)] p-5 shadow-[0_18px_42px_rgba(26,26,26,0.08)]">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[#8F5B22]">Lead workspace</div>
            <h2 className="mt-2 font-['Instrument_Serif'] text-4xl leading-none text-[#1A1A1A]">
              {detail.lead.company_name || "Unnamed lead"}
            </h2>
            <p className="mt-3 text-sm text-[#5F564C]">{detail.lead.address}</p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-[12px] border border-[#E8DCCF] bg-white/80 p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Relevance</div>
                <div className="mt-1 text-lg font-semibold text-[#1A1A1A]">
                  {formatScore(detail.lead.relevance_score)}
                  {detail.lead.relevance_keyword ? ` (${detail.lead.relevance_keyword})` : ""}
                </div>
              </div>
              <div className="rounded-[12px] border border-[#E8DCCF] bg-white/80 p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Status</div>
                <div className="mt-1 text-lg font-semibold capitalize text-[#1A1A1A]">{detail.lead.status}</div>
              </div>
              <div className="rounded-[12px] border border-[#E8DCCF] bg-white/80 p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Best contact</div>
                <div className="mt-1 break-all text-sm font-semibold text-[#1A1A1A]">{detail.lead.contact_email || "No email projected yet"}</div>
              </div>
              <div className="rounded-[12px] border border-[#E8DCCF] bg-white/80 p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Phone</div>
                <div className="mt-1 text-sm font-semibold text-[#1A1A1A]">{detail.contacts.phone || "No phone found"}</div>
              </div>
            </div>
          </section>

          <section className="rounded-[16px] bg-white p-4 shadow-[0_12px_34px_rgba(26,26,26,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">Discovered contacts</div>
                <div className="mt-1 text-sm text-[#5F564C]">This is what the system actually found on the official site.</div>
              </div>
              {detail.contacts.phone ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-[#E5D7C8] bg-[#FAF4ED] px-3 py-2 text-sm text-[#5F564C]">
                  <Phone className="h-4 w-4" />
                  {detail.contacts.phone}
                </div>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              {discoveredEmails.length > 0 ? discoveredEmails.map((candidate) => (
                <ContactCard
                  candidate={candidate}
                  key={candidate.id}
                  tone={candidate.id === approvedPrimary?.id || candidate.id === approvedFallback?.id ? "approved" : "neutral"}
                />
              )) : (
                <div className="rounded-[12px] border border-dashed border-[#D9CCBE] bg-[#FBF6F0] px-4 py-5 text-sm text-[#5F564C]">
                  No published site contacts found yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[16px] bg-white p-4 shadow-[0_12px_34px_rgba(26,26,26,0.08)]">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">Send route</div>
            <div className="mt-3 space-y-3">
              {approvedPrimary ? (
                <ContactCard candidate={approvedPrimary} tone="approved" />
              ) : (
                <div className="rounded-[12px] border border-[#E4D8CA] bg-[#FBF5EE] px-4 py-4 text-sm text-[#5F564C]">
                  No send approved route yet. Discovery found contact info, but outreach scoring is still keeping this lead in review.
                </div>
              )}
              {approvedFallback && approvedFallback.id !== approvedPrimary?.id ? (
                <ContactCard candidate={approvedFallback} tone="approved" />
              ) : null}
              {!approvedPrimary && primary ? (
                <div className="rounded-[12px] border border-[#EEE4D7] bg-[#FFFDFC] px-4 py-4 text-sm text-[#5F564C]">
                  Best discovered contact: <span className="font-semibold text-[#1A1A1A]">{primary.email_address}</span>
                </div>
              ) : null}
              {!approvedFallback && fallback && fallback.id !== primary?.id ? (
                <div className="rounded-[12px] border border-[#EEE4D7] bg-[#FFFDFC] px-4 py-4 text-sm text-[#5F564C]">
                  Alternate discovered contact: <span className="font-semibold text-[#1A1A1A]">{fallback.email_address}</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[16px] bg-white p-4 shadow-[0_12px_34px_rgba(26,26,26,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">Draft</div>
                <div className="mt-1 text-sm text-[#5F564C]">Keep the message tight, specific, and ready for send.</div>
              </div>
              <Button className="h-9 rounded-[8px] border border-[#D4691A] bg-white text-[#D4691A] hover:bg-[#FFF5ED]" onClick={() => onRefreshDraft(detail.lead.id)} type="button" variant="outline">
                Refresh
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="grid gap-2 text-sm text-[#5F564C]">
                Subject
                <Textarea
                  className="min-h-[64px] rounded-[10px]"
                  onChange={(event) => {
                    setDraftDirty(true)
                    setDraft({ ...visibleDraft, subject: event.target.value })
                  }}
                  value={visibleDraft.subject}
                />
              </label>
              <label className="grid gap-2 text-sm text-[#5F564C]">
                Body
                <Textarea
                  className="min-h-[220px] rounded-[10px]"
                  onChange={(event) => {
                    setDraftDirty(true)
                    setDraft({ ...visibleDraft, body: event.target.value })
                  }}
                  value={visibleDraft.body}
                />
              </label>
            </div>
            <Button className="mt-4 h-10 rounded-[8px] bg-[#1A1A1A] text-white hover:bg-[#1A1A1A]" onClick={() => onSaveDraft(detail.lead.id, visibleDraft)}>
              Save draft
            </Button>
          </section>

          <details className="rounded-[16px] bg-white p-4 shadow-[0_12px_34px_rgba(26,26,26,0.08)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">
              Details
              <ChevronDown className="h-4 w-4" />
            </summary>
            <div className="mt-4 space-y-5">
              <div>
                <div className="text-sm font-semibold text-[#1A1A1A]">Trust breakdown</div>
                <div className="mt-3 space-y-3">
                  {[primary, fallback].filter(Boolean).map((candidate) => (
                    <div className="rounded-[12px] border border-[#EEE4D7] p-3" key={candidate!.id}>
                      <div className="font-medium text-[#1A1A1A]">{candidate!.email_address}</div>
                      <ul className="mt-2 space-y-1 text-sm text-[#5F564C]">
                        {(candidate!.trust_reasons || []).map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold text-[#1A1A1A]">Pattern guesses</div>
                <div className="mt-3 space-y-3">
                  {guessedEmails.length > 0 ? guessedEmails.map((candidate) => (
                    <ContactCard candidate={candidate} key={candidate.id} tone="guessed" />
                  )) : (
                    <div className="rounded-[12px] border border-dashed border-[#D9CCBE] bg-[#FBF6F0] px-4 py-5 text-sm text-[#5F564C]">
                      No pattern guesses stored.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold text-[#1A1A1A]">Company candidates</div>
                <div className="mt-3 space-y-3">
                  {detail.candidates.companies.map((company) => (
                    <div key={company.id} className="rounded-[12px] border border-[#EEE4D7] p-3">
                      <div className="font-medium text-[#1A1A1A]">{company.company_name}</div>
                      <div className="mt-1 text-xs text-[#8B7D6B]">{company.source || "Unknown source"} · Confidence {Math.round(company.confidence)}</div>
                      <div className="mt-1 text-xs text-[#8B7D6B]">{company.is_chosen ? "Chosen" : company.rejected_reason || "Rejected"}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>

          <details className="rounded-[16px] bg-white p-4 shadow-[0_12px_34px_rgba(26,26,26,0.08)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">
              Timeline
              <ChevronDown className="h-4 w-4" />
            </summary>
            <div className="mt-4 space-y-3">
              {detail.timeline.map((event) => (
                <div key={event.id} className="rounded-[12px] border border-[#EEE4D7] px-3 py-3">
                  <div className="font-medium capitalize text-[#1A1A1A]">{event.event_type.replace(/_/g, " ")}</div>
                  <div className="mt-1 text-xs text-[#8B7D6B]">{formatRelativeTime(event.created_at)}</div>
                </div>
              ))}
            </div>
          </details>

          <details className="rounded-[16px] bg-white p-4 shadow-[0_12px_34px_rgba(26,26,26,0.08)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">
              Follow ups
              <ChevronDown className="h-4 w-4" />
            </summary>
            <div className="mt-4 space-y-3">
              {detail.follow_ups.map((followUp) => (
                <div key={followUp.id} className="rounded-[12px] border border-[#EEE4D7] px-3 py-3">
                  <div className="font-medium text-[#1A1A1A]">Step {followUp.step_number} · {followUp.channel}</div>
                  <div className="mt-1 text-xs text-[#8B7D6B]">{followUp.status} · {formatDate(followUp.scheduled_at)}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {followUp.channel === "email" ? (
                      <Button className="h-9 rounded-[8px] bg-[#D4691A] text-white hover:bg-[#BA5A12]" onClick={() => onSendFollowUp(detail.lead.id, followUp.step_number)}>
                        Send
                      </Button>
                    ) : (
                      <Button
                        className="h-9 rounded-[8px] border border-[#D4691A] bg-white text-[#D4691A] hover:bg-[#FFF5ED]"
                        onClick={() => {
                          const notes = window.prompt("Phone outcome notes", followUp.outcome_notes || "") ?? ""
                          onLogPhoneFollowUp(detail.lead.id, followUp.step_number, notes)
                        }}
                        variant="outline"
                      >
                        Log outcome
                      </Button>
                    )}
                    <Button className="h-9 rounded-[8px] border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onSkipFollowUp(detail.lead.id, followUp.step_number)} variant="outline">
                      Skip
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </details>

          <details className="rounded-[16px] bg-white p-4 shadow-[0_12px_34px_rgba(26,26,26,0.08)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">
              Permit info
              <ChevronDown className="h-4 w-4" />
            </summary>
            <div className="mt-4 space-y-2 text-sm text-[#5F564C]">
              <div>Permit {detail.lead.permit_number}</div>
              <div>{detail.lead.work_description}</div>
              <div>Filed {formatDate(detail.lead.filing_date)}</div>
              {detail.related_permits.map((permit) => (
                <div key={permit.id} className="rounded-[12px] border border-[#EEE4D7] px-3 py-3">
                  <div className="font-medium text-[#1A1A1A]">{permit.permit_number}</div>
                  <div className="mt-1 text-sm text-[#5F564C]">{permit.work_description}</div>
                </div>
              ))}
            </div>
          </details>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#D9CCBE] bg-[#FFF8F0]/96 px-4 py-4 backdrop-blur md:left-auto md:w-[680px]">
          <div className="flex flex-col gap-3">
            <Button
              className={`h-12 rounded-[10px] ${canSend(detail) ? "bg-[#2D6A4F] text-white hover:bg-[#25573F]" : "bg-[#D4691A] text-white hover:bg-[#BA5A12]"}`}
              disabled={working}
              onClick={() => canSend(detail) ? onSend(detail.lead.id) : onEnrich(detail.lead.id)}
            >
              {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : primaryActionLabel}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button className="h-10 rounded-[8px] border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onArchive(detail.lead.id)} variant="outline">
                Archive
              </Button>
              <Button className="h-10 rounded-[8px] border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onSwitchFallback(detail.lead.id)} variant="outline">
                Switch route
              </Button>
              <Button className="h-10 rounded-[8px] border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onVouch(detail.lead.id)} variant="outline">
                Vouch
              </Button>
              <Button className="h-10 rounded-[8px] border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onBounced(detail.lead.id)} variant="outline">
                Bounced
              </Button>
              <Button className="h-10 rounded-[8px] border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onReplied(detail.lead.id)} variant="outline">
                Replied
              </Button>
              <Button className="h-10 rounded-[8px] border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onWon(detail.lead.id)} variant="outline">
                Won
              </Button>
              <Button className="h-10 rounded-[8px] border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onLost(detail.lead.id)} variant="outline">
                Lost
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
