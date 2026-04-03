import { useMemo, useRef, useState } from "react"
import { BriefcaseBusiness, LoaderCircle, Mail, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Panel } from "@/features/metroglass-leads/components/panel"
import { formatProspectCategory, formatProspectStatus, formatRelativeTime } from "@/features/metroglass-leads/lib/format"
import type { ProspectCategory, ProspectRow, ProspectsPayload, ProspectStatus } from "@/features/metroglass-leads/types/api"
import { parseCsvText } from "@/features/metroglass-prospects/lib/csv"

const CATEGORY_VALUES: ProspectCategory[] = [
  "architect",
  "interior_designer",
  "gc",
  "property_manager",
  "project_manager",
]

const STATUS_FILTERS: Array<"all" | ProspectStatus> = ["all", "new", "drafted", "sent", "replied", "archived"]

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

function categoryCount(payload: ProspectsScreenProps["prospects"], category: ProspectCategory) {
  return payload?.categories?.[category] ?? 0
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
      <Panel className="overflow-hidden bg-[linear-gradient(145deg,#fff8ef,#ffffff_54%,#f4eadc)]">
        <div className="text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">Manual outreach CRM</div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="font-['Instrument_Serif'] text-4xl text-[#1A1A1A] sm:text-5xl">Prospects you control</h1>
            <p className="mt-3 text-sm leading-6 text-[#5F564C]">
              Upload architects, interior designers, GCs, property managers, and project managers from your own research. The app keeps the contact list, draft, attachment, and send history in one place.
            </p>
          </div>
          <div className="grid min-w-[220px] gap-3 rounded-[24px] border border-[#E7DACA] bg-white/80 p-4 text-sm text-[#5F564C]">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-[#8B7D6B]">Total prospects</div>
              <div className="mt-1 text-3xl font-semibold text-[#1A1A1A]">{prospects?.counts.all ?? 0}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-full bg-[#F7F0E6] px-3 py-2">New {prospects?.counts.new ?? 0}</div>
              <div className="rounded-full bg-[#F7F0E6] px-3 py-2">Drafted {prospects?.counts.drafted ?? 0}</div>
              <div className="rounded-full bg-[#F7F0E6] px-3 py-2">Sent {prospects?.counts.sent ?? 0}</div>
              <div className="rounded-full bg-[#F7F0E6] px-3 py-2">Replied {prospects?.counts.replied ?? 0}</div>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Panel className="bg-[linear-gradient(180deg,#fffdfa,#f8efe4)]">
          <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Import prospects</div>
          <div className="mt-3 text-2xl font-semibold text-[#1A1A1A]">Bring in your CSV and sort it by lane</div>
          <p className="mt-2 text-sm leading-6 text-[#5F564C]">
            Pick the category first, then upload the file. We will map common columns like company, contact, role, email, phone, website, city, and notes.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORY_VALUES.map((category) => (
              <Button
                key={category}
                className={`h-10 rounded-full px-4 ${uploadCategory === category ? "bg-[#1A1A1A] text-white hover:bg-[#1A1A1A]" : "border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]"}`}
                onClick={() => setUploadCategory(category)}
                type="button"
                variant="outline"
              >
                {formatProspectCategory(category)}
              </Button>
            ))}
          </div>
          <div className="mt-4 rounded-[20px] border border-dashed border-[#D8CAB9] bg-white/80 p-4">
            <input
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              ref={fileInputRef}
              type="file"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium text-[#1A1A1A]">{selectedFileLabel}</div>
                <div className="mt-1 text-sm text-[#6B5A48]">Current lane: {formatProspectCategory(uploadCategory)}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="h-10 rounded-full border border-[#D6C6B6] bg-white px-4 text-[#5F564C] hover:bg-[#F7F0E8]"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                  variant="outline"
                >
                  <Upload className="h-4 w-4" />
                  Choose CSV
                </Button>
                <Button
                  className="h-10 rounded-full bg-[#D4691A] px-4 text-white hover:bg-[#BA5A12]"
                  disabled={importBusy}
                  onClick={() => void handleImport()}
                  type="button"
                >
                  {importBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Import
                </Button>
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Category mix</div>
          <div className="mt-4 space-y-3">
            {CATEGORY_VALUES.map((category) => (
              <button
                key={category}
                className={`flex w-full items-center justify-between rounded-[18px] border px-4 py-3 text-left transition ${
                  categoryFilter === category ? "border-[#D4691A] bg-[#FFF3E6]" : "border-[#E7DACB] bg-white hover:border-[#DCC9B2]"
                }`}
                onClick={() => onCategoryFilterChange(categoryFilter === category ? "all" : category)}
                type="button"
              >
                <div>
                  <div className="font-medium text-[#1A1A1A]">{formatProspectCategory(category)}</div>
                  <div className="mt-1 text-xs text-[#8B7D6B]">Imported prospects in this lane</div>
                </div>
                <div className="rounded-full bg-[#F6EEE4] px-3 py-1 text-sm font-medium text-[#5F564C]">
                  {categoryCount(prospects, category)}
                </div>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Prospect queue</div>
            <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">Filter by status and lane</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((value) => (
              <Button
                key={value}
                className={`h-10 rounded-full px-4 ${statusFilter === value ? "bg-[#1A1A1A] text-white hover:bg-[#1A1A1A]" : "border border-[#D6C6B6] bg-white text-[#5F564C] hover:bg-[#F7F0E8]"}`}
                onClick={() => onStatusFilterChange(value)}
                type="button"
                variant="outline"
              >
                {value === "all" ? "All" : formatProspectStatus(value)}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {(prospects?.prospects ?? []).map((prospect) => (
            <button
              className="rounded-[22px] border border-[#E7DACB] bg-[linear-gradient(180deg,#fffdfa,#f9f1e7)] p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(26,26,26,0.1)]"
              key={prospect.id}
              onClick={() => onOpenProspect(prospect)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold tracking-[-0.03em] text-[#1A1A1A]">
                    {prospect.contact_name || prospect.company_name || prospect.email_address}
                  </div>
                  <div className="mt-1 text-sm text-[#5F564C]">
                    {[prospect.contact_role, prospect.company_name].filter(Boolean).join(" · ") || prospect.email_address}
                  </div>
                </div>
                <div className="rounded-full border border-[#E4D5C5] bg-white/80 px-3 py-1 text-xs font-medium text-[#6B5A48]">
                  {formatProspectStatus(prospect.status)}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#8B7D6B]">
                <div className="rounded-full border border-[#E7DACA] bg-white px-3 py-1">
                  {formatProspectCategory(prospect.category)}
                </div>
                {prospect.phone ? (
                  <div className="rounded-full border border-[#E7DACA] bg-white px-3 py-1">{prospect.phone}</div>
                ) : null}
                {prospect.website ? (
                  <div className="rounded-full border border-[#E7DACA] bg-white px-3 py-1">{prospect.website}</div>
                ) : null}
              </div>

              <div className="mt-4 rounded-[18px] border border-[#EEE4D7] bg-white/85 px-4 py-4">
                <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8B7D6B]">
                  <Mail className="h-3.5 w-3.5" />
                  Recipient
                </div>
                <div className="mt-2 break-all font-medium text-[#1A1A1A]">{prospect.email_address}</div>
                <div className="mt-2 text-xs text-[#8B7D6B]">
                  Updated {formatRelativeTime(prospect.updated_at)}
                  {prospect.last_sent_at ? ` · Last sent ${formatRelativeTime(prospect.last_sent_at)}` : ""}
                </div>
              </div>
            </button>
          ))}

          {!(prospects?.prospects ?? []).length ? (
            <div className="lg:col-span-2">
              <div className="rounded-[22px] border border-dashed border-[#DCCEBF] bg-white/80 px-6 py-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#F8EFE3] text-[#D4691A]">
                  <BriefcaseBusiness className="h-5 w-5" />
                </div>
                <div className="mt-4 text-xl font-semibold text-[#1A1A1A]">No prospects in this view yet</div>
                <p className="mt-2 text-sm leading-6 text-[#5F564C]">
                  Import your first CSV for one of the lanes above, or switch filters if you already loaded a list.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Recent imports</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(prospects?.recent_imports ?? []).map((batch) => (
            <div className="rounded-[18px] border border-[#E7DACB] bg-white px-4 py-4" key={batch.id}>
              <div className="font-medium text-[#1A1A1A]">{batch.filename}</div>
              <div className="mt-1 text-sm text-[#5F564C]">{formatProspectCategory(batch.category)}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#8B7D6B]">
                <div className="rounded-full bg-[#F7F0E6] px-3 py-1">Rows {batch.row_count}</div>
                <div className="rounded-full bg-[#F7F0E6] px-3 py-1">Imported {batch.imported_count}</div>
                <div className="rounded-full bg-[#F7F0E6] px-3 py-1">Skipped {batch.skipped_count}</div>
              </div>
              <div className="mt-3 text-xs text-[#8B7D6B]">{formatRelativeTime(batch.created_at)}</div>
            </div>
          ))}
          {!(prospects?.recent_imports ?? []).length ? (
            <div className="rounded-[18px] border border-dashed border-[#DCCEBF] px-4 py-6 text-sm text-[#6B5A48] md:col-span-2">
              No imports yet. Once you upload CSVs, this section will give you a quick paper trail.
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  )
}
