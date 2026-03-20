import { useMemo, useState } from "react"
import { Target } from "lucide-react"
import { Toaster } from "sonner"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { DashboardView } from "@/features/permit-pulse/components/dashboard-view"
import { EmptyState } from "@/features/permit-pulse/components/empty-state"
import { AppShell } from "@/features/permit-pulse/components/layout"
import { LeadDetailPanel } from "@/features/permit-pulse/components/lead-detail-panel"
import { LeadList } from "@/features/permit-pulse/components/lead-list"
import { LoadingSkeleton } from "@/features/permit-pulse/components/loading-skeleton"
import { PipelineWorkspace } from "@/features/permit-pulse/components/pipeline-workspace"
import { ProfileSettingsView } from "@/features/permit-pulse/components/profile-settings-view"
import { usePermitPulse } from "@/features/permit-pulse/hooks/use-permit-pulse"
import type { AutomationHealth, LeadStatus, PermitLead } from "@/types/permit-pulse"

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
  automationHealth,
  enrichingLeadId,
  sendingLeadId,
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
  automationHealth: AutomationHealth | null
  enrichingLeadId: string | null
  sendingLeadId: string | null
  emptyTitle: string
  emptyDescription: string
}) {
  return (
    <ResizablePanelGroup className="min-h-[calc(100vh-14rem)] rounded-[32px]" direction="horizontal">
      <ResizablePanel defaultSize={46} minSize={35}>
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
      <ResizablePanel defaultSize={54} minSize={40}>
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
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

export default function App() {
  const {
    allLeads,
    activeEnrichmentQueueId,
    activeOutreachQueueId,
    activeViewId,
    automationHealth,
    dashboardActivities,
    dashboardStats,
    enrichingLeadId,
    enrichmentLeads,
    enrichmentPresets,
    error,
    filters,
    lastScanAt,
    loading,
    outreachLeads,
    outreachPresets,
    profile,
    resetFilters,
    resetProfile,
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
    setFollowUpDate,
  } = usePermitPulse()

  const scannerSelection = useBulkSelection(scannerLeads)
  const enrichmentSelection = useBulkSelection(enrichmentLeads)
  const outreachSelection = useBulkSelection(outreachLeads)

  const activeSelection = useMemo(() => {
    if (section === "enrichment") {
      return enrichmentSelection
    }
    if (section === "outreach") {
      return outreachSelection
    }
    return scannerSelection
  }, [enrichmentSelection, outreachSelection, scannerSelection, section])

  const pipelineLane = section === "enrichment" || section === "outreach" || section === "sent-log"
    ? section
    : "scanner"
  const navSection = section === "dashboard" || section === "profile" ? section : "scanner"

  const bulkSetStatus = (status: LeadStatus) => {
    activeSelection.selectedIds.forEach((leadId) => updateLeadStatus(leadId, status))
    activeSelection.clear()
  }

  const openLeadInWorkspace = (leadId: string) => {
    setSelectedLeadId(leadId)
    setSection("scanner")
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
  }

  const currentWorkspacePane =
    pipelineLane === "scanner" ? (
      <WorkspacePane
        description="Use the main feed to qualify fit quickly, keep a lead selected, and work the detail panel without leaving the page."
        emptyDescription="Try a wider time window, a lower cost floor, or a different saved view."
        emptyTitle="No matching leads"
        leads={scannerLeads}
        onBulkSetStatus={bulkSetStatus}
        onSelectLead={setSelectedLeadId}
        onToggleAll={scannerSelection.toggleAll}
        onToggleLead={scannerSelection.toggleLead}
        selectedIds={scannerSelection.selectedIds}
        selectedLead={selectedLead}
        title="Scored permit feed"
        {...sharedDetailProps}
      />
    ) : pipelineLane === "enrichment" ? (
      <WorkspacePane
        description="Everything here still needs contact research or a stronger personalization angle before it is worth sending."
        emptyDescription="Current rescans are not leaving much unresolved. That is a good problem."
        emptyTitle="Enrichment queue is clear"
        leads={enrichmentLeads}
        onBulkSetStatus={bulkSetStatus}
        onSelectLead={setSelectedLeadId}
        onToggleAll={enrichmentSelection.toggleAll}
        onToggleLead={enrichmentSelection.toggleLead}
        selectedIds={enrichmentSelection.selectedIds}
        selectedLead={selectedLead}
        title="Research queue"
        {...sharedDetailProps}
      />
    ) : (
      <WorkspacePane
        description="These leads are reachable enough to move into outreach without reopening the whole research loop."
        emptyDescription="Nothing is ready right now. That usually means the real work is still in enrichment."
        emptyTitle="Outreach lane is empty"
        leads={outreachLeads}
        onBulkSetStatus={bulkSetStatus}
        onSelectLead={setSelectedLeadId}
        onToggleAll={outreachSelection.toggleAll}
        onToggleLead={outreachSelection.toggleLead}
        selectedIds={outreachSelection.selectedIds}
        selectedLead={selectedLead}
        title="Outreach queue"
        {...sharedDetailProps}
      />
    )

  let content = null

  if (loading && navSection === "scanner" && scannerLeads.length === 0) {
    content = <LoadingSkeleton />
  } else if (section === "dashboard") {
    content = (
      <DashboardView
        activities={dashboardActivities}
        lastScanAt={lastScanAt}
        onOpenLead={openLeadInWorkspace}
        onOpenScanner={() => setSection("scanner")}
        stats={dashboardStats}
        topLeads={topOpportunities}
      />
    )
  } else if (navSection === "scanner") {
    content = (
      error ? (
        <EmptyState description={error} icon={Target} title="Pipeline issue" />
      ) : (
        <PipelineWorkspace
          activeEnrichmentViewId={activeEnrichmentQueueId}
          activeOutreachViewId={activeOutreachQueueId}
          activeScannerViewId={activeViewId}
          allLeads={allLeads}
          enrichmentCount={enrichmentLeads.length}
          enrichmentViews={enrichmentPresets}
          filters={filters}
          lane={pipelineLane}
          onEnrichmentViewChange={setEnrichmentQueueId}
          onFiltersChange={setFilters}
          onLaneChange={(lane) => setSection(lane)}
          onOpenLead={openLeadInWorkspace}
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
    )
  } else {
    content = (
      <ProfileSettingsView profile={profile} onReset={resetProfile} onUpdate={updateProfile} />
    )
  }

  return (
    <>
      <AppShell
        lastScanAt={lastScanAt}
        onScan={scanLeads}
        onSearchChange={(value) => setFilters({ search: value })}
        onSectionChange={setSection}
        onToggleTheme={toggleTheme}
        scanning={loading}
        searchValue={filters.search}
        section={navSection}
        theme={theme}
      >
        {content}
      </AppShell>
      <Toaster closeButton position="top-right" richColors />
    </>
  )
}
