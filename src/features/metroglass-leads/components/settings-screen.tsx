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
    <div className="space-y-4 pb-28">
      <Panel>
        <div className="text-[11px] uppercase tracking-[0.24em] text-[#8B7D6B]">Settings</div>
        <h1 className="mt-2 font-['Instrument_Serif'] text-4xl text-[#1A1A1A]">System controls</h1>
      </Panel>

      <Panel>
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Account</div>
        <div className="mt-3 text-sm text-[#5F564C]">Gmail connected: {health?.hasGmail ? "Yes" : "No"}</div>
        <div className="mt-2 text-sm text-[#5F564C]">Default attachment: {health?.defaultAttachmentName || "Missing"}</div>
      </Panel>

      <Panel>
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">Send rules</div>
        <div className="mt-4 grid gap-4">
          <label className="grid gap-2 text-sm text-[#5F564C]">
            Daily cap
            <Input type="number" value={form.daily_send_cap} onChange={(event) => setForm({ ...form, daily_send_cap: Number(event.target.value) })} />
          </label>
          <label className="grid gap-2 text-sm text-[#5F564C]">
            Auto send trust threshold
            <Input type="number" value={form.auto_send_trust_threshold} onChange={(event) => setForm({ ...form, auto_send_trust_threshold: Number(event.target.value) })} />
          </label>
          <label className="grid gap-2 text-sm text-[#5F564C]">
            Manual send trust threshold
            <Input type="number" value={form.manual_send_trust_threshold} onChange={(event) => setForm({ ...form, manual_send_trust_threshold: Number(event.target.value) })} />
          </label>
          <div className="flex items-center justify-between rounded-[10px] border border-[#EEE4D7] px-3 py-3">
            <div>
              <div className="font-medium text-[#1A1A1A]">Warm up mode</div>
              <div className="text-sm text-[#5F564C]">Keep sending volume limited while the account warms up.</div>
            </div>
            <Switch checked={form.warm_up_mode} onCheckedChange={(checked) => setForm({ ...form, warm_up_mode: checked })} />
          </div>
          <label className="grid gap-2 text-sm text-[#5F564C]">
            Warm up daily cap
            <Input type="number" value={form.warm_up_daily_cap} onChange={(event) => setForm({ ...form, warm_up_daily_cap: Number(event.target.value) })} />
          </label>
        </div>
        <Button className="mt-4 h-11 rounded-[8px] bg-[#1A1A1A] text-white hover:bg-[#1A1A1A]" onClick={() => void save()}>
          Save settings
        </Button>
      </Panel>

      <Panel>
        <div className="text-xs uppercase tracking-[0.2em] text-[#8B7D6B]">System health</div>
        <div className="mt-3 text-sm text-[#5F564C]">Worker healthy: {system?.worker.ok ? "Yes" : "No"}</div>
        <div className="mt-2 text-sm text-[#5F564C]">Total leads: {system?.total_leads ?? 0}</div>
        <div className="mt-4 space-y-3">
          {(system?.recent_runs ?? []).map((run) => (
            <div key={run.id} className="rounded-[10px] border border-[#EEE4D7] bg-[#FFFCF8] px-3 py-3">
              <div className="font-medium text-[#1A1A1A]">
                {run.status === "running" ? "Run in progress" : "Recent run"}
              </div>
              <div className="mt-1 text-sm text-[#5F564C]">
                {run.current_stage || run.status} · backlog {run.progress?.backlog_pending ?? 0} · claimed {run.progress?.claimed ?? 0} · processed {run.progress?.processed ?? 0} · sent {run.summary?.sent ?? run.counters?.sends_succeeded ?? 0}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {(system?.recent_failures ?? []).map((failure) => (
            <div key={failure.id} className="rounded-[10px] border border-[#F0D0C6] bg-[#FFF5F2] px-3 py-3">
              <div className="font-medium text-[#1A1A1A]">{failure.job_type}</div>
              <div className="mt-1 text-sm text-[#8A4330]">{failure.error_code || "ERROR"} · {failure.error_message || "Unknown failure"}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
