import { useMemo, useState } from "react"
import { PanelRight, Target } from "lucide-react"
import { Toaster } from "sonner"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { DashboardView } from "@/features/permit-pulse/components/dashboard-view"
import { EmptyState } from "@/features/permit-pulse/components/empty-state"
import { SavedViewTabs, SmartFilterBar } from "@/features/permit-pulse/components/filters"
import { AppShell } from "@/features/permit-pulse/components/layout"
import { LeadDetailPanel } from "@/features/permit-pulse/components/lead-detail-panel"
import { LeadList } from "@/features/permit-pulse/components/lead-list"
import { LoadingSkeleton } from "@/features/permit-pulse/components/loading-skeleton"
import { PageHeader } from "@/features/permit-pulse/components/page-header"
import { ProfileSettingsView } from "@/features/permit-pulse/components/profile-settings-view"
import { SentLogView } from "@/features/permit-pulse/components/sent-log-view"
import { usePermitPulse } from "@/features/permit-pulse/hooks/use-permit-pulse"
import type { LeadStatus, PermitLead } from "@/types/permit-pulse"

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
  onFollowUpDateChange,
  onToggleIgnored,
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
  onFollowUpDateChange: (leadId: string, value: string) => void
  onToggleIgnored: (leadId: string) => void
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
          lead={selectedLead}
          onDraftChange={onDraftChange}
          onEnrichmentChange={onEnrichmentChange}
          onFollowUpDateChange={onFollowUpDateChange}
          onGenerateDraft={onGenerateDraft}
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
    dashboardActivities,
    dashboardStats,
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

  const bulkSetStatus = (status: LeadStatus) => {
    activeSelection.selectedIds.forEach((leadId) => updateLeadStatus(leadId, status))
    activeSelection.clear()
  }

  const openLeadInWorkspace = (leadId: string) => {
    setSelectedLeadId(leadId)
    setSection("workspace")
  }

  const sharedDetailProps = {
    onStatusChange: updateLeadStatus,
    onEnrichmentChange: updateEnrichment,
    onDraftChange: updateOutreachDraft,
    onGenerateDraft: generateDraft,
    onFollowUpDateChange: setFollowUpDate,
    onToggleIgnored: toggleIgnored,
  }

  let content = null

  if (loading && section !== "dashboard" && scannerLeads.length === 0) {
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
  } else if (section === "scanner") {
    content = (
      <div className="space-y-6">
        <PageHeader
          description="This is the scored DOB permit feed with saved views, tighter filtering, and a split-pane review mode so leads can move directly into research or outreach."
          eyebrow="Lead Scanner"
          title="Scan raw permits, qualify fast, and keep the next move visible."
        />
        <SavedViewTabs activeViewId={activeViewId} onSelect={setActiveViewId} views={savedViews} />
        <SmartFilterBar filters={filters} onChange={setFilters} onReset={resetFilters} />
        {error ? (
          <EmptyState description={error} icon={Target} title="Scanner issue" />
        ) : (
          <WorkspacePane
            description="Scored permit feed with bulk selection and side-by-side review."
            emptyDescription="Try a wider time window, a lower cost floor, or a different saved view."
            emptyTitle="No matching leads"
            leads={scannerLeads}
            onBulkSetStatus={bulkSetStatus}
            onSelectLead={setSelectedLeadId}
            onToggleAll={scannerSelection.toggleAll}
            onToggleLead={scannerSelection.toggleLead}
            selectedIds={scannerSelection.selectedIds}
            selectedLead={selectedLead}
            title="Scanner results"
            {...sharedDetailProps}
          />
        )}
      </div>
    )
  } else if (section === "workspace") {
    content = (
      <div className="space-y-6">
        <PageHeader
          description="This is the operational view for a single lead: qualify the permit, enrich the contact layer, write outreach, and keep every research step in memory."
          eyebrow="Lead Workspace"
          title="Turn a permit into a reachable opportunity."
        />
        {selectedLead ? (
          <LeadDetailPanel lead={selectedLead} {...sharedDetailProps} />
        ) : (
          <EmptyState
            actionLabel="Open scanner"
            description="Pick a lead from the scanner or queue pages to start working it here."
            icon={PanelRight}
            onAction={() => setSection("scanner")}
            title="No active lead"
          />
        )}
      </div>
    )
  } else if (section === "enrichment") {
    content = (
      <div className="space-y-6">
        <PageHeader
          description="Research lane for high-fit leads that still need website, phone, email, or a cleaner personalization angle before outreach."
          eyebrow="Enrichment Queue"
          title="Build the contact layer before outreach wastes time."
        />
        <SavedViewTabs activeViewId={activeEnrichmentQueueId} onSelect={setEnrichmentQueueId} views={enrichmentPresets} />
        <WorkspacePane
          description="High-potential leads that still need contact research or manual context."
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
      </div>
    )
  } else if (section === "outreach") {
    content = (
      <div className="space-y-6">
        <PageHeader
          description="This queue is for leads that are reachable enough to email, call, submit, or follow up without reopening the research loop."
          eyebrow="Outreach Queue"
          title="Move enriched leads into real outbound action."
        />
        <SavedViewTabs activeViewId={activeOutreachQueueId} onSelect={setOutreachQueueId} views={outreachPresets} />
        <WorkspacePane
          description="Reachable leads that can move directly into outreach work."
          emptyDescription="Nothing is outreach-ready right now. That usually means the enrichment queue is the real bottleneck."
          emptyTitle="Outreach queue is empty"
          leads={outreachLeads}
          onBulkSetStatus={bulkSetStatus}
            onSelectLead={setSelectedLeadId}
            onToggleAll={outreachSelection.toggleAll}
            onToggleLead={outreachSelection.toggleLead}
            selectedIds={outreachSelection.selectedIds}
            selectedLead={selectedLead}
          title="Outreach lane"
          {...sharedDetailProps}
        />
      </div>
    )
  } else if (section === "sent-log") {
    content = <SentLogView entries={sentLog} leads={allLeads} onOpenLead={openLeadInWorkspace} />
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
        section={section}
        theme={theme}
      >
        {content}
      </AppShell>
      <Toaster closeButton position="top-right" richColors />
    </>
  )
}
