import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { DEFAULT_FILTERS, METROGLASSPRO_PROFILE } from "@/features/permit-pulse/data/profile"
import {
  fetchAutomationJobs,
  fetchAutomationHealth,
  fetchAutomationSnapshot,
  persistLeadDraft,
  persistLeadEnrichment,
  persistLeadStatus,
  rejectResolverCandidate,
  refreshLeadDraft,
  retryAutomationJob,
  runLeadEnrichment,
  sendLeadImmediately,
  selectResolverCandidate,
  startAutomationScan,
  setPrimaryLeadContact,
} from "@/features/permit-pulse/lib/remote"
import { loadStore, saveStore } from "@/features/permit-pulse/lib/storage"
import {
  buildLeadFromPermit,
  createActivity,
  generateDraftFromLead,
  refreshDerivedLead,
} from "@/features/permit-pulse/lib/scoring"
import {
  countForRule,
  ENRICHMENT_QUEUE_PRESETS,
  getDashboardStats,
  getFilteredLeads,
  getQueueLeads,
  getRecentActivities,
  OUTREACH_QUEUE_PRESETS,
  SYSTEM_SAVED_VIEWS,
  sortLeads,
} from "@/features/permit-pulse/lib/views"
import type {
  AutomationHealth,
  AutomationJob,
  AutomationRunSummary,
  AppTheme,
  EnrichmentData,
  LeadFilters,
  LeadStatus,
  MainSection,
  OutreachDraft,
  PermitLead,
  PermitPulseStore,
  PermitRecord,
  SavedView,
  SentLogEntry,
  TenantProfile,
} from "@/types/permit-pulse"

const API_BASE = "https://data.cityofnewyork.us/resource/rbx6-tga4.json"

function mapById(leads: PermitLead[]): Record<string, PermitLead> {
  return leads.reduce<Record<string, PermitLead>>((result, lead) => {
    result[lead.id] = lead
    return result
  }, {})
}

function buildSodaUrl(profile: TenantProfile, filters: LeadFilters): string {
  const dateFrom = new Date()
  dateFrom.setDate(dateFrom.getDate() - filters.daysBack)
  const dateString = `${dateFrom.toISOString().split("T")[0]}T00:00:00`

  const boroughFilter = [...profile.primaryBoroughs, ...profile.secondaryBoroughs]
    .map((borough) => `borough='${borough}'`)
    .join(" OR ")
  const workTypeFilter = profile.workTypes.map((workType) => `work_type='${workType}'`).join(" OR ")

  const where = [
    `issued_date>'${dateString}'`,
    `estimated_job_costs>'${filters.minCost}'`,
    `permit_status='Permit Issued'`,
    `filing_reason='Initial Permit'`,
    `(${boroughFilter})`,
    `(${workTypeFilter})`,
  ].join(" AND ")

  return `${API_BASE}?$where=${encodeURIComponent(where)}&$order=issued_date DESC&$limit=500`
}

type LeadUpdater = (lead: PermitLead) => PermitLead
type UpdateLeadOptions = { recompute?: boolean }

export function usePermitPulse() {
  const [store, setStore] = useState<PermitPulseStore>(() => loadStore(METROGLASSPRO_PROFILE))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remoteHydrating, setRemoteHydrating] = useState(true)
  const [automationHealth, setAutomationHealth] = useState<AutomationHealth | null>(null)
  const [automationJobs, setAutomationJobs] = useState<AutomationJob[]>([])
  const [latestRunSummary, setLatestRunSummary] = useState<AutomationRunSummary | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [enrichingLeadId, setEnrichingLeadId] = useState<string | null>(null)
  const [sendingLeadId, setSendingLeadId] = useState<string | null>(null)
  const initialScanRef = useRef(false)

  const profile = store.profile
  const usesBackendDecisionState = Boolean(automationHealth?.hasSupabase)
  const allLeads = useMemo(() => sortLeads(Object.values(store.leads), "priority"), [store.leads])
  const activeView = useMemo<SavedView>(
    () => SYSTEM_SAVED_VIEWS.find((view) => view.id === store.activeViewId) ?? SYSTEM_SAVED_VIEWS[0],
    [store.activeViewId],
  )
  const activeEnrichmentPreset = useMemo(
    () => ENRICHMENT_QUEUE_PRESETS.find((preset) => preset.id === store.enrichmentQueueId) ?? ENRICHMENT_QUEUE_PRESETS[0],
    [store.enrichmentQueueId],
  )
  const activeOutreachPreset = useMemo(
    () => OUTREACH_QUEUE_PRESETS.find((preset) => preset.id === store.outreachQueueId) ?? OUTREACH_QUEUE_PRESETS[0],
    [store.outreachQueueId],
  )

  const scannerLeads = useMemo(
    () => getFilteredLeads(allLeads, store.filters, activeView),
    [activeView, allLeads, store.filters],
  )
  const enrichmentLeads = useMemo(
    () => getQueueLeads(allLeads, activeEnrichmentPreset, "priority"),
    [activeEnrichmentPreset, allLeads],
  )
  const outreachLeads = useMemo(
    () => getQueueLeads(allLeads, activeOutreachPreset, "priority"),
    [activeOutreachPreset, allLeads],
  )

  const selectedLead =
    allLeads.find((lead) => lead.id === store.selectedLeadId) ??
    (store.opportunityLane === "research" ? enrichmentLeads[0] : undefined) ??
    (store.opportunityLane === "ready" ? outreachLeads[0] : undefined) ??
    scannerLeads[0] ??
    allLeads[0] ??
    null

  const dashboardStats = useMemo(() => getDashboardStats(allLeads), [allLeads])
  const dashboardActivities = useMemo(() => getRecentActivities(allLeads, 10), [allLeads])
  const topOpportunities = useMemo(() => sortLeads(allLeads.filter((lead) => !lead.workflow.ignored), "priority").slice(0, 6), [allLeads])
  const sentLog = useMemo<SentLogEntry[]>(
    () =>
      store.sentLog.length > 0
        ? store.sentLog
        : allLeads
            .flatMap((lead) =>
              lead.outreachHistory
                .filter((item) => item.status === "sent")
                .map((item) => ({
                  id: item.id,
                  leadId: lead.id,
                  channel: item.channel,
                  recipient: item.recipient,
                  subject: item.subject,
                  sentAt: item.sentAt,
                  status: item.status,
                })),
            )
            .sort((left, right) => new Date(right.sentAt ?? 0).getTime() - new Date(left.sentAt ?? 0).getTime()),
    [allLeads, store.sentLog],
  )

  const savedViews = useMemo(
    () =>
      SYSTEM_SAVED_VIEWS.map((view) => ({
        ...view,
        count: countForRule(allLeads, view.rule),
      })),
    [allLeads],
  )

  const enrichmentPresets = useMemo(
    () =>
      ENRICHMENT_QUEUE_PRESETS.map((preset) => ({
        ...preset,
        count: countForRule(allLeads, preset.rule),
      })),
    [allLeads],
  )

  const outreachPresets = useMemo(
    () =>
      OUTREACH_QUEUE_PRESETS.map((preset) => ({
        ...preset,
        count: countForRule(allLeads, preset.rule),
      })),
    [allLeads],
  )

  useEffect(() => {
    saveStore(store)
  }, [store])

  const applyRemoteSnapshot = useCallback((snapshot: { leads: PermitLead[]; sentLog: SentLogEntry[]; jobs: AutomationJob[]; latestRunSummary?: AutomationRunSummary | null }) => {
    const orderedLeads = sortLeads(snapshot.leads, "priority")
    const orderedJobs = [...snapshot.jobs].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )

    setAutomationJobs(orderedJobs)
    setLatestRunSummary(snapshot.latestRunSummary ?? null)

    setStore((currentStore) => ({
      ...currentStore,
      leads: mapById(orderedLeads),
      sentLog: snapshot.sentLog,
      lastScanAt: orderedLeads[0]?.lastScannedAt ?? currentStore.lastScanAt,
      selectedLeadId:
        currentStore.selectedLeadId && orderedLeads.some((lead) => lead.id === currentStore.selectedLeadId)
          ? currentStore.selectedLeadId
          : orderedLeads[0]?.id ?? null,
    }))
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const [health, snapshot] = await Promise.all([fetchAutomationHealth(), fetchAutomationSnapshot()])
      if (cancelled) {
        return
      }

      setAutomationHealth(health)
      if (snapshot) {
        applyRemoteSnapshot(snapshot)
      }
      setRemoteHydrating(false)
    })()

    return () => {
      cancelled = true
    }
  }, [applyRemoteSnapshot])

  useEffect(() => {
    if (!activeRunId) {
      return undefined
    }

    let cancelled = false

    const poll = async () => {
      try {
        const [snapshot, jobsPayload] = await Promise.all([
          fetchAutomationSnapshot(),
          fetchAutomationJobs(activeRunId),
        ])

        if (cancelled) {
          return
        }

        if (snapshot) {
          applyRemoteSnapshot({
            ...snapshot,
            latestRunSummary: jobsPayload.latestRunSummary ?? snapshot.latestRunSummary ?? null,
            jobs: jobsPayload.jobs.length > 0 ? jobsPayload.jobs : snapshot.jobs,
          })
        } else if (jobsPayload.jobs.length > 0) {
          setAutomationJobs(jobsPayload.jobs)
          setLatestRunSummary(jobsPayload.latestRunSummary ?? null)
        }

        const latestRun = jobsPayload.latestRunSummary
        if (!latestRun || (latestRun.status !== "running" && latestRun.status !== "queued" && latestRun.status !== "retrying")) {
          setActiveRunId(null)
          setLoading(false)
          if (latestRun) {
            toast.success("Scan run finished", {
              description:
                latestRun.sentCount > 0
                  ? `${latestRun.completedLeadCount} leads resolved and ${latestRun.sentCount} emails sent.`
                  : `${latestRun.completedLeadCount} leads resolved${latestRun.failedJobs > 0 ? `, ${latestRun.failedJobs} need review` : ""}.`,
            })
          }
          return
        }

        window.setTimeout(() => {
          void poll()
        }, 3500)
      } catch {
        if (!cancelled) {
          window.setTimeout(() => {
            void poll()
          }, 5000)
        }
      }
    }

    void poll()

    return () => {
      cancelled = true
    }
  }, [activeRunId, applyRemoteSnapshot])

  useEffect(() => {
    const isDark = store.theme === "dark"
    document.documentElement.classList.toggle("dark", isDark)
    document.documentElement.style.colorScheme = isDark ? "dark" : "light"
  }, [store.theme])

  const scanLeads = useCallback(async () => {
    setLoading(true)
    setError(null)
    let queuedRun = false

    try {
      const remoteSnapshot = await fetchAutomationSnapshot()
      if (remoteSnapshot) {
        const run = await startAutomationScan()
        queuedRun = true
        setActiveRunId(run.runId)

        const latestSnapshot = await fetchAutomationSnapshot()
        if (latestSnapshot) {
          applyRemoteSnapshot(latestSnapshot)
        }

        toast.success("Scan started", {
          description:
            run.queuedLeadCount > 0
              ? `${run.queuedLeadCount} leads queued from ${run.scannedCount} scanned permits. Background resolve and send jobs are running now.`
              : `${run.scannedCount} permits scanned, but nothing new matched the queue.`,
        })
        return
      }

      const response = await fetch(buildSodaUrl(profile, store.filters))

      if (!response.ok) {
        throw new Error(`DOB API returned ${response.status}`)
      }

      const data = (await response.json()) as PermitRecord[]
      const scannedAt = new Date().toISOString()

      setStore((currentStore) => {
        const nextLeads = { ...currentStore.leads }

        data.forEach((permit) => {
          const id =
            permit.job_filing_number || `${permit.block}-${permit.lot}-${permit.house_no}-${permit.street_name}`
          const existingLead = currentStore.leads[id]
          const nextLead = buildLeadFromPermit(permit, currentStore.profile, existingLead, scannedAt)

          if (nextLead.score > 0) {
            nextLeads[nextLead.id] = nextLead
          }
        })

        const orderedLeads = sortLeads(Object.values(nextLeads), "priority")

        return {
          ...currentStore,
          leads: mapById(orderedLeads),
          lastScanAt: scannedAt,
          selectedLeadId: currentStore.selectedLeadId ?? orderedLeads[0]?.id ?? null,
        }
      })

      toast.success("Scan complete", {
        description: `${data.length} permits checked against the MetroGlassPro profile.`,
      })
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to fetch permits"
      setError(message)
      toast.error("Scan failed", { description: message })
    } finally {
      if (!queuedRun) {
        setLoading(false)
      }
    }
  }, [applyRemoteSnapshot, profile, store.filters])

  useEffect(() => {
    if (remoteHydrating) {
      return
    }

    if (initialScanRef.current || allLeads.length > 0) {
      return
    }

    initialScanRef.current = true
    void scanLeads()
  }, [allLeads.length, remoteHydrating, scanLeads])

  useEffect(() => {
    if (selectedLead?.id === store.selectedLeadId || !selectedLead) {
      return
    }

    setStore((currentStore) => ({
      ...currentStore,
      selectedLeadId: selectedLead.id,
    }))
  }, [selectedLead, store.selectedLeadId])

  const updateLead = useCallback((leadId: string, updater: LeadUpdater, options: UpdateLeadOptions = {}) => {
    setStore((currentStore) => {
      const existingLead = currentStore.leads[leadId]
      if (!existingLead) {
        return currentStore
      }

      const nextLead = updater(existingLead)
      const updatedLead = options.recompute === false ? nextLead : refreshDerivedLead(nextLead, currentStore.profile)

      return {
        ...currentStore,
        leads: {
          ...currentStore.leads,
          [leadId]: updatedLead,
        },
      }
    })
  }, [])

  const setSection = useCallback((section: MainSection) => {
    setStore((currentStore) => ({
      ...currentStore,
      section,
    }))
  }, [])

  const setTheme = useCallback((theme: AppTheme) => {
    setStore((currentStore) => ({
      ...currentStore,
      theme,
    }))
  }, [])

  const toggleTheme = useCallback(() => {
    setStore((currentStore) => ({
      ...currentStore,
      theme: currentStore.theme === "dark" ? "light" : "dark",
    }))
  }, [])

  const setSelectedLeadId = useCallback((leadId: string) => {
    setStore((currentStore) => ({
      ...currentStore,
      selectedLeadId: leadId,
    }))
  }, [])

  const setFilters = useCallback((patch: Partial<LeadFilters>) => {
    setStore((currentStore) => ({
      ...currentStore,
      filters: {
        ...currentStore.filters,
        ...patch,
      },
    }))
  }, [])

  const resetFilters = useCallback(() => {
    setStore((currentStore) => ({
      ...currentStore,
      filters: DEFAULT_FILTERS,
      activeViewId: "hot-today",
    }))
  }, [])

  const setActiveViewId = useCallback((viewId: string) => {
    setStore((currentStore) => ({
      ...currentStore,
      activeViewId: viewId,
      section: "opportunities",
      opportunityLane: "feed",
    }))
  }, [])

  const setEnrichmentQueueId = useCallback((queueId: string) => {
    setStore((currentStore) => ({
      ...currentStore,
      enrichmentQueueId: queueId,
      section: "opportunities",
      opportunityLane: "research",
    }))
  }, [])

  const setOutreachQueueId = useCallback((queueId: string) => {
    setStore((currentStore) => ({
      ...currentStore,
      outreachQueueId: queueId,
      section: "opportunities",
      opportunityLane: "ready",
    }))
  }, [])

  const setOpportunityLane = useCallback((lane: "feed" | "research" | "ready" | "sent") => {
    setStore((currentStore) => ({
      ...currentStore,
      section: "opportunities",
      opportunityLane: lane,
    }))
  }, [])

  const updateLeadStatus = useCallback((leadId: string, status: LeadStatus) => {
    updateLead(leadId, (lead) => {
      const nextActivity = createActivity(
        "status-changed",
        "Pipeline status updated",
        `Lead moved to ${status}.`,
      )

      return {
        ...lead,
        workflow: {
          ...lead.workflow,
          status,
          lastReviewedAt: new Date().toISOString(),
        },
        activities: [nextActivity, ...lead.activities].slice(0, 40),
      }
    }, { recompute: !usesBackendDecisionState })
    void persistLeadStatus(leadId, status)
      .then(applyRemoteSnapshot)
      .catch(() => undefined)
  }, [applyRemoteSnapshot, updateLead, usesBackendDecisionState])

  const updateEnrichment = useCallback((leadId: string, patch: Partial<EnrichmentData>) => {
    const nextEnrichment = {
      ...store.leads[leadId]?.enrichment,
      ...patch,
    }

    updateLead(leadId, (lead) => {
      let activity = lead.activities
      const addedContact =
        (!lead.enrichment.directEmail && nextEnrichment.directEmail) ||
        (!lead.enrichment.genericEmail && nextEnrichment.genericEmail) ||
        (!lead.enrichment.phone && nextEnrichment.phone)

      if (addedContact) {
        activity = [
          createActivity("contact-found", "Contact route added", "A new phone or email path was saved."),
          ...lead.activities,
        ].slice(0, 40)
      } else if (patch.notes || patch.researchNotes) {
        activity = [
          createActivity("note-added", "Research note added", "Lead notes were updated."),
          ...lead.activities,
        ].slice(0, 40)
      }

      return {
        ...lead,
        enrichment: nextEnrichment,
        activities: activity,
      }
    }, { recompute: !usesBackendDecisionState })
    void persistLeadEnrichment(leadId, nextEnrichment)
      .then(applyRemoteSnapshot)
      .catch(() => undefined)
  }, [applyRemoteSnapshot, store.leads, updateLead, usesBackendDecisionState])

  const updateOutreachDraft = useCallback((leadId: string, patch: Partial<OutreachDraft>) => {
    const nextDraft = {
      ...store.leads[leadId]?.outreachDraft,
      ...patch,
      updatedAt: new Date().toISOString(),
    }

    updateLead(leadId, (lead) => {
      const draftWasEmpty = !lead.outreachDraft.shortEmail && !lead.outreachDraft.callOpener

      const nextActivities = draftWasEmpty
        ? [createActivity("draft-created", "Outreach draft created", "A working draft was added."), ...lead.activities].slice(0, 40)
        : lead.activities

      return {
        ...lead,
        outreachDraft: nextDraft,
        workflow: {
          ...lead.workflow,
          status: lead.workflow.status === "new" ? "drafted" : lead.workflow.status,
        },
        activities: nextActivities,
      }
    }, { recompute: !usesBackendDecisionState })
    void persistLeadDraft(leadId, {
      subject: nextDraft.subject,
      introLine: nextDraft.introLine,
      body: nextDraft.shortEmail,
      callOpener: nextDraft.callOpener,
      followUpNote: nextDraft.followUpNote,
    })
      .then(applyRemoteSnapshot)
      .catch(() => undefined)
  }, [applyRemoteSnapshot, store.leads, updateLead, usesBackendDecisionState])

  const generateDraft = useCallback((leadId: string) => {
    const lead = store.leads[leadId]
    if (!lead) {
      return
    }

    if (usesBackendDecisionState) {
      void refreshLeadDraft(leadId)
        .then(applyRemoteSnapshot)
        .then(() => {
          toast.success("Draft helper updated", {
            description: "The worker rebuilt the draft from the latest resolver data.",
          })
        })
        .catch((caughtError) => {
          const message = caughtError instanceof Error ? caughtError.message : "Draft refresh failed"
          toast.error("Draft refresh failed", {
            description: message,
          })
        })
      return
    }

    const draft = generateDraftFromLead(lead)
    updateOutreachDraft(leadId, draft)
    toast.success("Draft helper updated", {
      description: "Practical outreach copy has been drafted for this lead.",
    })
  }, [applyRemoteSnapshot, store.leads, updateOutreachDraft, usesBackendDecisionState])

  const setFollowUpDate = useCallback((leadId: string, followUpDate: string) => {
    const currentLead = store.leads[leadId]
    if (!currentLead) {
      return
    }

    const nextStatus =
      followUpDate
        ? "follow-up-due"
        : currentLead.workflow.status === "follow-up-due"
          ? "reviewed"
          : currentLead.workflow.status

    updateLead(leadId, (lead) => ({
      ...lead,
      enrichment: {
        ...lead.enrichment,
        followUpDate,
      },
      workflow: {
        ...lead.workflow,
        nextActionDue: followUpDate,
        status: nextStatus,
      },
      activities: [
        createActivity(
          "follow-up-set",
          "Follow-up scheduled",
          followUpDate ? `Next action set for ${followUpDate}.` : "Follow-up date cleared.",
        ),
        ...lead.activities,
      ].slice(0, 40),
    }), { recompute: !usesBackendDecisionState })

    void persistLeadEnrichment(leadId, { followUpDate })
      .then(() => persistLeadStatus(leadId, nextStatus))
      .then(applyRemoteSnapshot)
      .catch(() => undefined)
  }, [applyRemoteSnapshot, store.leads, updateLead, usesBackendDecisionState])

  const toggleIgnored = useCallback((leadId: string) => {
    const currentLead = store.leads[leadId]
    if (!currentLead) {
      return
    }

    const nextIgnored = !currentLead.workflow.ignored
    const nextStatus = nextIgnored ? "archived" : "reviewed"

    updateLead(leadId, (lead) => ({
      ...lead,
      workflow: {
        ...lead.workflow,
        ignored: nextIgnored,
        status: nextStatus,
      },
    }), { recompute: !usesBackendDecisionState })

    void persistLeadStatus(leadId, nextStatus)
      .then(applyRemoteSnapshot)
      .catch(() => undefined)
  }, [applyRemoteSnapshot, store.leads, updateLead, usesBackendDecisionState])

  const acceptResolverCandidate = useCallback(async (leadId: string, candidateId: string) => {
    try {
      const snapshot = await selectResolverCandidate(leadId, candidateId)
      applyRemoteSnapshot(snapshot)
      toast.success("Resolver choice accepted", {
        description: "The worker updated the chosen candidate and recalculated the route.",
      })
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Resolver update failed"
      toast.error("Resolver update failed", {
        description: message,
      })
    }
  }, [applyRemoteSnapshot])

  const rejectResolverCandidateAction = useCallback(async (leadId: string, candidateId: string) => {
    try {
      const snapshot = await rejectResolverCandidate(leadId, candidateId)
      applyRemoteSnapshot(snapshot)
      toast.success("Candidate rejected", {
        description: "That candidate has been pushed out of the trusted path.",
      })
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Candidate rejection failed"
      toast.error("Candidate rejection failed", {
        description: message,
      })
    }
  }, [applyRemoteSnapshot])

  const setPrimaryContactRoute = useCallback(async (leadId: string, contactId: string) => {
    try {
      const snapshot = await setPrimaryLeadContact(leadId, contactId)
      applyRemoteSnapshot(snapshot)
      toast.success("Primary route updated", {
        description: "This contact now drives the route decision and draft flow.",
      })
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Primary route update failed"
      toast.error("Primary route update failed", {
        description: message,
      })
    }
  }, [applyRemoteSnapshot])

  const refreshLeadAutomation = useCallback(async (leadId: string) => {
    if (!automationHealth?.hasSupabase) {
      toast.error("Automation setup incomplete", {
        description: "Supabase is not configured on the worker yet, so Brave, Maps, and Firecrawl enrichment cannot run.",
      })
      return
    }

    setEnrichingLeadId(leadId)

    try {
      const snapshot = await runLeadEnrichment(leadId)
      applyRemoteSnapshot(snapshot)
      toast.success("Enrichment refreshed", {
        description: "Property, company, website, and contact resolution ran for this lead.",
      })
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Lead enrichment failed"
      toast.error("Enrichment failed", {
        description: message,
      })
    } finally {
      setEnrichingLeadId(null)
    }
  }, [applyRemoteSnapshot, automationHealth])

  const sendLeadNow = useCallback(async (leadId: string) => {
    if (!automationHealth?.hasSupabase) {
      toast.error("Automation setup incomplete", {
        description: "Supabase is not configured on the worker yet, so send history cannot be synced.",
      })
      return
    }

    if (!automationHealth.hasGmail) {
      toast.error("Gmail send is not configured", {
        description: "Add the Gmail credentials on the worker before using direct send.",
      })
      return
    }

    setSendingLeadId(leadId)

    try {
      const result = await sendLeadImmediately(leadId)
      const snapshot = await fetchAutomationSnapshot()
      if (snapshot) {
        applyRemoteSnapshot(snapshot)
      }
      toast.success("Email sent", {
        description: result.recipient ? `Sent to ${result.recipient}.` : "The latest draft was sent.",
      })
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Direct send failed"
      toast.error("Send failed", {
        description: message,
      })
    } finally {
      setSendingLeadId(null)
    }
  }, [applyRemoteSnapshot, automationHealth])

  const retryJob = useCallback(async (jobId: string) => {
    try {
      const targetJob = automationJobs.find((job) => job.id === jobId) || null
      const snapshot = await retryAutomationJob(jobId)
      applyRemoteSnapshot(snapshot)
      if (targetJob?.runId) {
        setActiveRunId(targetJob.runId)
      }
      toast.success("Automation retried", {
        description: "That job was re-queued and the background worker is draining it now.",
      })
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Retry failed"
      toast.error("Retry failed", {
        description: message,
      })
    }
  }, [applyRemoteSnapshot, automationJobs])

  const updateProfile = useCallback((patch: Partial<TenantProfile>) => {
    setStore((currentStore) => ({
      ...currentStore,
      profile: {
        ...currentStore.profile,
        ...patch,
      },
      leads: mapById(Object.values(currentStore.leads).map((lead) => refreshDerivedLead(lead, {
        ...currentStore.profile,
        ...patch,
      }))),
    }))
  }, [])

  const resetProfile = useCallback(() => {
    setStore((currentStore) => ({
      ...currentStore,
      profile: METROGLASSPRO_PROFILE,
      leads: mapById(Object.values(currentStore.leads).map((lead) => refreshDerivedLead(lead, METROGLASSPRO_PROFILE))),
    }))
    toast.success("Profile reset", {
      description: "MetroGlassPro baseline scoring has been restored.",
    })
  }, [])

  return {
    theme: store.theme,
    section: store.section,
    opportunityLane: store.opportunityLane,
    filters: store.filters,
    profile,
    allLeads,
    scannerLeads,
    enrichmentLeads,
    outreachLeads,
    selectedLead,
    lastScanAt: store.lastScanAt,
    sentLog,
    automationJobs,
    latestRunSummary,
    loading,
    error,
    automationHealth,
    enrichingLeadId,
    sendingLeadId,
    dashboardStats,
    dashboardActivities,
    topOpportunities,
    savedViews,
    enrichmentPresets,
    outreachPresets,
    activeViewId: store.activeViewId,
    activeEnrichmentQueueId: store.enrichmentQueueId,
    activeOutreachQueueId: store.outreachQueueId,
    setTheme,
    toggleTheme,
    setSection,
    setSelectedLeadId,
    setFilters,
    resetFilters,
    setActiveViewId,
    setEnrichmentQueueId,
    setOutreachQueueId,
    setOpportunityLane,
    scanLeads,
    updateLeadStatus,
    updateEnrichment,
    updateOutreachDraft,
    generateDraft,
    setFollowUpDate,
    toggleIgnored,
    acceptResolverCandidate,
    rejectResolverCandidate: rejectResolverCandidateAction,
    setPrimaryContactRoute,
    refreshLeadAutomation,
    sendLeadNow,
    retryJob,
    updateProfile,
    resetProfile,
  }
}
