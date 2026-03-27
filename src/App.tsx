import { LoaderCircle, ListTodo, ScanLine, Settings2 } from "lucide-react"
import { Toaster } from "sonner"

import { Button } from "@/components/ui/button"
import { LoginScreen } from "@/features/auth/components/login-screen"
import { useMetroglassAuth } from "@/features/auth/hooks/use-metroglass-auth"
import { LeadDetailView } from "@/features/metroglass-leads/components/lead-detail-view"
import { LeadsScreen } from "@/features/metroglass-leads/components/leads-screen"
import { SettingsScreen } from "@/features/metroglass-leads/components/settings-screen"
import { TodayScreen } from "@/features/metroglass-leads/components/today-screen"
import { useMetroglassLeads } from "@/features/metroglass-leads/hooks/use-metroglass-leads"

function AppTabs({
  tab,
  onChange,
}: {
  tab: "today" | "leads" | "settings"
  onChange: (value: "today" | "leads" | "settings") => void
}) {
  const items = [
    { id: "today", label: "Today", icon: ScanLine },
    { id: "leads", label: "Leads", icon: ListTodo },
    { id: "settings", label: "Settings", icon: Settings2 },
  ] as const

  return (
    <nav className="fixed bottom-4 left-0 right-0 z-30 px-3">
      <div className="mx-auto grid max-w-[560px] grid-cols-3 gap-2 rounded-[22px] border border-[#D9CCBE] bg-[rgba(255,248,240,0.94)] p-2 shadow-[0_18px_40px_rgba(26,26,26,0.12)] backdrop-blur-xl">
        {items.map((item) => {
          const Icon = item.icon
          const active = tab === item.id
          return (
            <button
              key={item.id}
              className={`flex min-h-[54px] flex-col items-center justify-center rounded-[16px] text-xs font-medium transition ${
                active
                  ? "bg-[#1A1A1A] text-white shadow-[0_12px_24px_rgba(26,26,26,0.18)]"
                  : "bg-white/80 text-[#5F564C] hover:bg-white"
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
  } = useMetroglassLeads()

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(212,105,26,0.12),transparent_22%),linear-gradient(180deg,#efe4d5,#eadfce_36%,#efe7dc)] text-[#1A1A1A]">
      <header className="sticky top-0 z-20 border-b border-[#D9CCBE] bg-[rgba(239,228,213,0.88)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[#D4691A]">MetroGlassPro</div>
            <div className="mt-1 font-['Instrument_Serif'] text-3xl leading-none sm:text-[2.4rem]">Leads</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <div className="rounded-full border border-[#D9CCBE] bg-white/80 px-3 py-1 text-xs text-[#5F564C]">
                {today?.counts.new ?? 0} new
              </div>
              <div className="rounded-full border border-[#D9CCBE] bg-white/80 px-3 py-1 text-xs text-[#5F564C]">
                {today?.counts.review ?? 0} review
              </div>
              <div className="rounded-full border border-[#D9CCBE] bg-white/80 px-3 py-1 text-xs text-[#5F564C]">
                {today?.counts.email_required ?? 0} email required
              </div>
              <div className="rounded-full border border-[#D9CCBE] bg-white/80 px-3 py-1 text-xs text-[#5F564C]">
                {today?.counts.ready ?? 0} ready
              </div>
              <div className="rounded-full border border-[#D9CCBE] bg-white/80 px-3 py-1 text-xs text-[#5F564C]">
                Worker {health?.ok ? "healthy" : "offline"}
              </div>
            </div>
          </div>

          <Button className="h-11 rounded-full border border-[#D6C6B6] bg-white px-5 text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => void onLogout()} type="button" variant="outline">
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
            onScan={() => void actions.scan()}
            onSendAllReady={() => void actions.sendAllReady()}
            onSendFollowUp={(leadId, step) => void actions.sendFollowUp(leadId, step)}
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
        onSaveNotes={(leadId, notes) => void actions.saveNotes(leadId, notes)}
        onSaveDraft={(leadId, draft) => void actions.saveDraft(leadId, draft)}
        onSend={(leadId) => void actions.sendLead(leadId)}
        onSendFollowUp={(leadId, step) => void actions.sendFollowUp(leadId, step)}
        onSkipFollowUp={(leadId, step) => void actions.skipFollowUp(leadId, step)}
        onSwitchFallback={(leadId) => void actions.switchFallback(leadId)}
        onVouch={(leadId) => void actions.vouchLead(leadId)}
        onWon={(leadId) => void actions.markWon(leadId)}
        open={Boolean(selectedLeadId)}
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
      <div className="flex min-h-screen items-center justify-center bg-[#E8E2D9]">
        <LoaderCircle className="h-7 w-7 animate-spin text-[#D4691A]" />
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
