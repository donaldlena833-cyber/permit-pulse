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
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#D9CCBE] bg-[#FFF8F0]/96 px-3 py-3 backdrop-blur">
      <div className="mx-auto grid max-w-4xl grid-cols-3 gap-2">
        {items.map((item) => {
          const Icon = item.icon
          const active = tab === item.id
          return (
            <button
              key={item.id}
              className={`flex min-h-[48px] flex-col items-center justify-center rounded-[10px] text-xs font-medium transition ${
                active ? "bg-[#1A1A1A] text-white" : "bg-white text-[#5F564C]"
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
    <div className="min-h-screen bg-[#E8E2D9] text-[#1A1A1A]">
      <header className="sticky top-0 z-20 border-b border-[#D9CCBE] bg-[#E8E2D9]/92 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-[#D4691A]">MetroGlassPro</div>
            <div className="font-['Instrument_Serif'] text-3xl leading-none">Leads</div>
          </div>
          <Button className="h-10 rounded-[8px] border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]" onClick={() => void onLogout()} type="button" variant="outline">
            Log out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-4">
        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <LoaderCircle className="h-7 w-7 animate-spin text-[#D4691A]" />
          </div>
        ) : null}

        {!loading && tab === "today" ? (
          <TodayScreen
            actionLeadId={actionLeadId}
            onEnrich={(leadId) => void actions.enrichLead(leadId)}
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
