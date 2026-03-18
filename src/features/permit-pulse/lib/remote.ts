import type { EnrichmentData, LeadStatus, PermitLead, SentLogEntry } from "@/types/permit-pulse"

interface AutomationSnapshot {
  leads: PermitLead[]
  sentLog: SentLogEntry[]
}

function getApiBase(): string {
  return __PERMIT_PULSE_WORKER_URL__.replace(/\/$/, "")
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, init)
  if (!response.ok) {
    throw new Error(`Worker API returned ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function fetchAutomationSnapshot(): Promise<AutomationSnapshot | null> {
  if (!__PERMIT_PULSE_WORKER_URL__) {
    return null
  }

  try {
    return await requestJson<AutomationSnapshot>("/api/v2/state")
  } catch {
    return null
  }
}

export async function triggerAutomationRun(): Promise<void> {
  await requestJson("/api/v2/run", {
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

export async function sendLeadImmediately(leadId: string): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>(`/api/v2/leads/${encodeURIComponent(leadId)}/send`, {
    method: "POST",
  })
}
