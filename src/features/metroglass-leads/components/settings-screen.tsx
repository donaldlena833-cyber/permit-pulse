import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Panel } from "@/features/metroglass-leads/components/panel"
import type { ConfigPayload, HealthPayload, SystemPayload } from "@/features/metroglass-leads/types/api"

interface SettingsScreenProps {
  health: HealthPayload | null
  config: ConfigPayload | null
  system: SystemPayload | null
  onSaveConfig: (patch: Partial<ConfigPayload>) => Promise<void>
}

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

  return (
    <div className="space-y-5 pb-28">
      <Panel className="bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Settings</div>
        <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.05em] text-steel-900">System controls</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-steel-600">
          Control permit send rules, the prospects pilot schedule, and what the worker is allowed to do on its own.
        </p>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Integrations</div>
          <div className="mt-4 grid gap-3 text-sm text-steel-600">
            <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">Gmail connected: {health?.hasGmail ? "Yes" : "No"}</div>
            <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">Default attachment: {health?.defaultAttachmentName || "Missing"}</div>
            <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">Worker healthy: {system?.worker.ok ? "Yes" : "No"}</div>
            <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">Total leads: {system?.total_leads ?? 0}</div>
            <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">Total prospects: {system?.total_prospects ?? 0}</div>
          </div>
        </Panel>

        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Permit automation</div>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm text-steel-600">
              Daily cap
              <Input type="number" value={form.daily_send_cap} onChange={(event) => setForm({ ...form, daily_send_cap: Number(event.target.value) })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Auto send trust threshold
              <Input type="number" value={form.auto_send_trust_threshold} onChange={(event) => setForm({ ...form, auto_send_trust_threshold: Number(event.target.value) })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Manual send trust threshold
              <Input type="number" value={form.manual_send_trust_threshold} onChange={(event) => setForm({ ...form, manual_send_trust_threshold: Number(event.target.value) })} />
            </label>
            <div className="flex items-center justify-between rounded-[16px] border border-steel-200 bg-white px-4 py-4">
              <div>
                <div className="font-medium text-steel-900">Permit auto-send on schedule</div>
                <div className="text-sm text-steel-600">Keep scheduled permit automation paused during the prospects pilot unless you intentionally turn it back on.</div>
              </div>
              <Switch checked={form.permit_auto_send_enabled} onCheckedChange={(checked) => setForm({ ...form, permit_auto_send_enabled: checked })} />
            </div>
            <div className="flex items-center justify-between rounded-[16px] border border-steel-200 bg-white px-4 py-4">
              <div>
                <div className="font-medium text-steel-900">Warm up mode</div>
                <div className="text-sm text-steel-600">Keep permit sending volume capped while the account warms up.</div>
              </div>
              <Switch checked={form.warm_up_mode} onCheckedChange={(checked) => setForm({ ...form, warm_up_mode: checked })} />
            </div>
            <label className="grid gap-2 text-sm text-steel-600">
              Warm up daily cap
              <Input type="number" value={form.warm_up_daily_cap} onChange={(event) => setForm({ ...form, warm_up_daily_cap: Number(event.target.value) })} />
            </label>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Prospects pilot</div>
          <div className="mt-4 grid gap-4">
            <div className="flex items-center justify-between rounded-[16px] border border-steel-200 bg-white px-4 py-4">
              <div>
                <div className="font-medium text-steel-900">Prospects pilot enabled</div>
                <div className="text-sm text-steel-600">Run category-based prospect batches on the worker schedule.</div>
              </div>
              <Switch checked={form.prospect_pilot_enabled} onCheckedChange={(checked) => setForm({ ...form, prospect_pilot_enabled: checked })} />
            </div>
            <label className="grid gap-2 text-sm text-steel-600">
              Total daily sends per category
              <Input
                type="number"
                value={form.prospect_daily_per_category ?? form.prospect_initial_daily_per_category}
                onChange={(event) => setForm({
                  ...form,
                  prospect_daily_per_category: Number(event.target.value),
                  prospect_initial_daily_per_category: Number(event.target.value),
                  prospect_follow_up_daily_per_category: Number(event.target.value),
                })}
              />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Timezone
              <Input value={form.prospect_timezone} onChange={(event) => setForm({ ...form, prospect_timezone: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Initial send time
              <Input value={form.prospect_initial_send_time} onChange={(event) => setForm({ ...form, prospect_initial_send_time: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Sequence send time
              <Input
                value={form.prospect_follow_up_send_time}
                onChange={(event) => setForm({
                  ...form,
                  prospect_follow_up_send_time: event.target.value,
                })}
              />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Follow-up offsets in days
              <Input
                value={(form.prospect_follow_up_offsets_days ?? [form.prospect_follow_up_delay_days, 14]).join(", ")}
                onChange={(event) => {
                  const values = event.target.value
                    .split(",")
                    .map((value) => Number(value.trim()))
                    .filter((value) => Number.isFinite(value) && value > 0)
                  setForm({
                    ...form,
                    prospect_follow_up_offsets_days: values,
                    prospect_follow_up_delay_days: values[0] ?? form.prospect_follow_up_delay_days,
                  })
                }}
              />
            </label>
          </div>
          <Button className="mt-5 h-11 rounded-full px-5" onClick={() => void save()}>
            Save settings
          </Button>
        </Panel>

        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Runtime reports</div>
          <div className="mt-4 space-y-3">
            {(system?.recent_runs ?? []).map((run) => (
              <div key={run.id} className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                <div className="font-medium text-steel-900">
                  {run.mode?.startsWith("prospect_")
                    ? "Outreach CRM daily send batch"
                    : run.status === "running" ? "Permit run in progress" : "Recent permit run"}
                </div>
                <div className="mt-1 text-sm text-steel-600">
                  {run.current_stage || run.status} · sent {run.summary?.sent ?? run.counters?.sends_succeeded ?? 0}
                  {run.slot_key ? ` · ${run.slot_key}` : ""}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 space-y-3">
            {(system?.recent_failures ?? []).map((failure) => (
              <div key={failure.id} className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-4">
                <div className="font-medium text-steel-900">{failure.job_type}</div>
                <div className="mt-1 text-sm text-red-700">{failure.error_code || "ERROR"} · {failure.error_message || "Unknown failure"}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
