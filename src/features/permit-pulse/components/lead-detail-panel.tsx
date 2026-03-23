import { type ReactNode, useMemo } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Bot,
  ChevronDown,
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
  ShieldCheck,
  Sparkles,
  TimerReset,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
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
  QualityTierBadge,
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
  mobile?: boolean
  onStatusChange: (leadId: string, status: LeadStatus) => void
  onEnrichmentChange: (leadId: string, patch: Partial<EnrichmentData>) => void
  onDraftChange: (leadId: string, patch: Partial<OutreachDraft>) => void
  onGenerateDraft: (leadId: string) => void
  onRunEnrichment: (leadId: string) => void
  onSendNow: (leadId: string) => void
  onFollowUpDateChange: (leadId: string, value: string) => void
  onToggleIgnored: (leadId: string) => void
  onAcceptCandidate: (leadId: string, candidateId: string) => void
  onRejectCandidate: (leadId: string, candidateId: string) => void
  onSetPrimaryContact: (leadId: string, contactId: string) => void
}

function getTrustScore(lead: PermitLead) {
  return Math.round(
    ((lead.companyProfile.confidence || 0) * 0.38) +
    ((lead.channelDecision.routeConfidence || 0) * 0.28) +
    (lead.contactability.total * 0.2) +
    (lead.outreachReadiness.score * 0.14),
  )
}

function getTrustLabel(score: number) {
  if (score >= 80) return "High trust"
  if (score >= 60) return "Solid trust"
  if (score >= 40) return "Mixed trust"
  return "Low trust"
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
          ? "h-9 justify-start rounded-2xl bg-orange-500 px-3.5 text-white hover:bg-orange-600"
          : "h-9 justify-start rounded-2xl border-navy-200 bg-white/90 px-3.5 text-navy-700 hover:bg-cream-100 dark:border-dark-border dark:bg-dark-bg dark:text-dark-text"
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
    <div className="rounded-[20px] border border-navy-200/70 bg-white/80 p-3 dark:border-dark-border/70 dark:bg-dark-card/80">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">{label}</div>
        <div className="text-sm font-semibold text-navy-900 dark:text-dark-text">{value}</div>
      </div>
      <Progress className="mt-2 h-1.5 bg-cream-100 dark:bg-dark-border/70" value={value} />
      <p className="mt-2 text-xs leading-5 text-navy-500 dark:text-dark-muted">{helper}</p>
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
    <div className="flex items-center justify-between gap-3 rounded-[18px] border border-navy-200/70 bg-cream-50/70 px-3 py-2 dark:border-dark-border/70 dark:bg-dark-bg">
      <div className="flex min-w-0 items-start gap-3">
        <div className="rounded-2xl bg-white/80 p-2 text-navy-600 dark:bg-dark-card dark:text-dark-text">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">{label}</div>
          <div className="truncate text-sm font-medium text-navy-700 dark:text-dark-text">{value || "—"}</div>
        </div>
      </div>
      {actionLabel && onAction ? (
        <Button className="h-7 rounded-xl px-2.5 text-[11px]" onClick={onAction} type="button" variant="outline">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

function ActionMeta({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-full border border-navy-200/70 bg-white/80 px-3 py-1.5 dark:border-dark-border/70 dark:bg-dark-bg">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">{label}</span>
      <span className="ml-2 text-sm font-medium text-navy-800 dark:text-dark-text">{value}</span>
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

function CandidateCard({
  candidate,
  onAccept,
  onReject,
}: {
  candidate: PermitLead["resolutionCandidates"][number]
  onAccept?: () => void
  onReject?: () => void
}) {
  return (
    <div className="rounded-[18px] border border-navy-200/70 bg-cream-50/70 px-3 py-2.5 dark:border-dark-border/70 dark:bg-dark-bg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-navy-800 dark:text-dark-text">{candidate.label || "Unnamed candidate"}</div>
          <div className="mt-1 text-xs text-navy-500 dark:text-dark-muted">
            {[candidate.role, candidate.source, `${candidate.confidence}% confidence`].filter(Boolean).join(" • ")}
          </div>
        </div>
        <div className="rounded-full border border-navy-200 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-navy-500 dark:border-dark-border dark:bg-dark-card dark:text-dark-muted">
          {candidate.status}
        </div>
      </div>
      <div className="mt-2 text-sm leading-6 text-navy-700 dark:text-dark-text">{candidate.url || candidate.domain || "No route stored"}</div>
      {candidate.detail ? (
        <p className="mt-2 text-xs leading-5 text-navy-500 dark:text-dark-muted">{candidate.detail}</p>
      ) : null}
      {candidate.matchedQuery ? (
        <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-navy-400 dark:text-dark-muted">
          Query: {candidate.matchedQuery}
        </div>
      ) : null}
      {onAccept || onReject ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {candidate.status !== "selected" && onAccept ? (
            <Button className="h-8 rounded-xl px-3 text-[11px]" onClick={onAccept} type="button">
              Use this
            </Button>
          ) : null}
          {candidate.status !== "rejected" && onReject ? (
            <Button className="h-8 rounded-xl px-3 text-[11px]" onClick={onReject} type="button" variant="outline">
              Reject
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function LeadDetailPanel({
  lead,
  automationHealth,
  isEnriching,
  isSending,
  mobile = false,
  onStatusChange,
  onEnrichmentChange,
  onDraftChange,
  onGenerateDraft,
  onRunEnrichment,
  onSendNow,
  onFollowUpDateChange,
  onToggleIgnored,
  onAcceptCandidate,
  onRejectCandidate,
  onSetPrimaryContact,
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

  const contacts = Array.isArray(lead.contacts) ? lead.contacts : []
  const resolutionCandidates = Array.isArray(lead.resolutionCandidates) ? lead.resolutionCandidates : []
  const enrichmentFacts = Array.isArray(lead.enrichmentFacts) ? lead.enrichmentFacts : []
  const activities = Array.isArray(lead.activities) ? lead.activities : []
  const readinessBlockers = Array.isArray(lead.outreachReadiness?.blockers) ? lead.outreachReadiness.blockers : []
  const contactabilityMissing = Array.isArray(lead.contactability?.missing) ? lead.contactability.missing : []
  const enrichmentSourceTags = Array.isArray(lead.enrichment?.sourceTags) ? lead.enrichment.sourceTags : []
  const propertySourceTags = Array.isArray(lead.propertyProfile?.sourceTags) ? lead.propertyProfile.sourceTags : []
  const confidenceTags = Array.isArray(lead.enrichment?.confidenceTags) ? lead.enrichment.confidenceTags : []

  const chosenContact = contacts.find((contact) => contact.isPrimary) || contacts[0] || null
  const alternativeContacts = chosenContact ? contacts.filter((contact) => contact.id !== chosenContact.id) : contacts
  const website =
    chosenContact?.website ||
    lead.enrichment.companyWebsite ||
    lead.companyProfile.website ||
    contacts.find((contact) => contact.website)?.website ||
    ""
  const primaryEmail =
    chosenContact?.email ||
    lead.enrichment.directEmail ||
    lead.enrichment.genericEmail ||
    contacts.find((contact) => contact.email)?.email ||
    ""
  const phone = chosenContact?.phone || lead.enrichment.phone || contacts.find((contact) => contact.phone)?.phone || ""
  const linkedIn =
    chosenContact?.linkedInUrl ||
    lead.enrichment.linkedInUrl ||
    lead.companyProfile.linkedInUrl ||
    contacts.find((contact) => contact.linkedInUrl)?.linkedInUrl ||
    ""
  const companyCandidates = resolutionCandidates.filter((candidate) => candidate.type === "company")
  const personCandidates = resolutionCandidates.filter((candidate) => candidate.type === "person")
  const selectedCompanyCandidate = companyCandidates.find((candidate) => candidate.status === "selected") || null
  const rejectedCompanyCandidates = companyCandidates.filter((candidate) => candidate.status !== "selected").slice(0, 4)
  const selectedPeople = personCandidates.filter((candidate) => candidate.status === "selected").slice(0, 3)
  const rejectedPeople = personCandidates.filter((candidate) => candidate.status !== "selected").slice(0, 4)
  const blocker = getLeadBlocker(lead)
  const canSendNow = Boolean(
    primaryEmail
    && lead.outreachDraft.subject
    && lead.outreachDraft.shortEmail,
  )
  const trustScore = getTrustScore(lead)
  const trustLabel = getTrustLabel(trustScore)
  const trustGaps = uniq([...readinessBlockers, ...contactabilityMissing]).slice(0, 4)
  const chosenTarget = lead.channelDecision.targetRole || chosenContact?.role || lead.companyProfile.role || "company"
  const routeQuality = lead.channelDecision.recipientType || (chosenContact?.type ?? "unrated")
  const automationSources = uniq([
    ...enrichmentSourceTags,
    ...propertySourceTags,
    lead.companyProfile.searchQuery ? "brave" : "",
    lead.companyProfile.website ? "website" : "",
    contacts.some((contact) => contact.source === "firecrawl") ? "firecrawl" : "",
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

  if (mobile) {
    return (
      <div className="relative h-full rounded-[30px] border border-navy-200/70 bg-white/90 shadow-sm backdrop-blur-xl dark:border-dark-border/70 dark:bg-dark-card/90">
        <ScrollArea className="h-full">
          <div className="space-y-3 p-3 pb-32">
            <SectionCard
              className="rounded-[28px]"
              contentClassName="space-y-3"
              description={lead.humanSummary || "Review the lead, trust the best route, and move on."}
              title={getPermitAddress(lead)}
            >
              <div className="flex flex-wrap gap-2">
                <LeadScoreBadge score={lead.score} tier={lead.leadTier} />
                <StatusBadge status={lead.workflow.status} />
                <BoroughBadge borough={lead.borough} />
              </div>

              <div className="rounded-[18px] border border-navy-200/70 bg-cream-50/80 p-3 dark:border-dark-border/70 dark:bg-dark-bg">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
                  Best next step
                </div>
                <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">
                  {lead.nextAction.label}
                </div>
                <p className="mt-1 text-sm leading-6 text-navy-600 dark:text-dark-muted">{lead.nextAction.detail}</p>
              </div>

              <div className="grid gap-2">
                <RouteRow
                  actionLabel={primaryEmail ? "Copy" : undefined}
                  icon={Mail}
                  label="Best email"
                  onAction={primaryEmail ? () => copyValue("Email", primaryEmail) : undefined}
                  value={primaryEmail || "No email selected yet"}
                />
                <div className="grid grid-cols-2 gap-2">
                  <CompactField label="Company" value={selectedCompanyCandidate?.label || lead.companyProfile.name || "Still resolving"} />
                  <CompactField label="Route" value={lead.channelDecision.primary} />
                </div>
              </div>
            </SectionCard>

            <InfoBlock title="Workflow">
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Pipeline status</label>
                  <Select onValueChange={(value) => onStatusChange(lead.id, value as LeadStatus)} value={lead.workflow.status}>
                    <SelectTrigger className="h-11 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card">
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
                    className="h-11 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onFollowUpDateChange(lead.id, event.target.value)}
                    type="date"
                    value={lead.enrichment.followUpDate}
                  />
                </div>

                <Button
                  className="h-11 justify-start rounded-2xl border-navy-200 bg-white/90 text-navy-700 hover:bg-cream-100 dark:border-dark-border dark:bg-dark-bg dark:text-dark-text"
                  onClick={() => onToggleIgnored(lead.id)}
                  type="button"
                  variant="outline"
                >
                  <TimerReset className="h-4 w-4" />
                  {lead.workflow.ignored ? "Restore lead" : "Archive lead"}
                </Button>
              </div>
            </InfoBlock>

            <InfoBlock title="Contact">
              <div className="space-y-2">
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
                  actionLabel={linkedIn ? "Open" : undefined}
                  icon={Linkedin}
                  label="LinkedIn"
                  onAction={linkedIn ? () => openExternal(linkedIn) : undefined}
                  value={linkedIn}
                />
              </div>
            </InfoBlock>

            <InfoBlock title="Company">
              <div className="grid gap-2">
                <CompactField label="Chosen company" value={lead.companyProfile.name || "—"} />
                <CompactField label="Target role" value={chosenTarget} />
                <CompactField label="Match strength" value={lead.companyProfile.matchStrength || "weak"} />
                <CompactField label="Resolver trust" value={`${trustLabel} • ${trustScore}`} />
              </div>
            </InfoBlock>

            <InfoBlock title="Permit">
              <div className="grid gap-2">
                <CompactField label="GC / Applicant" value={getApplicantDisplay(lead)} />
                <CompactField label="Filing rep" value={getFilingRepDisplay(lead)} />
                <CompactField label="Estimated cost" value={formatCurrency(lead.estimated_job_costs)} />
                <CompactField label="Work type" value={lead.work_type || "—"} />
                <CompactField label="Issued" value={formatDate(lead.issued_date)} />
                <CompactField label="Glass scope" value={lead.serviceAngle || "Custom glass scope"} />
              </div>
            </InfoBlock>

            <InfoBlock title="Outreach">
              <div className="space-y-3">
                <ControlButton
                  icon={Sparkles}
                  label="Refresh draft"
                  onClick={() => onGenerateDraft(lead.id)}
                />
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Subject</label>
                  <Input
                    className="h-11 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onDraftChange(lead.id, { subject: event.target.value })}
                    value={lead.outreachDraft.subject}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Email draft</label>
                  <Textarea
                    className="min-h-[180px] rounded-[22px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onDraftChange(lead.id, { shortEmail: event.target.value })}
                    value={lead.outreachDraft.shortEmail}
                  />
                </div>
              </div>
            </InfoBlock>

            <Collapsible className="rounded-[24px] border border-navy-200/70 bg-white/80 p-4 dark:border-dark-border/70 dark:bg-dark-card/80">
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center justify-between text-left" type="button">
                  <div>
                    <div className="text-sm font-semibold tracking-[-0.02em] text-navy-900 dark:text-dark-text">Research</div>
                    <div className="mt-1 text-sm text-navy-500 dark:text-dark-muted">Alternatives, candidates, and enrichment facts.</div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-navy-500 transition-transform group-data-[state=open]:rotate-180 dark:text-dark-muted" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 space-y-4">
                {selectedCompanyCandidate ? (
                  <CandidateCard
                    candidate={selectedCompanyCandidate}
                    onReject={() => onRejectCandidate(lead.id, selectedCompanyCandidate.id)}
                  />
                ) : null}

                {selectedPeople.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    onReject={() => onRejectCandidate(lead.id, candidate.id)}
                  />
                ))}

                {alternativeContacts.slice(0, 3).map((contact) => (
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
                      {contact.email || contact.phone || contact.linkedInUrl || "No direct route"}
                    </div>
                    {!contact.isPrimary ? (
                      <div className="mt-3">
                        <Button className="h-8 rounded-xl px-3 text-[11px]" onClick={() => onSetPrimaryContact(lead.id, contact.id)} type="button" variant="outline">
                          Set primary route
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}

                {enrichmentFacts.slice(0, 6).map((fact) => (
                  <div
                    key={fact.id}
                    className="rounded-[18px] border border-navy-200/70 bg-cream-50/70 px-3 py-2.5 dark:border-dark-border/70 dark:bg-dark-bg"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                      {fact.field.replace(/_/g, " ")}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-navy-700 dark:text-dark-text">{fact.value}</div>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>

            <Collapsible className="rounded-[24px] border border-navy-200/70 bg-white/80 p-4 dark:border-dark-border/70 dark:bg-dark-card/80">
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center justify-between text-left" type="button">
                  <div>
                    <div className="text-sm font-semibold tracking-[-0.02em] text-navy-900 dark:text-dark-text">Timeline</div>
                    <div className="mt-1 text-sm text-navy-500 dark:text-dark-muted">Recent activity and saved lead memory.</div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-navy-500 transition-transform group-data-[state=open]:rotate-180 dark:text-dark-muted" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 space-y-2">
                {activities.length === 0 ? (
                  <p className="text-sm text-navy-500 dark:text-dark-muted">No activity recorded yet.</p>
                ) : (
                  activities.slice(0, 8).map((activity) => (
                    <div
                      key={activity.id}
                      className="rounded-[18px] border border-navy-200/70 bg-cream-50/70 px-3 py-2.5 dark:border-dark-border/70 dark:bg-dark-bg"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-navy-800 dark:text-dark-text">{activity.title}</div>
                        <div className="text-[10px] uppercase tracking-[0.16em] text-navy-400 dark:text-dark-muted">{formatDate(activity.createdAt)}</div>
                      </div>
                      <div className="mt-1 text-sm leading-6 text-navy-500 dark:text-dark-muted">{activity.detail}</div>
                    </div>
                  ))
                )}
              </CollapsibleContent>
            </Collapsible>

            <Collapsible className="rounded-[24px] border border-navy-200/70 bg-white/80 p-4 dark:border-dark-border/70 dark:bg-dark-card/80">
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center justify-between text-left" type="button">
                  <div>
                    <div className="text-sm font-semibold tracking-[-0.02em] text-navy-900 dark:text-dark-text">Trace</div>
                    <div className="mt-1 text-sm text-navy-500 dark:text-dark-muted">Debug only when you need to sanity check the machine.</div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-navy-500 transition-transform group-data-[state=open]:rotate-180 dark:text-dark-muted" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 space-y-2">
                <CompactField label="Automation mode" value={automationMode} />
                <CompactField label="Current blocker" value={blocker} />
                <CompactField label="Search query" value={lead.companyProfile.searchQuery || "No stored query"} />
                <CompactField label="Worker note" value={automationNote} />
                {confidenceTags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {confidenceTags.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-navy-200 bg-white/80 px-3 py-1 text-xs text-navy-600 dark:border-dark-border dark:bg-dark-bg dark:text-dark-muted"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </CollapsibleContent>
            </Collapsible>
          </div>
        </ScrollArea>

        <div className="sticky bottom-[4.75rem] z-20 border-t border-navy-200/70 bg-white/96 p-3 backdrop-blur-xl dark:border-dark-border/70 dark:bg-dark-card/96">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button
              className="h-12 rounded-2xl bg-orange-500 text-white hover:bg-orange-600"
              disabled={!canSendNow || !automationHealth?.hasGmail || isSending}
              onClick={() => onSendNow(lead.id)}
              type="button"
            >
              <Send className="h-4 w-4" />
              {isSending ? "Sending..." : "Send email"}
            </Button>
            <Button
              className="h-12 rounded-2xl border-navy-200 bg-white/90 px-4 text-navy-700 hover:bg-cream-100 dark:border-dark-border dark:bg-dark-bg dark:text-dark-text"
              disabled={isEnriching}
              onClick={() => onRunEnrichment(lead.id)}
              type="button"
              variant="outline"
            >
              <Bot className="h-4 w-4" />
              {isEnriching ? "Running..." : "Enrich"}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full rounded-[30px] border border-navy-200/70 bg-white/80 shadow-sm backdrop-blur-xl dark:border-dark-border/70 dark:bg-dark-card/90">
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4">
          <SectionCard
            className="rounded-[30px]"
            contentClassName="space-y-4"
            description="The lead summary you need before deciding whether to research, draft, or contact."
            title={getPermitAddress(lead)}
          >
            <div className="flex flex-wrap gap-2">
              <LeadScoreBadge score={lead.score} tier={lead.leadTier} />
              <QualityTierBadge tier={lead.qualityTier} />
              <ContactabilityBadge contactability={lead.contactability} />
              <PriorityBadge label={lead.priorityLabel} />
              <StatusBadge status={lead.workflow.status} />
              <BoroughBadge borough={lead.borough} />
            </div>

            <p className="text-sm leading-6 text-navy-500 dark:text-dark-muted">{lead.humanSummary}</p>

            <div className="grid gap-2 md:grid-cols-3">
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

            <div className="grid gap-2 md:grid-cols-3">
              <CompactField label="Permit relevance" value={`${Math.round(lead.relevanceScore * 100)}%`} />
              <CompactField label="Matched wording" value={lead.relevanceKeyword || "General renovation"} />
              <CompactField label="Likely glass scope" value={lead.serviceAngle || "Custom glass scope"} />
            </div>
          </SectionCard>

          <div className="overflow-hidden rounded-[28px] border border-navy-200/70 bg-white/80 shadow-[0_24px_80px_rgba(70,55,37,0.08)] backdrop-blur-xl dark:border-dark-border/70 dark:bg-dark-card/90">
            <div className="border-b border-navy-200/70 p-4 dark:border-dark-border/70">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-3xl">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
                      Best next step
                    </div>
                    <div className="mt-2 text-xl font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">
                      {lead.nextAction.label}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-navy-600 dark:text-dark-muted">{lead.nextAction.detail}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <ActionMeta label="Primary route" value={lead.channelDecision.primary} />
                    <ActionMeta label="Readiness" value={lead.outreachReadiness.label} />
                    <ActionMeta label="Route confidence" value={`${lead.channelDecision.routeConfidence ?? 0}`} />
                    <ActionMeta label="Target" value={chosenTarget} />
                  </div>
                </div>

                <div className="rounded-[18px] border border-navy-200/70 bg-cream-50/80 px-3 py-2.5 dark:border-dark-border/70 dark:bg-dark-bg">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                    Current blocker
                  </div>
                  <div className="mt-1 text-sm font-medium text-navy-700 dark:text-dark-text">{blocker}</div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-[18px] border border-navy-200/70 bg-white/90 px-3 py-3 dark:border-dark-border/70 dark:bg-dark-bg">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Resolver trust
                        </div>
                        <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">
                          {trustLabel}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-semibold tracking-[-0.04em] text-navy-900 dark:text-dark-text">{trustScore}</div>
                        <div className="text-[10px] uppercase tracking-[0.16em] text-navy-400 dark:text-dark-muted">score</div>
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-navy-600 dark:text-dark-muted">{lead.channelDecision.reason}</p>
                    <div className="mt-2 text-[11px] text-navy-500 dark:text-dark-muted">
                      {selectedCompanyCandidate?.label || lead.companyProfile.name || "No chosen company"} • {routeQuality} route • {chosenTarget}
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-navy-200/70 bg-white/90 px-3 py-3 dark:border-dark-border/70 dark:bg-dark-bg">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                      What still needs work
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {trustGaps.length > 0 ? (
                        trustGaps.map((item) => (
                          <span
                            key={item}
                            className="rounded-full border border-navy-200 bg-cream-50 px-3 py-1 text-xs text-navy-600 dark:border-dark-border dark:bg-dark-card dark:text-dark-muted"
                          >
                            {item}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-navy-500 dark:text-dark-muted">No major blockers stored right now.</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-b border-navy-200/70 p-4 dark:border-dark-border/70">
              <div className="grid gap-2 md:grid-cols-3">
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

              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
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

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-500 dark:text-dark-muted">Queue</label>
                  <Button
                    className="h-10 w-full justify-start rounded-2xl border-navy-200 bg-white/90 text-navy-700 hover:bg-cream-100 dark:border-dark-border dark:bg-dark-bg dark:text-dark-text"
                    onClick={() => onToggleIgnored(lead.id)}
                    type="button"
                    variant="outline"
                  >
                    <TimerReset className="h-4 w-4" />
                    {lead.workflow.ignored ? "Restore" : "Archive"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-base font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">
                    Primary routes
                  </div>
                  <p className="mt-1 text-sm leading-6 text-navy-500 dark:text-dark-muted">
                    Use the cleanest route first. Everything else stays secondary.
                  </p>
                </div>
                <div className="rounded-full border border-navy-200/70 bg-cream-50/80 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-navy-500 dark:border-dark-border/70 dark:bg-dark-bg dark:text-dark-muted">
                  {chosenContact ? "Route ready" : "Still resolving"}
                </div>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
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
                  actionLabel={linkedIn ? "Open" : undefined}
                  icon={Linkedin}
                  label="LinkedIn"
                  onAction={linkedIn ? () => openExternal(linkedIn) : undefined}
                  value={linkedIn}
                />
              </div>

              <Collapsible className="mt-4 rounded-[20px] border border-navy-200/70 bg-cream-50/70 p-2 dark:border-dark-border/70 dark:bg-dark-bg">
                <CollapsibleTrigger asChild>
                  <button
                    className="group flex w-full items-center justify-between rounded-[16px] px-3 py-2 text-left"
                    type="button"
                  >
                    <div>
                      <div className="text-sm font-semibold text-navy-900 dark:text-dark-text">Research tools</div>
                      <div className="text-xs text-navy-500 dark:text-dark-muted">Open BIS, maps, search routes, and copy helpers only when needed.</div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-navy-500 transition-transform group-data-[state=open]:rotate-180 dark:text-dark-muted" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-1 pb-1 pt-2">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {actionLinks.map((link) => (
                      <ControlButton key={link.label} icon={link.icon} label={link.label} onClick={link.action} />
                    ))}
                    <ControlButton
                      disabled={!lead.job_description}
                      icon={Clipboard}
                      label="Copy permit description"
                      onClick={() => copyValue("Permit description", lead.job_description)}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>

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

                  <InfoBlock title="Resolver snapshot" description="Quick confidence context before you drop into deeper research.">
                    <div className="grid gap-2 md:grid-cols-2">
                      <CompactField label="Chosen company" value={lead.companyProfile.name || "—"} />
                      <CompactField label="Primary contact" value={chosenContact?.name || lead.enrichment.contactPersonName || "—"} />
                      <CompactField label="Route quality" value={routeQuality} />
                      <CompactField label="Target role" value={chosenTarget} />
                      <CompactField label="Neighborhood" value={lead.propertyProfile.neighborhood || "—"} />
                      <CompactField label="Building type" value={lead.propertyProfile.buildingType || "—"} />
                      <CompactField label="Search query" value={lead.companyProfile.searchQuery || "—"} />
                      <CompactField label="Match strength" value={lead.companyProfile.matchStrength || "weak"} />
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
                  <InfoBlock title="Resolver output" description="The main facts, chosen winner, and rejected candidates currently backing this lead.">
                    <div className="space-y-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        <CompactField label="Neighborhood" value={lead.propertyProfile.neighborhood || "—"} />
                        <CompactField label="Building type" value={lead.propertyProfile.buildingType || "—"} />
                        <CompactField label="Property class" value={lead.propertyProfile.propertyClass || "—"} />
                        <CompactField label="Search query" value={lead.companyProfile.searchQuery || "—"} />
                      </div>

                      <div className="space-y-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                          Chosen company
                        </div>
                        {selectedCompanyCandidate ? (
                          <CandidateCard
                            candidate={selectedCompanyCandidate}
                            onReject={() => onRejectCandidate(lead.id, selectedCompanyCandidate.id)}
                          />
                        ) : (
                          <p className="text-sm text-navy-500 dark:text-dark-muted">
                            No chosen company candidate has been stored yet.
                          </p>
                        )}
                      </div>

                      {selectedPeople.length > 0 ? (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                            Chosen people
                          </div>
                          <div className="mt-2 space-y-2">
                            {selectedPeople.map((candidate) => (
                              <CandidateCard
                                key={candidate.id}
                                candidate={candidate}
                                onReject={() => onRejectCandidate(lead.id, candidate.id)}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        {enrichmentFacts.length === 0 ? (
                          <p className="text-sm text-navy-500 dark:text-dark-muted">
                            No structured facts yet. Run enrichment to refresh company and contact clues.
                          </p>
                        ) : (
                          enrichmentFacts.slice(0, 8).map((fact) => (
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

                      {rejectedCompanyCandidates.length > 0 ? (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                            Rejected company candidates
                          </div>
                          <div className="mt-2 space-y-2">
                            {rejectedCompanyCandidates.map((candidate) => (
                              <CandidateCard
                                key={candidate.id}
                                candidate={candidate}
                                onAccept={() => onAcceptCandidate(lead.id, candidate.id)}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {rejectedPeople.length > 0 ? (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                            Rejected people candidates
                          </div>
                          <div className="mt-2 space-y-2">
                            {rejectedPeople.map((candidate) => (
                              <CandidateCard
                                key={candidate.id}
                                candidate={candidate}
                                onAccept={() => onAcceptCandidate(lead.id, candidate.id)}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}

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
                                {!contact.isPrimary ? (
                                  <div className="mt-3">
                                    <Button
                                      className="h-8 rounded-xl px-3 text-[11px]"
                                      onClick={() => onSetPrimaryContact(lead.id, contact.id)}
                                      type="button"
                                      variant="outline"
                                    >
                                      Set primary route
                                    </Button>
                                  </div>
                                ) : null}
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
                    {activities.length === 0 ? (
                      <p className="text-sm text-navy-500 dark:text-dark-muted">No activity recorded yet.</p>
                    ) : (
                      activities.map((activity) => (
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
                          {confidenceTags.length > 0 ? (
                            confidenceTags.map((item) => (
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
      </ScrollArea>
    </div>
  )
}
