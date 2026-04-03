import { useState } from "react"
import { AlertTriangle, ArrowLeft, ExternalLink, LoaderCircle, Mail, Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  formatDate,
  formatProspectCategory,
  formatProspectQueueState,
  formatProspectStatus,
  formatRelativeTime,
} from "@/features/metroglass-leads/lib/format"
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
  onOptOut: (prospectId: string) => void
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
  onOptOut,
}: ProspectDetailViewProps) {
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [notes, setNotes] = useState("")

  if (!open || !detail) {
    return null
  }

  const working = actionTargetId === detail.prospect.id

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.48)] backdrop-blur-sm">
      <div className="absolute inset-x-0 bottom-0 top-0 overflow-y-auto bg-[rgba(248,250,252,0.96)] md:left-auto md:w-[760px] md:border-l md:border-steel-200">
        <div className="sticky top-0 z-20 border-b border-steel-200 bg-[rgba(248,250,252,0.92)] px-4 py-4 backdrop-blur-xl">
          <button className="inline-flex items-center gap-2 text-sm font-semibold text-steel-700" onClick={onClose} type="button">
            <ArrowLeft className="h-4 w-4" />
            Back to prospects
          </button>
        </div>

        <div className="space-y-5 px-4 py-5 pb-32">
          <section className="rounded-[24px] border border-steel-200 bg-white p-5 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-brand-700">
                  {formatProspectCategory(detail.prospect.category)}
                </div>
                <h2 className="mt-4 text-4xl font-extrabold tracking-[-0.05em] text-steel-900">
                  {detail.prospect.contact_name || detail.prospect.company_name || detail.prospect.email_address}
                </h2>
                <div className="mt-2 text-sm text-steel-600">
                  {[detail.prospect.contact_role, detail.prospect.company_name].filter(Boolean).join(" · ") || detail.prospect.email_address}
                </div>
              </div>
              <div className="rounded-[18px] border border-steel-200 bg-steel-50/80 px-4 py-3">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel-500">Queue state</div>
                <div className="mt-2 text-lg font-bold tracking-[-0.03em] text-steel-900">
                  {formatProspectQueueState(detail.prospect.queue_state || detail.prospect.status)}
                </div>
                <div className="mt-1 text-sm text-steel-600">{formatProspectStatus(detail.prospect.status)}</div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[18px] border border-steel-200 bg-steel-50/60 px-4 py-4">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel-500">Recipient</div>
                <div className="mt-2 break-all font-medium text-steel-900">{detail.prospect.email_address}</div>
              </div>
              <div className="rounded-[18px] border border-steel-200 bg-steel-50/60 px-4 py-4">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel-500">Website</div>
                <div className="mt-2 font-medium text-steel-900">{detail.prospect.website || "No website saved"}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-steel-600">
              {detail.prospect.phone ? <div className="rounded-full border border-steel-200 bg-white px-3 py-1">{detail.prospect.phone}</div> : null}
              {detail.prospect.city || detail.prospect.state ? (
                <div className="rounded-full border border-steel-200 bg-white px-3 py-1">
                  {[detail.prospect.city, detail.prospect.state].filter(Boolean).join(", ")}
                </div>
              ) : null}
              <div className="rounded-full border border-steel-200 bg-white px-3 py-1">
                Added {formatDate(detail.prospect.created_at)}
              </div>
              {detail.prospect.first_sent_at ? (
                <div className="rounded-full border border-steel-200 bg-white px-3 py-1">
                  First sent {formatRelativeTime(detail.prospect.first_sent_at)}
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                className="h-11 rounded-full px-5"
                disabled={working || detail.prospect.status === "opted_out"}
                onClick={() => onSend(detail.prospect.id)}
                type="button"
              >
                {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {detail.prospect.first_sent_at ? "Send follow-up now" : "Send initial now"}
              </Button>
              <Button
                className="h-11 rounded-full px-5"
                disabled={working}
                onClick={() => onMarkReplied(detail.prospect.id)}
                type="button"
                variant="outline"
              >
                Mark replied
              </Button>
              <Button
                className="h-11 rounded-full border-red-200 bg-red-50 px-5 text-red-700 hover:bg-red-100"
                disabled={working}
                onClick={() => onOptOut(detail.prospect.id)}
                type="button"
                variant="outline"
              >
                <AlertTriangle className="h-4 w-4" />
                Take me off list
              </Button>
              <Button
                className="h-11 rounded-full px-5"
                disabled={working}
                onClick={() => onArchive(detail.prospect.id)}
                type="button"
                variant="outline"
              >
                Archive
              </Button>
              {detail.prospect.website ? (
                <a
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-steel-200 bg-white px-5 text-sm font-semibold text-steel-700 hover:bg-steel-50"
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

          <section className="rounded-[22px] border border-steel-200 bg-white p-5 shadow-soft">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Draft</div>
            <div className="mt-4 space-y-3">
              <Input
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Subject line"
                value={subject}
              />
              <Textarea
                className="min-h-[280px]"
                onChange={(event) => setBody(event.target.value)}
                placeholder="Draft body"
                value={body}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                className="h-10 rounded-full px-4"
                disabled={working}
                onClick={() => onSaveDraft(detail.prospect.id, { subject, body })}
                type="button"
              >
                <Save className="h-4 w-4" />
                Save draft
              </Button>
            </div>
          </section>

          <section className="rounded-[22px] border border-steel-200 bg-white p-5 shadow-soft">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Notes</div>
            <Textarea
              className="mt-4 min-h-[140px]"
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Keep research notes, context, or follow-up reminders here."
              value={notes}
            />
            <div className="mt-4">
              <Button
                className="h-10 rounded-full px-4"
                disabled={working}
                onClick={() => onSaveNotes(detail.prospect.id, notes)}
                type="button"
                variant="outline"
              >
                Save notes
              </Button>
            </div>
          </section>

          <section className="rounded-[22px] border border-steel-200 bg-white p-5 shadow-soft">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Follow-up plan</div>
            <div className="mt-4 grid gap-3">
              {(detail.follow_ups ?? []).map((followUp) => (
                <div className="rounded-[16px] border border-steel-200 bg-steel-50/60 px-4 py-4" key={followUp.id}>
                  <div className="font-medium text-steel-900">Step {followUp.step_number}</div>
                  <div className="mt-1 text-sm text-steel-600">
                    {formatProspectQueueState(followUp.status === "sent" ? "follow_up_sent" : "queued_follow_up")} · scheduled {formatDate(followUp.scheduled_at)}
                  </div>
                  {followUp.sent_at ? (
                    <div className="mt-2 text-sm text-steel-600">Sent {formatRelativeTime(followUp.sent_at)}</div>
                  ) : null}
                </div>
              ))}
              {!(detail.follow_ups ?? []).length ? (
                <div className="rounded-[16px] border border-dashed border-steel-200 px-4 py-5 text-sm text-steel-500">
                  No automated follow-up is scheduled yet.
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[22px] border border-steel-200 bg-white p-5 shadow-soft">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Activity</div>
            <div className="mt-4 space-y-3">
              {(detail.timeline ?? []).map((event) => (
                <div className="rounded-[16px] border border-steel-200 bg-steel-50/60 px-4 py-4" key={event.id}>
                  <div className="font-medium text-steel-900">{event.event_type.replace(/_/g, " ")}</div>
                  <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-steel-500">{event.actor_type}</div>
                  <div className="mt-2 text-sm text-steel-600">{formatRelativeTime(event.created_at)}</div>
                </div>
              ))}
              {!(detail.timeline ?? []).length ? (
                <div className="rounded-[16px] border border-dashed border-steel-200 px-4 py-6 text-sm text-steel-500">
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
