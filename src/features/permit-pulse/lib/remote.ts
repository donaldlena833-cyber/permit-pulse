import type {
  AutomationHealth,
  AutomationJob,
  EnrichmentData,
  LeadStatus,
  PermitLead,
  SentLogEntry,
} from "@/types/permit-pulse"
import { getAccessToken } from "@/features/auth/lib/session"

interface AutomationSnapshot {
  leads: PermitLead[]
  sentLog: SentLogEntry[]
  jobs: AutomationJob[]
}

function isAutomationSnapshot(value: unknown): value is AutomationSnapshot {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<AutomationSnapshot>
  return Array.isArray(candidate.leads) && Array.isArray(candidate.sentLog) && Array.isArray(candidate.jobs)
}

function getApiBase(): string {
  return __PERMIT_PULSE_WORKER_URL__.replace(/\/$/, "")
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = getAccessToken()
  const response = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  let payload: unknown = null

  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Worker API returned ${response.status}`
    throw new Error(message)
  }

  return payload as T
}

export async function fetchAutomationSnapshot(): Promise<AutomationSnapshot | null> {
  if (!__PERMIT_PULSE_WORKER_URL__) {
    return null
  }

  try {
    const snapshot = await requestJson<unknown>("/api/v2/state")
    return isAutomationSnapshot(snapshot) ? snapshot : null
  } catch {
    return null
  }
}

export async function fetchAutomationHealth(): Promise<AutomationHealth | null> {
  if (!__PERMIT_PULSE_WORKER_URL__) {
    return null
  }

  try {
    return await requestJson<AutomationHealth>("/api/v2/health")
  } catch {
    return null
  }
}

export async function triggerAutomationRun(): Promise<void> {
  await requestJson("/api/v2/run", {
    method: "POST",
  })
}

export async function retryAutomationJob(jobId: string): Promise<AutomationSnapshot> {
  return requestJson<AutomationSnapshot>(`/api/v2/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
  })
}

export async function runLeadEnrichment(leadId: string): Promise<AutomationSnapshot> {
  return requestJson<AutomationSnapshot>(`/api/v2/leads/${encodeURIComponent(leadId)}/enrich`, {
    method: "POST",
  })
}

export async function persistLeadStatus(leadId: string, status: LeadStatus): Promise<AutomationSnapshot> {
  return requestJson<AutomationSnapshot>(`/api/v2/leads/${encodeURIComponent(leadId)}/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  })
}

export async function persistLeadEnrichment(
  leadId: string,
  enrichment: Partial<EnrichmentData>,
): Promise<AutomationSnapshot> {
  return requestJson<AutomationSnapshot>(`/api/v2/leads/${encodeURIComponent(leadId)}/enrichment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(enrichment),
  })
}

export async function persistLeadDraft(
  leadId: string,
  patch: {
    recipient?: string
    recipientType?: string
    subject?: string
    introLine?: string
    body?: string
    pluginLine?: string
    callOpener?: string
    followUpNote?: string
  },
): Promise<AutomationSnapshot> {
  return requestJson<AutomationSnapshot>(`/api/v2/leads/${encodeURIComponent(leadId)}/draft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  })
}

export async function refreshLeadDraft(leadId: string): Promise<AutomationSnapshot> {
  return requestJson<AutomationSnapshot>(`/api/v2/leads/${encodeURIComponent(leadId)}/draft/refresh`, {
    method: "POST",
  })
}

export async function selectResolverCandidate(leadId: string, candidateId: string): Promise<AutomationSnapshot> {
  return requestJson<AutomationSnapshot>(
    `/api/v2/leads/${encodeURIComponent(leadId)}/candidates/${encodeURIComponent(candidateId)}/select`,
    {
      method: "POST",
    },
  )
}

export async function rejectResolverCandidate(leadId: string, candidateId: string): Promise<AutomationSnapshot> {
  return requestJson<AutomationSnapshot>(
    `/api/v2/leads/${encodeURIComponent(leadId)}/candidates/${encodeURIComponent(candidateId)}/reject`,
    {
      method: "POST",
    },
  )
}

export async function setPrimaryLeadContact(leadId: string, contactId: string): Promise<AutomationSnapshot> {
  return requestJson<AutomationSnapshot>(
    `/api/v2/leads/${encodeURIComponent(leadId)}/contacts/${encodeURIComponent(contactId)}/primary`,
    {
      method: "POST",
    },
  )
}

export async function sendLeadImmediately(
  leadId: string,
): Promise<{ success: boolean; recipient?: string; sentAt?: string }> {
  return requestJson<{ success: boolean; recipient?: string; sentAt?: string }>(
    `/api/v2/leads/${encodeURIComponent(leadId)}/send`,
    {
    method: "POST",
    },
  )
}
