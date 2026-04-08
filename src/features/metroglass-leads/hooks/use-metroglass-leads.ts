import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import {
  addManualLeadEmail,
  archiveLead,
  createWorkspaceUser,
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
  markProspectBounced as markProspectBouncedRequest,
  markProspectReply as markProspectReplyRequest,
  markLeadEmailRequired,
  markOutcome,
  optOutProspect as optOutProspectRequest,
  refreshDraft,
  repairLeadFollowUps,
  removeProspectSuppressionRequest,
  resolveOutreachReviewRequest,
  selectLeadEmail,
  sendAllReady,
  sendDueLeadFollowUps,
  sendFollowUp,
  sendLeadNow,
  sendProspectNow,
  skipFollowUp,
  syncOutreachRepliesNow,
  switchToFallback,
  suppressProspect,
  triggerScan,
  updateConfig,
  updateDraft,
  updateProspectDraft,
  updateProspectNotes,
  updateProspectStatus,
  updateWorkspaceAccount,
  uploadWorkspaceAttachment,
  vouchLead,
  runProspectDailySendNow,
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

function scopeTypeLabel(scopeType: "email" | "domain" | "company") {
  if (scopeType === "email") return "Email"
  if (scopeType === "domain") return "Domain"
  return "Company"
}

function sumCounts(values?: Record<string, number>) {
  return Object.values(values ?? {}).reduce((total, value) => total + Number(value || 0), 0)
}

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
  const [prospectQuery, setProspectQuery] = useState("")
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
      const payload = await fetchProspects(prospectStatusFilter, prospectCategoryFilter, prospectQuery, 1, 100)
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
            follow_up_offsets_days: [3, 14],
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
            sent_today_by_category: {
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
            positive_replies_by_category: {
              architect: 0,
              interior_designer: 0,
              gc: 0,
              property_manager: 0,
              project_manager: 0,
            },
            suppressed_by_category: {
              architect: 0,
              interior_designer: 0,
              gc: 0,
              property_manager: 0,
              project_manager: 0,
            },
            metrics: {
              contacts_total: 0,
              sent_total: 0,
              delivered_total: 0,
              replied_total: 0,
              positive_replies_total: 0,
              opted_out_total: 0,
              bounced_total: 0,
              suppressed_total: 0,
            },
            campaigns: [],
            campaign_batches: [],
            suppressed_contacts: [],
            reply_sync: null,
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
  }, [prospectCategoryFilter, prospectQuery, prospectStatusFilter])

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

  const runGlobalAction = useCallback(async (actionId: string, work: () => Promise<void>, successMessage: string) => {
    setActionLeadId(actionId)
    try {
      await work()
      toast.success(successMessage)
      await Promise.all([
        refreshToday(),
        refreshLeads(),
        refreshProspects(),
        refreshSelectedLead(selectedLeadId),
        refreshSelectedProspect(selectedProspectId),
        refreshSystem(),
      ])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed")
    } finally {
      setActionLeadId(null)
    }
  }, [refreshLeads, refreshProspects, refreshSelectedLead, refreshSelectedProspect, refreshSystem, refreshToday, selectedLeadId, selectedProspectId])

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
    sendAllReady: async () => {
      setActionLeadId("send-ready")
      try {
        const result = await sendAllReady()
        if (result.succeeded > 0) {
          toast.success(`Sent ${result.succeeded} ready permit${result.succeeded === 1 ? "" : "s"}${result.failed ? ` (${result.failed} failed)` : ""}`)
        } else if (result.failed > 0) {
          throw new Error(`Ready permit batch failed for ${result.failed} lead${result.failed === 1 ? "" : "s"}`)
        } else {
          toast("No ready permits to send right now")
        }
        await Promise.all([
          refreshToday(),
          refreshLeads(),
          refreshProspects(),
          refreshSelectedLead(selectedLeadId),
          refreshSelectedProspect(selectedProspectId),
          refreshSystem(),
        ])
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Action failed")
      } finally {
        setActionLeadId(null)
      }
    },
    sendDueFollowUps: (limit = 20) => runGlobalAction("send-due-follow-ups", async () => {
      await sendDueLeadFollowUps(limit)
    }, `Sent up to ${limit} due permit follow-ups`),
    repairFollowUps: () => runGlobalAction("repair-follow-ups", async () => {
      await repairLeadFollowUps()
    }, "Permit follow-up queue repaired"),
    syncReplies: () => runGlobalAction("sync-replies", async () => {
      await syncOutreachRepliesNow()
    }, "Reply sync complete"),
    runProspectBatch: async () => {
      setActionLeadId("run-prospect-batch")
      try {
        const result = await runProspectDailySendNow()
        if (!result.started) {
          throw new Error(
            result.reason === "prospect_pilot_disabled"
              ? "Prospect pilot is disabled in settings"
              : result.reason === "slot_already_processed"
                ? "This outreach slot already ran"
                : "Outreach batch did not start",
          )
        }
        const selectedCount = Number(result.summary?.selected_count || 0)
        const sentCount = sumCounts(result.summary?.sent_by_category)
        const skippedCount = sumCounts(result.summary?.skipped_by_category)
        if (sentCount > 0) {
          toast.success(`Outreach batch sent ${sentCount} contact${sentCount === 1 ? "" : "s"}${skippedCount ? ` (${skippedCount} skipped)` : ""}`)
        } else if (selectedCount > 0) {
          throw new Error(`Outreach batch attempted ${selectedCount} contact${selectedCount === 1 ? "" : "s"} but sent none`)
        } else {
          toast("No eligible prospects to send right now")
        }
        await Promise.all([
          refreshToday(),
          refreshLeads(),
          refreshProspects(),
          refreshSelectedLead(selectedLeadId),
          refreshSelectedProspect(selectedProspectId),
          refreshSystem(),
        ])
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Action failed")
      } finally {
        setActionLeadId(null)
      }
    },
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
        const reasons = result.skipped_by_reason || {}
        const details = [
          reasons.missing_valid_email ? `${reasons.missing_valid_email} missing valid email` : null,
          reasons.duplicate_in_file ? `${reasons.duplicate_in_file} duplicate email in file` : null,
          reasons.already_in_database ? `${reasons.already_in_database} already in database` : null,
        ].filter(Boolean)
        toast.success(
          `Imported ${result.imported} prospects${result.skipped ? `, skipped ${result.skipped}${details.length ? ` (${details.join(", ")})` : ""}` : ""}`,
        )
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
    markProspectReply: (prospectId: string, tone: "neutral" | "positive" = "neutral") => runProspectAction(prospectId, async () => {
      await markProspectReplyRequest(prospectId, tone)
    }, "Reply recorded"),
    markProspectBounced: (prospectId: string) => runProspectAction(prospectId, async () => {
      await markProspectBouncedRequest(prospectId)
    }, "Bounce recorded"),
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
      await markProspectReplyRequest(prospectId, "neutral")
    }, "Marked replied"),
    optOutProspect: (prospectId: string) => runProspectAction(prospectId, async () => {
      await optOutProspectRequest(prospectId)
    }, "Prospect opted out"),
    suppressProspect: (prospectId: string, scopeType: "email" | "domain" | "company", reason?: string) => runProspectAction(prospectId, async () => {
      await suppressProspect(prospectId, { scope_type: scopeType, reason })
    }, `${scopeTypeLabel(scopeType)} suppressed`),
    removeProspectSuppression: (suppressionId: string, prospectId: string | null = null) => runProspectAction(prospectId, async () => {
      await removeProspectSuppressionRequest(suppressionId)
    }, "Suppression removed"),
    resolveProspectReview: (reviewId: string, prospectId: string, action: string) => runProspectAction(prospectId, async () => {
      await resolveOutreachReviewRequest(reviewId, { action, prospect_id: prospectId })
    }, "Review resolved"),
    saveConfig: async (patch: Partial<ConfigPayload>) => {
      try {
        const nextConfig = await updateConfig(patch)
        setConfig(nextConfig)
        toast.success("Settings updated")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Settings update failed")
      }
    },
    saveWorkspaceProfile: async (payload: {
      name?: string
      business_name?: string
      website?: string | null
      sender_name?: string | null
      sender_email?: string | null
      billing_email?: string | null
      phone?: string | null
      outreach_pitch?: string | null
      outreach_focus?: string | null
      outreach_cta?: string | null
      first_campaign_ready?: boolean
    }) => {
      try {
        await updateWorkspaceAccount(payload)
        await refreshSystem()
        toast.success("Workspace profile updated")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Workspace update failed")
        throw error
      }
    },
    uploadWorkspaceAttachment: async (payload: {
      filename: string
      content_type: string
      content_base64: string
      make_default?: boolean
      archive_previous_default?: boolean
    }) => {
      try {
        await uploadWorkspaceAttachment(payload)
        await Promise.all([refreshSystem(), fetchHealth().then(setHealth)])
        toast.success("Workspace attachment updated")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Attachment upload failed")
        throw error
      }
    },
    createWorkspaceUser: async (payload: {
      email: string
      password: string
      full_name?: string
      role?: "owner" | "admin" | "member"
    }) => {
      try {
        await createWorkspaceUser(payload)
        await refreshSystem()
        toast.success("Workspace user created")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "User creation failed")
        throw error
      }
    },
  }), [refreshLeads, refreshProspects, refreshSelectedLead, refreshSelectedProspect, refreshSystem, refreshToday, runAction, runGlobalAction, runProspectAction, scan, selectedLeadId, selectedProspectId])

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
    prospectQuery,
    setProspectQuery,
    config,
    system,
    loading,
    actionLeadId,
    actions,
    refreshAll,
  }
}
