import { type ReactNode, useMemo } from "react"
import type { LucideIcon } from "lucide-react"
import {
  ArrowUpRight,
  Bot,
  Clipboard,
  Globe,
  Instagram,
  Link2,
  Linkedin,
  Mail,
  MapPinned,
  NotebookPen,
  Phone,
  Search,
  Send,
  Sparkles,
  TimerReset,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  BoroughBadge,
  ContactabilityBadge,
  LeadScoreBadge,
  PriorityBadge,
  StatusBadge,
} from "@/features/permit-pulse/components/badges"
import { EmptyState } from "@/features/permit-pulse/components/empty-state"
import { SectionCard } from "@/features/permit-pulse/components/section-card"
import {
  formatCurrency,
  formatDate,
  getApplicantDisplay,
  getFilingRepDisplay,
  getPermitAddress,
} from "@/features/permit-pulse/lib/format"
import { getLeadBlocker } from "@/features/permit-pulse/lib/operator"
import type {
  AutomationHealth,
  EnrichmentData,
  LeadStatus,
  OutreachDraft,
  PermitLead,
} from "@/types/permit-pulse"

const STATUS_OPTIONS: LeadStatus[] = [
  "new",
  "reviewed",
  "researching",
  "enriched",
  "outreach-ready",
  "drafted",
  "contacted",
  "follow-up-due",
  "replied",
  "qualified",
  "quoted",
  "won",
  "lost",
  "archived",
]

interface LeadDetailPanelProps {
  lead: PermitLead | null
  automationHealth: AutomationHealth | null
  isEnriching: boolean
  isSending: boolean
  onStatusChange: (leadId: string, status: LeadStatus) => void
  onEnrichmentChange: (leadId: string, patch: Partial<EnrichmentData>) => void
  onDraftChange: (leadId: string, patch: Partial<OutreachDraft>) => void
  onGenerateDraft: (leadId: string) => void
  onRunEnrichment: (leadId: string) => void
  onSendNow: (leadId: string) => void
  onFollowUpDateChange: (leadId: string, value: string) => void
  onToggleIgnored: (leadId: string) => void
}

function copyValue(label: string, value: string) {
  if (!value) {
    toast.error(`No ${label.toLowerCase()} to copy yet.`)
    return
  }

  void navigator.clipboard.writeText(value)
  toast.success(`${label} copied`)
}

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer")
}

function quickSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function ControlButton({
  disabled,
  icon: Icon,
  label,
  loading,
  onClick,
  variant = "outline",
}: {
  disabled?: boolean
  icon: LucideIcon
  label: string
  loading?: boolean
  onClick: () => void
  variant?: "default" | "outline"
}) {
  return (
    <Button
      className={
        variant === "default"
          ? "h-10 justify-start rounded-2xl bg-orange-500 px-4 text-white hover:bg-orange-600"
          : "h-10 justify-start rounded-2xl border-navy-200 bg-white/90 px-4 text-navy-700 hover:bg-cream-100 dark:border-dark-border dark:bg-dark-bg dark:text-dark-text"
      }
      disabled={disabled || loading}
      onClick={onClick}
      type="button"
      variant={variant}
    >
      <Icon className="h-4 w-4" />
      {loading ? `${label}...` : label}
    </Button>
  )
}

function CompactField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-navy-200/70 bg-cream-50/70 px-3 py-2.5 dark:border-dark-border/70 dark:bg-dark-bg">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">{label}</div>
      <div className="mt-1 text-sm leading-6 text-navy-700 dark:text-dark-text">{value || "—"}</div>
    </div>
  )
}

function SignalCard({ label, helper, value }: { label: string; helper: string; value: number }) {
  return (
    <div className="rounded-[22px] border border-navy-200/70 bg-white/80 p-4 dark:border-dark-border/70 dark:bg-dark-card/80">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-navy-800 dark:text-dark-text">{label}</div>
        <div className="text-sm font-semibold text-navy-900 dark:text-dark-text">{value}</div>
      </div>
      <Progress className="mt-3 h-1.5 bg-cream-100 dark:bg-dark-border/70" value={value} />
      <p className="mt-3 text-sm leading-6 text-navy-500 dark:text-dark-muted">{helper}</p>
    </div>
  )
}

function RouteRow({
  actionLabel,
  icon: Icon,
  label,
  onAction,
  value,
}: {
  actionLabel?: string
  icon: LucideIcon
  label: string
  onAction?: () => void
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[20px] border border-navy-200/70 bg-cream-50/70 px-3 py-2.5 dark:border-dark-border/70 dark:bg-dark-bg">
      <div className="flex min-w-0 items-start gap-3">
        <div className="rounded-2xl bg-white/80 p-2 text-navy-600 dark:bg-dark-card dark:text-dark-text">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">{label}</div>
          <div className="truncate text-sm text-navy-700 dark:text-dark-text">{value || "—"}</div>
        </div>
      </div>
      {actionLabel && onAction ? (
        <Button className="h-8 rounded-xl px-3 text-xs" onClick={onAction} type="button" variant="outline">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

function InfoBlock({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="rounded-[24px] border border-navy-200/70 bg-white/80 p-4 dark:border-dark-border/70 dark:bg-dark-card/80">
      <div className="text-sm font-semibold tracking-[-0.02em] text-navy-900 dark:text-dark-text">{title}</div>
      {description ? <p className="mt-1 text-sm leading-6 text-navy-500 dark:text-dark-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </div>
  )
}

export function LeadDetailPanel({
  lead,
  automationHealth,
  isEnriching,
  isSending,
  onStatusChange,
  onEnrichmentChange,
  onDraftChange,
  onGenerateDraft,
  onRunEnrichment,
  onSendNow,
  onFollowUpDateChange,
  onToggleIgnored,
}: LeadDetailPanelProps) {
  const actionLinks = useMemo(() => {
    if (!lead) {
      return []
    }

    const boroughNumber =
      lead.borough === "MANHATTAN"
        ? "1"
        : lead.borough === "BRONX"
          ? "2"
          : lead.borough === "BROOKLYN"
            ? "3"
            : lead.borough === "QUEENS"
              ? "4"
              : "5"

    const address = `${lead.house_no} ${lead.street_name}, ${lead.borough}, NY ${lead.zip_code ?? ""}`.trim()
    const gcQuery = lead.applicant_business_name || getApplicantDisplay(lead)
    const ownerQuery = lead.owner_business_name || lead.owner_name || address

    return [
      {
        label: "DOB BIS",
        icon: Link2,
        action: () =>
          openExternal(
            `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?boro=${boroughNumber}&block=${lead.block}&lot=${lead.lot}`,
          ),
      },
      {
        label: "Maps",
        icon: MapPinned,
        action: () => openExternal(`https://www.google.com/maps/search/${encodeURIComponent(address)}`),
      },
      {
        label: "Owner search",
        icon: Search,
        action: () => openExternal(quickSearchUrl(`${ownerQuery} NYC`)),
      },
      {
        label: "GC search",
        icon: Search,
        action: () => openExternal(quickSearchUrl(`${gcQuery} NYC contractor phone`)),
      },
      {
        label: "LinkedIn",
        icon: Linkedin,
        action: () => openExternal(quickSearchUrl(`${gcQuery} LinkedIn`)),
      },
      {
        label: "Instagram",
        icon: Instagram,
        action: () => openExternal(quickSearchUrl(`${gcQuery} Instagram`)),
      },
    ]
  }, [lead])

  if (!lead) {
    return (
      <EmptyState
        description="Select a lead from the queue to qualify it, research the real company, and move it into outreach."
        icon={NotebookPen}
        title="No lead selected"
      />
    )
  }

  const website =
    lead.enrichment.companyWebsite ||
    lead.companyProfile.website ||
    lead.contacts.find((contact) => contact.website)?.website ||
    ""
  const primaryEmail =
    lead.enrichment.directEmail ||
    lead.enrichment.genericEmail ||
    lead.contacts.find((contact) => contact.email)?.email ||
    ""
  const phone = lead.enrichment.phone || lead.contacts.find((contact) => contact.phone)?.phone || ""
  const contactForm =
    lead.enrichment.contactFormUrl ||
    lead.contacts.find((contact) => contact.contactFormUrl)?.contactFormUrl ||
    ""
  const linkedIn =
    lead.enrichment.linkedInUrl ||
    lead.companyProfile.linkedInUrl ||
    lead.contacts.find((contact) => contact.linkedInUrl)?.linkedInUrl ||
    ""
  const instagram =
    lead.enrichment.instagramUrl ||
    lead.companyProfile.instagramUrl ||
    lead.contacts.find((contact) => contact.instagramUrl)?.instagramUrl ||
    ""

  const chosenContact = lead.contacts.find((contact) => contact.isPrimary) || lead.contacts[0] || null
  const alternativeContacts = chosenContact ? lead.contacts.filter((contact) => contact.id !== chosenContact.id) : lead.contacts
  const blocker = getLeadBlocker(lead)
  const canSendNow = Boolean(primaryEmail && lead.outreachDraft.subject && lead.outreachDraft.shortEmail)
  const automationSources = uniq([
    ...lead.enrichment.sourceTags,
    ...lead.propertyProfile.sourceTags,
    lead.companyProfile.searchQuery ? "brave" : "",
    lead.companyProfile.website ? "website" : "",
    lead.contacts.some((contact) => contact.source === "firecrawl") ? "firecrawl" : "",
  ])

  const automationMode = !automationHealth
    ? "Checking worker setup"
    : automationHealth.hasSupabase
      ? automationHealth.hasGmail
        ? "Enrichment and send are available"
        : "Enrichment is live, Gmail is still pending"
      : "Manual mode only"
  const automationNote = !automationHealth
    ? "Provider health has not loaded yet."
    : automationHealth.hasSupabase
      ? "The worker can match property context, resolve companies, scrape websites, and refresh contact routes for this lead."
      : "The worker is online, but Supabase is missing, so API-backed enrichment cannot persist."

  return (
    <div className="h-full rounded-[30px] border border-navy-200/70 bg-white/80 shadow-sm backdrop-blur-xl dark:border-dark-border/70 dark:bg-dark-card/90">
      <ScrollArea className="h-[calc(100vh-13rem)]">
        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <SectionCard
              className="rounded-[30px]"
              contentClassName="space-y-4"
              description="Chosen company, best route, and the most important signal summary for this lead."
              title={getPermitAddress(lead)}
            >
              <div className="flex flex-wrap gap-2">
                <LeadScoreBadge score={lead.score} tier={lead.leadTier} />
                <ContactabilityBadge contactability={lead.contactability} />
                <PriorityBadge label={lead.priorityLabel} />
                <StatusBadge status={lead.workflow.status} />
                <BoroughBadge borough={lead.borough} />
              </div>

              <p className="text-sm leading-6 text-navy-500 dark:text-dark-muted">{lead.humanSummary}</p>

              <div className="grid gap-3 xl:grid-cols-3">
                <SignalCard helper={lead.scoreBreakdown.summary} label="Lead score" value={lead.score} />
                <SignalCard
                  helper={lead.contactability.explanation}
                  label="Contactability"
                  value={lead.contactability.total}
                />
                <SignalCard
                  helper={lead.outreachReadiness.explanation}
                  label="Outreach readiness"
                  value={lead.outreachReadiness.score}
                />
              </div>
            </SectionCard>

            <Tabs className="space-y-4" defaultValue="overview">
              <TabsList className="h-auto w-full justify-start rounded-[24px] bg-cream-100/90 p-1 dark:bg-dark-border/70">
                <TabsTrigger className="rounded-[18px] px-4 py-2" value="overview">
                  Overview
                </TabsTrigger>
                <TabsTrigger className="rounded-[18px] px-4 py-2" value="research">
                  Research
                </TabsTrigger>
                <TabsTrigger className="rounded-[18px] px-4 py-2" value="outreach">
                  Outreach
                </TabsTrigger>
                <TabsTrigger className="rounded-[18px] px-4 py-2" value="timeline">
                  Timeline
                </TabsTrigger>
                <TabsTrigger className="rounded-[18px] px-4 py-2" value="trace">
                  Trace
                </TabsTrigger>
              </TabsList>

              <TabsContent className="space-y-4" value="overview">
                <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                  <InfoBlock title="Why this matters" description="Keep the decision support above the fold.">
                    <div className="space-y-3">
                      <div className="rounded-[20px] border border-orange-200/70 bg-orange-50/80 p-3 dark:border-orange-800/40 dark:bg-orange-900/15">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
                          Best next step
                        </div>
                        <div className="mt-2 text-base font-semibold text-navy-900 dark:text-dark-text">{lead.nextAction.label}</div>
                        <p className="mt-2 text-sm leading-6 text-navy-600 dark:text-dark-muted">{lead.nextAction.detail}</p>
                      </div>
                      <div className="rounded-[20px] border border-navy-200/70 bg-cream-50/70 p-3 dark:border-dark-border/70 dark:bg-dark-bg">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                          Current blocker
                        </div>
                        <div className="mt-2 text-sm leading-6 text-navy-700 dark:text-dark-text">{blocker}</div>
                      </div>
                    </div>
                  </InfoBlock>

                  <InfoBlock title="Permit essentials" description="Only the facts you need while deciding.">
                    <div className="grid gap-2 md:grid-cols-2">
                      <CompactField label="GC / Applicant" value={getApplicantDisplay(lead)} />
                      <CompactField label="Filing rep" value={getFilingRepDisplay(lead)} />
                      <CompactField label="Owner business" value={lead.owner_business_name || "—"} />
                      <CompactField label="Estimated cost" value={formatCurrency(lead.estimated_job_costs)} />
                      <CompactField label="Work type" value={lead.work_type || "—"} />
                      <CompactField label="Issued" value={formatDate(lead.issued_date)} />
                    </div>
                  </InfoBlock>
                </div>

                <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                  <InfoBlock title="Chosen company" description="One company profile shown by default, alternatives belong in research.">
                    <div className="grid gap-2 md:grid-cols-2">
                      <CompactField label="Company" value={lead.companyProfile.name || "—"} />
                      <CompactField label="Role" value={lead.companyProfile.role || "—"} />
                      <CompactField label="Website" value={website || "—"} />
                      <CompactField label="Match strength" value={lead.companyProfile.matchStrength || "weak"} />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-navy-500 dark:text-dark-muted">
                      {lead.companyProfile.description || "The resolver has not stored a useful description yet."}
                    </p>
                  </InfoBlock>

                  <InfoBlock title="Chosen contact route" description="The route that currently looks most usable.">
                    <div className="grid gap-2">
                      <RouteRow
                        actionLabel={primaryEmail ? "Copy" : undefined}
                        icon={Mail}
                        label="Primary email"
                        onAction={primaryEmail ? () => copyValue("Email", primaryEmail) : undefined}
                        value={primaryEmail}
                      />
                      <RouteRow
                        actionLabel={phone ? "Copy" : undefined}
                        icon={Phone}
                        label="Primary phone"
                        onAction={phone ? () => copyValue("Phone", phone) : undefined}
                        value={phone}
                      />
                      <RouteRow
                        actionLabel={linkedIn ? "Open" : undefined}
                        icon={Linkedin}
                        label="LinkedIn"
                        onAction={linkedIn ? () => openExternal(linkedIn) : undefined}
                        value={linkedIn}
                      />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-navy-500 dark:text-dark-muted">
                      {chosenContact
                        ? `${chosenContact.name || "Unnamed contact"} • ${chosenContact.role || "No role"} • ${chosenContact.source}`
                        : "No primary contact has been resolved yet."}
                    </p>
                  </InfoBlock>
                </div>
              </TabsContent>

              <TabsContent className="space-y-4" value="research">
                <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                  <InfoBlock title="Resolver output" description="The main facts and contact candidates currently backing this lead.">
                    <div className="space-y-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        <CompactField label="Neighborhood" value={lead.propertyProfile.neighborhood || "—"} />
                        <CompactField label="Building type" value={lead.propertyProfile.buildingType || "—"} />
                        <CompactField label="Property class" value={lead.propertyProfile.propertyClass || "—"} />
                        <CompactField label="Search query" value={lead.companyProfile.searchQuery || "—"} />
                      </div>

                      <div className="space-y-2">
                        {lead.enrichmentFacts.length === 0 ? (
                          <p className="text-sm text-navy-500 dark:text-dark-muted">
                            No structured facts yet. Run enrichment to refresh company and contact clues.
                          </p>
                        ) : (
                          lead.enrichmentFacts.slice(0, 8).map((fact) => (
                            <div
                              key={fact.id}
                              className="rounded-[18px] border border-navy-200/70 bg-cream-50/70 px-3 py-2.5 dark:border-dark-border/70 dark:bg-dark-bg"
                            >
                              <div className="flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                                <span>{fact.field.replace(/_/g, " ")}</span>
                                <span>{fact.source}</span>
                              </div>
                              <div className="mt-1 text-sm leading-6 text-navy-700 dark:text-dark-text">{fact.value}</div>
                            </div>
                          ))
                        )}
                      </div>

                      {alternativeContacts.length > 0 ? (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                            Alternative contacts
                          </div>
                          <div className="mt-2 space-y-2">
                            {alternativeContacts.slice(0, 4).map((contact) => (
                              <div
                                key={contact.id}
                                className="rounded-[18px] border border-navy-200/70 bg-cream-50/70 px-3 py-2.5 dark:border-dark-border/70 dark:bg-dark-bg"
                              >
                                <div className="text-sm font-medium text-navy-800 dark:text-dark-text">
                                  {contact.name || lead.companyProfile.name || "Unknown contact"}
                                </div>
                                <div className="mt-1 text-xs text-navy-500 dark:text-dark-muted">
                                  {[contact.role, contact.source, `${contact.confidence}% confidence`].filter(Boolean).join(" • ")}
                                </div>
                                <div className="mt-2 text-sm text-navy-700 dark:text-dark-text">
                                  {contact.email || contact.phone || contact.linkedInUrl || contact.website || "No direct route"}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </InfoBlock>

                  <InfoBlock title="Manual override" description="Keep manual research tight. Add only what changes the next move.">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Website</label>
                        <Input
                          className="h-10 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onEnrichmentChange(lead.id, { companyWebsite: event.target.value })}
                          placeholder="https://company.com"
                          value={lead.enrichment.companyWebsite}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Phone</label>
                        <Input
                          className="h-10 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onEnrichmentChange(lead.id, { phone: event.target.value })}
                          placeholder="(212) 555 0100"
                          value={lead.enrichment.phone}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Direct email</label>
                        <Input
                          className="h-10 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onEnrichmentChange(lead.id, { directEmail: event.target.value })}
                          placeholder="name@company.com"
                          value={lead.enrichment.directEmail}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Generic email</label>
                        <Input
                          className="h-10 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onEnrichmentChange(lead.id, { genericEmail: event.target.value })}
                          placeholder="info@company.com"
                          value={lead.enrichment.genericEmail}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Contact person</label>
                        <Input
                          className="h-10 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onEnrichmentChange(lead.id, { contactPersonName: event.target.value })}
                          placeholder="Name"
                          value={lead.enrichment.contactPersonName}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Contact role</label>
                        <Input
                          className="h-10 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onEnrichmentChange(lead.id, { contactRole: event.target.value })}
                          placeholder="Owner, estimator, PM"
                          value={lead.enrichment.contactRole}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">LinkedIn</label>
                        <Input
                          className="h-10 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onEnrichmentChange(lead.id, { linkedInUrl: event.target.value })}
                          placeholder="https://linkedin.com/..."
                          value={lead.enrichment.linkedInUrl}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Instagram</label>
                        <Input
                          className="h-10 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onEnrichmentChange(lead.id, { instagramUrl: event.target.value })}
                          placeholder="https://instagram.com/..."
                          value={lead.enrichment.instagramUrl}
                        />
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 xl:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Notes</label>
                        <Textarea
                          className="min-h-[110px] rounded-[22px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onEnrichmentChange(lead.id, { notes: event.target.value })}
                          placeholder="Short qualification notes."
                          value={lead.enrichment.notes}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Research notes</label>
                        <Textarea
                          className="min-h-[110px] rounded-[22px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onEnrichmentChange(lead.id, { researchNotes: event.target.value })}
                          placeholder="Website findings, personalization, or owner context."
                          value={lead.enrichment.researchNotes}
                        />
                      </div>
                    </div>
                  </InfoBlock>
                </div>
              </TabsContent>

              <TabsContent className="space-y-4" value="outreach">
                <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                  <InfoBlock title="Channel decision" description="Keep the sending logic visible before you touch the draft.">
                    <div className="space-y-3">
                      <CompactField label="Primary channel" value={lead.channelDecision.primary} />
                      <CompactField label="Readiness" value={lead.outreachReadiness.label} />
                      <CompactField label="Auto-send eligibility" value={lead.channelDecision.autoSendEligible ? "Eligible" : "Hold"} />
                      <div className="rounded-[20px] border border-navy-200/70 bg-cream-50/70 p-3 dark:border-dark-border/70 dark:bg-dark-bg">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                          Sending note
                        </div>
                        <p className="mt-2 text-sm leading-6 text-navy-700 dark:text-dark-text">
                          {lead.channelDecision.reason || lead.automationSummary.autoSendReason}
                        </p>
                      </div>
                    </div>
                  </InfoBlock>

                  <InfoBlock title="Draft helper" description="Editable outreach copy stays here, not all over the workspace.">
                    <div className="grid gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Subject line</label>
                        <Input
                          className="h-10 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onDraftChange(lead.id, { subject: event.target.value })}
                          value={lead.outreachDraft.subject}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Intro line</label>
                        <Textarea
                          className="min-h-[80px] rounded-[22px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onDraftChange(lead.id, { introLine: event.target.value })}
                          value={lead.outreachDraft.introLine}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Short email</label>
                        <Textarea
                          className="min-h-[180px] rounded-[22px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                          onChange={(event) => onDraftChange(lead.id, { shortEmail: event.target.value })}
                          value={lead.outreachDraft.shortEmail}
                        />
                      </div>
                      <div className="grid gap-3 xl:grid-cols-2">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Call opener</label>
                          <Textarea
                            className="min-h-[80px] rounded-[22px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                            onChange={(event) => onDraftChange(lead.id, { callOpener: event.target.value })}
                            value={lead.outreachDraft.callOpener}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Follow-up note</label>
                          <Textarea
                            className="min-h-[80px] rounded-[22px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                            onChange={(event) => onDraftChange(lead.id, { followUpNote: event.target.value })}
                            value={lead.outreachDraft.followUpNote}
                          />
                        </div>
                      </div>
                    </div>
                  </InfoBlock>
                </div>
              </TabsContent>

              <TabsContent className="space-y-4" value="timeline">
                <InfoBlock title="Activity timeline" description="Lead memory that makes rescans and interruptions easy to recover from.">
                  <div className="space-y-2">
                    {lead.activities.length === 0 ? (
                      <p className="text-sm text-navy-500 dark:text-dark-muted">No activity recorded yet.</p>
                    ) : (
                      lead.activities.map((activity) => (
                        <div
                          key={activity.id}
                          className="flex items-start gap-3 rounded-[20px] border border-navy-200/70 bg-cream-50/70 px-3 py-2.5 dark:border-dark-border/70 dark:bg-dark-bg"
                        >
                          <div className="mt-1.5 h-2 w-2 rounded-full bg-orange-500" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <div className="text-sm font-medium text-navy-800 dark:text-dark-text">{activity.title}</div>
                              <div className="text-[10px] uppercase tracking-[0.16em] text-navy-400 dark:text-dark-muted">
                                {formatDate(activity.createdAt)}
                              </div>
                            </div>
                            <p className="mt-1 text-sm leading-6 text-navy-500 dark:text-dark-muted">{activity.detail}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </InfoBlock>
              </TabsContent>

              <TabsContent className="space-y-4" value="trace">
                <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                  <InfoBlock title="Automation trace" description="Useful debug context without turning the workspace into a log viewer.">
                    <div className="space-y-3">
                      <CompactField label="Automation mode" value={automationMode} />
                      <CompactField label="Company match" value={lead.automationSummary.companyMatchStrength} />
                      <CompactField label="Enrichment confidence" value={`${lead.automationSummary.enrichmentConfidence}`} />
                      <div className="rounded-[20px] border border-navy-200/70 bg-cream-50/70 p-3 dark:border-dark-border/70 dark:bg-dark-bg">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                          Worker note
                        </div>
                        <p className="mt-2 text-sm leading-6 text-navy-700 dark:text-dark-text">{automationNote}</p>
                      </div>
                      <div className="rounded-[20px] border border-navy-200/70 bg-cream-50/70 p-3 dark:border-dark-border/70 dark:bg-dark-bg">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                          Search query
                        </div>
                        <p className="mt-2 text-sm leading-6 text-navy-700 dark:text-dark-text">
                          {lead.companyProfile.searchQuery || "No stored search query yet."}
                        </p>
                      </div>
                    </div>
                  </InfoBlock>

                  <InfoBlock title="Sources and confidence" description="The summary you use to judge whether the resolver actually found something trustworthy.">
                    <div className="space-y-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                          Source tags
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {automationSources.length > 0 ? (
                            automationSources.map((item) => (
                              <span
                                key={item}
                                className="rounded-full border border-navy-200 bg-white/80 px-3 py-1 text-xs text-navy-600 dark:border-dark-border dark:bg-dark-bg dark:text-dark-muted"
                              >
                                {item}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-navy-500 dark:text-dark-muted">No source tags stored yet.</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                          Confidence tags
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {lead.enrichment.confidenceTags.length > 0 ? (
                            lead.enrichment.confidenceTags.map((item) => (
                              <span
                                key={item}
                                className="rounded-full border border-navy-200 bg-white/80 px-3 py-1 text-xs text-navy-600 dark:border-dark-border dark:bg-dark-bg dark:text-dark-muted"
                              >
                                {item}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-navy-500 dark:text-dark-muted">No manual confidence tags yet.</span>
                          )}
                        </div>
                      </div>

                      <div className="rounded-[20px] border border-navy-200/70 bg-cream-50/70 p-3 dark:border-dark-border/70 dark:bg-dark-bg">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                          Automation reason
                        </div>
                        <p className="mt-2 text-sm leading-6 text-navy-700 dark:text-dark-text">
                          {lead.automationSummary.autoSendReason || "No automation reason stored yet."}
                        </p>
                      </div>
                    </div>
                  </InfoBlock>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <SectionCard
              contentClassName="space-y-4"
              description="Best next move, fast controls, and only the routes you actually need to use."
              title="Action rail"
            >
              <div className="rounded-[22px] border border-orange-200/70 bg-gradient-to-br from-orange-50 to-white p-4 dark:border-orange-800/40 dark:from-orange-900/15 dark:to-dark-card">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
                  Best next step
                </div>
                <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">
                  {lead.nextAction.label}
                </div>
                <p className="mt-2 text-sm leading-6 text-navy-600 dark:text-dark-muted">{lead.nextAction.detail}</p>
              </div>

              <div className="grid gap-2">
                <ControlButton
                  icon={Bot}
                  label="Run enrichment"
                  loading={isEnriching}
                  onClick={() => onRunEnrichment(lead.id)}
                  variant="default"
                />
                <ControlButton
                  icon={Sparkles}
                  label="Refresh draft"
                  onClick={() => onGenerateDraft(lead.id)}
                />
                <ControlButton
                  disabled={!canSendNow || !automationHealth?.hasGmail}
                  icon={Send}
                  label="Send now"
                  loading={isSending}
                  onClick={() => onSendNow(lead.id)}
                />
              </div>

              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Pipeline status</label>
                  <Select onValueChange={(value) => onStatusChange(lead.id, value as LeadStatus)} value={lead.workflow.status}>
                    <SelectTrigger className="h-10 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Follow-up date</label>
                  <Input
                    className="h-10 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onFollowUpDateChange(lead.id, event.target.value)}
                    type="date"
                    value={lead.enrichment.followUpDate}
                  />
                </div>

                <Button
                  className="h-10 justify-start rounded-2xl border-navy-200 bg-white/90 text-navy-700 hover:bg-cream-100 dark:border-dark-border dark:bg-dark-bg dark:text-dark-text"
                  onClick={() => onToggleIgnored(lead.id)}
                  type="button"
                  variant="outline"
                >
                  <TimerReset className="h-4 w-4" />
                  {lead.workflow.ignored ? "Bring back into queue" : "Archive from active queue"}
                </Button>
              </div>
            </SectionCard>

            <SectionCard
              contentClassName="space-y-3"
              description="The cleanest current routes for reaching this lead."
              title="Contact routes"
            >
              <RouteRow
                actionLabel={primaryEmail ? "Copy" : undefined}
                icon={Mail}
                label="Email"
                onAction={primaryEmail ? () => copyValue("Email", primaryEmail) : undefined}
                value={primaryEmail}
              />
              <RouteRow
                actionLabel={phone ? "Copy" : undefined}
                icon={Phone}
                label="Phone"
                onAction={phone ? () => copyValue("Phone", phone) : undefined}
                value={phone}
              />
              <RouteRow
                actionLabel={website ? "Open" : undefined}
                icon={Globe}
                label="Website"
                onAction={website ? () => openExternal(website.startsWith("http") ? website : `https://${website}`) : undefined}
                value={website}
              />
              <RouteRow
                actionLabel={contactForm ? "Open" : undefined}
                icon={ArrowUpRight}
                label="Contact form"
                onAction={contactForm ? () => openExternal(contactForm) : undefined}
                value={contactForm}
              />
              <RouteRow
                actionLabel={linkedIn ? "Open" : undefined}
                icon={Linkedin}
                label="LinkedIn"
                onAction={linkedIn ? () => openExternal(linkedIn) : undefined}
                value={linkedIn}
              />
              <RouteRow
                actionLabel={instagram ? "Open" : undefined}
                icon={Instagram}
                label="Instagram"
                onAction={instagram ? () => openExternal(instagram) : undefined}
                value={instagram}
              />
            </SectionCard>

            <SectionCard
              contentClassName="grid gap-2"
              description="Fast manual research actions when you want to verify the resolver yourself."
              title="Research shortcuts"
            >
              {actionLinks.map((link) => (
                <ControlButton key={link.label} icon={link.icon} label={link.label} onClick={link.action} />
              ))}
              <ControlButton
                disabled={!lead.job_description}
                icon={Clipboard}
                label="Copy permit description"
                onClick={() => copyValue("Permit description", lead.job_description)}
              />
            </SectionCard>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
