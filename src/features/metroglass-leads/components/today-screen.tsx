import { LoaderCircle, Mail, PhoneCall, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Panel } from "@/features/metroglass-leads/components/panel"
import { formatLeadStatus, formatRelativeTime, formatScore } from "@/features/metroglass-leads/lib/format"
import type { LeadRow, TodayPayload } from "@/features/metroglass-leads/types/api"

interface TodayScreenProps {
  today: TodayPayload | null
  actionLeadId: string | null
  onOpenLead: (lead: LeadRow) => void
  onScan: () => void
  onSendAllReady: () => void
  onSendFollowUp: (leadId: string, step: number) => void
  onLogPhoneFollowUp: (leadId: string, step: number) => void
}

function leadSummary(lead: LeadRow) {
  return `${formatScore(lead.relevance_score)}${lead.relevance_keyword ? ` (${lead.relevance_keyword})` : ""}`
}

export function TodayScreen({
  today,
  actionLeadId,
  onOpenLead,
  onScan,
  onSendAllReady,
  onSendFollowUp,
  onLogPhoneFollowUp,
}: TodayScreenProps) {
  const progress = today ? (today.daily_cap.sent / Math.max(today.daily_cap.cap, 1)) * 100 : 0
  const run = today?.current_run ?? today?.last_run ?? null
  const isScanRunning = actionLeadId === "scan" || run?.status === "running"
  const runProgress = run?.progress
  const runOutcomeMessage = run?.status === "completed"
    ? ((run.summary?.processed ?? 0) === 0
      ? "No pending backlog and no new matching permits were found."
      : (run.summary?.sent ?? 0) === 0
        ? "Backlog moved, but nothing sendable was ready this run."
        : `${run.summary?.sent ?? 0} emails sent from this run.`)
    : null

  return (
    <div className="space-y-5 pb-32">
      <Panel className="overflow-hidden bg-[linear-gradient(135deg,#fff7ef,white_55%,#f7ebdd)]">
        <div className="text-[11px] uppercase tracking-[0.24em] text-[#D4691A]">MetroGlass Leads</div>
        <h1 className="mt-2 font-['Instrument_Serif'] text-4xl leading-none text-[#1A1A1A] sm:text-5xl">
          {today?.greeting ?? "Good afternoon, Donald"}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5F564C]">
          {today?.daily_cap.sent ?? 0} / {today?.daily_cap.cap ?? 20} sent today. The dashboard below is organized around what needs a decision right now, not just what exists in the database.
        </p>
        <Progress className="mt-4 h-2.5 bg-[#F1E6D9]" value={progress} />
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-[16px] bg-white/85 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Backlog</div>
            <div className="mt-1 text-2xl font-semibold text-[#1A1A1A]">{today?.automation_backlog_pending ?? today?.counts.new ?? 0}</div>
          </div>
          <div className="rounded-[16px] bg-white/85 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Exceptions</div>
            <div className="mt-1 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.review ?? 0}</div>
          </div>
          <div className="rounded-[16px] bg-white/85 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Email required</div>
            <div className="mt-1 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.email_required ?? 0}</div>
          </div>
          <div className="rounded-[16px] bg-white/85 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Ready</div>
            <div className="mt-1 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.ready ?? 0}</div>
          </div>
        </div>
        {today?.warm_up.enabled ? (
          <p className="mt-4 text-xs font-medium text-[#8F5B22]">Warm up mode is on, cap {today.warm_up.cap}</p>
        ) : null}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Panel>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Current scan</div>
              <div className="mt-2 text-lg font-semibold text-[#1A1A1A]">
                {run?.status === "running"
                  ? `${run.current_stage ?? "working"}`
                  : run?.status === "failed"
                    ? "Last scan failed"
                    : "Last scan"}
              </div>
              <p className="mt-1 text-sm leading-6 text-[#5F564C]">
                {run?.status === "running"
                  ? `${runProgress?.claimed ?? 0} claimed, ${runProgress?.processed ?? 0} processed, ${runProgress?.sent ?? 0} sent`
                  : run?.summary
                    ? `${run.summary.claimed ?? 0} claimed, ${run.summary.processed ?? 0} processed, ${run.summary.sent ?? 0} sent`
                    : "No runs yet"}
              </p>
              {runProgress ? (
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#6B5A48] sm:grid-cols-5">
                  <div className="rounded-full bg-[#F6EEE4] px-3 py-2">Backlog {runProgress.backlog_pending}</div>
                  <div className="rounded-full bg-[#F6EEE4] px-3 py-2">Claimed {runProgress.claimed}</div>
                  <div className="rounded-full bg-[#F6EEE4] px-3 py-2">Processed {runProgress.processed}</div>
                  <div className="rounded-full bg-[#F6EEE4] px-3 py-2">Fresh {runProgress.fresh_inserted}</div>
                  <div className="rounded-full bg-[#F6EEE4] px-3 py-2">Remaining {runProgress.remaining}</div>
                </div>
              ) : null}
              {runOutcomeMessage ? (
                <p className="mt-3 text-sm leading-6 text-[#5F564C]">{runOutcomeMessage}</p>
              ) : null}
            </div>
            {run?.status === "running" ? (
              <LoaderCircle className="h-5 w-5 animate-spin text-[#D4691A]" />
            ) : (
              <RefreshCw className="h-5 w-5 text-[#D4691A]" />
            )}
          </div>
        </Panel>

        <Panel className="bg-[linear-gradient(180deg,#fffdfa,#f8efe4)]">
          <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Quick actions</div>
          <div className="mt-3 space-y-3">
            <Button className="h-11 w-full rounded-full bg-[#1A1A1A] text-white hover:bg-[#111111]" onClick={onScan} type="button">
              {isScanRunning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Run scan now"}
            </Button>
            <Button className="h-11 w-full rounded-full bg-[#2D6A4F] text-white hover:bg-[#25573F]" onClick={onSendAllReady} type="button">
              {actionLeadId === null ? "Send all ready" : "Working"}
            </Button>
          </div>
          <div className="mt-4 text-sm leading-6 text-[#5F564C]">
            Scan now drains queued backlog first, tops up with fresh DOB permits only when needed, then resolves, enriches, routes, drafts, and sends in the background.
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Automation backlog</div>
        <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">{today?.automation_backlog_pending ?? today?.counts.new ?? 0} pending leads</div>
        <div className="mt-2 text-sm leading-6 text-[#5F564C]">
          This is the true unprocessed queue. Scan claims from here first, then only fetches fresh permits if it still needs more work to fill the run.
        </div>
        <div className="mt-4 space-y-3">
          {(today?.automation_backlog ?? today?.new_leads ?? []).slice(0, 6).map((lead) => (
            <div key={lead.id} className="rounded-[16px] border border-[#EEE4D7] px-4 py-4">
              <button className="w-full text-left transition hover:text-[#D4691A]" onClick={() => onOpenLead(lead)} type="button">
                <div className="font-medium text-[#1A1A1A]">{lead.company_name || lead.applicant_name || lead.address}</div>
                <div className="mt-1 text-sm text-[#5F564C]">{lead.address}</div>
                <div className="mt-2 text-xs text-[#8B7D6B]">
                  Relevance {leadSummary(lead)} | Waiting to be processed
                </div>
              </button>
              <div className="mt-3 flex gap-2">
                <Button
                  className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]"
                  onClick={() => onOpenLead(lead)}
                  type="button"
                  variant="outline"
                >
                  Open
                </Button>
              </div>
            </div>
          ))}
          {!(today?.automation_backlog ?? today?.new_leads ?? []).length ? (
            <div className="rounded-[16px] border border-dashed border-[#E2D4C6] px-4 py-6 text-sm text-[#6B5A48]">
              There is no pending backlog right now.
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Processed this run</div>
        <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">{today?.processed_this_run.length ?? 0} recently processed leads</div>
        <div className="mt-2 text-sm leading-6 text-[#5F564C]">
          These leads were claimed by the current or last scan run and already moved through resolve, enrichment, route selection, and draft generation.
        </div>
        <div className="mt-4 space-y-3">
          {(today?.processed_this_run ?? []).slice(0, 6).map((lead) => (
            <div key={lead.id} className="rounded-[16px] border border-[#EEE4D7] px-4 py-4">
              <button className="w-full text-left transition hover:text-[#D4691A]" onClick={() => onOpenLead(lead)} type="button">
                <div className="font-medium text-[#1A1A1A]">{lead.company_name || lead.applicant_name || lead.address}</div>
                <div className="mt-1 text-sm text-[#5F564C]">{lead.address}</div>
                <div className="mt-2 text-xs text-[#8B7D6B]">
                  Relevance {leadSummary(lead)} | Status {formatLeadStatus(lead.status)}
                </div>
              </button>
            </div>
          ))}
          {!(today?.processed_this_run ?? []).length ? (
            <div className="rounded-[16px] border border-dashed border-[#E2D4C6] px-4 py-6 text-sm text-[#6B5A48]">
              Nothing has been processed in the current visible run yet.
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Ready to send</div>
            <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.ready ?? 0} leads ready</div>
          </div>
          <Button className="h-11 rounded-full bg-[#2D6A4F] px-4 text-white hover:bg-[#25573F]" onClick={onSendAllReady}>
            {actionLeadId === null ? "Send all ready" : "Working"}
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {(today?.ready ?? []).slice(0, 6).map((lead) => (
            <button
              key={lead.id}
              className="w-full rounded-[16px] border border-[#EEE4D7] px-4 py-4 text-left transition hover:border-[#D4691A]"
              onClick={() => onOpenLead(lead)}
              type="button"
            >
              <div className="font-medium text-[#1A1A1A]">{lead.company_name || lead.address}</div>
              <div className="mt-1 text-sm text-[#5F564C]">{lead.address}</div>
              <div className="mt-2 text-xs text-[#8B7D6B]">
                Relevance {leadSummary(lead)} | Trust {Math.round(lead.contact_email_trust ?? 0)}
              </div>
            </button>
          ))}
        </div>
      </Panel>

      <Panel>
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Exceptions</div>
        <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.review ?? 0} leads need a decision</div>
        <div className="mt-4 space-y-3">
          {(today?.review ?? []).slice(0, 6).map((lead) => (
            <button
              key={lead.id}
              className="w-full rounded-[16px] border border-[#EEE4D7] px-4 py-4 text-left transition hover:border-[#D4691A]"
              onClick={() => onOpenLead(lead)}
              type="button"
            >
              <div className="font-medium text-[#1A1A1A]">{lead.company_name || lead.address}</div>
              <div className="mt-1 text-sm text-[#5F564C]">{lead.address}</div>
              <div className="mt-2 text-xs text-[#8B7D6B]">
                Relevance {leadSummary(lead)} | Trust {Math.round(lead.contact_email_trust ?? 0)}
              </div>
            </button>
          ))}
          {!(today?.review ?? []).length ? (
            <div className="rounded-[16px] border border-dashed border-[#E2D4C6] px-4 py-6 text-sm text-[#6B5A48]">
              No plain review leads right now.
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel className="bg-[linear-gradient(180deg,#fffdfa,#f8efe4)]">
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Email required</div>
        <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.email_required ?? 0} leads waiting on a verified address</div>
        <div className="mt-2 max-w-2xl text-sm leading-6 text-[#5F564C]">
          These are the leads you intentionally parked because enrichment did not surface a usable email. Open any of them to add a verified address manually or keep working from text/phone.
        </div>
        <div className="mt-4 space-y-3">
          {(today?.email_required ?? []).slice(0, 6).map((lead) => (
            <button
              key={lead.id}
              className="w-full rounded-[16px] border border-[#EEE4D7] px-4 py-4 text-left transition hover:border-[#D4691A]"
              onClick={() => onOpenLead(lead)}
              type="button"
            >
              <div className="font-medium text-[#1A1A1A]">{lead.company_name || lead.address}</div>
              <div className="mt-1 text-sm text-[#5F564C]">{lead.address}</div>
              <div className="mt-2 text-xs text-[#8B7D6B]">
                Relevance {leadSummary(lead)} | No verified email chosen yet
              </div>
            </button>
          ))}
          {!(today?.email_required ?? []).length ? (
            <div className="rounded-[16px] border border-dashed border-[#E2D4C6] px-4 py-6 text-sm text-[#6B5A48]">
              Nothing is parked in Email Required right now.
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Follow ups due</div>
        <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">{today?.follow_ups_due.length ?? 0} due today</div>
        <div className="mt-4 space-y-3">
          {(today?.follow_ups_due ?? []).map((followUp) => (
            <div key={followUp.id} className="rounded-[16px] border border-[#EEE4D7] px-4 py-4">
              <div className="font-medium text-[#1A1A1A]">{followUp.company_name}</div>
              <div className="mt-1 text-sm text-[#5F564C]">Step {followUp.step} via {followUp.channel}</div>
              {followUp.channel === "email" ? (
                <Button className="mt-3 h-10 rounded-full bg-[#D4691A] text-white hover:bg-[#BA5A12]" onClick={() => onSendFollowUp(followUp.lead_id, followUp.step)}>
                  <Mail className="h-4 w-4" />
                  Send
                </Button>
              ) : (
                <div className="mt-3 space-y-3">
                  <p className="rounded-[14px] bg-[#F6F1EA] p-3 text-sm text-[#5F564C]">
                    {followUp.phone_script || "Call the contact and ask if the glass scope is still open."}
                  </p>
                  <Button className="h-10 rounded-full border border-[#D4691A] bg-white text-[#D4691A] hover:bg-[#FFF5ED]" onClick={() => onLogPhoneFollowUp(followUp.lead_id, followUp.step)} variant="outline">
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
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Recent sends</div>
        <div className="mt-4 space-y-3">
          {(today?.recent_sends ?? []).map((send) => (
            <div key={`${send.lead_id}-${send.sent_at}`} className="rounded-[16px] border border-[#EEE4D7] px-4 py-4">
              <div className="font-medium text-[#1A1A1A]">{send.company_name}</div>
              <div className="mt-1 text-sm text-[#5F564C]">{send.email}</div>
              <div className="mt-2 text-xs text-[#8B7D6B]">{send.outcome} · {formatRelativeTime(send.sent_at)}</div>
            </div>
          ))}
        </div>
      </Panel>

      <button
        className="fixed bottom-24 right-4 flex h-14 min-w-[56px] items-center justify-center rounded-full bg-[#D4691A] px-5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(212,105,26,0.35)] transition hover:bg-[#BA5A12]"
        onClick={onScan}
        type="button"
      >
        {isScanRunning ? <LoaderCircle className="h-5 w-5 animate-spin" /> : "Scan"}
      </button>
    </div>
  )
}
