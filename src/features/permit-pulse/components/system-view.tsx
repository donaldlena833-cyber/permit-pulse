import {
  Bot,
  Database,
  Globe,
  Mail,
  MapPinned,
  Search,
  ShieldCheck,
} from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/features/permit-pulse/components/page-header"
import { ProfileSettingsView } from "@/features/permit-pulse/components/profile-settings-view"
import { SectionCard } from "@/features/permit-pulse/components/section-card"
import type { AutomationHealth, TenantProfile } from "@/types/permit-pulse"
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

interface SystemViewProps {
  automationHealth: AutomationHealth | null
  alerts: SystemAlert[]
  profile: TenantProfile
  onUpdateProfile: (patch: Partial<TenantProfile>) => void
  onResetProfile: () => void
}

export function SystemView({
  automationHealth,
  alerts,
  profile,
  onUpdateProfile,
  onResetProfile,
}: SystemViewProps) {
  const providers = [
    {
      label: "Supabase",
      active: Boolean(automationHealth?.hasSupabase),
      icon: Database,
      detail: "Stores lead memory, enrichment, outreach history, and activity logs.",
    },
    {
      label: "Gmail",
      active: Boolean(automationHealth?.hasGmail),
      icon: Mail,
      detail: "Used for direct send and later auto-send once resolver trust is high enough.",
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
