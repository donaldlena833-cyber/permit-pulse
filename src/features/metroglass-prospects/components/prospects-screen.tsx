import { useMemo, useRef, useState } from "react"
import { LoaderCircle, Mail, Upload, Users2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Panel } from "@/features/metroglass-leads/components/panel"
import {
  formatProspectCategory,
  formatProspectQueueState,
  formatProspectStatus,
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
  "gc",
  "property_manager",
  "project_manager",
]

const STATUS_FILTERS: Array<"all" | ProspectStatus> = ["all", "new", "drafted", "sent", "replied", "opted_out", "archived"]

interface ProspectsScreenProps {
  prospects: ProspectsPayload | null
  statusFilter: "all" | ProspectStatus
  categoryFilter: "all" | ProspectCategory
  onStatusFilterChange: (value: "all" | ProspectStatus) => void
  onCategoryFilterChange: (value: "all" | ProspectCategory) => void
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

export function ProspectsScreen({
  prospects,
  statusFilter,
  categoryFilter,
  onStatusFilterChange,
  onCategoryFilterChange,
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

  return (
    <div className="space-y-5 pb-32">
      <Panel className="bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-brand-700">
              Prospects pilot
            </div>
            <h1 className="mt-4 text-4xl font-extrabold tracking-[-0.05em] text-steel-900 sm:text-5xl">
              Manual outreach with automation rules
            </h1>
            <p className="mt-3 text-sm leading-6 text-steel-600">
              Import researched contacts by category, let the pilot run fixed daily quotas, and keep initials, follow-ups, and suppressions visible in one operational workspace.
            </p>
          </div>

          <div className="min-w-[260px] rounded-[20px] border border-steel-200 bg-white p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Pilot status</div>
                <div className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-steel-900">
                  {prospects?.automation.pilot_enabled ? "Active" : "Paused"}
                </div>
              </div>
              <Users2 className="h-6 w-6 text-brand-600" />
            </div>
            <div className="mt-4 grid gap-2 text-sm text-steel-600">
              <div>Initial send time: {prospects?.automation.initial_send_time ?? "11:00"} ET</div>
              <div>Follow-up time: {prospects?.automation.follow_up_send_time ?? "23:30"} ET</div>
              <div>Permit auto-send: {prospects?.automation.permit_auto_send_enabled ? "Enabled" : "Paused for pilot"}</div>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Daily scoreboard</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {CATEGORY_VALUES.map((category) => (
              <button
                key={category}
                className={`rounded-[18px] border px-4 py-4 text-left transition ${
                  categoryFilter === category
                    ? "border-brand-300 bg-brand-50/70"
                    : "border-steel-200 bg-white hover:border-steel-300"
                }`}
                onClick={() => onCategoryFilterChange(categoryFilter === category ? "all" : category)}
                type="button"
              >
                <div className="font-medium text-steel-900">{formatProspectCategory(category)}</div>
                <div className="mt-3 grid gap-1 text-sm text-steel-600">
                  <div>Initial sent: {prospects?.automation.initial_sent_today?.[category] ?? 0}/{prospects?.automation.initial_daily_per_category ?? 0}</div>
                  <div>Follow-ups: {prospects?.automation.follow_up_sent_today?.[category] ?? 0}/{prospects?.automation.follow_up_daily_per_category ?? 0}</div>
                  <div>Queued: {queueCount(prospects, category)}</div>
                  <div>Due tonight: {followUpCount(prospects, category)}</div>
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Import lane</div>
          <div className="mt-3 text-2xl font-bold tracking-[-0.04em] text-steel-900">Upload researched CSVs</div>
          <p className="mt-2 text-sm leading-6 text-steel-600">
            Supported columns: <span className="font-mono">name, company, role, email, phone, website, category, description</span>.
          </p>
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
            <div className="mt-1 text-sm text-steel-600">Selected lane: {formatProspectCategory(uploadCategory)}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button className="h-10 rounded-full px-4" onClick={() => fileInputRef.current?.click()} type="button" variant="outline">
                <Upload className="h-4 w-4" />
                Choose CSV
              </Button>
              <Button className="h-10 rounded-full px-4" disabled={importBusy} onClick={() => void handleImport()} type="button">
                {importBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import
              </Button>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Initial outreach queue</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-900">{prospects?.initial_queue.length ?? 0} visible prospects ready for initial send</div>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {(prospects?.initial_queue ?? []).slice(0, 8).map((prospect) => (
              <button
                key={prospect.id}
                className="w-full rounded-[16px] border border-steel-200 bg-white px-4 py-4 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
                onClick={() => onOpenProspect(prospect)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-steel-900">{prospect.contact_name || prospect.company_name || prospect.email_address}</div>
                    <div className="mt-1 text-sm text-steel-600">{[prospect.contact_role, prospect.company_name].filter(Boolean).join(" · ") || prospect.email_address}</div>
                  </div>
                  <div className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-brand-700">
                    {formatProspectCategory(prospect.category)}
                  </div>
                </div>
              </button>
            ))}
            {!(prospects?.initial_queue ?? []).length ? (
              <div className="rounded-[16px] border border-dashed border-steel-200 px-4 py-5 text-sm text-steel-500">
                No unsent prospects are queued right now.
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Follow-up queue</div>
              <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-900">{prospects?.follow_up_queue.length ?? 0} visible follow-ups due</div>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {(prospects?.follow_up_queue ?? []).slice(0, 8).map((followUp) => (
              <div key={followUp.id} className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-steel-900">{followUp.contact_name || followUp.company_name || followUp.email_address}</div>
                    <div className="mt-1 text-sm text-steel-600">
                      {(followUp.category && formatProspectCategory(followUp.category)) || "Prospect"} · due {formatRelativeTime(followUp.scheduled_at)}
                    </div>
                  </div>
                  <div className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-amber-700">
                    Step {followUp.step_number}
                  </div>
                </div>
              </div>
            ))}
            {!(prospects?.follow_up_queue ?? []).length ? (
              <div className="rounded-[16px] border border-dashed border-steel-200 px-4 py-5 text-sm text-steel-500">
                No prospect follow-ups are due in the current queue.
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Prospect directory</div>
            <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-steel-900">Filter by status and category</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((value) => (
              <Button
                key={value}
                className="h-10 rounded-full px-4"
                onClick={() => onStatusFilterChange(value)}
                type="button"
                variant={statusFilter === value ? "default" : "outline"}
              >
                {value === "all" ? "All" : formatProspectStatus(value)}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {(prospects?.prospects ?? []).map((prospect) => (
            <button
              key={prospect.id}
              className="grid w-full gap-3 rounded-[18px] border border-steel-200 bg-white px-4 py-4 text-left transition hover:border-brand-300 hover:bg-brand-50/30 md:grid-cols-[1.2fr_0.8fr_0.8fr_auto]"
              onClick={() => onOpenProspect(prospect)}
              type="button"
            >
              <div className="min-w-0">
                <div className="font-medium text-steel-900">{prospect.contact_name || prospect.company_name || prospect.email_address}</div>
                <div className="mt-1 truncate text-sm text-steel-600">{[prospect.contact_role, prospect.company_name].filter(Boolean).join(" · ") || prospect.email_address}</div>
              </div>
              <div className="text-sm text-steel-600">
                <div className="font-medium text-steel-900">{formatProspectCategory(prospect.category)}</div>
                <div className="mt-1 truncate">{prospect.website || prospect.phone || "No website"}</div>
              </div>
              <div className="text-sm text-steel-600">
                <div className="font-medium text-steel-900">{formatProspectQueueState(prospect.queue_state || prospect.status)}</div>
                <div className="mt-1">{prospect.last_sent_at ? `Last sent ${formatRelativeTime(prospect.last_sent_at)}` : "Not sent yet"}</div>
              </div>
              <div className="inline-flex items-center rounded-full border border-steel-200 bg-steel-50 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-steel-600">
                <Mail className="mr-2 h-3.5 w-3.5" />
                {prospect.email_address}
              </div>
            </button>
          ))}
          {!(prospects?.prospects ?? []).length ? (
            <div className="rounded-[18px] border border-dashed border-steel-200 px-4 py-8 text-sm text-steel-500">
              No prospects match this view yet.
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  )
}
