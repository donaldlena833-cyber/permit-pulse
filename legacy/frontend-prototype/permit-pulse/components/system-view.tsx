import {
  AlertTriangle,
  Bot,
  Clock3,
  FileText,
  Database,
  Globe,
  Mail,
  MapPinned,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/features/permit-pulse/components/page-header"
import { ProfileSettingsView } from "@/features/permit-pulse/components/profile-settings-view"
import { SectionCard } from "@/features/permit-pulse/components/section-card"
import type { AutomationHealth, AutomationJob, TenantProfile } from "@/types/permit-pulse"
import type { SystemAlert } from "@/features/permit-pulse/lib/operator"
import { cn } from "@/lib/utils"

function ProviderCard({
  active,
  icon: Icon,
  label,
  detail,
}: {
  active: boolean
  icon: typeof Database
  label: string
  detail: string
}) {
  return (
    <div
      className={cn(
        "rounded-[24px] border p-4",
        active
          ? "border-emerald-200/60 bg-emerald-50/75 dark:border-emerald-900/40 dark:bg-emerald-950/20"
          : "border-navy-200/70 bg-cream-50/80 dark:border-dark-border/70 dark:bg-dark-bg",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "rounded-2xl p-2.5",
            active ? "bg-emerald-600 text-white" : "bg-cream-100 text-navy-600 dark:bg-dark-border/70 dark:text-dark-text",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-navy-900 dark:text-dark-text">{label}</div>
          <div className="text-xs text-navy-500 dark:text-dark-muted">{active ? "Live" : "Missing"}</div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-navy-600 dark:text-dark-muted">{detail}</p>
    </div>
  )
}

function JobStatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "neutral" | "success" | "warning"
}) {
  return (
    <div
      className={cn(
        "rounded-[24px] border px-4 py-3",
        tone === "success"
          ? "border-emerald-200/60 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20"
          : tone === "warning"
            ? "border-orange-200/60 bg-orange-50/80 dark:border-orange-800/40 dark:bg-orange-950/20"
            : "border-navy-200/70 bg-cream-50/80 dark:border-dark-border/70 dark:bg-dark-bg",
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-navy-500 dark:text-dark-muted">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-navy-900 dark:text-dark-text">{value}</div>
    </div>
  )
}

function formatJobLabel(job: AutomationJob): string {
  switch (job.jobType) {
    case "permit_ingest":
      return "Permit ingest"
    case "enrichment_batch":
      return "Enrichment batch"
    case "lead_enrichment":
      return "Lead enrichment"
    case "draft_refresh":
      return "Draft refresh"
    case "send":
      return "Send"
    case "status_update":
      return "Status update"
    case "manual_enrichment":
      return "Manual enrichment"
    case "candidate_select":
      return "Resolver accept"
    case "candidate_reject":
      return "Resolver reject"
    case "primary_contact":
      return "Primary route"
    default:
      return job.jobType
  }
}

function formatJobStatus(job: AutomationJob): string {
  switch (job.status) {
    case "running":
      return "Running"
    case "retrying":
      return "Retrying"
    case "succeeded":
      return "Succeeded"
    case "failed":
      return "Failed"
    default:
      return "Queued"
  }
}

interface SystemViewProps {
  automationHealth: AutomationHealth | null
  alerts: SystemAlert[]
  jobs: AutomationJob[]
  profile: TenantProfile
  onRetryJob: (jobId: string) => void
  onUpdateProfile: (patch: Partial<TenantProfile>) => void
  onResetProfile: () => void
}

export function SystemView({
  automationHealth,
  alerts,
  jobs,
  profile,
  onRetryJob,
  onUpdateProfile,
  onResetProfile,
}: SystemViewProps) {
  const jobStats = {
    running: jobs.filter((job) => job.status === "running" || job.status === "retrying").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    succeeded: jobs.filter((job) => job.status === "succeeded").length,
  }
  const recentJobs = jobs.slice(0, 8)
  const providers = [
    {
      label: "Supabase",
      active: Boolean(automationHealth?.hasSupabase),
      icon: Database,
      detail: automationHealth?.hasSupabase
        ? automationHealth.supabaseAuthMode === "service_role"
          ? "Stores lead memory, enrichment, outreach history, and activity logs through the secure service-role path."
          : "Stores lead memory and automation state, but the worker is still using the anon fallback and should be hardened."
        : "Stores lead memory, enrichment, outreach history, and activity logs.",
    },
    {
      label: "Gmail",
      active: Boolean(automationHealth?.hasGmail),
      icon: Mail,
      detail: "Used for direct send and later auto-send once resolver trust is high enough.",
    },
    {
      label: "Default PDF",
      active: Boolean(automationHealth?.hasDefaultAttachment),
      icon: FileText,
      detail: automationHealth?.hasDefaultAttachment
        ? `${automationHealth.defaultAttachmentName || "Default attachment"} will be added to every sent outreach email.`
        : "No default PDF attachment is loaded yet, so sends will go out without the one-pager.",
    },
    {
      label: "Brave Search",
      active: Boolean(automationHealth?.hasBrave),
      icon: Search,
      detail: "Primary search layer for company domains, people clues, and public contact routes.",
    },
    {
      label: "Google Maps",
      active: Boolean(automationHealth?.hasGoogleMaps),
      icon: MapPinned,
      detail: "Normalizes addresses, place matches, and neighborhood context for each permit.",
    },
    {
      label: "Firecrawl",
      active: Boolean(automationHealth?.hasFirecrawl),
      icon: Globe,
      detail: "Scrapes the chosen site for contact pages, service language, and public routes.",
    },
    {
      label: "ZeroBounce",
      active: Boolean(automationHealth?.hasZeroBounce),
      icon: ShieldCheck,
      detail: "Reserved for high-value leads right before send, so credits are not wasted.",
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="Automation health, scoring logic, and machine settings."
        description="Keep strategy and machine setup separate from the daily review loop. This is where you tune the system and verify what is actually online."
      />

      <Tabs className="space-y-6" defaultValue="automation">
        <TabsList className="grid w-full max-w-[360px] grid-cols-2 rounded-full bg-cream-100 p-1 dark:bg-dark-border/70">
          <TabsTrigger className="rounded-full" value="automation">
            Automation
          </TabsTrigger>
          <TabsTrigger className="rounded-full" value="scoring">
            Scoring
          </TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-6" value="automation">
          <SectionCard
            description="A simple read on what is healthy, what is missing, and why enrichment quality may still be weak."
            title="Provider health"
          >
            <div className="grid gap-4 xl:grid-cols-3">
              {providers.map((provider) => (
                <ProviderCard
                  key={provider.label}
                  active={provider.active}
                  detail={provider.detail}
                  icon={provider.icon}
                  label={provider.label}
                />
              ))}
            </div>
          </SectionCard>

          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <SectionCard
              description="Operator-facing alerts only. No raw stack traces unless we explicitly need them."
              title="System notes"
            >
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={cn(
                      "rounded-[22px] border px-4 py-3",
                      alert.tone === "warning"
                        ? "border-orange-200 bg-orange-50/80 dark:border-orange-800/40 dark:bg-orange-900/15"
                        : alert.tone === "success"
                          ? "border-emerald-200/60 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                          : "border-navy-200/70 bg-cream-50/80 dark:border-dark-border/70 dark:bg-dark-bg",
                    )}
                  >
                    <div className="text-sm font-semibold text-navy-900 dark:text-dark-text">{alert.title}</div>
                    <p className="mt-1 text-sm leading-6 text-navy-600 dark:text-dark-muted">{alert.description}</p>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              description="The machine should feel predictable. Keep the stages visible and the current guardrails explicit."
              title="Automation flow"
            >
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  {
                    title: "1. Ingest permits",
                    detail: "Pull DOB permits, normalize core fields, score fit, and write clean lead rows.",
                  },
                  {
                    title: "2. Resolve context",
                    detail: "Match property, company, and contact routes through search, maps, and website scraping.",
                  },
                  {
                    title: "3. Prepare outreach",
                    detail: "Rank contact routes, generate drafts, and only allow sending once the machine is trustworthy.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-[24px] border border-navy-200/70 bg-cream-50/80 p-4 dark:border-dark-border/70 dark:bg-dark-bg"
                  >
                    <div className="inline-flex items-center gap-2 text-sm font-semibold text-navy-900 dark:text-dark-text">
                      <Bot className="h-4 w-4 text-orange-500" />
                      {item.title}
                    </div>
                    <p className="mt-3 text-sm leading-6 text-navy-600 dark:text-dark-muted">{item.detail}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
            <SectionCard
              description="Recent automation state, so you can tell whether the machine ran, stalled, or failed without reading raw logs."
              title="Run ledger"
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <JobStatCard label="Running" tone="neutral" value={jobStats.running} />
                <JobStatCard label="Failed" tone={jobStats.failed > 0 ? "warning" : "neutral"} value={jobStats.failed} />
                <JobStatCard
                  label="Succeeded"
                  tone={jobStats.succeeded > 0 ? "success" : "neutral"}
                  value={jobStats.succeeded}
                />
              </div>

              <div className="mt-5 space-y-3">
                {recentJobs.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-navy-200/70 bg-cream-50/80 px-4 py-5 text-sm leading-6 text-navy-600 dark:border-dark-border/70 dark:bg-dark-bg dark:text-dark-muted">
                    No automation jobs are logged yet. Once ingest, enrichment, or send runs, they will appear here with clear success or failure state.
                  </div>
                ) : (
                  recentJobs.map((job) => (
                    <div
                      key={job.id}
                      className={cn(
                        "rounded-[24px] border px-4 py-4",
                        job.status === "failed"
                          ? "border-orange-200/70 bg-orange-50/80 dark:border-orange-800/40 dark:bg-orange-950/15"
                          : job.status === "succeeded"
                            ? "border-emerald-200/60 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/15"
                            : "border-navy-200/70 bg-cream-50/80 dark:border-dark-border/70 dark:bg-dark-bg",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-navy-900 dark:text-dark-text">
                              {formatJobLabel(job)}
                            </span>
                            <span className="rounded-full border border-navy-200/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-navy-500 dark:border-dark-border dark:text-dark-muted">
                              {formatJobStatus(job)}
                            </span>
                            <span className="text-xs text-navy-500 dark:text-dark-muted">
                              Attempt {job.attemptCount}
                            </span>
                          </div>
                          <div className="text-sm font-medium text-navy-700 dark:text-dark-text/90">{job.summary}</div>
                          <p className="text-sm leading-6 text-navy-600 dark:text-dark-muted">{job.detail}</p>
                        </div>
                        {job.status === "failed" && job.retryable ? (
                          <Button className="rounded-full" onClick={() => onRetryJob(job.id)} type="button" variant="outline">
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Retry
                          </Button>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-navy-500 dark:text-dark-muted">
                        <span className="inline-flex items-center gap-1.5">
                          <Bot className="h-3.5 w-3.5" />
                          {job.provider || "worker"}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 className="h-3.5 w-3.5" />
                          {job.finishedAt || job.startedAt || job.createdAt}
                        </span>
                        {job.leadId ? (
                          <span className="inline-flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Lead {job.leadId}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>

            <SectionCard
              description="Treat these as safe operator answers to the most common question, which is whether retrying is worth your time."
              title="Recovery guidance"
            >
              <div className="space-y-3">
                {[
                  {
                    title: "Ingest failures",
                    detail: "Usually mean the permit pull or write path stalled. Retry is safe and should not duplicate rows because ingest upserts by permit key.",
                  },
                  {
                    title: "Enrichment failures",
                    detail: "Usually point to provider timeouts, weak search matches, or temporary API issues. Retry is worth doing once before manual research.",
                  },
                  {
                    title: "Send failures",
                    detail: "Treat these as sensitive. Retry only after confirming the route is still correct and the latest draft is the one you want going out.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-[24px] border border-navy-200/70 bg-cream-50/80 px-4 py-4 dark:border-dark-border/70 dark:bg-dark-bg"
                  >
                    <div className="text-sm font-semibold text-navy-900 dark:text-dark-text">{item.title}</div>
                    <p className="mt-2 text-sm leading-6 text-navy-600 dark:text-dark-muted">{item.detail}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="scoring">
          <ProfileSettingsView
            onReset={onResetProfile}
            onUpdate={onUpdateProfile}
            profile={profile}
            showHeader={false}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
