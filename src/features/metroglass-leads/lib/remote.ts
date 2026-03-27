import { getAccessToken } from "@/features/auth/lib/session"
import type {
  ConfigPayload,
  HealthPayload,
  LeadDetailResponse,
  LeadsPayload,
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
  return requestJson<{ started: boolean; run_id?: string | null }>("/api/scan", {
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

export function fetchLeadDetail(leadId: string) {
  return requestJson<LeadDetailResponse>(`/api/leads/${encodeURIComponent(leadId)}`)
}

export function sendLeadNow(leadId: string) {
  return requestJson<{ success: boolean; recipient: string; sentAt: string }>(
    `/api/leads/${encodeURIComponent(leadId)}/send`,
    { method: "POST" },
  )
}

export function enrichLeadNow(leadId: string) {
  return requestJson<{ run_id: string; lead_id: string; status: string }>(
    `/api/leads/${encodeURIComponent(leadId)}/enrich`,
    { method: "POST" },
  )
}

export function enrichLeadBatch(leadIds: string[]) {
  return requestJson<{ started: boolean; accepted: number }>("/api/leads/enrich-batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lead_ids: leadIds }),
  })
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

export function updateLeadNotes(leadId: string, operator_notes: string) {
  return requestJson<{ id: string; operator_notes: string | null; updated_at: string }>(
    `/api/leads/${encodeURIComponent(leadId)}/notes`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operator_notes }),
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

export function sendFollowUp(leadId: string, step: number) {
  return requestJson<{ success: boolean }>(`/api/leads/${encodeURIComponent(leadId)}/follow-ups/${step}/send`, {
    method: "POST",
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
