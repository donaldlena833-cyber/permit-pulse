import { getAccessToken } from "@/features/auth/lib/session"
import type {
  ConfigPayload,
  HealthPayload,
  LeadDetailResponse,
  LeadsPayload,
  ProspectDetailResponse,
  ProspectsPayload,
  SystemPayload,
  TodayPayload,
} from "@/features/metroglass-leads/types/api"

function apiBase(): string {
  return __PERMIT_PULSE_WORKER_URL__.replace(/\/$/, "")
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = getAccessToken()
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `API error ${response.status}`
    throw new Error(message)
  }

  return payload as T
}

export function fetchHealth() {
  return requestJson<HealthPayload>("/api/health")
}

export function fetchToday() {
  return requestJson<TodayPayload>("/api/today")
}

export function triggerScan() {
  return requestJson<{
    started: boolean
    run_id?: string | null
    mode?: "operator_scan"
    target_claim_count?: number
    backlog_pending_at_start?: number
    active_run_reused?: boolean
  }>("/api/scan", {
    method: "POST",
  })
}

export function fetchRun(runId: string) {
  return requestJson<TodayPayload["current_run"]>(`/api/runs/${encodeURIComponent(runId)}`)
}

export function fetchLeads(status: string, page = 1, limit = 20) {
  const params = new URLSearchParams({ status, page: String(page), limit: String(limit) })
  return requestJson<LeadsPayload>(`/api/leads?${params.toString()}`)
}

export function fetchProspects(status: string, category: string, q = "", page = 1, limit = 20) {
  const params = new URLSearchParams({
    status,
    category,
    q,
    page: String(page),
    limit: String(limit),
  })
  return requestJson<ProspectsPayload>(`/api/prospects?${params.toString()}`)
}

export function fetchLeadDetail(leadId: string) {
  return requestJson<LeadDetailResponse>(`/api/leads/${encodeURIComponent(leadId)}`)
}

export function fetchProspectDetail(prospectId: string) {
  return requestJson<ProspectDetailResponse>(`/api/prospects/${encodeURIComponent(prospectId)}`)
}

export function sendLeadNow(leadId: string) {
  return requestJson<{ success: boolean; recipient: string; sentAt: string }>(
    `/api/leads/${encodeURIComponent(leadId)}/send`,
    { method: "POST" },
  )
}

export function sendProspectNow(prospectId: string) {
  return requestJson<{ success: boolean; recipient: string; sentAt: string }>(
    `/api/prospects/${encodeURIComponent(prospectId)}/send`,
    { method: "POST" },
  )
}

export function markProspectReply(prospectId: string, tone: "neutral" | "positive" = "neutral") {
  return requestJson(`/api/prospects/${encodeURIComponent(prospectId)}/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tone }),
  })
}

export function markProspectBounced(prospectId: string) {
  return requestJson(`/api/prospects/${encodeURIComponent(prospectId)}/bounce`, {
    method: "POST",
  })
}

export function enrichLeadNow(leadId: string) {
  return requestJson<{ run_id: string; lead_id: string; status: string }>(
    `/api/leads/${encodeURIComponent(leadId)}/enrich`,
    { method: "POST" },
  )
}

export function sendAllReady() {
  return requestJson<{ attempted: number; succeeded: number; failed: number; remaining: number }>(
    "/api/leads/send-ready",
    { method: "POST" },
  )
}

export function archiveLead(leadId: string) {
  return requestJson<{ success: boolean }>(`/api/leads/${encodeURIComponent(leadId)}/archive`, {
    method: "POST",
  })
}

export function markLeadEmailRequired(leadId: string) {
  return requestJson<{ success: boolean; status: string }>(`/api/leads/${encodeURIComponent(leadId)}/email-required`, {
    method: "POST",
  })
}

export function vouchLead(leadId: string) {
  return requestJson<{ success: boolean }>(`/api/leads/${encodeURIComponent(leadId)}/vouch`, {
    method: "POST",
  })
}

export function markOutcome(leadId: string, body: Record<string, unknown>) {
  return requestJson<{ success: boolean; outcome: string }>(`/api/leads/${encodeURIComponent(leadId)}/outcome`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

export function switchToFallback(leadId: string) {
  return requestJson<{ success: boolean; active_email_role: "primary" | "fallback" }>(
    `/api/leads/${encodeURIComponent(leadId)}/switch-fallback`,
    { method: "POST" },
  )
}

export function selectLeadEmail(leadId: string, candidateId: string) {
  return requestJson<{ success: boolean; email: string; fallback_email?: string | null; status: string }>(
    `/api/leads/${encodeURIComponent(leadId)}/select-email`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ candidate_id: candidateId }),
    },
  )
}

export function addManualLeadEmail(leadId: string, payload: { email: string; note?: string }) {
  return requestJson<{ success: boolean; email: string; fallback_email?: string | null; status: string }>(
    `/api/leads/${encodeURIComponent(leadId)}/manual-email`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  )
}

export function refreshDraft(leadId: string) {
  return requestJson<{ subject: string; body: string; cta_type: string }>(
    `/api/leads/${encodeURIComponent(leadId)}/draft/refresh`,
    { method: "POST" },
  )
}

export function updateDraft(leadId: string, draft: { subject: string; body: string; cta_type?: string }) {
  return requestJson(`/api/leads/${encodeURIComponent(leadId)}/draft`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(draft),
  })
}

export function importProspectsCsv(payload: { filename: string; category: string; rows: Array<Record<string, string>> }) {
  return requestJson<{
    batch_id: string
    filename: string
    category: string
    imported: number
    skipped: number
    skipped_by_reason?: {
      missing_valid_email?: number
      duplicate_in_file?: number
    }
  }>(
    "/api/prospects/import",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  )
}

export function updateProspectDraft(prospectId: string, draft: { subject: string; body: string }) {
  return requestJson(`/api/prospects/${encodeURIComponent(prospectId)}/draft`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(draft),
  })
}

export function updateProspectNotes(prospectId: string, notes: string) {
  return requestJson(`/api/prospects/${encodeURIComponent(prospectId)}/notes`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ notes }),
  })
}

export function updateProspectStatus(prospectId: string, status: string) {
  return requestJson(`/api/prospects/${encodeURIComponent(prospectId)}/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  })
}

export function optOutProspect(prospectId: string) {
  return requestJson(`/api/prospects/${encodeURIComponent(prospectId)}/opt-out`, {
    method: "POST",
  })
}

export function suppressProspect(prospectId: string, payload: { scope_type: "email" | "domain" | "company"; reason?: string }) {
  return requestJson(`/api/prospects/${encodeURIComponent(prospectId)}/suppress`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
}

export function removeProspectSuppressionRequest(suppressionId: string) {
  return requestJson(`/api/outreach/suppressions/${encodeURIComponent(suppressionId)}/remove`, {
    method: "POST",
  })
}

export function resolveOutreachReviewRequest(reviewId: string, payload: { action: string; prospect_id?: string | null }) {
  return requestJson(`/api/outreach/review/${encodeURIComponent(reviewId)}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
}

export function sendFollowUp(leadId: string, step: number) {
  return requestJson<{ success: boolean }>(`/api/leads/${encodeURIComponent(leadId)}/follow-ups/${step}/send`, {
    method: "POST",
  })
}

export function sendDueLeadFollowUps(limit = 20) {
  return requestJson<{
    checked?: number
    attempted?: number
    succeeded?: number
    failed?: number
    processed?: number
  }>("/api/leads/follow-ups/send-due", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ limit }),
  })
}

export function repairLeadFollowUps(lookbackDays = 60, limit = 500) {
  return requestJson<{
    scanned?: number
    repaired?: number
    created?: number
    upgraded_legacy?: number
  }>("/api/leads/follow-ups/repair", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lookback_days: lookbackDays, limit }),
  })
}

export function skipFollowUp(leadId: string, step: number) {
  return requestJson<{ success: boolean }>(`/api/leads/${encodeURIComponent(leadId)}/follow-ups/${step}/skip`, {
    method: "POST",
  })
}

export function logPhoneFollowUp(leadId: string, step: number, notes: string) {
  return requestJson<{ success: boolean }>(`/api/leads/${encodeURIComponent(leadId)}/follow-ups/${step}/log`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ notes }),
  })
}

export function fetchConfig() {
  return requestJson<ConfigPayload>("/api/config")
}

export function updateConfig(patch: Partial<ConfigPayload>) {
  return requestJson<ConfigPayload>("/api/config", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  })
}

export function fetchSystem() {
  return requestJson<SystemPayload>("/api/system")
}

export function syncOutreachRepliesNow() {
  return requestJson<{
    checked_at: string
    scanned_messages: number
    processed_messages: number
    prospect_replies: number
    lead_replies: number
    opt_outs: number
    positive_replies: number
    unmatched_messages: number
    bounces?: number
    review_items?: number
  }>("/api/outreach/sync-replies", {
    method: "POST",
  })
}

export function runProspectDailySendNow() {
  return requestJson<{
    started: boolean
    reason?: string
    summary?: {
      attempted_by_category: Record<string, number>
      sent_by_category: Record<string, number>
      skipped_by_category: Record<string, number>
      selected_count: number
      selected_initial_count?: number
      selected_follow_up_count?: number
    }
  }>("/api/prospects/run-daily-send", {
    method: "POST",
  })
}
