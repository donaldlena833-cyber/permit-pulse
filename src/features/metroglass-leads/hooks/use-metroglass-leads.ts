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
  fetchProspectDetail,
  fetchProspects,
  fetchRun,
  fetchSystem,
  fetchToday,
  importProspectsCsv,
  logPhoneFollowUp,
  markLeadEmailRequired,
  markOutcome,
  optOutProspect as optOutProspectRequest,
  refreshDraft,
  selectLeadEmail,
  sendAllReady,
  sendFollowUp,
  sendLeadNow,
  sendProspectNow,
  skipFollowUp,
  switchToFallback,
  triggerScan,
  updateConfig,
  updateDraft,
  updateProspectDraft,
  updateProspectNotes,
  updateProspectStatus,
  vouchLead,
} from "@/features/metroglass-leads/lib/remote"
import type {
  AppTab,
  ConfigPayload,
  HealthPayload,
  LeadDetailResponse,
  LeadRow,
  LeadsPayload,
  ProspectCategory,
  ProspectDetailResponse,
  ProspectsPayload,
  ProspectStatus,
  SystemPayload,
  TodayPayload,
} from "@/features/metroglass-leads/types/api"

export function useMetroglassLeads() {
  const [tab, setTab] = useState<AppTab>("today")
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [today, setToday] = useState<TodayPayload | null>(null)
  const [leads, setLeads] = useState<LeadsPayload["leads"]>([])
  const [prospects, setProspects] = useState<ProspectsPayload | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [selectedLead, setSelectedLead] = useState<LeadDetailResponse | null>(null)
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(null)
  const [selectedProspect, setSelectedProspect] = useState<ProspectDetailResponse | null>(null)
  const [leadFilter, setLeadFilter] = useState<string>("all")
  const [prospectStatusFilter, setProspectStatusFilter] = useState<"all" | ProspectStatus>("all")
  const [prospectCategoryFilter, setProspectCategoryFilter] = useState<"all" | ProspectCategory>("all")
  const [config, setConfig] = useState<ConfigPayload | null>(null)
  const [system, setSystem] = useState<SystemPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLeadId, setActionLeadId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)

  const refreshToday = useCallback(async (options?: { preserveRunId?: string | null }) => {
    const payload = await fetchToday()
    setToday((current) => {
      if (options?.preserveRunId && !payload.current_run && current?.current_run?.id === options.preserveRunId) {
        return {
          ...payload,
          current_run: current.current_run,
        }
      }
      return payload
    })
    if (payload.current_run?.id) {
      setRunId(payload.current_run.id)
    } else if (!options?.preserveRunId) {
      setRunId(null)
    }
    return payload
  }, [])

  const refreshLeads = useCallback(async () => {
    const payload = await fetchLeads(leadFilter, 1, 50)
    setLeads(payload.leads)
    return payload
  }, [leadFilter])

  const refreshProspects = useCallback(async () => {
    try {
      const payload = await fetchProspects(prospectStatusFilter, prospectCategoryFilter, 1, 50)
      setProspects(payload)
      return payload
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (message.includes("v2_prospects") || message.includes("v2_prospect")) {
        const fallback: ProspectsPayload = {
          prospects: [],
          page: 1,
          limit: 50,
          counts: {
            all: 0,
            new: 0,
            drafted: 0,
            sent: 0,
            replied: 0,
            opted_out: 0,
            archived: 0,
          },
          categories: {
            architect: 0,
            interior_designer: 0,
            gc: 0,
            property_manager: 0,
            project_manager: 0,
          },
          recent_imports: [],
          initial_queue: [],
          follow_up_queue: [],
          automation: {
            pilot_enabled: false,
            permit_auto_send_enabled: false,
            timezone: "America/New_York",
            initial_send_time: "11:00",
            follow_up_send_time: "23:30",
            initial_daily_per_category: 10,
            follow_up_daily_per_category: 10,
            follow_up_delay_days: 3,
            initial_sent_today: {
              architect: 0,
              interior_designer: 0,
              gc: 0,
              property_manager: 0,
              project_manager: 0,
            },
            follow_up_sent_today: {
              architect: 0,
              interior_designer: 0,
              gc: 0,
              property_manager: 0,
              project_manager: 0,
            },
            initial_queue_by_category: {
              architect: 0,
              interior_designer: 0,
              gc: 0,
              property_manager: 0,
              project_manager: 0,
            },
            follow_up_due_by_category: {
              architect: 0,
              interior_designer: 0,
              gc: 0,
              property_manager: 0,
              project_manager: 0,
            },
            opted_out_by_category: {
              architect: 0,
              interior_designer: 0,
              gc: 0,
              property_manager: 0,
              project_manager: 0,
            },
            initial_queue: [],
            follow_up_queue: [],
            recent_sends: [],
            exceptions: [],
          },
        }
        setProspects(fallback)
        return fallback
      }
      throw error
    }
  }, [prospectCategoryFilter, prospectStatusFilter])

  const refreshSelectedLead = useCallback(async (leadId?: string | null) => {
    const id = leadId ?? selectedLeadId
    if (!id) return null
    const detail = await fetchLeadDetail(id)
    setSelectedLead(detail)
    return detail
  }, [selectedLeadId])

  const refreshSelectedProspect = useCallback(async (prospectId?: string | null) => {
    const id = prospectId ?? selectedProspectId
    if (!id) return null
    const detail = await fetchProspectDetail(id)
    setSelectedProspect(detail)
    return detail
  }, [selectedProspectId])

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
        refreshProspects(),
        refreshConfig(),
        refreshSystem(),
      ])
    } finally {
      setLoading(false)
    }
  }, [refreshConfig, refreshLeads, refreshProspects, refreshSystem, refreshToday])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    void refreshLeads()
  }, [refreshLeads])

  useEffect(() => {
    void refreshProspects()
  }, [refreshProspects])

  useEffect(() => {
    if (!selectedLeadId) {
      setSelectedLead(null)
      return
    }
    void refreshSelectedLead(selectedLeadId)
  }, [refreshSelectedLead, selectedLeadId])

  useEffect(() => {
    if (!selectedProspectId) {
      setSelectedProspect(null)
      return
    }
    void refreshSelectedProspect(selectedProspectId)
  }, [refreshSelectedProspect, selectedProspectId])

  useEffect(() => {
    if (!runId) {
      return undefined
    }

    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const [run, todayPayload] = await Promise.all([
            fetchRun(runId),
            refreshToday({ preserveRunId: runId }),
          ])
          if (!run) {
            return
          }
          setToday((current) => {
            if (!current && !todayPayload) {
              return current
            }
            return {
              ...(todayPayload ?? current ?? {}),
              current_run: run,
            } as TodayPayload
          })
          if (run.status !== "running") {
            setRunId(null)
            await Promise.all([refreshToday(), refreshLeads(), refreshSystem()])
          }
        } catch (error) {
          console.error("Run polling failed", error)
        }
      })()
    }, 2000)

    return () => window.clearInterval(interval)
  }, [refreshLeads, refreshSystem, refreshToday, runId])

  const openLead = useCallback((lead: LeadRow) => {
    setSelectedProspectId(null)
    setSelectedLeadId(lead.id)
  }, [])

  const closeLead = useCallback(() => {
    setSelectedLeadId(null)
  }, [])

  const openProspect = useCallback((prospect: ProspectsPayload["prospects"][number]) => {
    setSelectedLeadId(null)
    setSelectedProspectId(prospect.id)
  }, [])

  const closeProspect = useCallback(() => {
    setSelectedProspectId(null)
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

  const runProspectAction = useCallback(async (prospectId: string | null, work: () => Promise<void>, successMessage: string) => {
    setActionLeadId(prospectId)
    try {
      await work()
      toast.success(successMessage)
      await Promise.all([refreshToday(), refreshProspects(), refreshSelectedProspect(prospectId), refreshSystem()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed")
    } finally {
      setActionLeadId(null)
    }
  }, [refreshProspects, refreshSelectedProspect, refreshSystem, refreshToday])

  const scan = useCallback(async () => {
    setActionLeadId("scan")
    try {
      const result = await triggerScan()
      if (result.run_id) {
        setRunId(result.run_id)
        setToday((current) => current ? {
          ...current,
          current_run: {
            id: result.run_id,
            status: "running",
            current_stage: "claim",
            started_at: new Date().toISOString(),
            mode: result.mode ?? "operator_scan",
            target_claim_count: result.target_claim_count ?? 0,
            backlog_pending_at_start: result.backlog_pending_at_start ?? current.automation_backlog_pending ?? 0,
            counters: {
              permits_found: 0,
              permits_skipped_low_relevance: 0,
              permits_deduplicated: 0,
              leads_created: 0,
              leads_enriched: 0,
              leads_ready: 0,
              leads_review: 0,
              drafts_generated: 0,
              sends_attempted: 0,
              sends_succeeded: 0,
              sends_failed: 0,
            },
            progress: {
              backlog_pending: result.backlog_pending_at_start ?? current.automation_backlog_pending ?? 0,
              claimed: 0,
              processed: 0,
              fresh_inserted: 0,
              remaining: result.target_claim_count ?? 0,
            },
          },
        } : current)
      }
      toast.success(result.active_run_reused ? "Active scan already in progress" : "Automation scan started")
      await refreshToday({ preserveRunId: result.run_id ?? null })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scan failed")
    } finally {
      setActionLeadId(null)
    }
  }, [refreshToday])

  const actions = useMemo(() => ({
    scan,
    sendAllReady: () => runAction(null, async () => { await sendAllReady() }, "Ready leads sent"),
    enrichLead: (leadId: string) => runAction(leadId, async () => { await enrichLeadNow(leadId) }, "Lead automation started"),
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
    importProspects: async (payload: { filename: string; category: ProspectCategory; rows: Array<Record<string, string>> }) => {
      setActionLeadId("prospects-import")
      try {
        const result = await importProspectsCsv(payload)
        toast.success(`Imported ${result.imported} prospects${result.skipped ? `, skipped ${result.skipped}` : ""}`)
        await Promise.all([refreshProspects(), refreshToday(), refreshSystem()])
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Import failed")
      } finally {
        setActionLeadId(null)
      }
    },
    sendProspect: (prospectId: string) => runProspectAction(prospectId, async () => {
      await sendProspectNow(prospectId)
    }, "Prospect email sent"),
    saveProspectDraft: (prospectId: string, draft: { subject: string; body: string }) => runProspectAction(prospectId, async () => {
      await updateProspectDraft(prospectId, draft)
    }, "Prospect draft saved"),
    saveProspectNotes: (prospectId: string, notes: string) => runProspectAction(prospectId, async () => {
      await updateProspectNotes(prospectId, notes)
    }, "Notes saved"),
    archiveProspect: (prospectId: string) => runProspectAction(prospectId, async () => {
      await updateProspectStatus(prospectId, "archived")
    }, "Prospect archived"),
    markProspectReplied: (prospectId: string) => runProspectAction(prospectId, async () => {
      await updateProspectStatus(prospectId, "replied")
    }, "Marked replied"),
    optOutProspect: (prospectId: string) => runProspectAction(prospectId, async () => {
      await optOutProspectRequest(prospectId)
    }, "Prospect opted out"),
    saveConfig: async (patch: Partial<ConfigPayload>) => {
      try {
        const nextConfig = await updateConfig(patch)
        setConfig(nextConfig)
        toast.success("Settings updated")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Settings update failed")
      }
    },
  }), [refreshProspects, refreshSystem, refreshToday, runAction, runProspectAction, scan])

  return {
    tab,
    setTab,
    health,
    today,
    leads,
    prospects,
    selectedLeadId,
    selectedLead,
    selectedProspectId,
    selectedProspect,
    openLead,
    closeLead,
    openProspect,
    closeProspect,
    leadFilter,
    setLeadFilter,
    prospectStatusFilter,
    setProspectStatusFilter,
    prospectCategoryFilter,
    setProspectCategoryFilter,
    config,
    system,
    loading,
    actionLeadId,
    actions,
  }
}
