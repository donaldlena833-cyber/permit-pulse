import { LoaderCircle, Mail, PhoneCall, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Panel } from "@/features/metroglass-leads/components/panel"
import { formatRelativeTime, formatScore } from "@/features/metroglass-leads/lib/format"
import type { LeadRow, TodayPayload } from "@/features/metroglass-leads/types/api"

interface TodayScreenProps {
  today: TodayPayload | null
  actionLeadId: string | null
  onOpenLead: (lead: LeadRow) => void
  onEnrich: (leadId: string) => void
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
  onEnrich,
  onScan,
  onSendAllReady,
  onSendFollowUp,
  onLogPhoneFollowUp,
}: TodayScreenProps) {
  const progress = today ? (today.daily_cap.sent / Math.max(today.daily_cap.cap, 1)) * 100 : 0
  const run = today?.current_run ?? today?.last_run ?? null

  return (
    <div className="space-y-4 pb-28">
      <Panel className="overflow-hidden bg-[linear-gradient(135deg,#fff7ef,white_55%,#f7ebdd)]">
        <div className="text-[11px] uppercase tracking-[0.24em] text-[#D4691A]">MetroGlass Leads</div>
        <h1 className="mt-2 font-['Instrument_Serif'] text-4xl leading-none text-[#1A1A1A]">
          {today?.greeting ?? "Good afternoon, Donald"}
        </h1>
        <p className="mt-3 text-sm text-[#5F564C]">
          {today?.daily_cap.sent ?? 0} / {today?.daily_cap.cap ?? 20} sent today
        </p>
        <Progress className="mt-3 h-2.5 bg-[#F1E6D9]" value={progress} />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-[12px] bg-white/80 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">New</div>
            <div className="mt-1 text-xl font-semibold text-[#1A1A1A]">{today?.counts.new ?? 0}</div>
          </div>
          <div className="rounded-[12px] bg-white/80 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Review</div>
            <div className="mt-1 text-xl font-semibold text-[#1A1A1A]">{today?.counts.review ?? 0}</div>
          </div>
          <div className="rounded-[12px] bg-white/80 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Ready</div>
            <div className="mt-1 text-xl font-semibold text-[#1A1A1A]">{today?.counts.ready ?? 0}</div>
          </div>
        </div>
        {today?.warm_up.enabled ? (
          <p className="mt-3 text-xs font-medium text-[#8F5B22]">Warm up mode is on, cap {today.warm_up.cap}</p>
        ) : null}
      </Panel>

      <Panel>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Run status</div>
            <div className="mt-2 text-lg font-semibold text-[#1A1A1A]">
              {run?.status === "running"
                ? `Scanning, ${run.current_stage ?? "working"}`
                : run?.status === "failed"
                  ? "Last scan failed"
                  : "Last scan"}
            </div>
            <p className="mt-1 text-sm text-[#5F564C]">
              {run?.status === "running"
                ? `${run.counters?.permits_found ?? 0} permits found so far`
                : run?.summary
                  ? `${run.summary.leads_created ?? 0} leads created, ${run.summary.leads_ready ?? 0} ready, ${run.summary.leads_review ?? 0} review`
                  : "No runs yet"}
            </p>
          </div>
          {run?.status === "running" ? <LoaderCircle className="h-5 w-5 animate-spin text-[#D4691A]" /> : <RefreshCw className="h-5 w-5 text-[#D4691A]" />}
        </div>
      </Panel>

      <Panel>
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">New leads</div>
        <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.new ?? 0} new leads</div>
        <div className="mt-4 space-y-3">
          {(today?.new_leads ?? []).slice(0, 6).map((lead) => (
            <div
              key={lead.id}
              className="rounded-[10px] border border-[#EEE4D7] px-3 py-3"
            >
              <button
                className="w-full text-left transition hover:text-[#D4691A]"
                onClick={() => onOpenLead(lead)}
                type="button"
              >
                <div className="font-medium text-[#1A1A1A]">{lead.company_name || lead.applicant_name || lead.address}</div>
                <div className="mt-1 text-sm text-[#5F564C]">{lead.address}</div>
                <div className="mt-2 text-xs text-[#8B7D6B]">
                  Relevance {leadSummary(lead)} | Status {lead.status}
                </div>
              </button>
              <div className="mt-3 flex gap-2">
                <Button
                  className="h-9 rounded-[8px] bg-[#D4691A] px-3 text-white hover:bg-[#BA5A12]"
                  disabled={actionLeadId === lead.id}
                  onClick={() => onEnrich(lead.id)}
                  type="button"
                >
                  {actionLeadId === lead.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Enrich"}
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
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Ready to send</div>
            <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.ready ?? 0} leads ready</div>
          </div>
          <Button className="h-11 rounded-[8px] bg-[#2D6A4F] px-4 text-white hover:bg-[#25573F]" onClick={onSendAllReady}>
            {actionLeadId === null ? "Send All Ready" : "Working"}
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {(today?.ready ?? []).slice(0, 6).map((lead) => (
            <button
              key={lead.id}
              className="w-full rounded-[10px] border border-[#EEE4D7] px-3 py-3 text-left transition hover:border-[#D4691A]"
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
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Needs review</div>
        <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.review ?? 0} leads to review</div>
        <div className="mt-4 space-y-3">
          {(today?.review ?? []).slice(0, 6).map((lead) => (
            <button
              key={lead.id}
              className="w-full rounded-[10px] border border-[#EEE4D7] px-3 py-3 text-left transition hover:border-[#D4691A]"
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
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Follow ups due</div>
        <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">{today?.follow_ups_due.length ?? 0} due today</div>
        <div className="mt-4 space-y-3">
          {(today?.follow_ups_due ?? []).map((followUp) => (
            <div key={followUp.id} className="rounded-[10px] border border-[#EEE4D7] px-3 py-3">
              <div className="font-medium text-[#1A1A1A]">{followUp.company_name}</div>
              <div className="mt-1 text-sm text-[#5F564C]">Step {followUp.step} via {followUp.channel}</div>
              {followUp.channel === "email" ? (
                <Button className="mt-3 h-10 rounded-[8px] bg-[#D4691A] text-white hover:bg-[#BA5A12]" onClick={() => onSendFollowUp(followUp.lead_id, followUp.step)}>
                  <Mail className="h-4 w-4" />
                  Send
                </Button>
              ) : (
                <div className="mt-3 space-y-3">
                  <p className="rounded-[8px] bg-[#F6F1EA] p-3 text-sm text-[#5F564C]">
                    {followUp.phone_script || "Call the contact and ask if the glass scope is still open."}
                  </p>
                  <Button className="h-10 rounded-[8px] border border-[#D4691A] bg-white text-[#D4691A] hover:bg-[#FFF5ED]" onClick={() => onLogPhoneFollowUp(followUp.lead_id, followUp.step)} variant="outline">
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
            <div key={`${send.lead_id}-${send.sent_at}`} className="rounded-[10px] border border-[#EEE4D7] px-3 py-3">
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
        {actionLeadId === "scan" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : "Scan"}
      </button>
    </div>
  )
}
