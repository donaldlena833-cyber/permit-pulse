import { AlertTriangle, LoaderCircle, Mail, PhoneCall, RefreshCw, ShieldCheck, Users2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Panel } from "@/features/metroglass-leads/components/panel"
import { formatProspectCategory, formatRelativeTime, formatScore } from "@/features/metroglass-leads/lib/format"
import type { LeadRow, ProspectCategory, TodayPayload } from "@/features/metroglass-leads/types/api"

interface TodayScreenProps {
  today: TodayPayload | null
  actionLeadId: string | null
  onOpenLead: (lead: LeadRow) => void
  onScan: () => void
  onRunProspectBatch: () => void
  onSendAllReady: () => void
  onSendDueFollowUps: (limit?: number) => void
  onSyncReplies: () => void
  onSendFollowUp: (leadId: string, step: number) => void
  onLogPhoneFollowUp: (leadId: string, step: number) => void
}

const CATEGORIES: ProspectCategory[] = [
  "architect",
  "interior_designer",
  "property_manager",
  "project_manager",
  "gc",
]

function leadSummary(lead: LeadRow) {
  return `${formatScore(lead.relevance_score)}${lead.relevance_keyword ? ` (${lead.relevance_keyword})` : ""}`
}

function runHeadline(run: TodayPayload["current_run"] | TodayPayload["last_run"]) {
  if (!run) return "No automation running"
  if (run.mode?.startsWith("prospect_")) {
    return "Outreach CRM daily send batch"
  }
  if (run.status === "running") {
    return "Permit scan in progress"
  }
  return "Last permit automation run"
}

function queueChip(label: string, value: number, tone: "default" | "success" | "warning" = "default") {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-steel-200 bg-white text-steel-600"

  return (
    <div className={`rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] ${toneClass}`}>
      {label} {value}
    </div>
  )
}

export function TodayScreen({
  today,
  actionLeadId,
  onOpenLead,
  onScan,
  onRunProspectBatch,
  onSendAllReady,
  onSendDueFollowUps,
  onSyncReplies,
  onSendFollowUp,
  onLogPhoneFollowUp,
}: TodayScreenProps) {
  const progress = today ? (today.daily_cap.sent / Math.max(today.daily_cap.cap, 1)) * 100 : 0
  const run = today?.current_run ?? today?.last_run ?? null
  const isScanRunning = actionLeadId === "scan" || run?.status === "running"
  const prospect = today?.prospect_automation
  const permitRunMessage = run?.status === "completed"
    ? ((run.summary?.processed ?? 0) === 0
      ? "No claimable permit work was found in the visible automation queue."
      : (run.summary?.sent ?? 0) === 0
        ? "Permit backlog moved, but nothing new was send-approved."
        : `${run.summary?.sent ?? 0} permit emails went out in the last visible run.`)
    : run?.status === "running"
      ? "Permit automation is draining backlog and checking fresh permits."
      : "No active permit run right now."

  return (
    <div className="space-y-5 pb-32">
      <Panel className="overflow-hidden bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-brand-700">
              Ops command center
            </div>
            <h1 className="mt-4 text-4xl font-extrabold tracking-[-0.05em] text-steel-900 sm:text-5xl">
              {today?.greeting ?? "Good morning, Donald"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-steel-600">
              Permit automation and the prospects pilot now share the same control room. This surface is about throughput, queue health, and exceptions, not marketing chrome.
            </p>
          </div>
          <div className="min-w-[260px] rounded-[20px] border border-steel-200 bg-white p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Daily send budget</div>
                <div className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-steel-900">
                  {today?.daily_cap.sent ?? 0}
                  <span className="ml-2 text-base font-semibold text-steel-500">/ {today?.daily_cap.cap ?? 0}</span>
                </div>
              </div>
              <ShieldCheck className="h-6 w-6 text-brand-600" />
            </div>
            <Progress className="mt-4 h-2.5 bg-steel-100" value={progress} />
            <div className="mt-4 flex flex-wrap gap-2">
              {queueChip("Permit backlog", today?.automation_backlog_pending ?? 0)}
              {queueChip("Prospect queue", prospect?.initial_queue.length ?? 0)}
              {queueChip("Follow-ups", prospect?.follow_up_queue.length ?? 0, "warning")}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr_0.8fr]">
        <Panel>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Permit automation</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-900">{runHeadline(run)}</div>
              <p className="mt-2 text-sm leading-6 text-steel-600">{permitRunMessage}</p>
            </div>
            {run?.status === "running" ? (
              <LoaderCircle className="h-5 w-5 animate-spin text-brand-600" />
            ) : (
              <RefreshCw className="h-5 w-5 text-brand-600" />
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-5">
            {queueChip("Claimed", run?.progress?.claimed ?? 0)}
            {queueChip("Processed", run?.progress?.processed ?? 0)}
            {queueChip("Fresh", run?.progress?.fresh_inserted ?? 0)}
            {queueChip("Ready", run?.progress?.ready ?? 0, "success")}
            {queueChip("Exceptions", run?.progress?.review ?? 0, "warning")}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Prospects pilot</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-900">
                {prospect?.pilot_enabled ? "Active" : "Paused"}
              </div>
              <p className="mt-2 text-sm leading-6 text-steel-600">
                {prospect?.pilot_enabled
                  ? `${prospect.initial_daily_per_category}/category at ${prospect.initial_send_time}, with follow-ups queued for ${(prospect.follow_up_offsets_days ?? [3, 14]).join(" and ")} days at ${prospect.follow_up_send_time}.`
                  : "The prospect pilot is currently disabled in config."}
              </p>
            </div>
            <Users2 className="h-5 w-5 text-brand-600" />
          </div>

          <div className="mt-4 grid gap-2">
            {CATEGORIES.map((category) => (
              <div key={category} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-[16px] border border-steel-200 bg-steel-50/60 px-3 py-3">
                <div className="font-medium text-steel-900">{formatProspectCategory(category)}</div>
                <div className="font-mono text-xs text-steel-600">
                  Sent {prospect?.sent_today_by_category?.[category] ?? ((prospect?.initial_sent_today?.[category] ?? 0) + (prospect?.follow_up_sent_today?.[category] ?? 0))}/{prospect?.initial_daily_per_category ?? 0}
                </div>
                <div className="font-mono text-xs text-steel-600">
                  Positive {prospect?.positive_replies_by_category?.[category] ?? 0}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-[16px] border border-steel-200 bg-steel-50/80 p-3 text-sm leading-6 text-steel-600">
            Reply sync {prospect?.reply_sync?.checked_at ? `last checked ${formatRelativeTime(prospect.reply_sync.checked_at)}` : "has not run yet"}.
            {" "}
            Processed {prospect?.reply_sync?.processed_messages ?? 0} inbox replies and captured {prospect?.reply_sync?.opt_outs ?? 0} opt-outs.
          </div>
        </Panel>

        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Actions</div>
          <div className="mt-4 grid gap-3">
            <Button className="h-11 w-full rounded-full" onClick={onScan} type="button">
              {isScanRunning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Run permit scan"}
            </Button>
            <Button className="h-11 w-full rounded-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={onSendAllReady} type="button">
              {actionLeadId === "send-ready" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Send ready permits"}
            </Button>
            <Button className="h-11 w-full rounded-full" onClick={() => onSendDueFollowUps(20)} type="button" variant="outline">
              {actionLeadId === "send-due-follow-ups" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Send 20 due follow-ups"}
            </Button>
            <Button className="h-11 w-full rounded-full" onClick={onRunProspectBatch} type="button" variant="outline">
              {actionLeadId === "run-prospect-batch" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Run outreach batch now"}
            </Button>
            <Button className="h-11 w-full rounded-full" onClick={onSyncReplies} type="button" variant="outline">
              {actionLeadId === "sync-replies" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Sync Gmail replies"}
            </Button>
          </div>
          <div className="mt-4 rounded-[16px] border border-steel-200 bg-steel-50/80 p-3 text-sm leading-6 text-steel-600">
            Scheduled permit auto-send is intentionally separated from the prospects pilot. Manual permit workflows stay available while the pilot runs.
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Permit queues</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-900">Manual work and send-ready lanes</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {queueChip("Backlog", today?.automation_backlog_pending ?? 0)}
              {queueChip("Email required", today?.counts.email_required ?? 0, "warning")}
              {queueChip("Ready", today?.counts.ready ?? 0, "success")}
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="space-y-3">
              <div className="text-sm font-semibold text-steel-900">Backlog</div>
              {(today?.automation_backlog ?? []).slice(0, 4).map((lead) => (
                <button
                  key={lead.id}
                  className="w-full rounded-[16px] border border-steel-200 bg-white px-4 py-4 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
                  onClick={() => onOpenLead(lead)}
                  type="button"
                >
                  <div className="font-medium text-steel-900">{lead.company_name || lead.applicant_name || lead.address}</div>
                  <div className="mt-1 text-sm text-steel-600">{lead.address}</div>
                  <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-steel-500">
                    {leadSummary(lead)}
                  </div>
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <div className="text-sm font-semibold text-steel-900">Ready</div>
              {(today?.ready ?? []).slice(0, 4).map((lead) => (
                <button
                  key={lead.id}
                  className="w-full rounded-[16px] border border-emerald-200 bg-emerald-50/70 px-4 py-4 text-left transition hover:border-emerald-300"
                  onClick={() => onOpenLead(lead)}
                  type="button"
                >
                  <div className="font-medium text-steel-900">{lead.company_name || lead.address}</div>
                  <div className="mt-1 text-sm text-steel-600">{lead.address}</div>
                  <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-emerald-700">
                    Trust {Math.round(lead.contact_email_trust ?? 0)}
                  </div>
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <div className="text-sm font-semibold text-steel-900">Email required</div>
              {(today?.email_required ?? []).slice(0, 4).map((lead) => (
                <button
                  key={lead.id}
                  className="w-full rounded-[16px] border border-amber-200 bg-amber-50/70 px-4 py-4 text-left transition hover:border-amber-300"
                  onClick={() => onOpenLead(lead)}
                  type="button"
                >
                  <div className="font-medium text-steel-900">{lead.company_name || lead.address}</div>
                  <div className="mt-1 text-sm text-steel-600">{lead.address}</div>
                  <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-amber-700">
                    Waiting on a verified email
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Prospect automation board</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-900">Outreach metrics, due follow-ups, and suppressions</div>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            <div className="rounded-[18px] border border-steel-200 bg-white p-4">
              <div className="text-sm font-semibold text-steel-900">CRM totals</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-steel-600">
                <div>Contacts: {prospect?.metrics?.contacts_total ?? 0}</div>
                <div>Sent: {prospect?.metrics?.sent_total ?? 0}</div>
                <div>Delivered: {prospect?.metrics?.delivered_total ?? 0}</div>
                <div>Positive replies: {prospect?.metrics?.positive_replies_total ?? 0}</div>
              </div>
            </div>
            <div className="rounded-[18px] border border-steel-200 bg-white p-4">
              <div className="text-sm font-semibold text-steel-900">Follow-ups due in the next send window</div>
              <div className="mt-3 grid gap-2">
                {(prospect?.follow_up_queue ?? []).slice(0, 5).map((followUp) => (
                  <div key={followUp.id} className="rounded-[14px] border border-steel-200 bg-steel-50/70 px-3 py-3">
                    <div className="font-medium text-steel-900">{followUp.contact_name || followUp.company_name || followUp.email_address}</div>
                    <div className="mt-1 text-sm text-steel-600">
                      {followUp.category ? formatProspectCategory(followUp.category) : "Prospect"} · due {formatRelativeTime(followUp.scheduled_at)}
                    </div>
                  </div>
                ))}
                {!(prospect?.follow_up_queue ?? []).length ? (
                  <div className="rounded-[14px] border border-dashed border-steel-200 px-3 py-4 text-sm text-steel-500">
                    No prospect follow-ups are waiting right now.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[18px] border border-steel-200 bg-white p-4">
              <div className="text-sm font-semibold text-steel-900">Recent prospect sends</div>
              <div className="mt-3 grid gap-2">
                {(prospect?.recent_sends ?? []).slice(0, 5).map((send) => (
                  <div key={send.id} className="rounded-[14px] border border-steel-200 bg-steel-50/70 px-3 py-3">
                    <div className="font-medium text-steel-900">{send.contact_name}</div>
                    <div className="mt-1 text-sm text-steel-600">
                      {(send.category && formatProspectCategory(send.category)) || "Prospect"} · {send.kind === "follow_up" ? "Follow-up" : "Initial"} · {formatRelativeTime(send.sent_at)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[18px] border border-steel-200 bg-white p-4">
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-steel-900">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Prospect exceptions
              </div>
              <div className="mt-3 grid gap-2">
                {(prospect?.exceptions ?? []).slice(0, 5).map((item) => (
                  <div key={item.id} className="rounded-[14px] border border-amber-200 bg-amber-50/70 px-3 py-3">
                    <div className="font-medium text-steel-900">{item.label}</div>
                    <div className="mt-1 text-sm text-amber-800">
                      {item.category ? formatProspectCategory(item.category) : "Prospect"} · {item.event_type.replace(/_/g, " ")}
                    </div>
                  </div>
                ))}
                {!(prospect?.exceptions ?? []).length ? (
                  <div className="rounded-[14px] border border-dashed border-steel-200 px-3 py-4 text-sm text-steel-500">
                    No prospect exceptions have been logged recently.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Permit follow-ups</div>
          <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-900">{today?.follow_ups_due.length ?? 0} due today</div>
          <div className="mt-4 space-y-3">
            {(today?.follow_ups_due ?? []).map((followUp) => (
              <div key={followUp.id} className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                <div className="font-medium text-steel-900">{followUp.company_name}</div>
                <div className="mt-1 text-sm text-steel-600">Step {followUp.step} via {followUp.channel}</div>
                {followUp.channel === "email" ? (
                  <Button className="mt-3 h-10 rounded-full" onClick={() => onSendFollowUp(followUp.lead_id, followUp.step)}>
                    <Mail className="h-4 w-4" />
                    Send
                  </Button>
                ) : (
                  <div className="mt-3 space-y-3">
                    <p className="rounded-[14px] border border-steel-200 bg-steel-50/70 p-3 text-sm text-steel-600">
                      {followUp.phone_script || "Call the contact and ask if the glass scope is still open."}
                    </p>
                    <Button className="h-10 rounded-full" onClick={() => onLogPhoneFollowUp(followUp.lead_id, followUp.step)} variant="outline">
                      <PhoneCall className="h-4 w-4" />
                      Log outcome
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Recent permit sends</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(today?.recent_sends ?? []).map((send) => (
              <div key={`${send.lead_id}-${send.sent_at}`} className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                <div className="font-medium text-steel-900">{send.company_name}</div>
                <div className="mt-1 text-sm text-steel-600">{send.email}</div>
                <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-steel-500">
                  {send.outcome} · {formatRelativeTime(send.sent_at)}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
