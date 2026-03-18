import { useMemo } from "react"
import {
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
  Sparkles,
  TimerReset,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/features/permit-pulse/components/empty-state"
import {
  BoroughBadge,
  ContactabilityBadge,
  LeadScoreBadge,
  PriorityBadge,
  StatusBadge,
} from "@/features/permit-pulse/components/badges"
import { SectionCard } from "@/features/permit-pulse/components/section-card"
import {
  formatCurrency,
  formatDate,
  getApplicantDisplay,
  getFilingRepDisplay,
  getPermitAddress,
  toCommaList,
} from "@/features/permit-pulse/lib/format"
import type { EnrichmentData, LeadStatus, OutreachDraft, PermitLead } from "@/types/permit-pulse"

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
  onStatusChange: (leadId: string, status: LeadStatus) => void
  onEnrichmentChange: (leadId: string, patch: Partial<EnrichmentData>) => void
  onDraftChange: (leadId: string, patch: Partial<OutreachDraft>) => void
  onGenerateDraft: (leadId: string) => void
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

function QuickActionButton({
  label,
  onClick,
  icon: Icon,
}: {
  label: string
  onClick: () => void
  icon: typeof Globe
}) {
  return (
    <Button
      className="justify-start rounded-2xl border-navy-200 bg-white/80 text-navy-700 hover:bg-cream-100 dark:border-dark-border dark:bg-dark-bg dark:text-dark-text"
      onClick={onClick}
      type="button"
      variant="outline"
    >
      <Icon className="h-4 w-4" />
      {label}
    </Button>
  )
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-navy-200/70 bg-cream-50/70 p-4 dark:border-dark-border/70 dark:bg-dark-bg">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-navy-400 dark:text-dark-muted">{label}</div>
      <div className="mt-2 text-sm leading-6 text-navy-700 dark:text-dark-text">{value || "—"}</div>
    </div>
  )
}

function SignalBar({ label, value, helper }: { label: string; value: number; helper: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-navy-700 dark:text-dark-text">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <Progress className="h-2 bg-cream-100 dark:bg-dark-border/70" value={value} />
      <p className="text-sm leading-6 text-navy-500 dark:text-dark-muted">{helper}</p>
    </div>
  )
}

export function LeadDetailPanel({
  lead,
  onStatusChange,
  onEnrichmentChange,
  onDraftChange,
  onGenerateDraft,
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
        label: "Search owner",
        icon: Search,
        action: () => openExternal(quickSearchUrl(`${ownerQuery} NYC`)),
      },
      {
        label: "Search GC",
        icon: Search,
        action: () => openExternal(quickSearchUrl(`${gcQuery} NYC contractor phone`)),
      },
      {
        label: "Search LinkedIn",
        icon: Linkedin,
        action: () => openExternal(quickSearchUrl(`${gcQuery} LinkedIn`)),
      },
      {
        label: "Search Instagram",
        icon: Instagram,
        action: () => openExternal(quickSearchUrl(`${gcQuery} Instagram`)),
      },
    ]
  }, [lead])

  if (!lead) {
    return (
      <EmptyState
        description="Select a permit from the scanner, enrichment queue, or outreach queue to turn it into an operational lead."
        icon={NotebookPen}
        title="No lead selected"
      />
    )
  }

  return (
    <div className="h-full rounded-[30px] border border-navy-200/70 bg-white/80 shadow-sm backdrop-blur-xl dark:border-dark-border/70 dark:bg-dark-card/90">
      <ScrollArea className="h-[calc(100vh-13rem)]">
        <div className="space-y-6 p-5">
          <div className="rounded-[28px] border border-orange-200/60 bg-gradient-to-br from-orange-50 to-white p-5 dark:border-orange-800/40 dark:from-orange-900/15 dark:to-dark-card">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-600 dark:text-orange-300">
                  Lead workspace
                </div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-navy-900 dark:text-dark-text">
                  {getPermitAddress(lead)}
                </h2>
                <p className="max-w-3xl text-sm leading-7 text-navy-500 dark:text-dark-muted">{lead.humanSummary}</p>
                <div className="flex flex-wrap gap-2">
                  <LeadScoreBadge score={lead.score} tier={lead.leadTier} />
                  <ContactabilityBadge contactability={lead.contactability} />
                  <PriorityBadge label={lead.priorityLabel} />
                  <StatusBadge status={lead.workflow.status} />
                  <BoroughBadge borough={lead.borough} />
                </div>
              </div>

              <div className="rounded-[24px] border border-orange-200 bg-white/80 p-4 dark:border-orange-800/40 dark:bg-dark-bg">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-navy-400 dark:text-dark-muted">
                  Best next step
                </div>
                <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">
                  {lead.nextAction.label}
                </div>
                <p className="mt-2 max-w-xs text-sm leading-6 text-navy-500 dark:text-dark-muted">{lead.nextAction.detail}</p>
              </div>
            </div>
          </div>

          <SectionCard
            action={
              <Button className="rounded-full" onClick={() => onGenerateDraft(lead.id)} type="button" variant="outline">
                <Sparkles className="h-4 w-4" />
                Draft helper
              </Button>
            }
            description="Lead score, contactability, priority, and the current pipeline state."
            title="Signal stack"
          >
            <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
              <div className="space-y-5">
                <SignalBar helper={lead.scoreBreakdown.summary} label="Lead score" value={lead.score} />
                <SignalBar
                  helper={lead.contactability.explanation}
                  label="Contactability"
                  value={lead.contactability.total}
                />
                <SignalBar helper={lead.nextAction.detail} label="Priority score" value={lead.priorityScore} />
              </div>

              <div className="rounded-[24px] border border-navy-200/70 bg-cream-50/70 p-4 dark:border-dark-border/70 dark:bg-dark-bg">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-navy-400 dark:text-dark-muted">
                  Pipeline
                </div>
                <div className="mt-4 grid gap-4">
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

                  <Input
                    className="h-11 rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onFollowUpDateChange(lead.id, event.target.value)}
                    type="date"
                    value={lead.enrichment.followUpDate}
                  />

                  <Button
                    className="justify-start rounded-2xl"
                    onClick={() => onToggleIgnored(lead.id)}
                    type="button"
                    variant="outline"
                  >
                    <TimerReset className="h-4 w-4" />
                    {lead.workflow.ignored ? "Bring back into queues" : "Archive from active queues"}
                  </Button>
                </div>
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <SectionCard
              description="Permit basics, fit explanation, and source-side context."
              title="Permit intelligence"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <MetaField label="Owner" value={lead.owner_name || "—"} />
                <MetaField label="Owner business" value={lead.owner_business_name || "—"} />
                <MetaField label="GC / Applicant" value={getApplicantDisplay(lead)} />
                <MetaField label="Filing rep" value={getFilingRepDisplay(lead)} />
                <MetaField label="Work type" value={lead.work_type || "—"} />
                <MetaField label="Filing reason" value={lead.filing_reason || "—"} />
                <MetaField label="Estimated cost" value={formatCurrency(lead.estimated_job_costs)} />
                <MetaField label="Floor(s)" value={lead.work_on_floor || "—"} />
                <MetaField label="Approved" value={formatDate(lead.approved_date)} />
                <MetaField label="Issued" value={formatDate(lead.issued_date)} />
                <MetaField label="Expires" value={formatDate(lead.expired_date)} />
                <MetaField label="BIN / Block / Lot" value={`${lead.bin} / ${lead.block} / ${lead.lot}`} />
              </div>
              <div className="rounded-[22px] border border-navy-200/70 bg-white/80 p-4 dark:border-dark-border/70 dark:bg-dark-card/80">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-navy-400 dark:text-dark-muted">
                  Permit description
                </div>
                <p className="mt-3 text-sm leading-7 text-navy-600 dark:text-dark-muted">{lead.job_description}</p>
              </div>
            </SectionCard>

            <SectionCard
              description="One-click research routes plus editable contact data for the lead."
              title="Enrichment workbench"
            >
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {actionLinks.map((link) => (
                  <QuickActionButton key={link.label} icon={link.icon} label={link.label} onClick={link.action} />
                ))}
                {lead.enrichment.companyWebsite ? (
                  <QuickActionButton
                    icon={Globe}
                    label="Open website"
                    onClick={() => openExternal(lead.enrichment.companyWebsite)}
                  />
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Company website</label>
                  <div className="flex gap-2">
                    <Input
                      className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                      onChange={(event) => onEnrichmentChange(lead.id, { companyWebsite: event.target.value })}
                      placeholder="https://company.com"
                      value={lead.enrichment.companyWebsite}
                    />
                    <Button onClick={() => copyValue("Website", lead.enrichment.companyWebsite)} size="icon" type="button" variant="outline">
                      <Clipboard className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Phone</label>
                  <div className="flex gap-2">
                    <Input
                      className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                      onChange={(event) => onEnrichmentChange(lead.id, { phone: event.target.value })}
                      placeholder="(212) 555-0100"
                      value={lead.enrichment.phone}
                    />
                    <Button onClick={() => copyValue("Phone", lead.enrichment.phone)} size="icon" type="button" variant="outline">
                      <Phone className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Direct email</label>
                  <div className="flex gap-2">
                    <Input
                      className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                      onChange={(event) => onEnrichmentChange(lead.id, { directEmail: event.target.value })}
                      placeholder="name@company.com"
                      value={lead.enrichment.directEmail}
                    />
                    <Button onClick={() => copyValue("Direct email", lead.enrichment.directEmail)} size="icon" type="button" variant="outline">
                      <Mail className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Generic email</label>
                  <Input
                    className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onEnrichmentChange(lead.id, { genericEmail: event.target.value })}
                    placeholder="info@company.com"
                    value={lead.enrichment.genericEmail}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Contact form URL</label>
                  <Input
                    className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onEnrichmentChange(lead.id, { contactFormUrl: event.target.value })}
                    placeholder="https://company.com/contact"
                    value={lead.enrichment.contactFormUrl}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">LinkedIn</label>
                  <Input
                    className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onEnrichmentChange(lead.id, { linkedInUrl: event.target.value })}
                    placeholder="https://linkedin.com/in/..."
                    value={lead.enrichment.linkedInUrl}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Instagram</label>
                  <Input
                    className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onEnrichmentChange(lead.id, { instagramUrl: event.target.value })}
                    placeholder="https://instagram.com/..."
                    value={lead.enrichment.instagramUrl}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Contact person</label>
                  <Input
                    className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onEnrichmentChange(lead.id, { contactPersonName: event.target.value })}
                    placeholder="John Doe"
                    value={lead.enrichment.contactPersonName}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Contact role</label>
                  <Input
                    className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onEnrichmentChange(lead.id, { contactRole: event.target.value })}
                    placeholder="Owner, estimator, PM..."
                    value={lead.enrichment.contactRole}
                  />
                </div>
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <SectionCard
              description="Manual research memory, source tags, and confidence notes that survive rescans."
              title="Research notes"
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Notes</label>
                  <Textarea
                    className="min-h-[120px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onEnrichmentChange(lead.id, { notes: event.target.value })}
                    placeholder="Practical notes for qualification and follow-through."
                    value={lead.enrichment.notes}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Research notes</label>
                  <Textarea
                    className="min-h-[160px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onEnrichmentChange(lead.id, { researchNotes: event.target.value })}
                    placeholder="Website findings, bid angle, owner/operator context, or field notes."
                    value={lead.enrichment.researchNotes}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Source tags</label>
                    <Input
                      className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                      onChange={(event) =>
                        onEnrichmentChange(lead.id, { sourceTags: toCommaList(event.target.value) })
                      }
                      placeholder="Website, LinkedIn, Google Maps"
                      value={lead.enrichment.sourceTags.join(", ")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Confidence tags</label>
                    <Input
                      className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                      onChange={(event) =>
                        onEnrichmentChange(lead.id, { confidenceTags: toCommaList(event.target.value) })
                      }
                      placeholder="Strong match, direct phone, owner-confirmed"
                      value={lead.enrichment.confidenceTags.join(", ")}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              action={
                <Button className="rounded-full" onClick={() => onGenerateDraft(lead.id)} type="button">
                  <Sparkles className="h-4 w-4" />
                  Refresh drafts
                </Button>
              }
              description="Editable drafts with a practical, contractor-to-contractor tone."
              title="Outreach draft helper"
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Subject line</label>
                  <Input
                    className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onDraftChange(lead.id, { subject: event.target.value })}
                    value={lead.outreachDraft.subject}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Intro line</label>
                  <Textarea
                    className="min-h-[90px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onDraftChange(lead.id, { introLine: event.target.value })}
                    value={lead.outreachDraft.introLine}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Short cold email</label>
                  <Textarea
                    className="min-h-[190px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onDraftChange(lead.id, { shortEmail: event.target.value })}
                    value={lead.outreachDraft.shortEmail}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Call opener</label>
                  <Textarea
                    className="min-h-[90px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onDraftChange(lead.id, { callOpener: event.target.value })}
                    value={lead.outreachDraft.callOpener}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Follow-up note</label>
                  <Textarea
                    className="min-h-[90px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onDraftChange(lead.id, { followUpNote: event.target.value })}
                    value={lead.outreachDraft.followUpNote}
                  />
                </div>
              </div>
            </SectionCard>
          </div>

          <SectionCard
            description="Lead memory that explains what changed and when."
            title="Activity timeline"
          >
            <div className="space-y-3">
              {lead.activities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-4 rounded-[22px] border border-navy-200/70 bg-cream-50/70 p-4 dark:border-dark-border/70 dark:bg-dark-bg"
                >
                  <div className="mt-1 h-2.5 w-2.5 rounded-full bg-orange-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="font-medium text-navy-800 dark:text-dark-text">{activity.title}</div>
                      <div className="text-xs uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                        {formatDate(activity.createdAt)}
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-navy-500 dark:text-dark-muted">{activity.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </ScrollArea>
    </div>
  )
}
