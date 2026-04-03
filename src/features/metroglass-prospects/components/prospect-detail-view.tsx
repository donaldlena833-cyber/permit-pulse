import { useState } from "react"
import { ArrowLeft, ExternalLink, LoaderCircle, Mail, Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { formatDate, formatProspectCategory, formatProspectStatus, formatRelativeTime } from "@/features/metroglass-leads/lib/format"
import type { ProspectDetailResponse } from "@/features/metroglass-leads/types/api"

interface ProspectDetailViewProps {
  detail: ProspectDetailResponse | null
  open: boolean
  actionTargetId: string | null
  onClose: () => void
  onSaveDraft: (prospectId: string, draft: { subject: string; body: string }) => void
  onSaveNotes: (prospectId: string, notes: string) => void
  onSend: (prospectId: string) => void
  onArchive: (prospectId: string) => void
  onMarkReplied: (prospectId: string) => void
}

export function ProspectDetailView({
  detail,
  open,
  actionTargetId,
  onClose,
  onSaveDraft,
  onSaveNotes,
  onSend,
  onArchive,
  onMarkReplied,
}: ProspectDetailViewProps) {
  const [subject, setSubject] = useState(() => detail?.draft.subject || "")
  const [body, setBody] = useState(() => detail?.draft.body || "")
  const [notes, setNotes] = useState(() => detail?.prospect.notes || "")

  if (!open || !detail) {
    return null
  }

  const working = actionTargetId === detail.prospect.id

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(16,15,12,0.58)] backdrop-blur-sm">
      <div className="absolute inset-x-0 bottom-0 top-0 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(214,122,43,0.12),transparent_26%),linear-gradient(180deg,#f7efe5,#ede3d6_36%,#efe6db)] md:left-auto md:w-[720px] md:border-l md:border-[#D6C6B5]">
        <div className="sticky top-0 z-20 border-b border-[#DCCDBE] bg-[rgba(247,239,229,0.9)] px-4 py-4 backdrop-blur-xl">
          <button className="inline-flex items-center gap-2 text-sm font-medium text-[#54483C]" onClick={onClose} type="button">
            <ArrowLeft className="h-4 w-4" />
            Back to prospects
          </button>
        </div>

        <div className="space-y-5 px-4 py-5 pb-32">
          <section className="rounded-[26px] border border-[#E4D6C7] bg-[linear-gradient(145deg,#fff9f1,#ffffff_50%,#f5ecdf)] p-5 shadow-[0_22px_46px_rgba(26,26,26,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#8B7D6B]">{formatProspectCategory(detail.prospect.category)}</div>
                <h2 className="mt-2 font-['Instrument_Serif'] text-4xl text-[#1A1A1A]">
                  {detail.prospect.contact_name || detail.prospect.company_name || detail.prospect.email_address}
                </h2>
                <div className="mt-2 text-sm text-[#5F564C]">
                  {[detail.prospect.contact_role, detail.prospect.company_name].filter(Boolean).join(" · ") || detail.prospect.email_address}
                </div>
              </div>
              <div className="rounded-full border border-[#E4D5C5] bg-white/85 px-3 py-1 text-xs font-medium text-[#6B5A48]">
                {formatProspectStatus(detail.prospect.status)}
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[18px] border border-[#E9DCCF] bg-white/80 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Recipient</div>
                <div className="mt-2 break-all font-medium text-[#1A1A1A]">{detail.prospect.email_address}</div>
              </div>
              <div className="rounded-[18px] border border-[#E9DCCF] bg-white/80 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Website</div>
                <div className="mt-2 font-medium text-[#1A1A1A]">{detail.prospect.website || "No website saved"}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#8B7D6B]">
              {detail.prospect.phone ? <div className="rounded-full border border-[#E4D5C5] bg-white/85 px-3 py-1">{detail.prospect.phone}</div> : null}
              {detail.prospect.city || detail.prospect.state ? (
                <div className="rounded-full border border-[#E4D5C5] bg-white/85 px-3 py-1">
                  {[detail.prospect.city, detail.prospect.state].filter(Boolean).join(", ")}
                </div>
              ) : null}
              <div className="rounded-full border border-[#E4D5C5] bg-white/85 px-3 py-1">
                Added {formatDate(detail.prospect.created_at)}
              </div>
              {detail.prospect.last_sent_at ? (
                <div className="rounded-full border border-[#E4D5C5] bg-white/85 px-3 py-1">
                  Last sent {formatRelativeTime(detail.prospect.last_sent_at)}
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                className="h-11 rounded-full bg-[#1A1A1A] px-5 text-white hover:bg-[#111111]"
                disabled={working}
                onClick={() => onSend(detail.prospect.id)}
                type="button"
              >
                {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send email
              </Button>
              <Button
                className="h-11 rounded-full border border-[#D6C6B6] bg-white px-5 text-[#5F564C] hover:bg-[#F7F0E8]"
                disabled={working}
                onClick={() => onMarkReplied(detail.prospect.id)}
                type="button"
                variant="outline"
              >
                Mark replied
              </Button>
              <Button
                className="h-11 rounded-full border border-[#D6C6B6] bg-white px-5 text-[#5F564C] hover:bg-[#F7F0E8]"
                disabled={working}
                onClick={() => onArchive(detail.prospect.id)}
                type="button"
                variant="outline"
              >
                Archive
              </Button>
              {detail.prospect.website ? (
                <a
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-[#D6C6B6] bg-white px-5 text-sm font-medium text-[#5F564C] hover:bg-[#F7F0E8]"
                  href={detail.prospect.website}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open website
                </a>
              ) : null}
            </div>
          </section>

          <section className="rounded-[24px] border border-[#E4D6C7] bg-white/92 p-5 shadow-[0_20px_42px_rgba(26,26,26,0.07)]">
            <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Draft</div>
            <div className="mt-4 space-y-3">
              <Input
                className="h-12 rounded-[16px] border-[#D9CCBE] bg-[#FFFCF8]"
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Subject line"
                value={subject}
              />
              <Textarea
                className="min-h-[280px] rounded-[18px] border-[#D9CCBE] bg-[#FFFCF8]"
                onChange={(event) => setBody(event.target.value)}
                placeholder="Draft body"
                value={body}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                className="h-10 rounded-full bg-[#D4691A] px-4 text-white hover:bg-[#BA5A12]"
                disabled={working}
                onClick={() => onSaveDraft(detail.prospect.id, { subject, body })}
                type="button"
              >
                <Save className="h-4 w-4" />
                Save draft
              </Button>
            </div>
          </section>

          <section className="rounded-[24px] border border-[#E4D6C7] bg-white/92 p-5 shadow-[0_20px_42px_rgba(26,26,26,0.07)]">
            <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Notes</div>
            <Textarea
              className="mt-4 min-h-[140px] rounded-[18px] border-[#D9CCBE] bg-[#FFFCF8]"
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Keep research notes, context, or follow-up reminders here."
              value={notes}
            />
            <div className="mt-4">
              <Button
                className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]"
                disabled={working}
                onClick={() => onSaveNotes(detail.prospect.id, notes)}
                type="button"
                variant="outline"
              >
                Save notes
              </Button>
            </div>
          </section>

          <section className="rounded-[24px] border border-[#E4D6C7] bg-white/92 p-5 shadow-[0_20px_42px_rgba(26,26,26,0.07)]">
            <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Activity</div>
            <div className="mt-4 space-y-3">
              {(detail.timeline ?? []).map((event) => (
                <div className="rounded-[18px] border border-[#EEE4D7] bg-[#FFFCF8] px-4 py-4" key={event.id}>
                  <div className="font-medium text-[#1A1A1A]">{event.event_type.replace(/_/g, " ")}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[#8B7D6B]">{event.actor_type}</div>
                  <div className="mt-2 text-sm text-[#5F564C]">{formatRelativeTime(event.created_at)}</div>
                </div>
              ))}
              {!(detail.timeline ?? []).length ? (
                <div className="rounded-[18px] border border-dashed border-[#DCCEBF] px-4 py-6 text-sm text-[#6B5A48]">
                  No activity yet on this prospect.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
