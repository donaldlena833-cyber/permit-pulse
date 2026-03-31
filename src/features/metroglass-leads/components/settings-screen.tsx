import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Panel } from "@/features/metroglass-leads/components/panel"
import { formatRelativeTime } from "@/features/metroglass-leads/lib/format"
import type { ConfigPayload, HealthPayload, SystemPayload } from "@/features/metroglass-leads/types/api"

interface SettingsScreenProps {
  health: HealthPayload | null
  config: ConfigPayload | null
  system: SystemPayload | null
  onSaveConfig: (patch: Partial<ConfigPayload>) => Promise<void>
}

const SOURCE_OPTIONS = [
  { id: "nyc_dob", label: "NYC DOB permits", description: "Primary permit feed for the scanner." },
]

export function SettingsScreen({ health, config, system, onSaveConfig }: SettingsScreenProps) {
  const [form, setForm] = useState<ConfigPayload | null>(config)

  useEffect(() => {
    setForm(config)
  }, [config])

  if (!form) {
    return null
  }

  const save = async () => {
    await onSaveConfig(form)
  }

  const toggleSource = (sourceId: string, checked: boolean) => {
    const current = new Set(form.active_sources || [])
    if (checked) {
      current.add(sourceId)
    } else {
      current.delete(sourceId)
    }
    setForm({ ...form, active_sources: Array.from(current) })
  }

  return (
    <div className="space-y-5 pb-28">
      <section className="overflow-hidden rounded-[30px] border border-[#E5D7C8] bg-[radial-gradient(circle_at_top_left,rgba(212,105,26,0.14),transparent_24%),linear-gradient(150deg,#fff9f1,#fffdf9_52%,#f2e6d7)] px-5 py-6 shadow-[0_26px_56px_rgba(26,26,26,0.08)]">
        <div className="text-[11px] uppercase tracking-[0.24em] text-[#D4691A]">System desk</div>
        <h1 className="mt-2 font-['Instrument_Serif'] text-4xl text-[#1A1A1A] sm:text-5xl">Controls and diagnostics</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#5F564C]">
          Tune the scanner, keep delivery guarded, and inspect exactly where recent runs or jobs went sideways.
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Scan rules</div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm text-[#5F564C]">
              Relevance threshold
              <Input
                step="0.01"
                type="number"
                value={form.min_relevance_threshold}
                onChange={(event) => setForm({ ...form, min_relevance_threshold: Number(event.target.value) })}
              />
            </label>
            <label className="grid gap-2 text-sm text-[#5F564C]">
              Scan window days
              <Input
                type="number"
                value={form.scan_window_days}
                onChange={(event) => setForm({ ...form, scan_window_days: Number(event.target.value) })}
              />
            </label>
            <label className="grid gap-2 text-sm text-[#5F564C]">
              Scan limit per source
              <Input
                type="number"
                value={form.scan_limit_per_source}
                onChange={(event) => setForm({ ...form, scan_limit_per_source: Number(event.target.value) })}
              />
            </label>
            <div className="rounded-[18px] border border-[#EEE4D7] bg-[#FFFCF8] px-4 py-4 text-sm text-[#5F564C]">
              <div className="font-medium text-[#1A1A1A]">Current posture</div>
              <div className="mt-2 leading-6">
                Leads below <span className="font-medium text-[#1A1A1A]">{form.min_relevance_threshold}</span> stay out of the queue. The scanner looks back <span className="font-medium text-[#1A1A1A]">{form.scan_window_days}</span> days and reads up to <span className="font-medium text-[#1A1A1A]">{form.scan_limit_per_source || "all"}</span> permits per source.
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Active sources</div>
            <div className="mt-3 space-y-3">
              {SOURCE_OPTIONS.map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-4 rounded-[18px] border border-[#EEE4D7] bg-[#FFFCF8] px-4 py-4">
                  <div>
                    <div className="font-medium text-[#1A1A1A]">{source.label}</div>
                    <div className="mt-1 text-sm text-[#5F564C]">{source.description}</div>
                  </div>
                  <Switch
                    checked={form.active_sources.includes(source.id)}
                    onCheckedChange={(checked) => toggleSource(source.id, checked)}
                  />
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Delivery rules</div>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm text-[#5F564C]">
              Daily cap
              <Input
                type="number"
                value={form.daily_send_cap}
                onChange={(event) => setForm({ ...form, daily_send_cap: Number(event.target.value) })}
              />
            </label>
            <label className="grid gap-2 text-sm text-[#5F564C]">
              Auto send trust threshold
              <Input
                type="number"
                value={form.auto_send_trust_threshold}
                onChange={(event) => setForm({ ...form, auto_send_trust_threshold: Number(event.target.value) })}
              />
            </label>
            <label className="grid gap-2 text-sm text-[#5F564C]">
              Manual send trust threshold
              <Input
                type="number"
                value={form.manual_send_trust_threshold}
                onChange={(event) => setForm({ ...form, manual_send_trust_threshold: Number(event.target.value) })}
              />
            </label>
            <label className="grid gap-2 text-sm text-[#5F564C]">
              Auto send policy
              <select
                className="h-11 rounded-[14px] border border-[#DCCDBE] bg-white/90 px-3 text-sm text-[#1A1A1A] outline-none"
                onChange={(event) => setForm({ ...form, auto_send_policy: event.target.value as ConfigPayload["auto_send_policy"] })}
                value={form.auto_send_policy}
              >
                <option value="any_published">Any published email</option>
                <option value="threshold">Trust threshold only</option>
              </select>
            </label>
            <div className="flex items-center justify-between rounded-[18px] border border-[#EEE4D7] bg-[#FFFCF8] px-4 py-4">
              <div>
                <div className="font-medium text-[#1A1A1A]">Warm up mode</div>
                <div className="mt-1 text-sm text-[#5F564C]">Keep sending volume limited while the account warms up.</div>
              </div>
              <Switch
                checked={form.warm_up_mode}
                onCheckedChange={(checked) => setForm({ ...form, warm_up_mode: checked })}
              />
            </div>
            <label className="grid gap-2 text-sm text-[#5F564C]">
              Warm up daily cap
              <Input
                type="number"
                value={form.warm_up_daily_cap}
                onChange={(event) => setForm({ ...form, warm_up_daily_cap: Number(event.target.value) })}
              />
            </label>
          </div>

          <Button className="mt-5 h-11 rounded-full bg-[#1A1A1A] px-5 text-white hover:bg-[#111111]" onClick={() => void save()}>
            Save settings
          </Button>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.75fr_1.25fr]">
        <Panel>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">System health</div>
          <div className="mt-4 space-y-3 text-sm text-[#5F564C]">
            <div className="flex items-center justify-between border-b border-[#EEE4D7] pb-3">
              <span>Worker healthy</span>
              <span className="font-medium text-[#1A1A1A]">{system?.worker.ok ? "Yes" : "No"}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[#EEE4D7] pb-3">
              <span>Gmail connected</span>
              <span className="font-medium text-[#1A1A1A]">{health?.hasGmail ? "Yes" : "No"}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[#EEE4D7] pb-3">
              <span>Firecrawl key</span>
              <span className="font-medium text-[#1A1A1A]">{health?.hasFirecrawl ? "Present" : "Missing"}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[#EEE4D7] pb-3">
              <span>Default attachment</span>
              <span className="font-medium text-[#1A1A1A]">{health?.defaultAttachmentName || "Missing"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Total leads</span>
              <span className="font-medium text-[#1A1A1A]">{system?.total_leads ?? 0}</span>
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Recent run history</div>
              <div className="mt-2 text-2xl font-semibold text-[#1A1A1A]">What the last scans actually did</div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {(system?.recent_runs ?? []).map((run) => (
              <div key={run.id} className="rounded-[18px] border border-[#EEE4D7] bg-[#FFFCF8] px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-[#1A1A1A]">{run.status} {run.current_stage ? `· ${run.current_stage}` : ""}</div>
                    <div className="mt-1 text-sm text-[#5F564C]">
                      Started {formatRelativeTime(run.started_at)}{run.completed_at ? ` · finished ${formatRelativeTime(run.completed_at)}` : ""}
                    </div>
                  </div>
                  <div className="rounded-full border border-[#E4D5C5] bg-white px-3 py-1 text-xs font-medium text-[#6B5A48]">
                    {run.id.slice(0, 8)}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="border-l-2 border-[#E2D4C3] pl-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">Permits</div>
                    <div className="mt-1 text-lg font-semibold text-[#1A1A1A]">{run.counters?.permits_found ?? 0}</div>
                  </div>
                  <div className="border-l-2 border-[#E2D4C3] pl-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">Low relevance</div>
                    <div className="mt-1 text-lg font-semibold text-[#1A1A1A]">{run.counters?.permits_skipped_low_relevance ?? 0}</div>
                  </div>
                  <div className="border-l-2 border-[#E2D4C3] pl-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">Duplicates</div>
                    <div className="mt-1 text-lg font-semibold text-[#1A1A1A]">{run.counters?.permits_deduplicated ?? 0}</div>
                  </div>
                  <div className="border-l-2 border-[#E2D4C3] pl-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">Created</div>
                    <div className="mt-1 text-lg font-semibold text-[#1A1A1A]">{run.counters?.leads_created ?? 0}</div>
                  </div>
                  <div className="border-l-2 border-[#E2D4C3] pl-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">Enriched</div>
                    <div className="mt-1 text-lg font-semibold text-[#1A1A1A]">{run.counters?.leads_enriched ?? 0}</div>
                  </div>
                  <div className="border-l-2 border-[#E2D4C3] pl-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">Ready</div>
                    <div className="mt-1 text-lg font-semibold text-[#1A1A1A]">{run.counters?.leads_ready ?? 0}</div>
                  </div>
                  <div className="border-l-2 border-[#E2D4C3] pl-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">Needs operator</div>
                    <div className="mt-1 text-lg font-semibold text-[#1A1A1A]">{run.counters?.leads_review ?? 0}</div>
                  </div>
                  <div className="border-l-2 border-[#E2D4C3] pl-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">Drafts</div>
                    <div className="mt-1 text-lg font-semibold text-[#1A1A1A]">{run.counters?.drafts_generated ?? 0}</div>
                  </div>
                  <div className="border-l-2 border-[#E2D4C3] pl-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">Sent</div>
                    <div className="mt-1 text-lg font-semibold text-[#1A1A1A]">{run.counters?.sends_succeeded ?? 0}</div>
                  </div>
                  <div className="border-l-2 border-[#E2D4C3] pl-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B7D6B]">Failed</div>
                    <div className="mt-1 text-lg font-semibold text-[#1A1A1A]">{run.counters?.sends_failed ?? 0}</div>
                  </div>
                </div>
              </div>
            ))}

            {!(system?.recent_runs ?? []).length ? (
              <div className="rounded-[18px] border border-dashed border-[#E2D4C6] px-4 py-6 text-sm text-[#6B5A48]">
                No recent runs are available yet.
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Recent failures</div>
        <div className="mt-4 space-y-3">
          {(system?.recent_failures ?? []).map((failure) => (
            <div key={failure.id} className="rounded-[18px] border border-[#F0D0C6] bg-[#FFF5F2] px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-[#1A1A1A]">{failure.job_type}</div>
                  <div className="mt-1 text-sm text-[#8A4330]">{failure.error_code || "ERROR"} · {failure.error_message || "Unknown failure"}</div>
                </div>
                <div className="text-xs text-[#8A4330]">{formatRelativeTime(failure.created_at)}</div>
              </div>
            </div>
          ))}

          {!(system?.recent_failures ?? []).length ? (
            <div className="rounded-[18px] border border-dashed border-[#E2D4C6] px-4 py-6 text-sm text-[#6B5A48]">
              No recent failed jobs.
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  )
}
