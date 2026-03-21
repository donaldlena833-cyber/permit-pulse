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
import { OpportunitiesView } from "@/features/permit-pulse/components/opportunities-view"
import { PipelineView } from "@/features/permit-pulse/components/pipeline-view"
import { SystemView } from "@/features/permit-pulse/components/system-view"
import { usePermitPulse } from "@/features/permit-pulse/hooks/use-permit-pulse"
import { getAttentionItems, getPipelineColumns, getSystemAlerts } from "@/features/permit-pulse/lib/operator"
import { isOutreachReady, needsEnrichment } from "@/features/permit-pulse/lib/views"
import type { LeadStatus, OpportunityLane, PermitLead } from "@/types/permit-pulse"

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
  automationHealth: ReturnType<typeof usePermitPulse>["automationHealth"]
  enrichingLeadId: string | null
  sendingLeadId: string | null
  emptyTitle: string
  emptyDescription: string
}) {
  return (
    <ResizablePanelGroup className="min-h-[calc(100vh-14rem)] rounded-[32px]" direction="horizontal">
      <ResizablePanel defaultSize={42} minSize={32}>
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
      <ResizablePanel defaultSize={58} minSize={40}>
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
    opportunityLane,
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
    () => getSystemAlerts(allLeads, automationHealth, error, lastScanAt),
    [allLeads, automationHealth, error, lastScanAt],
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
        selectedIds={scannerSelection.selectedIds}
        selectedLead={selectedLead}
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
        selectedIds={enrichmentSelection.selectedIds}
        selectedLead={selectedLead}
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
        selectedIds={outreachSelection.selectedIds}
        selectedLead={selectedLead}
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
        onOpenLead={openLeadInOpportunities}
        onOpenOpportunities={(lane) => {
          setSection("opportunities")
          setOpportunityLane(lane ?? "feed")
        }}
        stats={dashboardStats}
        systemAlerts={systemAlerts}
        topLeads={topOpportunities}
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
        onResetProfile={resetProfile}
        onUpdateProfile={updateProfile}
        profile={profile}
      />
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
        section={section}
        theme={theme}
      >
        {content}
      </AppShell>
      <Toaster closeButton position="top-right" richColors />
    </>
  )
}
