import { useCallback, useEffect, useState } from "react"
import { BriefcaseBusiness, LoaderCircle, ListTodo, ScanLine, Settings2 } from "lucide-react"
import { Toaster } from "sonner"
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { InviteAcceptScreen } from "@/features/auth/components/invite-accept-screen"
import { LoginScreen } from "@/features/auth/components/login-screen"
import { SignupScreen } from "@/features/auth/components/signup-screen"
import { useMetroglassAuth } from "@/features/auth/hooks/use-metroglass-auth"
import { LeadDetailView } from "@/features/metroglass-leads/components/lead-detail-view"
import { LeadsScreen } from "@/features/metroglass-leads/components/leads-screen"
import { SettingsScreen } from "@/features/metroglass-leads/components/settings-screen"
import { TodayScreen } from "@/features/metroglass-leads/components/today-screen"
import { useMetroglassLeads } from "@/features/metroglass-leads/hooks/use-metroglass-leads"
import {
  acceptInvite,
  beginWorkspaceGmailConnect,
  bootstrapWorkspace,
  fetchInvitePreview,
  fetchOnboardingState,
  updateOnboardingProfile,
  uploadWorkspaceAttachment as uploadWorkspaceAttachmentRequest,
} from "@/features/metroglass-leads/lib/remote"
import type { InvitePreviewPayload, OnboardingPayload } from "@/features/metroglass-leads/types/api"
import { ProspectDetailView } from "@/features/metroglass-prospects/components/prospect-detail-view"
import { ProspectsScreen } from "@/features/metroglass-prospects/components/prospects-screen"
import { OnboardingScreen } from "@/features/onboarding/components/onboarding-screen"

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
    refreshAll,
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

  const workspaceName = system?.account?.name || "PermitPulse"
  const workspaceBusiness = system?.account?.business_name || workspaceName
  const title = tab === "prospects" ? "Outreach CRM" : "Leads"
  const subtitle = tab === "prospects" ? "Automated outbound email operations" : "Permit automation"

  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-20 border-b border-steel-200 bg-[rgba(248,250,252,0.9)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-brand-700">
                {workspaceName}
              </div>
              <div className="rounded-full border border-steel-200 bg-white px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">
                {subtitle}
              </div>
            </div>
            <div className="mt-3 text-3xl font-extrabold tracking-[-0.05em] text-steel-900 sm:text-[2.4rem]">{workspaceBusiness} {title}</div>
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
            onSaveWorkspaceProfile={actions.saveWorkspaceProfile}
            onUploadWorkspaceAttachment={actions.uploadWorkspaceAttachment}
            onRefreshWorkspace={refreshAll}
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
    </div>
  )
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }

  return btoa(binary)
}

function resolveAuthenticatedPath(state: OnboardingPayload | null): string {
  if (!state) {
    return "/onboarding"
  }

  if (state.requires_bootstrap) {
    return "/onboarding"
  }

  if (state.onboarding?.status !== "completed") {
    return "/onboarding"
  }

  return "/app"
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <LoaderCircle className="h-7 w-7 animate-spin text-primary" />
    </div>
  )
}

function RoutedApp() {
  const auth = useMetroglassAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [workspaceState, setWorkspaceState] = useState<OnboardingPayload | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [invitePreview, setInvitePreview] = useState<InvitePreviewPayload | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const refreshWorkspaceState = useCallback(async () => {
    if (auth.status !== "authenticated") {
      setWorkspaceState(null)
      return null
    }

    setWorkspaceLoading(true)
    try {
      const payload = await fetchOnboardingState()
      setWorkspaceState(payload)
      return payload
    } finally {
      setWorkspaceLoading(false)
    }
  }, [auth.status])

  useEffect(() => {
    if (auth.status === "authenticated") {
      void refreshWorkspaceState()
      return
    }

    setWorkspaceState(null)
  }, [auth.status, refreshWorkspaceState])

  useEffect(() => {
    const token = searchParams.get("token")
    if (location.pathname !== "/accept-invite" || !token) {
      setInvitePreview(null)
      setInviteError(null)
      return
    }

    let cancelled = false
    setInviteLoading(true)
    void (async () => {
      try {
        const preview = await fetchInvitePreview(token)
        if (!cancelled) {
          setInvitePreview(preview)
          setInviteError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setInviteError(error instanceof Error ? error.message : "Invite lookup failed")
        }
      } finally {
        if (!cancelled) {
          setInviteLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [location.pathname, searchParams])

  const handleLogin = useCallback(async (email: string, password: string) => {
    await auth.login(email, password)
    const nextState = await fetchOnboardingState()
    setWorkspaceState(nextState)
    const inviteToken = searchParams.get("token")
    navigate(
      location.pathname === "/accept-invite" && inviteToken
        ? `/accept-invite?token=${encodeURIComponent(inviteToken)}`
        : resolveAuthenticatedPath(nextState),
      { replace: true },
    )
  }, [auth, location.pathname, navigate, searchParams])

  const handleSignup = useCallback(async (email: string, password: string) => {
    await auth.signup(email, password)
    const nextState = await fetchOnboardingState()
    setWorkspaceState(nextState)
    const inviteToken = searchParams.get("token")
    navigate(
      location.pathname === "/accept-invite" && inviteToken
        ? `/accept-invite?token=${encodeURIComponent(inviteToken)}`
        : resolveAuthenticatedPath(nextState),
      { replace: true },
    )
  }, [auth, location.pathname, navigate, searchParams])

  const handleAcceptInvite = useCallback(async () => {
    const token = searchParams.get("token")
    if (!token) {
      throw new Error("Missing invite token")
    }

    setInviteLoading(true)
    try {
      await acceptInvite(token)
      const nextState = await fetchOnboardingState()
      setWorkspaceState(nextState)
      navigate(resolveAuthenticatedPath(nextState), { replace: true })
    } finally {
      setInviteLoading(false)
    }
  }, [navigate, searchParams])

  const handleBootstrap = useCallback(async (payload: {
    name: string
    business_name: string
    website?: string | null
    sender_name?: string | null
    sender_email?: string | null
    billing_email?: string | null
    phone?: string | null
  }) => {
    await bootstrapWorkspace(payload)
    const nextState = await fetchOnboardingState()
    setWorkspaceState(nextState)
    navigate(resolveAuthenticatedPath(nextState), { replace: true })
  }, [navigate])

  const handleOnboardingSave = useCallback(async (payload: Record<string, unknown>) => {
    await updateOnboardingProfile(payload)
    await refreshWorkspaceState()
  }, [refreshWorkspaceState])

  const handleOnboardingUpload = useCallback(async (file: File) => {
    const contentBase64 = await fileToBase64(file)
    await uploadWorkspaceAttachmentRequest({
      filename: file.name,
      content_type: file.type || "application/pdf",
      content_base64: contentBase64,
      make_default: true,
      archive_previous_default: true,
    })
    await refreshWorkspaceState()
  }, [refreshWorkspaceState])

  const handleConnectMailbox = useCallback(async () => {
    const result = await beginWorkspaceGmailConnect("/onboarding")
    window.location.assign(result.authorization_url)
  }, [])

  if (auth.status === "loading" || (auth.status === "authenticated" && workspaceLoading && location.pathname !== "/accept-invite")) {
    return (
      <>
        <FullScreenLoader />
        <Toaster position="top-center" richColors />
      </>
    )
  }

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={<Navigate replace to={auth.status === "authenticated" ? resolveAuthenticatedPath(workspaceState) : "/login"} />}
        />
        <Route
          path="/login"
          element={auth.status === "authenticated"
            ? <Navigate replace to={resolveAuthenticatedPath(workspaceState)} />
            : <LoginScreen error={auth.error} loading={auth.status === "loading"} onSubmit={handleLogin} onSwitchToSignup={() => navigate("/signup")} />}
        />
        <Route
          path="/signup"
          element={auth.status === "authenticated"
            ? <Navigate replace to={resolveAuthenticatedPath(workspaceState)} />
            : <SignupScreen error={auth.error} loading={auth.status === "loading"} onSubmit={handleSignup} onSwitchToLogin={() => navigate("/login")} />}
        />
        <Route
          path="/accept-invite"
          element={
            <InviteAcceptScreen
              authenticated={auth.status === "authenticated"}
              error={inviteError || auth.error}
              invite={invitePreview}
              loading={inviteLoading || auth.status === "loading"}
              onAccept={handleAcceptInvite}
              onLogin={handleLogin}
              onSignup={handleSignup}
            />
          }
        />
        <Route
          path="/onboarding"
          element={auth.status !== "authenticated"
            ? <Navigate replace to="/signup" />
            : workspaceState && !workspaceState.requires_bootstrap && workspaceState.onboarding?.status === "completed"
              ? <Navigate replace to="/app" />
              : (
                <OnboardingScreen
                  loading={workspaceLoading}
                  onBootstrap={handleBootstrap}
                  onConnectMailbox={handleConnectMailbox}
                  onSaveProfile={handleOnboardingSave}
                  onUploadAttachment={handleOnboardingUpload}
                  state={workspaceState}
                />
              )}
        />
        <Route
          path="/app/*"
          element={auth.status !== "authenticated"
            ? <Navigate replace to="/login" />
            : resolveAuthenticatedPath(workspaceState) !== "/app"
              ? <Navigate replace to={resolveAuthenticatedPath(workspaceState)} />
              : <MetroglassLeadsApp onLogout={auth.logout} />}
        />
      </Routes>
      <Toaster position="top-center" richColors />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <RoutedApp />
    </BrowserRouter>
  )
}
