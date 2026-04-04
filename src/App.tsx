import { BriefcaseBusiness, LoaderCircle, ListTodo, ScanLine, Settings2 } from "lucide-react"
import { Toaster } from "sonner"

import { Button } from "@/components/ui/button"
import { LoginScreen } from "@/features/auth/components/login-screen"
import { useMetroglassAuth } from "@/features/auth/hooks/use-metroglass-auth"
import { LeadDetailView } from "@/features/metroglass-leads/components/lead-detail-view"
import { LeadsScreen } from "@/features/metroglass-leads/components/leads-screen"
import { SettingsScreen } from "@/features/metroglass-leads/components/settings-screen"
import { TodayScreen } from "@/features/metroglass-leads/components/today-screen"
import { useMetroglassLeads } from "@/features/metroglass-leads/hooks/use-metroglass-leads"
import { ProspectDetailView } from "@/features/metroglass-prospects/components/prospect-detail-view"
import { ProspectsScreen } from "@/features/metroglass-prospects/components/prospects-screen"

function AppTabs({
  tab,
  onChange,
}: {
  tab: "today" | "leads" | "prospects" | "settings"
  onChange: (value: "today" | "leads" | "prospects" | "settings") => void
}) {
  const items = [
    { id: "today", label: "Today", icon: ScanLine },
    { id: "leads", label: "Leads", icon: ListTodo },
    { id: "prospects", label: "Outreach", icon: BriefcaseBusiness },
    { id: "settings", label: "Settings", icon: Settings2 },
  ] as const

  return (
    <nav className="fixed bottom-4 left-0 right-0 z-30 px-3">
      <div className="mx-auto grid max-w-[720px] grid-cols-4 gap-2 rounded-[20px] border border-steel-200 bg-[rgba(255,255,255,0.88)] p-2 shadow-[0_16px_36px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        {items.map((item) => {
          const Icon = item.icon
          const active = tab === item.id
          return (
            <button
              key={item.id}
              className={`flex min-h-[54px] flex-col items-center justify-center rounded-[16px] text-xs font-medium transition ${
                active
                  ? "bg-steel-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.2)]"
                  : "bg-white/70 text-steel-600 hover:bg-steel-50"
              }`}
              onClick={() => onChange(item.id)}
              type="button"
            >
              <Icon className="mb-1 h-4 w-4" />
              {item.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function MetroglassLeadsApp({ onLogout }: { onLogout: () => Promise<void> }) {
  const {
    tab,
    setTab,
    health,
    today,
    leads,
    selectedLead,
    selectedLeadId,
    openLead,
    closeLead,
    leadFilter,
    setLeadFilter,
    config,
    system,
    loading,
    actionLeadId,
    actions,
    prospects,
    selectedProspect,
    selectedProspectId,
    openProspect,
    closeProspect,
    prospectStatusFilter,
    setProspectStatusFilter,
    prospectCategoryFilter,
    setProspectCategoryFilter,
    prospectQuery,
    setProspectQuery,
  } = useMetroglassLeads()

  const title = tab === "prospects" ? "Outreach CRM" : "Leads"
  const subtitle = tab === "prospects" ? "Automated outbound email operations" : "Permit automation"

  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-20 border-b border-steel-200 bg-[rgba(248,250,252,0.9)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-brand-700">
                MetroGlass Pro
              </div>
              <div className="rounded-full border border-steel-200 bg-white px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">
                {subtitle}
              </div>
            </div>
            <div className="mt-3 text-3xl font-extrabold tracking-[-0.05em] text-steel-900 sm:text-[2.4rem]">{title}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {tab === "prospects" ? (
                <>
                  <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                    {prospects?.counts.all ?? 0} total
                  </div>
                  <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                    {prospects?.counts.new ?? 0} new
                  </div>
                  <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                    {prospects?.counts.drafted ?? 0} drafted
                  </div>
                  <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                    {prospects?.counts.sent ?? 0} sent
                  </div>
                  <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                    {prospects?.automation.metrics?.positive_replies_total ?? 0} positive replies
                  </div>
                  <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                    {prospects?.counts.opted_out ?? 0} opted out
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                    {today?.automation_backlog_pending ?? today?.counts.new ?? 0} backlog
                  </div>
                  <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                    {today?.counts.review ?? 0} exceptions
                  </div>
                  <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                    {today?.counts.email_required ?? 0} email required
                  </div>
                  <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                    {today?.counts.ready ?? 0} ready
                  </div>
                </>
              )}
              <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                Worker {health?.ok ? "healthy" : "offline"}
              </div>
            </div>
          </div>

          <Button className="h-11 rounded-full px-5" onClick={() => void onLogout()} type="button" variant="outline">
            Log out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <LoaderCircle className="h-7 w-7 animate-spin text-[#D4691A]" />
          </div>
        ) : null}

        {!loading && tab === "today" ? (
          <TodayScreen
            actionLeadId={actionLeadId}
            onLogPhoneFollowUp={(leadId, step) => {
              const notes = window.prompt("Phone outcome notes", "") ?? ""
              void actions.logPhoneFollowUp(leadId, step, notes)
            }}
            onOpenLead={openLead}
            onRunProspectBatch={() => void actions.runProspectBatch()}
            onScan={() => void actions.scan()}
            onSendAllReady={() => void actions.sendAllReady()}
            onSendDueFollowUps={(limit) => void actions.sendDueFollowUps(limit)}
            onSendFollowUp={(leadId, step) => void actions.sendFollowUp(leadId, step)}
            onSyncReplies={() => void actions.syncReplies()}
            today={today}
          />
        ) : null}

        {!loading && tab === "leads" ? (
          <LeadsScreen
            actionLeadId={actionLeadId}
            filter={leadFilter}
            leads={leads}
            onEnrich={(leadId) => void actions.enrichLead(leadId)}
            onFilterChange={setLeadFilter}
            onOpenLead={openLead}
          />
        ) : null}

        {!loading && tab === "settings" ? (
          <SettingsScreen
            config={config}
            health={health}
            onSaveConfig={actions.saveConfig}
            system={system}
          />
        ) : null}

        {!loading && tab === "prospects" ? (
          <ProspectsScreen
            actionTargetId={actionLeadId}
            categoryFilter={prospectCategoryFilter}
            onCategoryFilterChange={setProspectCategoryFilter}
            onImportCsv={actions.importProspects}
            onOpenProspect={openProspect}
            onQueryChange={setProspectQuery}
            onRepairPermitFollowUps={() => void actions.repairFollowUps()}
            onRunProspectBatch={() => void actions.runProspectBatch()}
            onStatusFilterChange={setProspectStatusFilter}
            onSyncReplies={() => void actions.syncReplies()}
            prospects={prospects}
            query={prospectQuery}
            statusFilter={prospectStatusFilter}
          />
        ) : null}
      </main>

      <LeadDetailView
        actionLeadId={actionLeadId}
        detail={selectedLead}
        key={selectedLead ? `${selectedLead.lead.id}:${selectedLead.lead.updated_at}` : "lead-detail"}
        onArchive={(leadId) => void actions.archiveLead(leadId)}
        onBounced={(leadId) => void actions.markBounced(leadId)}
        onClose={closeLead}
        onEnrich={(leadId) => void actions.enrichLead(leadId)}
        onEmailRequired={(leadId) => void actions.emailRequired(leadId)}
        onChooseEmail={(leadId, candidateId) => void actions.chooseEmail(leadId, candidateId)}
        onAddManualEmail={(leadId, payload) => void actions.addManualEmail(leadId, payload)}
        onLogPhoneFollowUp={(leadId, step, notes) => void actions.logPhoneFollowUp(leadId, step, notes)}
        onLost={(leadId) => void actions.markLost(leadId)}
        onRefreshDraft={(leadId) => void actions.refreshDraft(leadId)}
        onReplied={(leadId) => void actions.markReplied(leadId)}
        onSaveDraft={(leadId, draft) => void actions.saveDraft(leadId, draft)}
        onSend={(leadId) => void actions.sendLead(leadId)}
        onSendFollowUp={(leadId, step) => void actions.sendFollowUp(leadId, step)}
        onSkipFollowUp={(leadId, step) => void actions.skipFollowUp(leadId, step)}
        onSwitchFallback={(leadId) => void actions.switchFallback(leadId)}
        onVouch={(leadId) => void actions.vouchLead(leadId)}
        onWon={(leadId) => void actions.markWon(leadId)}
        open={Boolean(selectedLeadId)}
      />

      <ProspectDetailView
        actionTargetId={actionLeadId}
        detail={selectedProspect}
        key={selectedProspect ? `${selectedProspect.prospect.id}:${selectedProspect.prospect.updated_at}` : "prospect-detail"}
        onArchive={(prospectId) => void actions.archiveProspect(prospectId)}
        onMarkBounced={(prospectId) => void actions.markProspectBounced(prospectId)}
        onClose={closeProspect}
        onMarkPositiveReply={(prospectId) => void actions.markProspectReply(prospectId, "positive")}
        onMarkReplied={(prospectId) => void actions.markProspectReplied(prospectId)}
        onOptOut={(prospectId) => void actions.optOutProspect(prospectId)}
        onRemoveSuppression={(suppressionId, prospectId) => void actions.removeProspectSuppression(suppressionId, prospectId)}
        onResolveReview={(reviewId, prospectId, action) => void actions.resolveProspectReview(reviewId, prospectId, action)}
        onSaveDraft={(prospectId, draft) => void actions.saveProspectDraft(prospectId, draft)}
        onSaveNotes={(prospectId, notes) => void actions.saveProspectNotes(prospectId, notes)}
        onSend={(prospectId) => void actions.sendProspect(prospectId)}
        onSuppress={(prospectId, scopeType, reason) => void actions.suppressProspect(prospectId, scopeType, reason)}
        open={Boolean(selectedProspectId)}
      />

      <AppTabs tab={tab} onChange={setTab} />
      <Toaster position="top-center" richColors />
    </div>
  )
}

export default function App() {
  const auth = useMetroglassAuth()

  if (auth.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoaderCircle className="h-7 w-7 animate-spin text-primary" />
      </div>
    )
  }

  if (auth.status !== "authenticated") {
    return (
      <>
        <LoginScreen error={auth.error} loading={auth.status === "loading"} onSubmit={auth.login} />
        <Toaster position="top-center" richColors />
      </>
    )
  }

  return <MetroglassLeadsApp onLogout={auth.logout} />
}
