import { useMemo, useState } from "react"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  LoaderCircle,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { formatDate, formatLeadStatus, formatRelativeTime, formatScore } from "@/features/metroglass-leads/lib/format"
import type { EmailCandidate, LeadDetailResponse } from "@/features/metroglass-leads/types/api"

interface LeadDetailViewProps {
  detail: LeadDetailResponse | null
  open: boolean
  actionLeadId: string | null
  onClose: () => void
  onEnrich: (leadId: string) => void
  onSend: (leadId: string) => void
  onArchive: (leadId: string) => void
  onEmailRequired: (leadId: string) => void
  onVouch: (leadId: string) => void
  onBounced: (leadId: string) => void
  onReplied: (leadId: string) => void
  onWon: (leadId: string) => void
  onLost: (leadId: string) => void
  onSwitchFallback: (leadId: string) => void
  onChooseEmail: (leadId: string, candidateId: string) => void
  onAddManualEmail: (leadId: string, payload: { email: string; note?: string }) => void
  onRefreshDraft: (leadId: string) => void
  onSaveDraft: (leadId: string, draft: { subject: string; body: string }) => void
  onSendFollowUp: (leadId: string, step: number) => void
  onSkipFollowUp: (leadId: string, step: number) => void
  onLogPhoneFollowUp: (leadId: string, step: number, notes: string) => void
}

function canSend(detail: LeadDetailResponse | null) {
  return Boolean(detail?.contacts.approved_primary)
}

function normalizeSmsPhone(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits
  }
  if (digits.length === 10) {
    return `1${digits}`
  }
  return digits
}

function buildTextDraft(detail: LeadDetailResponse) {
  const address = detail.lead.address || "your project"

  return `Hi, this is Donald from MetroGlass Pro. I came across the filing for ${address} and wanted to reach out. Not sure if you're the right contact for the project, but we handle storefronts, shower doors, mirrors, railings, and custom glass across NYC. If any of that scope is still open, I'd be happy to help.`
}

function buildSmsHref(phone: string | null | undefined, draft: string) {
  const digits = normalizeSmsPhone(phone)
  if (!digits) {
    return "#"
  }
  return `sms:${digits}?&body=${encodeURIComponent(draft)}`
}

function candidateSurfaceTone(candidate: EmailCandidate, primaryId?: string | null, approvedId?: string | null) {
  if (candidate.id === approvedId) {
    return "border-[#B6D5C7] bg-[linear-gradient(180deg,#F5FCF8,#EDF7F1)]"
  }
  if (candidate.id === primaryId) {
    return "border-[#D8C8B3] bg-[linear-gradient(180deg,#FFF9F2,#FBF4EA)]"
  }
  return "border-[#E7DACB] bg-white"
}

function surfaceLabel(candidate: EmailCandidate) {
  if (candidate.provenance_page_type && candidate.provenance_page_type !== "other") {
    return candidate.provenance_page_type
  }
  if (candidate.provenance_source === "manual") {
    return "operator"
  }
  return candidate.provenance_source || "source"
}

function ContactCard({
  candidate,
  isCurrentRoute,
  isApprovedRoute,
  isWorking,
  onChoose,
}: {
  candidate: EmailCandidate
  isCurrentRoute: boolean
  isApprovedRoute: boolean
  isWorking: boolean
  onChoose?: () => void
}) {
  return (
    <div className={`rounded-[20px] border p-4 shadow-[0_16px_34px_rgba(26,26,26,0.06)] ${candidateSurfaceTone(candidate, isCurrentRoute ? candidate.id : null, isApprovedRoute ? candidate.id : null)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">
            <span className="inline-flex items-center gap-1 rounded-full border border-[#E4D4C2] bg-white/80 px-2.5 py-1">
              <Mail className="h-3.5 w-3.5" />
              {surfaceLabel(candidate)}
            </span>
            <span className="rounded-full border border-[#E4D4C2] bg-white/80 px-2.5 py-1">
              {candidate.provenance_extraction_method || "text_scrape"}
            </span>
            {isApprovedRoute ? (
              <span className="rounded-full border border-[#B6D5C7] bg-[#EEF9F2] px-2.5 py-1 text-[#2D6A4F]">
                Send approved
              </span>
            ) : null}
            {isCurrentRoute && !isApprovedRoute ? (
              <span className="rounded-full border border-[#E2C7A7] bg-[#FFF2E3] px-2.5 py-1 text-[#9A5A12]">
                Selected for review
              </span>
            ) : null}
          </div>

          <div className="mt-3 break-all text-lg font-semibold tracking-[-0.03em] text-[#151515]">
            {candidate.email_address}
          </div>

          {candidate.selection_reason ? (
            <div className="mt-2 text-sm text-[#5F564C]">{candidate.selection_reason}</div>
          ) : null}
        </div>

        <div className="shrink-0 rounded-full border border-[#E4D4C2] bg-white/80 px-3 py-1.5 text-sm font-semibold text-[#3F372F]">
          Trust {Math.round(candidate.trust_score)}
        </div>
      </div>

      {candidate.provenance_url ? (
        <a
          className="mt-3 inline-flex max-w-full items-center gap-2 break-all text-sm text-[#7B5E3D] hover:text-[#9A5A12]"
          href={candidate.provenance_url}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          {candidate.provenance_url}
        </a>
      ) : null}

      {candidate.provenance_raw_context ? (
        <div className="mt-3 rounded-[16px] bg-[#F8F2EA] px-3 py-3 text-sm leading-6 text-[#5F564C]">
          {candidate.provenance_raw_context}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {onChoose && !isCurrentRoute ? (
          <Button
            className="h-10 rounded-full bg-[#1A1A1A] px-4 text-white hover:bg-[#111111]"
            disabled={isWorking}
            onClick={onChoose}
            type="button"
          >
            {isWorking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Use this email
          </Button>
        ) : null}
        {isCurrentRoute ? (
          <div className="inline-flex h-10 items-center gap-2 rounded-full border border-[#D9CCBE] bg-white/90 px-4 text-sm font-medium text-[#4D443A]">
            <Check className="h-4 w-4" />
            Current route
          </div>
        ) : null}
      </div>
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
  onEmailRequired,
  onVouch,
  onBounced,
  onReplied,
  onWon,
  onLost,
  onSwitchFallback,
  onChooseEmail,
  onAddManualEmail,
  onRefreshDraft,
  onSaveDraft,
  onSendFollowUp,
  onSkipFollowUp,
  onLogPhoneFollowUp,
}: LeadDetailViewProps) {
  const [draft, setDraft] = useState(() => ({
    subject: detail?.draft.subject || "",
    body: detail?.draft.body || "",
  }))
  const [draftDirty, setDraftDirty] = useState(false)
  const [manualEmail, setManualEmail] = useState("")
  const [manualNote, setManualNote] = useState("")
  const [textDraft, setTextDraft] = useState(() => (detail ? buildTextDraft(detail) : ""))

  const discoveredEmails = useMemo(() => detail?.contacts.discovered_emails ?? [], [detail])
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
  const smsHref = buildSmsHref(detail.contacts.phone, textDraft)
  const selectedRoute = detail.lead.active_email_role === "fallback"
    ? approvedFallback || fallback || approvedPrimary || primary
    : approvedPrimary || primary || approvedFallback || fallback
  const operatorNeedsDecision = !approvedPrimary && discoveredEmails.length > 0
  const isEmailRequired = detail.lead.status === "email_required"
  const canParkForEmail = !approvedPrimary && detail.lead.status !== "sent" && detail.lead.status !== "archived"
  const primaryActionLabel = detail.lead.status === "sent"
    ? "Sent"
    : canSend(detail)
      ? "Send email"
      : discoveredEmails.length > 0 || detail.contacts.phone
        ? "Refresh discovery"
        : "Enrich now"

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(16,15,12,0.58)] backdrop-blur-sm">
      <div className="absolute inset-x-0 bottom-0 top-0 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(214,122,43,0.14),transparent_26%),linear-gradient(180deg,#f7efe5,#ede3d6_36%,#efe6db)] md:left-auto md:w-[760px] md:border-l md:border-[#D6C6B5]">
        <div className="sticky top-0 z-20 border-b border-[#DCCDBE] bg-[rgba(247,239,229,0.88)] px-4 py-4 backdrop-blur-xl">
          <button className="inline-flex items-center gap-2 text-sm font-medium text-[#54483C]" onClick={onClose} type="button">
            <ArrowLeft className="h-4 w-4" />
            Back to queue
          </button>
        </div>

        <div className="space-y-5 px-4 pb-44 pt-4">
          <section className="overflow-hidden rounded-[28px] border border-[#E5D7C9] bg-[linear-gradient(155deg,#fff9f2,#fff_46%,#f5e8d8)] p-5 shadow-[0_24px_60px_rgba(26,26,26,0.1)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="inline-flex rounded-full border border-[#E7D7C2] bg-white/70 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[#9A5A12]">
                  Lead workspace
                </div>
                <h2 className="mt-4 font-['Instrument_Serif'] text-4xl leading-none text-[#1A1A1A] sm:text-[3.25rem]">
                  {detail.lead.company_name || "Unnamed lead"}
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-[#5F564C]">{detail.lead.address}</p>
              </div>

              <div className="rounded-[20px] border border-[#E7D7C2] bg-white/80 px-4 py-3 text-sm text-[#4F463D]">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#8B7D6B]">Current status</div>
                <div className="mt-1 text-lg font-semibold text-[#151515]">{formatLeadStatus(detail.lead.status)}</div>
                <div className="mt-1">Updated {formatRelativeTime(detail.lead.updated_at)}</div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[18px] border border-[#E7D7C2] bg-white/85 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Relevance</div>
                <div className="mt-2 text-lg font-semibold text-[#161616]">
                  {formatScore(detail.lead.relevance_score)}
                  {detail.lead.relevance_keyword ? ` (${detail.lead.relevance_keyword})` : ""}
                </div>
              </div>

              <div className="rounded-[18px] border border-[#E7D7C2] bg-white/85 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Selected email</div>
                <div className="mt-2 break-all text-sm font-semibold text-[#161616]">
                  {detail.lead.contact_email || "No route chosen"}
                </div>
              </div>

              <div className="rounded-[18px] border border-[#E7D7C2] bg-white/85 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Phone</div>
                <div className="mt-2 text-sm font-semibold text-[#161616]">
                  {detail.contacts.phone || "No phone found"}
                </div>
              </div>

              <div className="rounded-[18px] border border-[#E7D7C2] bg-white/85 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Decision state</div>
                <div className="mt-2 text-sm font-semibold text-[#161616]">
                  {approvedPrimary ? "System approved route" : isEmailRequired ? "Waiting on manual email research" : selectedRoute ? "Operator review needed" : "No route yet"}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-[#E4D6C7] bg-white/95 p-5 shadow-[0_16px_36px_rgba(26,26,26,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#E7D7C2] bg-[#FFF7ED] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[#9A5A12]">
                  <Sparkles className="h-3.5 w-3.5" />
                  Decision control
                </div>
                <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-[#161616]">
                  {operatorNeedsDecision ? "System found emails, but you make the call" : "Current send route"}
                </h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[#5F564C]">
                  Pick one of the discovered emails, add your own, or keep the current route. Once you choose, the lead becomes send-ready with your selection.
                </p>
              </div>

              <div className="min-w-[220px] rounded-[20px] border border-[#E6D8C9] bg-[#FBF5EC] p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Chosen route</div>
                <div className="mt-2 break-all text-base font-semibold text-[#151515]">
                  {selectedRoute?.email_address || "Nothing selected yet"}
                </div>
                <div className="mt-2 text-sm text-[#5F564C]">
                  {approvedPrimary
                    ? "Ready to send from the app."
                    : isEmailRequired
                      ? "Parked until you verify the right address yourself."
                    : selectedRoute
                      ? "Stored as the active review route."
                      : "Choose a found email or enter one yourself."}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_0.9fr]">
              <div className="space-y-3">
                {discoveredEmails.length > 0 ? discoveredEmails.map((candidate) => (
                  <ContactCard
                    candidate={candidate}
                    isApprovedRoute={candidate.id === approvedPrimary?.id || candidate.id === approvedFallback?.id}
                    isCurrentRoute={candidate.id === primary?.id || candidate.id === fallback?.id}
                    isWorking={working}
                    key={candidate.id}
                    onChoose={() => onChooseEmail(detail.lead.id, candidate.id)}
                  />
                )) : (
                  <div className="rounded-[20px] border border-dashed border-[#D8C9B7] bg-[#FBF6EF] px-4 py-6 text-sm text-[#5F564C]">
                    No published site emails found yet. You can still add a verified email manually below.
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-[22px] border border-[#E4D5C6] bg-[linear-gradient(180deg,#fffaf4,#f8efe4)] p-4">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">
                    <Plus className="h-4 w-4" />
                    Add your own
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[#5F564C]">
                    If you verified an email outside the app, store it here and use it as the active route.
                  </div>
                  <div className="mt-4 space-y-3">
                    <Input
                      className="h-12 rounded-[16px] border-[#DCCDBE] bg-white/90 px-4"
                      onChange={(event) => setManualEmail(event.target.value)}
                      placeholder="name@company.com"
                      type="email"
                      value={manualEmail}
                    />
                    <Textarea
                      className="min-h-[96px] rounded-[16px] border-[#DCCDBE] bg-white/90"
                      onChange={(event) => setManualNote(event.target.value)}
                      placeholder="Optional note about where you verified it."
                      value={manualNote}
                    />
                    <Button
                      className="h-11 w-full rounded-full bg-[#1A1A1A] text-white hover:bg-[#111111]"
                      disabled={working || manualEmail.trim().length === 0}
                      onClick={() => onAddManualEmail(detail.lead.id, { email: manualEmail.trim(), note: manualNote.trim() })}
                      type="button"
                    >
                      {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Use custom email
                    </Button>
                  </div>
                </div>

                <div className="rounded-[22px] border border-[#E4D5C6] bg-[#FCF7F1] p-4">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">
                    <Mail className="h-4 w-4" />
                    Why it is blocked
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[#5F564C]">
                    The system keeps low-trust emails in review until it has enough proof. This panel lets you override that when you already know the contact is real.
                  </div>
                  {selectedRoute?.trust_reasons?.length ? (
                    <div className="mt-4 rounded-[16px] border border-[#E8D8C7] bg-white/80 p-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8B7D6B]">Current reasoning</div>
                      <div className="mt-2 space-y-1 text-sm text-[#5F564C]">
                        {selectedRoute.trust_reasons.slice(0, 5).map((reason) => (
                          <div key={reason}>{reason}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[22px] border border-[#E4D5C6] bg-[linear-gradient(180deg,#fffaf4,#f4ebe0)] p-4">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">
                    <MessageSquare className="h-4 w-4" />
                    Manual hold
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[#5F564C]">
                    Move this lead into a dedicated Email Required list when enrichment did not produce a usable address and you want to research it later yourself.
                  </div>
                  <Button
                    className="mt-4 h-11 w-full rounded-full border border-[#D6C6B6] bg-white px-5 text-[#5F564C] hover:bg-[#F7F0E8]"
                    disabled={working || !canParkForEmail || isEmailRequired}
                    onClick={() => onEmailRequired(detail.lead.id)}
                    type="button"
                    variant="outline"
                  >
                    {isEmailRequired ? "Already in Email Required" : "Move to Email Required"}
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-[24px] border border-[#E4D6C7] bg-white/95 p-5 shadow-[0_16px_36px_rgba(26,26,26,0.08)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#E7D7C2] bg-[#FFF7ED] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[#9A5A12]">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Text lane
                  </div>
                  <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-[#161616]">Manual texting from your phone</h3>
                  <p className="mt-2 text-sm leading-6 text-[#5F564C]">
                    Keep a short SMS draft ready, then tap through to your phone's Messages app.
                  </p>
                </div>
                {detail.contacts.phone ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#E5D7C8] bg-[#FAF4ED] px-3 py-2 text-sm text-[#5F564C]">
                    <Phone className="h-4 w-4" />
                    {detail.contacts.phone}
                  </div>
                ) : null}
              </div>

              {detail.contacts.phone ? (
                <>
                  <Textarea
                    className="mt-4 min-h-[180px] rounded-[18px] border-[#DCCDBE] bg-[#FFFCF8] text-sm leading-6"
                    onChange={(event) => setTextDraft(event.target.value)}
                    value={textDraft}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button asChild className="h-11 rounded-full bg-[#2D6A4F] px-5 text-white hover:bg-[#25573F]">
                      <a href={smsHref}>
                        <MessageSquare className="h-4 w-4" />
                        Text now
                      </a>
                    </Button>
                    <Button
                      className="h-11 rounded-full border border-[#D6C6B6] bg-white px-5 text-[#5F564C] hover:bg-[#F7F0E8]"
                      onClick={() => {
                        void navigator.clipboard.writeText(textDraft)
                        toast.success("Text copied")
                      }}
                      type="button"
                      variant="outline"
                    >
                      <Copy className="h-4 w-4" />
                      Copy
                    </Button>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-[18px] border border-dashed border-[#D8C9B7] bg-[#FBF6EF] px-4 py-6 text-sm text-[#5F564C]">
                  No phone number is stored for this lead yet.
                </div>
              )}
            </div>

            <div className="rounded-[24px] border border-[#E4D6C7] bg-white/95 p-5 shadow-[0_16px_36px_rgba(26,26,26,0.08)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#E7D7C2] bg-[#FFF7ED] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[#9A5A12]">
                    <Sparkles className="h-3.5 w-3.5" />
                    Send route
                  </div>
                  <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-[#161616]">What happens if you hit send</h3>
                  <p className="mt-2 text-sm leading-6 text-[#5F564C]">
                    The app uses the active route shown here. If the wrong email is selected, change it above before sending.
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {approvedPrimary ? (
                  <ContactCard
                    candidate={approvedPrimary}
                    isApprovedRoute
                    isCurrentRoute
                    isWorking={working}
                  />
                ) : selectedRoute ? (
                  <ContactCard
                    candidate={selectedRoute}
                    isApprovedRoute={false}
                    isCurrentRoute
                    isWorking={working}
                  />
                ) : (
                  <div className="rounded-[18px] border border-dashed border-[#D8C9B7] bg-[#FBF6EF] px-4 py-6 text-sm text-[#5F564C]">
                    No email route is chosen yet.
                  </div>
                )}

                {approvedFallback && approvedFallback.id !== approvedPrimary?.id ? (
                  <ContactCard
                    candidate={approvedFallback}
                    isApprovedRoute
                    isCurrentRoute={approvedFallback.id === fallback?.id}
                    isWorking={working}
                  />
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-[#E4D6C7] bg-white/95 p-5 shadow-[0_16px_36px_rgba(26,26,26,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#E7D7C2] bg-[#FFF7ED] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[#9A5A12]">
                  <Mail className="h-3.5 w-3.5" />
                  Compose
                </div>
                <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-[#161616]">Email draft</h3>
                <p className="mt-2 text-sm leading-6 text-[#5F564C]">
                  Edit the email yourself whenever the generated draft misses the mark.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="h-10 rounded-full border border-[#D4691A] bg-white px-4 text-[#D4691A] hover:bg-[#FFF5ED]"
                  onClick={() => onRefreshDraft(detail.lead.id)}
                  type="button"
                  variant="outline"
                >
                  Refresh
                </Button>
                <Button
                  className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]"
                  onClick={() => {
                    setDraftDirty(true)
                    setDraft({ subject: "", body: "" })
                  }}
                  type="button"
                  variant="outline"
                >
                  Start fresh
                </Button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <label className="grid gap-2 text-sm text-[#5F564C]">
                Subject
                <Textarea
                  className="min-h-[120px] rounded-[18px] border-[#DCCDBE] bg-[#FFFCF8]"
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
                  className="min-h-[260px] rounded-[18px] border-[#DCCDBE] bg-[#FFFCF8]"
                  onChange={(event) => {
                    setDraftDirty(true)
                    setDraft({ ...visibleDraft, body: event.target.value })
                  }}
                  value={visibleDraft.body}
                />
              </label>
            </div>

            <Button
              className="mt-4 h-11 rounded-full bg-[#1A1A1A] px-5 text-white hover:bg-[#111111]"
              onClick={() => onSaveDraft(detail.lead.id, visibleDraft)}
              type="button"
            >
              Save draft
            </Button>
          </section>

          <details className="rounded-[22px] border border-[#E4D6C7] bg-white/95 p-4 shadow-[0_12px_32px_rgba(26,26,26,0.07)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">
              Provenance and routing
              <ChevronDown className="h-4 w-4" />
            </summary>

            <div className="mt-4 grid gap-5 xl:grid-cols-2">
              <div>
                <div className="text-sm font-semibold text-[#151515]">Trust breakdown</div>
                <div className="mt-3 space-y-3">
                  {[primary, fallback].filter(Boolean).map((candidate) => (
                    <div className="rounded-[16px] border border-[#E7DACA] bg-[#FFFDFC] p-4" key={candidate!.id}>
                      <div className="font-medium text-[#151515]">{candidate!.email_address}</div>
                      <div className="mt-2 space-y-1 text-sm text-[#5F564C]">
                        {(candidate!.trust_reasons || []).map((reason) => (
                          <div key={reason}>{reason}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold text-[#151515]">Company candidates</div>
                <div className="mt-3 space-y-3">
                  {detail.candidates.companies.map((company) => (
                    <div key={company.id} className="rounded-[16px] border border-[#E7DACA] bg-[#FFFDFC] p-4">
                      <div className="font-medium text-[#151515]">{company.company_name}</div>
                      <div className="mt-1 text-xs text-[#8B7D6B]">
                        {company.source || "Unknown source"} · Confidence {Math.round(company.confidence)}
                      </div>
                      <div className="mt-1 text-xs text-[#8B7D6B]">
                        {company.is_chosen ? "Chosen" : company.rejected_reason || "Rejected"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>

          <details className="rounded-[22px] border border-[#E4D6C7] bg-white/95 p-4 shadow-[0_12px_32px_rgba(26,26,26,0.07)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">
              Timeline
              <ChevronDown className="h-4 w-4" />
            </summary>
            <div className="mt-4 space-y-3">
              {detail.timeline.map((event) => (
                <div key={event.id} className="rounded-[14px] border border-[#EEE4D7] px-3 py-3">
                  <div className="font-medium capitalize text-[#1A1A1A]">{event.event_type.replace(/_/g, " ")}</div>
                  <div className="mt-1 text-xs text-[#8B7D6B]">{formatRelativeTime(event.created_at)}</div>
                </div>
              ))}
            </div>
          </details>

          <details className="rounded-[22px] border border-[#E4D6C7] bg-white/95 p-4 shadow-[0_12px_32px_rgba(26,26,26,0.07)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">
              Follow ups
              <ChevronDown className="h-4 w-4" />
            </summary>
            <div className="mt-4 space-y-3">
              {detail.follow_ups.map((followUp) => (
                <div key={followUp.id} className="rounded-[16px] border border-[#EEE4D7] px-4 py-4">
                  <div className="font-medium text-[#1A1A1A]">Step {followUp.step_number} · {followUp.channel}</div>
                  <div className="mt-1 text-xs text-[#8B7D6B]">{followUp.status} · {formatDate(followUp.scheduled_at)}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {followUp.channel === "email" ? (
                      <Button className="h-10 rounded-full bg-[#D4691A] px-4 text-white hover:bg-[#BA5A12]" onClick={() => onSendFollowUp(detail.lead.id, followUp.step_number)}>
                        Send
                      </Button>
                    ) : (
                      <Button
                        className="h-10 rounded-full border border-[#D4691A] bg-white px-4 text-[#D4691A] hover:bg-[#FFF5ED]"
                        onClick={() => {
                          const notes = window.prompt("Phone outcome notes", followUp.outcome_notes || "") ?? ""
                          onLogPhoneFollowUp(detail.lead.id, followUp.step_number, notes)
                        }}
                        variant="outline"
                      >
                        Log outcome
                      </Button>
                    )}
                    <Button className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onSkipFollowUp(detail.lead.id, followUp.step_number)} variant="outline">
                      Skip
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </details>

          <details className="rounded-[22px] border border-[#E4D6C7] bg-white/95 p-4 shadow-[0_12px_32px_rgba(26,26,26,0.07)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">
              Permit info
              <ChevronDown className="h-4 w-4" />
            </summary>
            <div className="mt-4 space-y-2 text-sm text-[#5F564C]">
              <div>Permit {detail.lead.permit_number}</div>
              <div>{detail.lead.work_description}</div>
              <div>Filed {formatDate(detail.lead.filing_date)}</div>
              {detail.related_permits.map((permit) => (
                <div key={permit.id} className="rounded-[14px] border border-[#EEE4D7] px-3 py-3">
                  <div className="font-medium text-[#1A1A1A]">{permit.permit_number}</div>
                  <div className="mt-1 text-sm text-[#5F564C]">{permit.work_description}</div>
                </div>
              ))}
            </div>
          </details>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#DCCDBE] bg-[rgba(255,248,240,0.96)] px-4 py-4 backdrop-blur-xl md:left-auto md:w-[760px]">
          <div className="flex flex-col gap-3">
            <Button
              className={`h-12 rounded-full ${canSend(detail) ? "bg-[#2D6A4F] text-white hover:bg-[#25573F]" : "bg-[#D4691A] text-white hover:bg-[#BA5A12]"}`}
              disabled={working}
              onClick={() => canSend(detail) ? onSend(detail.lead.id) : onEnrich(detail.lead.id)}
            >
              {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : primaryActionLabel}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onArchive(detail.lead.id)} variant="outline">
                Archive
              </Button>
              {detail.lead.fallback_email ? (
                <Button className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onSwitchFallback(detail.lead.id)} variant="outline">
                  Switch route
                </Button>
              ) : null}
              {detail.lead.contact_email ? (
                <Button className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onVouch(detail.lead.id)} variant="outline">
                  Vouch
                </Button>
              ) : null}
              {detail.lead.status === "sent" ? (
                <>
                  <Button className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onBounced(detail.lead.id)} variant="outline">
                    Bounced
                  </Button>
                  <Button className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onReplied(detail.lead.id)} variant="outline">
                    Replied
                  </Button>
                </>
              ) : null}
              <Button className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onWon(detail.lead.id)} variant="outline">
                Won
              </Button>
              <Button className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => onLost(detail.lead.id)} variant="outline">
                Lost
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
