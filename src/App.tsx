import { Component, type ReactNode, useMemo, useState } from "react"
import { ArrowLeft, LoaderCircle, Target } from "lucide-react"
import { Toaster } from "sonner"

import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { LoginScreen } from "@/features/auth/components/login-screen"
import { useMetroglassAuth } from "@/features/auth/hooks/use-metroglass-auth"
import { DashboardView } from "@/features/permit-pulse/components/dashboard-view"
import { EmptyState } from "@/features/permit-pulse/components/empty-state"
import { AppShell } from "@/features/permit-pulse/components/layout"
import { LeadDetailPanel } from "@/features/permit-pulse/components/lead-detail-panel"
import { LeadList } from "@/features/permit-pulse/components/lead-list"
import { LoadingSkeleton } from "@/features/permit-pulse/components/loading-skeleton"
import { OpportunitiesView } from "@/features/permit-pulse/components/opportunities-view"
import { PipelineView } from "@/features/permit-pulse/components/pipeline-view"
import { SystemView } from "@/features/permit-pulse/components/system-view"
import { usePermitPulse } from "@/features/permit-pulse/hooks/use-permit-pulse"
import { getAttentionItems, getPipelineColumns, getSystemAlerts } from "@/features/permit-pulse/lib/operator"
import { isOutreachReady, needsEnrichment } from "@/features/permit-pulse/lib/views"
import type { LeadStatus, OpportunityLane, PermitLead } from "@/types/permit-pulse"

class AppErrorBoundary extends Component<{
  children: ReactNode
  onReset: () => void
}, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error("MetroGlass Leads render error", error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-[32px] border border-orange-200/70 bg-orange-50/80 p-8 shadow-sm dark:border-orange-800/40 dark:bg-orange-900/15">
          <div className="max-w-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-700 dark:text-orange-200">
              Workspace issue
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-navy-900 dark:text-dark-text">
              This screen hit a render problem.
            </h2>
            <p className="mt-3 text-sm leading-7 text-navy-600 dark:text-dark-muted">
              The shell is still alive, but one part of the interface failed to render cleanly. Reset back to the dashboard and hard refresh if the issue lingers.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button className="rounded-full bg-orange-500 text-white hover:bg-orange-600" onClick={this.props.onReset} type="button">
                Return to dashboard
              </Button>
              <Button
                className="rounded-full"
                onClick={() => window.location.reload()}
                type="button"
                variant="outline"
              >
                Reload app
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function useBulkSelection(leads: PermitLead[]) {
  const [rawSelectedIds, setRawSelectedIds] = useState<string[]>([])
  const selectedIds = useMemo(
    () => rawSelectedIds.filter((id) => leads.some((lead) => lead.id === id)),
    [leads, rawSelectedIds],
  )

  const toggleLead = (leadId: string) => {
    setRawSelectedIds((currentIds) =>
      currentIds.includes(leadId)
        ? currentIds.filter((id) => id !== leadId)
        : [...currentIds, leadId],
    )
  }

  const toggleAll = () => {
    setRawSelectedIds((currentIds) =>
      currentIds.length === leads.length ? [] : leads.map((lead) => lead.id),
    )
  }

  const clear = () => setRawSelectedIds([])

  return {
    selectedIds,
    toggleLead,
    toggleAll,
    clear,
  }
}

function WorkspacePane({
  title,
  description,
  leads,
  selectedLead,
  selectedIds,
  onSelectLead,
  onToggleLead,
  onToggleAll,
  onBulkSetStatus,
  onStatusChange,
  onEnrichmentChange,
  onDraftChange,
  onGenerateDraft,
  onRunEnrichment,
  onSendNow,
  onFollowUpDateChange,
  onToggleIgnored,
  onAcceptCandidate,
  onRejectCandidate,
  onSetPrimaryContact,
  automationHealth,
  enrichingLeadId,
  sendingLeadId,
  mobileDetailOpen,
  onMobileDetailOpen,
  onMobileDetailClose,
  emptyTitle,
  emptyDescription,
}: {
  title: string
  description: string
  leads: PermitLead[]
  selectedLead: PermitLead | null
  selectedIds: string[]
  onSelectLead: (leadId: string) => void
  onToggleLead: (leadId: string) => void
  onToggleAll: () => void
  onBulkSetStatus: (status: LeadStatus) => void
  onStatusChange: (leadId: string, status: LeadStatus) => void
  onEnrichmentChange: (leadId: string, patch: Partial<PermitLead["enrichment"]>) => void
  onDraftChange: (leadId: string, patch: Partial<PermitLead["outreachDraft"]>) => void
  onGenerateDraft: (leadId: string) => void
  onRunEnrichment: (leadId: string) => void
  onSendNow: (leadId: string) => void
  onFollowUpDateChange: (leadId: string, value: string) => void
  onToggleIgnored: (leadId: string) => void
  onAcceptCandidate: (leadId: string, candidateId: string) => void
  onRejectCandidate: (leadId: string, candidateId: string) => void
  onSetPrimaryContact: (leadId: string, contactId: string) => void
  automationHealth: ReturnType<typeof usePermitPulse>["automationHealth"]
  enrichingLeadId: string | null
  sendingLeadId: string | null
  mobileDetailOpen: boolean
  onMobileDetailOpen: () => void
  onMobileDetailClose: () => void
  emptyTitle: string
  emptyDescription: string
}) {
  const handleSelectLead = (leadId: string) => {
    onSelectLead(leadId)
    onMobileDetailOpen()
  }

  const mobileSelectedLead =
    mobileDetailOpen && selectedLead && leads.some((lead) => lead.id === selectedLead.id)
      ? selectedLead
      : null


  return (
    <>
      <div className="md:hidden">
        {mobileSelectedLead ? (
          <div className="space-y-3">
            <Button
              className="rounded-full border-navy-200 bg-white/90 px-4 text-navy-700 hover:bg-cream-100 dark:border-dark-border dark:bg-dark-card dark:text-dark-text"
              onClick={onMobileDetailClose}
              type="button"
              variant="outline"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to leads
            </Button>
            <div className="min-h-[calc(100vh-14rem)]">
              <LeadDetailPanel
                automationHealth={automationHealth}
                isEnriching={mobileSelectedLead ? enrichingLeadId === mobileSelectedLead.id : false}
                isSending={mobileSelectedLead ? sendingLeadId === mobileSelectedLead.id : false}
                lead={mobileSelectedLead}
                mobile
                onDraftChange={onDraftChange}
                onEnrichmentChange={onEnrichmentChange}
                onFollowUpDateChange={onFollowUpDateChange}
                onGenerateDraft={onGenerateDraft}
                onRunEnrichment={onRunEnrichment}
                onSendNow={onSendNow}
                onStatusChange={onStatusChange}
                onToggleIgnored={onToggleIgnored}
                onAcceptCandidate={onAcceptCandidate}
                onRejectCandidate={onRejectCandidate}
                onSetPrimaryContact={onSetPrimaryContact}
              />
            </div>
          </div>
        ) : (
          <LeadList
            description={description}
            emptyDescription={emptyDescription}
            emptyTitle={emptyTitle}
            leads={leads}
            mobile
            onBulkSetStatus={onBulkSetStatus}
            onSelectLead={handleSelectLead}
            onToggleAll={onToggleAll}
            onToggleLead={onToggleLead}
            selectedIds={selectedIds}
            selectedLeadId={selectedLead?.id ?? null}
            title={title}
          />
        )}
      </div>

      <div className="hidden md:block">
        <ResizablePanelGroup className="h-[calc(100vh-11.5rem)] min-h-[760px] rounded-[32px]" direction="horizontal">
          <ResizablePanel defaultSize={24} minSize={18}>
            <LeadList
              description={description}
              emptyDescription={emptyDescription}
              emptyTitle={emptyTitle}
              leads={leads}
              onBulkSetStatus={onBulkSetStatus}
              onSelectLead={onSelectLead}
              onToggleAll={onToggleAll}
              onToggleLead={onToggleLead}
              selectedIds={selectedIds}
              selectedLeadId={selectedLead?.id ?? null}
              title={title}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={76} minSize={50}>
            <LeadDetailPanel
              automationHealth={automationHealth}
              isEnriching={selectedLead ? enrichingLeadId === selectedLead.id : false}
              isSending={selectedLead ? sendingLeadId === selectedLead.id : false}
              lead={selectedLead}
              onDraftChange={onDraftChange}
              onEnrichmentChange={onEnrichmentChange}
              onFollowUpDateChange={onFollowUpDateChange}
              onGenerateDraft={onGenerateDraft}
              onRunEnrichment={onRunEnrichment}
              onSendNow={onSendNow}
              onStatusChange={onStatusChange}
              onToggleIgnored={onToggleIgnored}
              onAcceptCandidate={onAcceptCandidate}
              onRejectCandidate={onRejectCandidate}
              onSetPrimaryContact={onSetPrimaryContact}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </>
  )
}

function getLaneForLead(lead: PermitLead | null): OpportunityLane {
  if (!lead) {
    return "feed"
  }

  if (isOutreachReady(lead)) {
    return "ready"
  }

  if (needsEnrichment(lead)) {
    return "research"
  }

  return "feed"
}

function MetroGlassLeadsWorkspace({
  onLogout,
  userEmail,
}: {
  onLogout: () => Promise<void>
  userEmail: string
}) {
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const {
    allLeads,
    activeEnrichmentQueueId,
    activeOutreachQueueId,
    activeViewId,
    automationHealth,
    automationJobs,
    dashboardActivities,
    dashboardStats,
    enrichingLeadId,
    enrichmentLeads,
    enrichmentPresets,
    error,
    filters,
    lastScanAt,
    latestRunSummary,
    loading,
    opportunityLane,
    outreachLeads,
    outreachPresets,
    profile,
    resetFilters,
    resetProfile,
    retryJob,
    savedViews,
    scannerLeads,
    scanLeads,
    section,
    sentLog,
    selectedLead,
    sendLeadNow,
    sendingLeadId,
    setActiveViewId,
    setEnrichmentQueueId,
    setFilters,
    setOpportunityLane,
    setOutreachQueueId,
    setSection,
    setSelectedLeadId,
    theme,
    toggleIgnored,
    toggleTheme,
    topOpportunities,
    updateEnrichment,
    updateLeadStatus,
    updateOutreachDraft,
    updateProfile,
    generateDraft,
    refreshLeadAutomation,
    acceptResolverCandidate,
    rejectResolverCandidate,
    setPrimaryContactRoute,
    setFollowUpDate,
  } = usePermitPulse()

  const scannerSelection = useBulkSelection(scannerLeads)
  const enrichmentSelection = useBulkSelection(enrichmentLeads)
  const outreachSelection = useBulkSelection(outreachLeads)

  const activeSelection = useMemo(() => {
    if (opportunityLane === "research") {
      return enrichmentSelection
    }
    if (opportunityLane === "ready") {
      return outreachSelection
    }
    return scannerSelection
  }, [enrichmentSelection, opportunityLane, outreachSelection, scannerSelection])

  const attentionItems = useMemo(
    () => getAttentionItems(allLeads, automationHealth),
    [allLeads, automationHealth],
  )
  const pipelineColumns = useMemo(() => getPipelineColumns(allLeads), [allLeads])
  const systemAlerts = useMemo(
    () => getSystemAlerts(allLeads, automationHealth, automationJobs, error, lastScanAt),
    [allLeads, automationHealth, automationJobs, error, lastScanAt],
  )

  const bulkSetStatus = (status: LeadStatus) => {
    activeSelection.selectedIds.forEach((leadId) => updateLeadStatus(leadId, status))
    activeSelection.clear()
  }

  const openLeadInOpportunities = (leadId: string, lane?: OpportunityLane) => {
    const lead = allLeads.find((item) => item.id === leadId) ?? null
    setSelectedLeadId(leadId)
    setSection("opportunities")
    setOpportunityLane(lane ?? getLaneForLead(lead))
    setMobileDetailOpen(true)
  }

  const sharedDetailProps = {
    automationHealth,
    enrichingLeadId,
    sendingLeadId,
    onStatusChange: updateLeadStatus,
    onEnrichmentChange: updateEnrichment,
    onDraftChange: updateOutreachDraft,
    onGenerateDraft: generateDraft,
    onRunEnrichment: refreshLeadAutomation,
    onSendNow: sendLeadNow,
    onFollowUpDateChange: setFollowUpDate,
    onToggleIgnored: toggleIgnored,
    onAcceptCandidate: acceptResolverCandidate,
    onRejectCandidate: rejectResolverCandidate,
    onSetPrimaryContact: setPrimaryContactRoute,
  }

  const currentWorkspacePane =
    opportunityLane === "feed" ? (
      <WorkspacePane
        description="Review fit and decide keep, research, or move."
        emptyDescription="Try a wider date window, a lower cost floor, or a different saved view."
        emptyTitle="No matching opportunities"
        leads={scannerLeads}
        onBulkSetStatus={bulkSetStatus}
        onSelectLead={setSelectedLeadId}
        onToggleAll={scannerSelection.toggleAll}
        onToggleLead={scannerSelection.toggleLead}
        onMobileDetailClose={() => setMobileDetailOpen(false)}
        onMobileDetailOpen={() => setMobileDetailOpen(true)}
        selectedIds={scannerSelection.selectedIds}
        selectedLead={selectedLead}
        mobileDetailOpen={mobileDetailOpen}
        title="Opportunity feed"
        {...sharedDetailProps}
      />
    ) : opportunityLane === "research" ? (
      <WorkspacePane
        description="Fix company and contact gaps before outreach."
        emptyDescription="Current rescans are not leaving much unresolved. That is a good problem."
        emptyTitle="Research queue is clear"
        leads={enrichmentLeads}
        onBulkSetStatus={bulkSetStatus}
        onSelectLead={setSelectedLeadId}
        onToggleAll={enrichmentSelection.toggleAll}
        onToggleLead={enrichmentSelection.toggleLead}
        onMobileDetailClose={() => setMobileDetailOpen(false)}
        onMobileDetailOpen={() => setMobileDetailOpen(true)}
        selectedIds={enrichmentSelection.selectedIds}
        selectedLead={selectedLead}
        mobileDetailOpen={mobileDetailOpen}
        title="Research queue"
        {...sharedDetailProps}
      />
    ) : (
      <WorkspacePane
        description="Reachable enough to move toward outreach now."
        emptyDescription="Nothing is ready right now. That usually means the real work is still in research."
        emptyTitle="Ready lane is empty"
        leads={outreachLeads}
        onBulkSetStatus={bulkSetStatus}
        onSelectLead={setSelectedLeadId}
        onToggleAll={outreachSelection.toggleAll}
        onToggleLead={outreachSelection.toggleLead}
        onMobileDetailClose={() => setMobileDetailOpen(false)}
        onMobileDetailOpen={() => setMobileDetailOpen(true)}
        selectedIds={outreachSelection.selectedIds}
        selectedLead={selectedLead}
        mobileDetailOpen={mobileDetailOpen}
        title="Ready to move"
        {...sharedDetailProps}
      />
    )

  let content = null

  if (loading && section === "opportunities" && scannerLeads.length === 0) {
    content = <LoadingSkeleton />
  } else if (section === "dashboard") {
    content = (
      <DashboardView
        activities={dashboardActivities}
        attentionItems={attentionItems}
        lastScanAt={lastScanAt}
        onScan={scanLeads}
        scanning={loading}
        onOpenLead={openLeadInOpportunities}
        onOpenOpportunities={(lane) => {
          setSection("opportunities")
          setOpportunityLane(lane ?? "feed")
        }}
        stats={dashboardStats}
        systemAlerts={systemAlerts}
        topLeads={topOpportunities}
        runSummary={latestRunSummary}
      />
    )
  } else if (section === "opportunities") {
    content =
      error && allLeads.length === 0 ? (
        <EmptyState description={error} icon={Target} title="Opportunity feed issue" />
      ) : (
        <OpportunitiesView
          activeEnrichmentViewId={activeEnrichmentQueueId}
          activeOutreachViewId={activeOutreachQueueId}
          activeScannerViewId={activeViewId}
          allLeads={allLeads}
          enrichmentCount={enrichmentLeads.length}
          enrichmentViews={enrichmentPresets}
          filters={filters}
          lane={opportunityLane}
          onEnrichmentViewChange={setEnrichmentQueueId}
          onFiltersChange={setFilters}
          onLaneChange={setOpportunityLane}
          onOpenLead={openLeadInOpportunities}
          onOutreachViewChange={setOutreachQueueId}
          onResetFilters={resetFilters}
          onScannerViewChange={setActiveViewId}
          outreachCount={outreachLeads.length}
          outreachViews={outreachPresets}
          savedViews={savedViews}
          scannerCount={scannerLeads.length}
          sentCount={sentLog.length}
          sentLog={sentLog}
          workspace={currentWorkspacePane}
        />
      )
  } else if (section === "pipeline") {
    content = (
      <PipelineView
        columns={pipelineColumns}
        onOpenLead={(leadId) => openLeadInOpportunities(leadId)}
        onOpenOpportunities={() => {
          setSection("opportunities")
          setOpportunityLane("feed")
        }}
      />
    )
  } else {
    content = (
      <SystemView
        alerts={systemAlerts}
        automationHealth={automationHealth}
        jobs={automationJobs}
        onResetProfile={resetProfile}
        onRetryJob={retryJob}
        onUpdateProfile={updateProfile}
        profile={profile}
      />
    )
  }

  return (
    <>
      <AppShell
        lastScanAt={lastScanAt}
        onLogout={onLogout}
        onScan={scanLeads}
        onSearchChange={(value) => setFilters({ search: value })}
        onSectionChange={(nextSection) => {
          setMobileDetailOpen(false)
          setSection(nextSection)
        }}
        onToggleTheme={toggleTheme}
        scanning={loading}
        searchValue={filters.search}
        section={section}
        theme={theme}
        userEmail={userEmail}
      >
        <AppErrorBoundary
          onReset={() => {
            setSection("dashboard")
          }}
        >
          {content}
        </AppErrorBoundary>
      </AppShell>
      <Toaster closeButton position="top-right" richColors />
    </>
  )
}

export default function App() {
  const { error, login, logout, session, status } = useMetroglassAuth()

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-3 rounded-full border border-navy-200 bg-white/90 px-5 py-3 text-sm font-medium text-navy-700 shadow-sm dark:border-dark-border dark:bg-dark-card dark:text-dark-text">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Restoring MetroGlass Leads
        </div>
      </div>
    )
  }

  if (!session) {
    return <LoginScreen error={error} loading={status === "loading"} onSubmit={login} />
  }

  return <MetroGlassLeadsWorkspace onLogout={logout} userEmail={session.user.email} />
}
