import { useMemo, useRef, useState } from "react"
import { BarChart3, LoaderCircle, Search, ShieldBan, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Panel } from "@/features/metroglass-leads/components/panel"
import {
  formatDate,
  formatProspectCategory,
  formatProspectQueueState,
  formatRelativeTime,
} from "@/features/metroglass-leads/lib/format"
import type {
  ProspectCategory,
  ProspectRow,
  ProspectsPayload,
  ProspectStatus,
} from "@/features/metroglass-leads/types/api"
import { parseCsvText } from "@/features/metroglass-prospects/lib/csv"

const CATEGORY_VALUES: ProspectCategory[] = [
  "architect",
  "interior_designer",
  "property_manager",
  "project_manager",
  "gc",
]

const STATUS_FILTERS: Array<"all" | ProspectStatus> = ["all", "new", "drafted", "sent", "replied", "opted_out", "archived"]

interface ProspectsScreenProps {
  prospects: ProspectsPayload | null
  statusFilter: "all" | ProspectStatus
  categoryFilter: "all" | ProspectCategory
  query: string
  onStatusFilterChange: (value: "all" | ProspectStatus) => void
  onCategoryFilterChange: (value: "all" | ProspectCategory) => void
  onQueryChange: (value: string) => void
  onOpenProspect: (prospect: ProspectRow) => void
  onImportCsv: (payload: { filename: string; category: ProspectCategory; rows: Array<Record<string, string>> }) => Promise<void>
  actionTargetId: string | null
}

function queueCount(payload: ProspectsScreenProps["prospects"], category: ProspectCategory) {
  return payload?.automation.initial_queue_by_category?.[category] ?? 0
}

function followUpCount(payload: ProspectsScreenProps["prospects"], category: ProspectCategory) {
  return payload?.automation.follow_up_due_by_category?.[category] ?? 0
}

function suppressedCount(payload: ProspectsScreenProps["prospects"], category: ProspectCategory) {
  return payload?.automation.suppressed_by_category?.[category] ?? payload?.automation.opted_out_by_category?.[category] ?? 0
}

function descriptionPreview(prospect: ProspectRow) {
  const text = String(prospect.notes || "").trim()
  if (!text) return "No personalization description saved yet."
  if (text.length <= 120) return text
  return `${text.slice(0, 117).trim()}...`
}

export function ProspectsScreen({
  prospects,
  statusFilter,
  categoryFilter,
  query,
  onStatusFilterChange,
  onCategoryFilterChange,
  onQueryChange,
  onOpenProspect,
  onImportCsv,
  actionTargetId,
}: ProspectsScreenProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadCategory, setUploadCategory] = useState<ProspectCategory>("architect")
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const importBusy = uploading || actionTargetId === "prospects-import"

  const selectedFileLabel = useMemo(() => {
    if (!uploadFile) {
      return "Choose a CSV to import"
    }
    return `${uploadFile.name} · ${Math.max(1, Math.round(uploadFile.size / 1024))} KB`
  }, [uploadFile])

  async function handleImport() {
    if (!uploadFile) {
      toast.error("Choose a CSV file first")
      return
    }

    setUploading(true)
    try {
      const text = await uploadFile.text()
      const rows = parseCsvText(text)
      if (rows.length === 0) {
        throw new Error("CSV file does not contain any usable rows")
      }
      await onImportCsv({
        filename: uploadFile.name,
        category: uploadCategory,
        rows,
      })
      setUploadFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CSV import failed")
    } finally {
      setUploading(false)
    }
  }

  const metrics = prospects?.automation.metrics
  const programs = prospects?.automation.campaigns ?? []

  return (
    <div className="space-y-5 pb-32">
      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel className="bg-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-brand-700">
                Outreach CRM
              </div>
              <h1 className="mt-4 text-4xl font-extrabold tracking-[-0.05em] text-steel-950 sm:text-[3rem]">
                Contact store, sequences, and daily send control
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-steel-600">
                This workspace is built for outbound execution: imports, personalization, send quotas, follow-up schedule, suppression safety, and contact-level visibility in one place.
              </p>
            </div>
            <div className="min-w-[260px] rounded-[20px] border border-steel-200 bg-steel-50/70 p-4">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Sequence rules</div>
              <div className="mt-3 grid gap-2 text-sm text-steel-700">
                <div>Weekdays only at {prospects?.automation.initial_send_time ?? "11:00"} ET</div>
                <div>{prospects?.automation.initial_daily_per_category ?? 10} total sends per category per day</div>
                <div>Follow-ups are prioritized before new initials</div>
                <div>Cadence: {(prospects?.automation.follow_up_offsets_days ?? [3, 14]).join(" days, ")} days</div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="bg-white">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Core metrics</div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[18px] border border-steel-200 bg-steel-50/70 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-steel-500">Contacts</div>
              <div className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-steel-950">{metrics?.contacts_total ?? 0}</div>
            </div>
            <div className="rounded-[18px] border border-steel-200 bg-steel-50/70 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-steel-500">Sent</div>
              <div className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-steel-950">{metrics?.sent_total ?? 0}</div>
            </div>
            <div className="rounded-[18px] border border-steel-200 bg-steel-50/70 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-steel-500">Delivered</div>
              <div className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-steel-950">{metrics?.delivered_total ?? 0}</div>
            </div>
            <div className="rounded-[18px] border border-steel-200 bg-steel-50/70 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-steel-500">Positive replies</div>
              <div className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-steel-950">{metrics?.positive_replies_total ?? 0}</div>
            </div>
          </div>
          <div className="mt-3 rounded-[18px] border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
            {metrics?.suppressed_total ?? 0} contacts are currently suppressed by opt-out, reply, bounce, or company-domain protection.
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel className="bg-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Import dock</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-950">Upload category-specific contact files</div>
            </div>
            <Upload className="h-5 w-5 text-brand-600" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORY_VALUES.map((category) => (
              <Button
                key={category}
                className="h-10 rounded-full px-4"
                onClick={() => setUploadCategory(category)}
                type="button"
                variant={uploadCategory === category ? "default" : "outline"}
              >
                {formatProspectCategory(category)}
              </Button>
            ))}
          </div>
          <div className="mt-4 rounded-[18px] border border-dashed border-steel-300 bg-steel-50/70 p-4">
            <input
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              ref={fileInputRef}
              type="file"
            />
            <div className="font-medium text-steel-900">{selectedFileLabel}</div>
            <div className="mt-1 text-sm text-steel-600">
              Supported columns: <span className="font-mono">name, company, role, email, phone, website, category, description</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button className="h-10 rounded-full px-4" onClick={() => fileInputRef.current?.click()} type="button" variant="outline">
                <Upload className="h-4 w-4" />
                Choose CSV
              </Button>
              <Button className="h-10 rounded-full px-4" disabled={importBusy} onClick={() => void handleImport()} type="button">
                {importBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import contacts
              </Button>
            </div>
          </div>

          <div className="mt-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Recent imports</div>
            <div className="mt-3 grid gap-2">
              {(prospects?.recent_imports ?? []).map((batch) => (
                <div className="rounded-[16px] border border-steel-200 bg-steel-50/60 px-4 py-3" key={batch.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-steel-900">{batch.filename}</div>
                      <div className="mt-1 text-sm text-steel-600">{formatProspectCategory(batch.category)} · {formatDate(batch.created_at)}</div>
                    </div>
                    <div className="text-right text-sm text-steel-600">
                      <div>{batch.imported_count} imported</div>
                      <div>{batch.skipped_count} skipped</div>
                    </div>
                  </div>
                </div>
              ))}
              {!(prospects?.recent_imports ?? []).length ? (
                <div className="rounded-[16px] border border-dashed border-steel-200 px-4 py-5 text-sm text-steel-500">
                  No imports yet.
                </div>
              ) : null}
            </div>
          </div>
        </Panel>

        <Panel className="bg-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Category programs</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-950">Daily capacity and sequence health</div>
            </div>
            <BarChart3 className="h-5 w-5 text-brand-600" />
          </div>

          <div className="mt-4 grid gap-3">
            {CATEGORY_VALUES.map((category) => {
              const program = programs.find((item) => item.category === category)
              return (
                <button
                  key={category}
                  className={`grid grid-cols-[1.2fr_repeat(4,minmax(0,1fr))] items-center gap-3 rounded-[18px] border px-4 py-4 text-left transition ${
                    categoryFilter === category
                      ? "border-brand-300 bg-brand-50/60"
                      : "border-steel-200 bg-white hover:border-steel-300"
                  }`}
                  onClick={() => onCategoryFilterChange(categoryFilter === category ? "all" : category)}
                  type="button"
                >
                  <div>
                    <div className="font-medium text-steel-950">{formatProspectCategory(category)}</div>
                    <div className="mt-1 text-sm text-steel-600">{program?.contacts ?? 0} contacts stored</div>
                  </div>
                  <div className="text-sm text-steel-600">
                    <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-steel-500">Sent today</div>
                    <div className="mt-1 font-medium text-steel-900">{program?.sent_today ?? 0}/{prospects?.automation.initial_daily_per_category ?? 10}</div>
                  </div>
                  <div className="text-sm text-steel-600">
                    <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-steel-500">Queued</div>
                    <div className="mt-1 font-medium text-steel-900">{queueCount(prospects, category)}</div>
                  </div>
                  <div className="text-sm text-steel-600">
                    <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-steel-500">F/U due</div>
                    <div className="mt-1 font-medium text-steel-900">{followUpCount(prospects, category)}</div>
                  </div>
                  <div className="text-sm text-steel-600">
                    <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-steel-500">Suppressed</div>
                    <div className="mt-1 font-medium text-steel-900">{suppressedCount(prospects, category)}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel className="bg-white">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Today’s automation queues</div>
          <div className="mt-4 grid gap-4">
            <div className="rounded-[18px] border border-steel-200 bg-steel-50/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-steel-950">Ready for initial outreach</div>
                <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                  {prospects?.initial_queue.length ?? 0}
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                {(prospects?.initial_queue ?? []).slice(0, 6).map((prospect) => (
                  <button
                    key={prospect.id}
                    className="rounded-[14px] border border-steel-200 bg-white px-4 py-3 text-left transition hover:border-brand-300"
                    onClick={() => onOpenProspect(prospect)}
                    type="button"
                  >
                    <div className="font-medium text-steel-900">{prospect.contact_name || prospect.company_name || prospect.email_address}</div>
                    <div className="mt-1 text-sm text-steel-600">{descriptionPreview(prospect)}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[18px] border border-steel-200 bg-steel-50/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-steel-950">Follow-ups due</div>
                <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                  {prospects?.follow_up_queue.length ?? 0}
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                {(prospects?.follow_up_queue ?? []).slice(0, 6).map((followUp) => (
                  <div className="rounded-[14px] border border-steel-200 bg-white px-4 py-3" key={followUp.id}>
                    <div className="font-medium text-steel-900">{followUp.contact_name || followUp.company_name || followUp.email_address}</div>
                    <div className="mt-1 text-sm text-steel-600">
                      Step {followUp.step_number} · due {formatRelativeTime(followUp.scheduled_at)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[18px] border border-amber-200 bg-amber-50/60 p-4">
              <div className="inline-flex items-center gap-2 font-semibold text-amber-900">
                <ShieldBan className="h-4 w-4" />
                Suppression and exceptions
              </div>
              <div className="mt-3 grid gap-2">
                {(prospects?.automation.exceptions ?? []).slice(0, 6).map((item) => (
                  <div className="rounded-[14px] border border-amber-200 bg-white px-4 py-3" key={item.id}>
                    <div className="font-medium text-steel-900">{item.label}</div>
                    <div className="mt-1 text-sm text-amber-800">{item.event_type.replace(/_/g, " ")}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="bg-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Contact store</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-950">Search, filter, and inspect every contact</div>
            </div>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-400" />
              <Input className="pl-9" onChange={(event) => onQueryChange(event.target.value)} placeholder="Search company, email, role, or description" value={query} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="h-9 rounded-full px-4" onClick={() => onStatusFilterChange("all")} type="button" variant={statusFilter === "all" ? "default" : "outline"}>
              All
            </Button>
            {STATUS_FILTERS.filter((value) => value !== "all").map((value) => (
              <Button
                key={value}
                className="h-9 rounded-full px-4"
                onClick={() => onStatusFilterChange(value)}
                type="button"
                variant={statusFilter === value ? "default" : "outline"}
              >
                {value.replace(/_/g, " ")}
              </Button>
            ))}
          </div>

          <div className="mt-4 overflow-hidden rounded-[20px] border border-steel-200">
            <div className="grid grid-cols-[1.2fr_0.85fr_0.7fr_0.9fr] gap-3 border-b border-steel-200 bg-steel-50 px-4 py-3 text-[11px] font-medium uppercase tracking-[0.16em] text-steel-500">
              <div>Contact</div>
              <div>Company</div>
              <div>State</div>
              <div>Next step</div>
            </div>
            <div className="divide-y divide-steel-200">
              {(prospects?.prospects ?? []).map((prospect) => (
                <button
                  key={prospect.id}
                  className="grid w-full grid-cols-[1.2fr_0.85fr_0.7fr_0.9fr] gap-3 bg-white px-4 py-4 text-left transition hover:bg-steel-50/70"
                  onClick={() => onOpenProspect(prospect)}
                  type="button"
                >
                  <div>
                    <div className="font-medium text-steel-950">{prospect.contact_name || prospect.email_address}</div>
                    <div className="mt-1 text-sm text-steel-600">{prospect.email_address}</div>
                    <div className="mt-2 text-sm text-steel-500">{descriptionPreview(prospect)}</div>
                  </div>
                  <div>
                    <div className="font-medium text-steel-900">{prospect.company_name || "No company"}</div>
                    <div className="mt-1 text-sm text-steel-600">{[prospect.contact_role, formatProspectCategory(prospect.category)].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div>
                    <div className="font-medium text-steel-900">{formatProspectQueueState(prospect.queue_state || prospect.status)}</div>
                    <div className="mt-1 text-sm text-steel-600">{prospect.last_sent_at ? `Last sent ${formatRelativeTime(prospect.last_sent_at)}` : "Not sent yet"}</div>
                  </div>
                  <div>
                    <div className="font-medium text-steel-900">
                      {prospect.next_follow_up ? `Step ${prospect.next_follow_up.step_number} scheduled` : prospect.first_sent_at ? "Awaiting response" : "Initial queued"}
                    </div>
                    <div className="mt-1 text-sm text-steel-600">
                      {prospect.next_follow_up ? formatDate(prospect.next_follow_up.scheduled_at) : formatDate(prospect.updated_at)}
                    </div>
                  </div>
                </button>
              ))}
              {!(prospects?.prospects ?? []).length ? (
                <div className="px-4 py-10 text-sm text-steel-500">
                  No contacts match this view yet.
                </div>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
