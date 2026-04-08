import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  LoaderCircle,
  Mail,
  Save,
  ShieldBan,
  ThumbsUp,
  Undo2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  formatDate,
  formatProspectCategory,
  formatProspectQueueState,
  formatProspectStatus,
  formatRelativeTime,
} from "@/features/operator-console/lib/format"
import type { ProspectDetailResponse } from "@/features/operator-console/types/api"

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
  onMarkPositiveReply: (prospectId: string) => void
  onMarkBounced: (prospectId: string) => void
  onOptOut: (prospectId: string) => void
  onSuppress: (prospectId: string, scopeType: "email" | "domain" | "company", reason?: string) => void
  onRemoveSuppression: (suppressionId: string, prospectId: string) => void
  onResolveReview: (reviewId: string, prospectId: string, action: string) => void
}

function blockReasonLabel(value: string | null | undefined) {
  if (!value) return "Sendable"
  if (value === "opted_out") return "Suppressed by contact state"
  if (value === "company_opted_out") return "Company domain opted out"
  if (value === "company_replied") return "Company domain already replied"
  if (value === "company_bounced") return "Company domain previously bounced"
  if (value === "reply_review_pending" || value === "auto_reply_review") return "Waiting on inbound reply review"
  return value.replace(/_/g, " ")
}

function shortDescription(value: string | null | undefined) {
  const text = String(value || "").trim()
  if (!text) return "No description saved yet."
  return text
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
  onMarkPositiveReply,
  onMarkBounced,
  onOptOut,
  onSuppress,
  onRemoveSuppression,
  onResolveReview,
}: ProspectDetailViewProps) {
  const [subject, setSubject] = useState(detail?.draft.subject || "")
  const [body, setBody] = useState(detail?.draft.body || "")
  const [notes, setNotes] = useState(detail?.prospect.notes || "")

  const summary = useMemo(() => {
    if (!detail) return null
    return detail.prospect.contact_name || detail.prospect.company_name || detail.prospect.email_address
  }, [detail])

  if (!open || !detail) {
    return null
  }

  const working = actionTargetId === detail.prospect.id

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(9,14,24,0.42)] backdrop-blur-sm">
      <div className="absolute inset-0 overflow-y-auto bg-[#f4f7fb] md:left-auto md:w-[860px] md:border-l md:border-steel-200">
        <div className="sticky top-0 z-20 border-b border-steel-200 bg-[rgba(244,247,251,0.94)] px-4 py-4 backdrop-blur-xl">
          <button
            className="inline-flex items-center gap-2 text-sm font-semibold text-steel-700"
            onClick={onClose}
            type="button"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to outreach
          </button>
        </div>

        <div className="space-y-5 px-4 py-5 pb-32">
          <section className="rounded-[24px] border border-steel-200 bg-white px-5 py-5 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2">
                  <div className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-brand-700">
                    {formatProspectCategory(detail.prospect.category)}
                  </div>
                  <div className="rounded-full border border-steel-200 bg-steel-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-steel-600">
                    {formatProspectQueueState(detail.prospect.queue_state || detail.prospect.status)}
                  </div>
                </div>
                <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.045em] text-steel-950 sm:text-[2.35rem]">
                  {summary}
                </h2>
                <div className="mt-2 text-sm text-steel-600">
                  {[detail.prospect.contact_role, detail.prospect.company_name].filter(Boolean).join(" · ") || detail.prospect.email_address}
                </div>
              </div>

              <div className="rounded-[18px] border border-steel-200 bg-steel-50/70 px-4 py-3">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel-500">Automation status</div>
                <div className="mt-2 text-lg font-bold tracking-[-0.03em] text-steel-900">
                  {formatProspectStatus(detail.prospect.status)}
                </div>
                <div className="mt-1 text-sm text-steel-600">{blockReasonLabel(detail.prospect.automation_block_reason)}</div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                className="h-11 rounded-full px-5"
                disabled={working || detail.prospect.status === "opted_out"}
                onClick={() => onSend(detail.prospect.id)}
                type="button"
              >
                {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {detail.prospect.first_sent_at ? "Send next follow-up" : "Send initial email"}
              </Button>
              <Button
                className="h-11 rounded-full px-5"
                disabled={working}
                onClick={() => onMarkPositiveReply(detail.prospect.id)}
                type="button"
                variant="outline"
              >
                <ThumbsUp className="h-4 w-4" />
                Positive reply
              </Button>
              <Button
                className="h-11 rounded-full px-5"
                disabled={working}
                onClick={() => onMarkReplied(detail.prospect.id)}
                type="button"
                variant="outline"
              >
                <Undo2 className="h-4 w-4" />
                Mark replied
              </Button>
              <Button
                className="h-11 rounded-full px-5"
                disabled={working}
                onClick={() => onMarkBounced(detail.prospect.id)}
                type="button"
                variant="outline"
              >
                <ShieldBan className="h-4 w-4" />
                Mark bounced
              </Button>
              <Button
                className="h-11 rounded-full border-red-200 bg-red-50 px-5 text-red-700 hover:bg-red-100"
                disabled={working}
                onClick={() => onOptOut(detail.prospect.id)}
                type="button"
                variant="outline"
              >
                <AlertTriangle className="h-4 w-4" />
                Opt out / suppress
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
              <Button
                className="h-11 rounded-full px-5"
                disabled={working}
                onClick={() => onSuppress(detail.prospect.id, "email", "manual_suppression")}
                type="button"
                variant="outline"
              >
                Suppress email
              </Button>
              <Button
                className="h-11 rounded-full px-5"
                disabled={working}
                onClick={() => onSuppress(detail.prospect.id, detail.prospect.company_domain ? "domain" : "company", "manual_suppression")}
                type="button"
                variant="outline"
              >
                Suppress company
              </Button>
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-[22px] border border-steel-200 bg-white p-5 shadow-soft">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Draft</div>
              <div className="mt-2 text-sm text-steel-600">
                This is the exact email sequence content the automation will send, with the MetroGlass PDF attached automatically.
              </div>
              <div className="mt-4 space-y-3">
                <Input onChange={(event) => setSubject(event.target.value)} placeholder="Subject line" value={subject} />
                <Textarea
                  className="min-h-[360px]"
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

            <div className="space-y-5">
              <section className="rounded-[22px] border border-steel-200 bg-white p-5 shadow-soft">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Company</div>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-[16px] border border-steel-200 bg-steel-50/60 px-4 py-4">
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel-500">Recipient</div>
                    <div className="mt-2 break-all font-medium text-steel-900">{detail.prospect.email_address}</div>
                  </div>
                  <div className="rounded-[16px] border border-steel-200 bg-steel-50/60 px-4 py-4">
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel-500">Website</div>
                    <div className="mt-2 font-medium text-steel-900">{detail.prospect.website || "No website saved"}</div>
                    {detail.prospect.website ? (
                      <a
                        className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-800"
                        href={detail.prospect.website}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open website
                      </a>
                    ) : null}
                  </div>
                  <div className="rounded-[16px] border border-steel-200 bg-steel-50/60 px-4 py-4">
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel-500">Campaign</div>
                    <div className="mt-2 font-medium text-steel-900">{detail.prospect.campaign?.name || "Default category campaign"}</div>
                    <div className="mt-1 text-sm text-steel-600">
                      {detail.prospect.campaign?.send_time_local || "11:00"} · {detail.prospect.campaign?.timezone || "America/New_York"}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs text-steel-600">
                  {detail.prospect.phone ? <div className="rounded-full border border-steel-200 bg-white px-3 py-1">{detail.prospect.phone}</div> : null}
                  {detail.prospect.company_domain ? <div className="rounded-full border border-steel-200 bg-white px-3 py-1">{detail.prospect.company_domain}</div> : null}
                  {detail.prospect.city || detail.prospect.state ? (
                    <div className="rounded-full border border-steel-200 bg-white px-3 py-1">
                      {[detail.prospect.city, detail.prospect.state].filter(Boolean).join(", ")}
                    </div>
                  ) : null}
                  <div className="rounded-full border border-steel-200 bg-white px-3 py-1">Added {formatDate(detail.prospect.created_at)}</div>
                  {detail.prospect.first_sent_at ? (
                    <div className="rounded-full border border-steel-200 bg-white px-3 py-1">First sent {formatRelativeTime(detail.prospect.first_sent_at)}</div>
                  ) : null}
                </div>
              </section>

              <section className="rounded-[22px] border border-steel-200 bg-white p-5 shadow-soft">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Description</div>
                <div className="mt-2 text-sm text-steel-600">
                  This description is used for personalization. Keep it short, specific, and human.
                </div>
                <Textarea
                  className="mt-4 min-h-[180px]"
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="What about this company or contact makes the outreach more relevant?"
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
                    Save description
                  </Button>
                </div>
                <div className="mt-4 rounded-[16px] border border-steel-200 bg-steel-50/60 px-4 py-4 text-sm leading-6 text-steel-700">
                  {shortDescription(detail.prospect.notes)}
                </div>
              </section>

              <section className="rounded-[22px] border border-steel-200 bg-white p-5 shadow-soft">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Follow-up schedule</div>
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
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Reply review</div>
                <div className="mt-4 grid gap-3">
                  {(detail.review_items ?? []).map((item) => (
                    <div className="rounded-[16px] border border-amber-200 bg-amber-50/60 px-4 py-4" key={String(item.id)}>
                      <div className="font-medium text-steel-900">{String(item.reason || "reply review pending").replace(/_/g, " ")}</div>
                      <div className="mt-1 text-sm text-steel-600">{String(item.subject || "No subject")}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button className="h-9 rounded-full px-4" disabled={working} onClick={() => onResolveReview(String(item.id), detail.prospect.id, "mark_positive_reply")} type="button" variant="outline">
                          Positive
                        </Button>
                        <Button className="h-9 rounded-full px-4" disabled={working} onClick={() => onResolveReview(String(item.id), detail.prospect.id, "mark_reply")} type="button" variant="outline">
                          Replied
                        </Button>
                        <Button className="h-9 rounded-full px-4" disabled={working} onClick={() => onResolveReview(String(item.id), detail.prospect.id, "mark_bounced")} type="button" variant="outline">
                          Bounced
                        </Button>
                        <Button className="h-9 rounded-full px-4" disabled={working} onClick={() => onResolveReview(String(item.id), detail.prospect.id, "mark_opt_out")} type="button" variant="outline">
                          Opt out
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!(detail.review_items ?? []).length ? (
                    <div className="rounded-[16px] border border-dashed border-steel-200 px-4 py-5 text-sm text-steel-500">
                      No pending inbound review on this contact.
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="rounded-[22px] border border-steel-200 bg-white p-5 shadow-soft">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Suppressions</div>
                <div className="mt-4 grid gap-3">
                  {(detail.suppressions ?? []).map((suppression) => (
                    <div className="rounded-[16px] border border-steel-200 bg-steel-50/60 px-4 py-4" key={suppression.id}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-steel-900">{suppression.scope_type} · {suppression.scope_value}</div>
                          <div className="mt-1 text-sm text-steel-600">{suppression.reason || "manual suppression"}</div>
                        </div>
                        <Button className="h-9 rounded-full px-4" disabled={working} onClick={() => onRemoveSuppression(suppression.id, detail.prospect.id)} type="button" variant="outline">
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!(detail.suppressions ?? []).length ? (
                    <div className="rounded-[16px] border border-dashed border-steel-200 px-4 py-5 text-sm text-steel-500">
                      No manual or derived suppressions are attached to this contact right now.
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
                      No activity yet on this contact.
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
