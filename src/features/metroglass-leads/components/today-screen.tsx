import { LoaderCircle, Mail, PhoneCall, RefreshCw, SendHorizonal } from "lucide-react"

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

function queueNote(count: number, emptyLabel: string, activeLabel: string) {
  return count > 0 ? activeLabel : emptyLabel
}

function QueuePreview({
  title,
  count,
  leads,
  emptyState,
  highlight,
  onOpenLead,
}: {
  title: string
  count: number
  leads: LeadRow[]
  emptyState: string
  highlight: string
  onOpenLead: (lead: LeadRow) => void
}) {
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">{title}</div>
          <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">{count}</div>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-medium ${highlight}`}>{emptyState}</div>
      </div>

      <div className="mt-4 space-y-3">
        {leads.slice(0, 5).map((lead) => (
          <button
            key={lead.id}
            className="w-full rounded-[18px] border border-[#EEE4D7] bg-[#FFFCF8] px-4 py-4 text-left transition hover:border-[#D4691A] hover:bg-white"
            onClick={() => onOpenLead(lead)}
            type="button"
          >
            <div className="font-medium text-[#1A1A1A]">{lead.company_name || lead.applicant_name || lead.address}</div>
            <div className="mt-1 text-sm text-[#5F564C]">{lead.address}</div>
            <div className="mt-2 text-xs text-[#8B7D6B]">
              Relevance {leadSummary(lead)} | Status {formatLeadStatus(lead.status)}
            </div>
          </button>
        ))}

        {!leads.length ? (
          <div className="rounded-[18px] border border-dashed border-[#E2D4C6] px-4 py-6 text-sm text-[#6B5A48]">
            {emptyState}
          </div>
        ) : null}
      </div>
    </Panel>
  )
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
  const runCounters = run?.counters
  const readyCount = today?.counts.ready ?? 0
  const bulkSendDisabled = readyCount === 0 || actionLeadId === "scan"
  const sendNeedsSoftTone = readyCount === 0 || Boolean(today?.warm_up.enabled)
  const bulkSendLabel = readyCount === 0
    ? "No ready leads yet"
    : today?.warm_up.enabled
      ? "Warm-up queue ready"
      : "Send all ready"

  const scanMetrics = [
    { label: "Permits found", value: runCounters?.permits_found ?? 0 },
    { label: "Low relevance", value: runCounters?.permits_skipped_low_relevance ?? 0 },
    { label: "Duplicates", value: runCounters?.permits_deduplicated ?? 0 },
    { label: "Leads created", value: runCounters?.leads_created ?? 0 },
    { label: "Leads enriched", value: runCounters?.leads_enriched ?? 0 },
    { label: "Ready", value: runCounters?.leads_ready ?? 0 },
    { label: "Review", value: runCounters?.leads_review ?? 0 },
    { label: "Drafts", value: runCounters?.drafts_generated ?? 0 },
    { label: "Send attempts", value: runCounters?.sends_attempted ?? 0 },
    { label: "Sent", value: runCounters?.sends_succeeded ?? 0 },
    { label: "Failed", value: runCounters?.sends_failed ?? 0 },
  ]

  return (
    <div className="space-y-5 pb-32">
      <section className="overflow-hidden rounded-[30px] border border-[#E4D5C6] bg-[radial-gradient(circle_at_top_left,rgba(212,105,26,0.14),transparent_22%),linear-gradient(150deg,#fff9f1,#fffdf9_48%,#f3e8da)] px-5 py-6 shadow-[0_26px_56px_rgba(26,26,26,0.08)]">
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-[#D4691A]">MetroGlass Leads</div>
            <h1 className="mt-2 font-['Instrument_Serif'] text-4xl leading-none text-[#1A1A1A] sm:text-5xl">
              {today?.greeting ?? "Good afternoon, Donald"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5F564C]">
              {today?.daily_cap.sent ?? 0} / {today?.daily_cap.cap ?? 20} sent today. This board is tuned for operator decisions: what to enrich, what to research, what to send, and what the last scan actually did.
            </p>
            <Progress className="mt-4 h-2.5 bg-[#F1E6D9]" value={progress} />

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="border-l-2 border-[#D4691A] bg-white/75 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">New</div>
                <div className="mt-1 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.new ?? 0}</div>
              </div>
              <div className="border-l-2 border-[#9A6A2C] bg-white/75 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Review</div>
                <div className="mt-1 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.review ?? 0}</div>
              </div>
              <div className="border-l-2 border-[#7F5F3F] bg-white/75 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Email required</div>
                <div className="mt-1 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.email_required ?? 0}</div>
              </div>
              <div className="border-l-2 border-[#2D6A4F] bg-white/75 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">Ready</div>
                <div className="mt-1 text-2xl font-semibold text-[#1A1A1A]">{today?.counts.ready ?? 0}</div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 self-start">
            <div className="border border-[#E6D8C9] bg-[rgba(255,255,255,0.76)] p-4 backdrop-blur-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-[#8B7D6B]">Run pulse</div>
                  <div className="mt-2 text-lg font-semibold text-[#1A1A1A]">
                    {run?.status === "running"
                      ? `Scanning ${run.current_stage ?? "pipeline"}`
                      : run?.status === "failed"
                        ? "Last scan failed"
                        : run
                          ? "Last completed scan"
                          : "No scans yet"}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[#5F564C]">
                    {run
                      ? `Updated ${formatRelativeTime(run.completed_at || run.started_at)}`
                      : "Run a scan to fill the queue and build the funnel report below."}
                  </p>
                </div>
                {run?.status === "running" ? (
                  <LoaderCircle className="h-5 w-5 animate-spin text-[#D4691A]" />
                ) : (
                  <RefreshCw className="h-5 w-5 text-[#D4691A]" />
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button className="h-11 flex-1 rounded-full bg-[#1A1A1A] text-white hover:bg-[#111111]" onClick={onScan} type="button">
                {actionLeadId === "scan" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Run scan now"}
              </Button>
              <Button
                className={`h-11 flex-1 rounded-full ${
                  sendNeedsSoftTone
                    ? "border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]"
                    : "bg-[#2D6A4F] text-white hover:bg-[#25573F]"
                }`}
                disabled={bulkSendDisabled}
                onClick={onSendAllReady}
                type="button"
                variant={sendNeedsSoftTone ? "outline" : "default"}
              >
                <SendHorizonal className="h-4 w-4" />
                {bulkSendLabel}
              </Button>
            </div>

            <div className="text-sm leading-6 text-[#5F564C]">
              {today?.warm_up.enabled
                ? `Warm-up mode is on with a cap of ${today.warm_up.cap}. Send controls stay secondary until the queue is genuinely ready.`
                : "Use the drawer to verify weak routes, move dead-ends into Email Required, and text from your phone when email is not ready."}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        <Panel className="bg-[linear-gradient(180deg,#fffdfa,#f8efe4)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Scan report</div>
              <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">
                {run?.status === "running" ? "Live funnel" : "Latest funnel"}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5F564C]">
                This is the full shape of the last run, including how much source volume got filtered out before it ever became a lead.
              </p>
            </div>
            {run ? (
              <div className="rounded-full border border-[#E4D5C5] bg-white/90 px-3 py-1 text-xs font-medium text-[#6B5A48]">
                {run.status} {run.current_stage ? `· ${run.current_stage}` : ""}
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {scanMetrics.map((metric) => (
              <div key={metric.label} className="border-l-2 border-[#E2D4C3] bg-white/82 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">{metric.label}</div>
                <div className="mt-1 text-2xl font-semibold text-[#1A1A1A]">{metric.value}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Operator lane</div>
          <div className="mt-3 space-y-4 text-sm leading-6 text-[#5F564C]">
            <div className="border-l-2 border-[#D4691A] pl-4">
              Start with <span className="font-medium text-[#1A1A1A]">New</span> when the queue is dry and you need fresh enrichment work.
            </div>
            <div className="border-l-2 border-[#9A6A2C] pl-4">
              Move to <span className="font-medium text-[#1A1A1A]">Review</span> when the system found options but still needs your judgment.
            </div>
            <div className="border-l-2 border-[#7F5F3F] pl-4">
              Use <span className="font-medium text-[#1A1A1A]">Email Required</span> when the website is real but enrichment still didn’t produce the usable address.
            </div>
            <div className="border-l-2 border-[#2D6A4F] pl-4">
              <span className="font-medium text-[#1A1A1A]">Ready</span> is for leads with an approved route, not wishful thinking.
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <QueuePreview
          count={today?.counts.new ?? 0}
          emptyState={queueNote(today?.counts.new ?? 0, "No untouched leads are waiting right now.", "Fresh permits waiting on enrichment")}
          highlight="bg-[#FFF1E2] text-[#9A5A12]"
          leads={today?.new_leads ?? []}
          onOpenLead={onOpenLead}
          title="New"
        />

        <QueuePreview
          count={today?.counts.ready ?? 0}
          emptyState={queueNote(today?.counts.ready ?? 0, "Nothing is approved for send yet.", "Approved routes ready for outreach")}
          highlight="bg-[#EEF9F2] text-[#2D6A4F]"
          leads={today?.ready ?? []}
          onOpenLead={onOpenLead}
          title="Ready"
        />

        <QueuePreview
          count={today?.counts.review ?? 0}
          emptyState={queueNote(today?.counts.review ?? 0, "No plain review leads right now.", "Lead routes need a human decision")}
          highlight="bg-[#FFF7ED] text-[#9A6A2C]"
          leads={today?.review ?? []}
          onOpenLead={onOpenLead}
          title="Review"
        />

        <QueuePreview
          count={today?.counts.email_required ?? 0}
          emptyState={queueNote(today?.counts.email_required ?? 0, "Nothing is parked in Email Required right now.", "Leads waiting on a verified address")}
          highlight="bg-[#F5EDE3] text-[#6B5A48]"
          leads={today?.email_required ?? []}
          onOpenLead={onOpenLead}
          title="Email Required"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
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
            {!(today?.recent_sends ?? []).length ? (
              <div className="rounded-[18px] border border-dashed border-[#E2D4C6] px-4 py-6 text-sm text-[#6B5A48]">
                No sends logged yet today.
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

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
