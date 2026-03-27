import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import {
  addManualLeadEmail,
  archiveLead,
  enrichLeadNow,
  fetchConfig,
  fetchHealth,
  fetchLeadDetail,
  fetchLeads,
  fetchRun,
  fetchSystem,
  fetchToday,
  logPhoneFollowUp,
  markLeadEmailRequired,
  markOutcome,
  refreshDraft,
  selectLeadEmail,
  sendAllReady,
  sendFollowUp,
  sendLeadNow,
  skipFollowUp,
  switchToFallback,
  triggerScan,
  updateConfig,
  updateDraft,
  updateLeadNotes,
  vouchLead,
} from "@/features/metroglass-leads/lib/remote"
import type {
  AppTab,
  ConfigPayload,
  HealthPayload,
  LeadDetailResponse,
  LeadRow,
  LeadsPayload,
  SystemPayload,
  TodayPayload,
} from "@/features/metroglass-leads/types/api"

export function useMetroglassLeads() {
  const [tab, setTab] = useState<AppTab>("today")
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [today, setToday] = useState<TodayPayload | null>(null)
  const [leads, setLeads] = useState<LeadsPayload["leads"]>([])
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [selectedLead, setSelectedLead] = useState<LeadDetailResponse | null>(null)
  const [leadFilter, setLeadFilter] = useState<string>("all")
  const [config, setConfig] = useState<ConfigPayload | null>(null)
  const [system, setSystem] = useState<SystemPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLeadId, setActionLeadId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)

  const refreshToday = useCallback(async () => {
    const payload = await fetchToday()
    setToday(payload)
    if (payload.current_run?.id) {
      setRunId(payload.current_run.id)
    } else {
      setRunId(null)
    }
    return payload
  }, [])

  const refreshLeads = useCallback(async () => {
    const payload = await fetchLeads(leadFilter, 1, 50)
    setLeads(payload.leads)
    return payload
  }, [leadFilter])

  const refreshSelectedLead = useCallback(async (leadId?: string | null) => {
    const id = leadId ?? selectedLeadId
    if (!id) return null
    const detail = await fetchLeadDetail(id)
    setSelectedLead(detail)
    return detail
  }, [selectedLeadId])

  const refreshConfig = useCallback(async () => {
    const payload = await fetchConfig()
    setConfig(payload)
    return payload
  }, [])

  const refreshSystem = useCallback(async () => {
    const payload = await fetchSystem()
    setSystem(payload)
    return payload
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([
        fetchHealth().then(setHealth),
        refreshToday(),
        refreshLeads(),
        refreshConfig(),
        refreshSystem(),
      ])
    } finally {
      setLoading(false)
    }
  }, [refreshConfig, refreshLeads, refreshSystem, refreshToday])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    void refreshLeads()
  }, [refreshLeads])

  useEffect(() => {
    if (!selectedLeadId) {
      setSelectedLead(null)
      return
    }
    void refreshSelectedLead(selectedLeadId)
  }, [refreshSelectedLead, selectedLeadId])

  useEffect(() => {
    if (!runId) {
      return undefined
    }

    const interval = window.setInterval(() => {
      void (async () => {
        const run = await fetchRun(runId)
        if (!run) {
          return
        }
        setToday((current) => current ? { ...current, current_run: run } : current)
        if (run.status !== "running") {
          setRunId(null)
          await Promise.all([refreshToday(), refreshLeads(), refreshSystem()])
        }
      })()
    }, 2000)

    return () => window.clearInterval(interval)
  }, [refreshLeads, refreshSystem, refreshToday, runId])

  const openLead = useCallback((lead: LeadRow) => {
    setSelectedLeadId(lead.id)
  }, [])

  const closeLead = useCallback(() => {
    setSelectedLeadId(null)
  }, [])

  const runAction = useCallback(async (leadId: string | null, work: () => Promise<void>, successMessage: string) => {
    setActionLeadId(leadId)
    try {
      await work()
      toast.success(successMessage)
      await Promise.all([refreshToday(), refreshLeads(), refreshSelectedLead(leadId), refreshSystem()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed")
    } finally {
      setActionLeadId(null)
    }
  }, [refreshLeads, refreshSelectedLead, refreshSystem, refreshToday])

  const scan = useCallback(async () => {
    setActionLeadId("scan")
    try {
      const result = await triggerScan()
      if (result.run_id) {
        setRunId(result.run_id)
      }
      toast.success("Scan started")
      await refreshToday()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scan failed")
    } finally {
      setActionLeadId(null)
    }
  }, [refreshToday])

  const actions = useMemo(() => ({
    scan,
    sendAllReady: () => runAction(null, async () => { await sendAllReady() }, "Ready leads sent"),
    enrichLead: (leadId: string) => runAction(leadId, async () => { await enrichLeadNow(leadId) }, "Lead enrichment started"),
    sendLead: (leadId: string) => runAction(leadId, async () => { await sendLeadNow(leadId) }, "Email sent"),
    archiveLead: (leadId: string) => runAction(leadId, async () => { await archiveLead(leadId) }, "Lead archived"),
    emailRequired: (leadId: string) => runAction(leadId, async () => { await markLeadEmailRequired(leadId) }, "Moved to Email Required"),
    vouchLead: (leadId: string) => runAction(leadId, async () => { await vouchLead(leadId) }, "Email vouched"),
    markBounced: (leadId: string) => runAction(leadId, async () => {
      await markOutcome(leadId, { outcome: "bounced", bounce_type: "hard" })
    }, "Bounce recorded"),
    markReplied: (leadId: string) => runAction(leadId, async () => {
      await markOutcome(leadId, { outcome: "replied" })
    }, "Reply recorded"),
    markWon: (leadId: string) => runAction(leadId, async () => {
      await markOutcome(leadId, { outcome: "won" })
    }, "Lead marked won"),
    markLost: (leadId: string) => runAction(leadId, async () => {
      await markOutcome(leadId, { outcome: "lost" })
    }, "Lead marked lost"),
    switchFallback: (leadId: string) => runAction(leadId, async () => {
      await switchToFallback(leadId)
    }, "Fallback activated"),
    chooseEmail: (leadId: string, candidateId: string) => runAction(leadId, async () => {
      await selectLeadEmail(leadId, candidateId)
    }, "Email route selected"),
    addManualEmail: (leadId: string, payload: { email: string; note?: string }) => runAction(leadId, async () => {
      await addManualLeadEmail(leadId, payload)
    }, "Manual email saved"),
    saveNotes: (leadId: string, operatorNotes: string) => runAction(leadId, async () => {
      await updateLeadNotes(leadId, operatorNotes)
    }, "Notes saved"),
    refreshDraft: (leadId: string) => runAction(leadId, async () => {
      await refreshDraft(leadId)
    }, "Draft refreshed"),
    saveDraft: (leadId: string, draft: { subject: string; body: string; cta_type?: string }) => runAction(leadId, async () => {
      await updateDraft(leadId, draft)
    }, "Draft saved"),
    sendFollowUp: (leadId: string, step: number) => runAction(leadId, async () => {
      await sendFollowUp(leadId, step)
    }, "Follow up sent"),
    skipFollowUp: (leadId: string, step: number) => runAction(leadId, async () => {
      await skipFollowUp(leadId, step)
    }, "Follow up skipped"),
    logPhoneFollowUp: (leadId: string, step: number, notes: string) => runAction(leadId, async () => {
      await logPhoneFollowUp(leadId, step, notes)
    }, "Phone note logged"),
    saveConfig: async (patch: Partial<ConfigPayload>) => {
      try {
        const nextConfig = await updateConfig(patch)
        setConfig(nextConfig)
        toast.success("Settings updated")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Settings update failed")
      }
    },
  }), [runAction, scan])

  return {
    tab,
    setTab,
    health,
    today,
    leads,
    selectedLeadId,
    selectedLead,
    openLead,
    closeLead,
    leadFilter,
    setLeadFilter,
    config,
    system,
    loading,
    actionLeadId,
    actions,
  }
}
