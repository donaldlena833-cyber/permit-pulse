import { useMemo, useRef, useState } from "react"
import {
  BarChart3,
  Clock3,
  LoaderCircle,
  Mail,
  RefreshCw,
  Search,
  ShieldBan,
  Upload,
  WandSparkles,
} from "lucide-react"
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
import { analyzeCsvText, parseCsvText } from "@/features/metroglass-prospects/lib/csv"

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
  onRunProspectBatch: () => void
  onSyncReplies: () => void
  onRepairPermitFollowUps: () => void
  actionTargetId: string | null
}

interface CsvPreview {
  delimiter: string
  headers: string[]
  totalRows: number
  importableRows: number
  missingEmailRows: number
  duplicateEmailRows: number
  sampleRows: Array<Record<string, string>>
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

function delimiterLabel(value: string) {
  if (value === "\t") return "tab"
  if (value === ";") return "semicolon"
  return "comma"
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
  onRunProspectBatch,
  onSyncReplies,
  onRepairPermitFollowUps,
  actionTargetId,
}: ProspectsScreenProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadCategory, setUploadCategory] = useState<ProspectCategory>("architect")
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadPreview, setUploadPreview] = useState<CsvPreview | null>(null)
  const [uploading, setUploading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const importBusy = uploading || actionTargetId === "prospects-import"
  const replySyncBusy = actionTargetId === "sync-replies"
  const prospectBatchBusy = actionTargetId === "run-prospect-batch"
  const repairBusy = actionTargetId === "repair-follow-ups"

  const selectedFileLabel = useMemo(() => {
    if (!uploadFile) {
      return "Choose a CSV to preview and import"
    }
    return `${uploadFile.name} · ${Math.max(1, Math.round(uploadFile.size / 1024))} KB`
  }, [uploadFile])

  async function handleFileChange(file: File | null) {
    setUploadFile(file)
    setUploadPreview(null)

    if (!file) {
      return
    }

    setPreviewing(true)
    try {
      const text = await file.text()
      setUploadPreview(analyzeCsvText(text))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read CSV preview")
    } finally {
      setPreviewing(false)
    }
  }

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
      setUploadPreview(null)
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
  const categoryPrograms = prospects?.automation.campaigns ?? []
  const campaignBatches = prospects?.automation.campaign_batches ?? []
  const suppressedContacts = prospects?.automation.suppressed_contacts ?? []
  const replySync = prospects?.automation.reply_sync

  return (
    <div className="space-y-5 pb-32">
      <div className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel className="bg-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-brand-700">
                Outreach CRM
              </div>
              <h1 className="mt-4 text-4xl font-extrabold tracking-[-0.05em] text-steel-950 sm:text-[3rem]">
                Contact store, sequences, and send governance
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-steel-600">
                This workspace is now about reliable outbound execution: imports, personalization, category quotas, follow-up queues, reply sync, and suppression safety in one modern ops board.
              </p>
            </div>
            <div className="min-w-[280px] rounded-[20px] border border-steel-200 bg-steel-50/70 p-4">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Send model</div>
              <div className="mt-3 grid gap-2 text-sm text-steel-700">
                <div>Initial sends: weekdays at {prospects?.automation.initial_send_time ?? "11:00"} ET</div>
                <div>Follow-ups: weekdays at {prospects?.automation.follow_up_send_time ?? "23:30"} ET</div>
                <div>{prospects?.automation.initial_daily_per_category ?? 10} total sends per category per day</div>
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
            <div className="rounded-[18px] border border-steel-200 bg-steel-50/70 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-steel-500">Replied</div>
              <div className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-steel-950">{metrics?.replied_total ?? 0}</div>
            </div>
            <div className="rounded-[18px] border border-steel-200 bg-steel-50/70 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-steel-500">Suppressed</div>
              <div className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-steel-950">{metrics?.suppressed_total ?? 0}</div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.94fr_1.06fr]">
        <Panel className="bg-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Import dock</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-950">Preview before you import</div>
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
              onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
              ref={fileInputRef}
              type="file"
            />
            <div className="font-medium text-steel-900">{selectedFileLabel}</div>
            <div className="mt-1 text-sm text-steel-600">
              Expected columns: <span className="font-mono">name, company, role, email, phone, website, category, description</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button className="h-10 rounded-full px-4" onClick={() => fileInputRef.current?.click()} type="button" variant="outline">
                <Upload className="h-4 w-4" />
                Choose CSV
              </Button>
              <Button className="h-10 rounded-full px-4" disabled={importBusy || !uploadFile || previewing} onClick={() => void handleImport()} type="button">
                {importBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import contacts
              </Button>
            </div>
          </div>

          <div className="mt-4 rounded-[18px] border border-steel-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-steel-950">Import preview</div>
              {previewing ? <LoaderCircle className="h-4 w-4 animate-spin text-brand-600" /> : null}
            </div>

            {uploadPreview ? (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-[14px] border border-steel-200 bg-steel-50/70 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-steel-500">Rows</div>
                    <div className="mt-1 text-2xl font-bold tracking-[-0.04em] text-steel-950">{uploadPreview.totalRows}</div>
                  </div>
                  <div className="rounded-[14px] border border-emerald-200 bg-emerald-50/70 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-700">Importable</div>
                    <div className="mt-1 text-2xl font-bold tracking-[-0.04em] text-emerald-900">{uploadPreview.importableRows}</div>
                  </div>
                  <div className="rounded-[14px] border border-amber-200 bg-amber-50/70 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-amber-700">Missing email</div>
                    <div className="mt-1 text-2xl font-bold tracking-[-0.04em] text-amber-900">{uploadPreview.missingEmailRows}</div>
                  </div>
                  <div className="rounded-[14px] border border-red-200 bg-red-50/70 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-red-700">Duplicates</div>
                    <div className="mt-1 text-2xl font-bold tracking-[-0.04em] text-red-900">{uploadPreview.duplicateEmailRows}</div>
                  </div>
                </div>

                <div className="rounded-[14px] border border-steel-200 bg-steel-50/60 p-3 text-sm text-steel-700">
                  Detected {delimiterLabel(uploadPreview.delimiter)}-delimited file with {uploadPreview.headers.length} mapped columns.
                </div>

                <div className="flex flex-wrap gap-2">
                  {uploadPreview.headers.slice(0, 10).map((header) => (
                    <div key={header} className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                      {header}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-steel-500">Choose a CSV to see row counts, duplicate risk, and the detected column structure before import.</div>
            )}
          </div>
        </Panel>

        <Panel className="bg-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Ops controls</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-950">Automation visibility and manual overrides</div>
            </div>
            <WandSparkles className="h-5 w-5 text-brand-600" />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Button className="h-11 rounded-full px-5" disabled={prospectBatchBusy} onClick={onRunProspectBatch} type="button">
              {prospectBatchBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Run outreach batch now
            </Button>
            <Button className="h-11 rounded-full px-5" disabled={replySyncBusy} onClick={onSyncReplies} type="button" variant="outline">
              {replySyncBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync Gmail replies
            </Button>
            <Button className="h-11 rounded-full px-5" disabled={repairBusy} onClick={onRepairPermitFollowUps} type="button" variant="outline">
              {repairBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
              Repair permit follow-ups
            </Button>
          </div>

          <div className="mt-4 rounded-[18px] border border-steel-200 bg-steel-50/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-steel-950">Reply sync status</div>
              <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                {replySync?.checked_at ? formatRelativeTime(replySync.checked_at) : "Never run"}
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-steel-700 sm:grid-cols-4">
              <div>Scanned: <span className="font-semibold text-steel-950">{replySync?.scanned_messages ?? 0}</span></div>
              <div>Processed: <span className="font-semibold text-steel-950">{replySync?.processed_messages ?? 0}</span></div>
              <div>Opt-outs: <span className="font-semibold text-steel-950">{replySync?.opt_outs ?? 0}</span></div>
              <div>Positive: <span className="font-semibold text-steel-950">{replySync?.positive_replies ?? 0}</span></div>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Category programs</div>
                <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-950">Daily capacity and queue health</div>
              </div>
              <BarChart3 className="h-5 w-5 text-brand-600" />
            </div>

            <div className="mt-4 grid gap-3">
              {CATEGORY_VALUES.map((category) => {
                const program = categoryPrograms.find((item) => item.key === category)
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
                      <div className="mt-1 font-medium text-steel-900">
                        {prospects?.automation.sent_today_by_category?.[category] ?? 0}/{prospects?.automation.initial_daily_per_category ?? 10}
                      </div>
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
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.94fr_1.06fr]">
        <Panel className="bg-white">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Queues and suppression</div>
          <div className="mt-4 grid gap-4">
            <div className="rounded-[18px] border border-steel-200 bg-steel-50/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-steel-950">Ready for initial outreach</div>
                <div className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
                  {prospects?.initial_queue.length ?? 0}
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                {(prospects?.initial_queue ?? []).slice(0, 5).map((prospect) => (
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
                {(prospects?.follow_up_queue ?? []).slice(0, 5).map((followUp) => (
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
                Suppression center
              </div>
              <div className="mt-3 grid gap-2">
                {suppressedContacts.slice(0, 6).map((contact) => (
                  <div className="rounded-[14px] border border-amber-200 bg-white px-4 py-3" key={contact.id}>
                    <div className="font-medium text-steel-900">{contact.contact_name || contact.company_name || contact.email_address}</div>
                    <div className="mt-1 text-sm text-amber-800">
                      {contact.reason?.replace(/_/g, " ") || "suppressed"} · {formatRelativeTime(contact.updated_at)}
                    </div>
                  </div>
                ))}
                {!suppressedContacts.length ? (
                  <div className="rounded-[14px] border border-amber-200 bg-white px-4 py-3 text-sm text-amber-800">
                    No suppressed contacts are visible right now.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="bg-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Campaign performance</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-950">Import batches and delivery quality</div>
            </div>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-400" />
              <Input className="pl-9" onChange={(event) => onQueryChange(event.target.value)} placeholder="Search company, email, role, or description" value={query} />
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {campaignBatches.slice(0, 8).map((batch) => (
              <div className="grid grid-cols-[1.2fr_repeat(4,minmax(0,1fr))] gap-3 rounded-[16px] border border-steel-200 bg-steel-50/60 px-4 py-4" key={batch.id}>
                <div>
                  <div className="font-medium text-steel-950">{batch.filename}</div>
                  <div className="mt-1 text-sm text-steel-600">
                    {formatProspectCategory(batch.category)} · imported {batch.imported_count} / skipped {batch.skipped_count}
                  </div>
                </div>
                <div className="text-sm text-steel-700">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-steel-500">Sent</div>
                  <div className="mt-1 font-medium text-steel-950">{batch.sent_total}</div>
                </div>
                <div className="text-sm text-steel-700">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-steel-500">Delivered</div>
                  <div className="mt-1 font-medium text-steel-950">{batch.delivered_total}</div>
                </div>
                <div className="text-sm text-steel-700">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-steel-500">Replied</div>
                  <div className="mt-1 font-medium text-steel-950">{batch.replied_total}</div>
                </div>
                <div className="text-sm text-steel-700">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-steel-500">Positive</div>
                  <div className="mt-1 font-medium text-steel-950">{batch.positive_replies_total}</div>
                </div>
              </div>
            ))}
            {!campaignBatches.length ? (
              <div className="rounded-[16px] border border-steel-200 bg-steel-50/60 px-4 py-6 text-sm text-steel-500">
                Campaign metrics will populate as soon as imports and sends accumulate.
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
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
