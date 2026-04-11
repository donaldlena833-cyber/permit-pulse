import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Panel } from "@/features/metroglass-leads/components/panel"
import type {
  ConfigPayload,
  HealthPayload,
  SystemPayload,
  TemplatePreviewPayload,
  TenantEmailTemplate,
  TenantProfile,
} from "@/features/metroglass-leads/types/api"

interface SettingsScreenProps {
  health: HealthPayload | null
  config: ConfigPayload | null
  system: SystemPayload | null
  tenant: TenantProfile | null
  templates: TenantEmailTemplate[]
  templatePlaceholders: string[]
  onSaveConfig: (patch: Partial<ConfigPayload>) => Promise<void>
  onSaveTenantProfile: (patch: Partial<TenantProfile>) => Promise<TenantProfile | void>
  onSaveTemplate: (
    templateId: string,
    patch: { subject_template?: string; body_template?: string },
  ) => Promise<TenantEmailTemplate | void>
  onResetTemplate: (templateId: string) => Promise<TenantEmailTemplate | void>
  onPreviewTemplate: (payload: {
    id?: string
    template_kind?: TenantEmailTemplate["template_kind"]
    subject_template?: string
    body_template?: string
    sample_data?: Record<string, unknown>
  }) => Promise<TemplatePreviewPayload>
}

function kindLabel(kind: TenantEmailTemplate["template_kind"]) {
  if (kind === "prospect_initial") return "Prospect Initial"
  if (kind === "prospect_follow_up_1") return "Prospect Follow-up 1"
  if (kind === "prospect_follow_up_2") return "Prospect Follow-up 2"
  if (kind === "permit_initial") return "Permit Initial"
  if (kind === "permit_follow_up_1") return "Permit Follow-up 1"
  return "Permit Follow-up 2"
}

function sectionLabel(kind: TenantEmailTemplate["template_kind"]) {
  return kind.startsWith("permit_") ? "Permit Outreach" : "Prospect Outreach"
}

function categoryLabel(category: TenantEmailTemplate["category"]) {
  if (!category) return "All categories"
  return category.replace(/_/g, " ")
}

export function SettingsScreen({
  health,
  config,
  system,
  tenant,
  templates,
  templatePlaceholders,
  onSaveConfig,
  onSaveTenantProfile,
  onSaveTemplate,
  onResetTemplate,
  onPreviewTemplate,
}: SettingsScreenProps) {
  const [configForm, setConfigForm] = useState<ConfigPayload | null>(config)
  const [profileForm, setProfileForm] = useState({
    business_name: tenant?.business_name || "",
    website: tenant?.website || "",
    phone: tenant?.phone || "",
    sender_name: tenant?.sender_name || "",
    outreach_pitch: tenant?.outreach_pitch || "",
    outreach_focus: tenant?.outreach_focus || "",
    outreach_cta: tenant?.outreach_cta || "",
    accent_color: tenant?.accent_color || "#334155",
  })
  const [drafts, setDrafts] = useState<Record<string, { subject_template: string; body_template: string }>>({})
  const [previewByTemplateId, setPreviewByTemplateId] = useState<Record<string, TemplatePreviewPayload["preview"] | undefined>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    setConfigForm(config)
  }, [config])

  useEffect(() => {
    setProfileForm({
      business_name: tenant?.business_name || "",
      website: tenant?.website || "",
      phone: tenant?.phone || "",
      sender_name: tenant?.sender_name || "",
      outreach_pitch: tenant?.outreach_pitch || "",
      outreach_focus: tenant?.outreach_focus || "",
      outreach_cta: tenant?.outreach_cta || "",
      accent_color: tenant?.accent_color || "#334155",
    })
  }, [tenant])

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        templates.map((template) => [
          template.id,
          {
            subject_template: template.subject_template,
            body_template: template.body_template,
          },
        ]),
      ),
    )
  }, [templates])

  const groupedTemplates = useMemo(() => {
    const groups = new Map<string, TenantEmailTemplate[]>()
    for (const template of templates) {
      const key = sectionLabel(template.template_kind)
      const current = groups.get(key) || []
      current.push(template)
      groups.set(key, current)
    }
    return Array.from(groups.entries())
  }, [templates])

  if (!tenant || !configForm) {
    return null
  }

  const saveConfig = async () => {
    setBusyKey("config")
    try {
      await onSaveConfig(configForm)
    } finally {
      setBusyKey(null)
    }
  }

  const saveProfile = async () => {
    setBusyKey("profile")
    try {
      await onSaveTenantProfile({
        business_name: profileForm.business_name,
        website: profileForm.website,
        phone: profileForm.phone || null,
        sender_name: profileForm.sender_name,
        outreach_pitch: profileForm.outreach_pitch,
        outreach_focus: profileForm.outreach_focus,
        outreach_cta: profileForm.outreach_cta,
        accent_color: profileForm.accent_color,
      })
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="space-y-5 pb-28">
      <Panel className="bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Settings</div>
        <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.05em] text-steel-900">Tenant workspace controls</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-steel-600">
          Manage this tenant’s brand profile, Gmail connection state, template library, and automation rules.
        </p>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Tenant profile</div>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm text-steel-600">
              Business name
              <Input value={profileForm.business_name} onChange={(event) => setProfileForm({ ...profileForm, business_name: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Website
              <Input value={profileForm.website} onChange={(event) => setProfileForm({ ...profileForm, website: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Phone
              <Input value={profileForm.phone} onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Sender name
              <Input value={profileForm.sender_name} onChange={(event) => setProfileForm({ ...profileForm, sender_name: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Accent color
              <div className="flex items-center gap-3">
                <Input className="h-12 w-20 rounded-2xl p-1" type="color" value={profileForm.accent_color} onChange={(event) => setProfileForm({ ...profileForm, accent_color: event.target.value })} />
                <Input value={profileForm.accent_color} onChange={(event) => setProfileForm({ ...profileForm, accent_color: event.target.value })} />
              </div>
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Outreach pitch
              <Textarea className="min-h-[110px]" value={profileForm.outreach_pitch} onChange={(event) => setProfileForm({ ...profileForm, outreach_pitch: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Outreach focus
              <Textarea className="min-h-[110px]" value={profileForm.outreach_focus} onChange={(event) => setProfileForm({ ...profileForm, outreach_focus: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Outreach CTA
              <Textarea className="min-h-[110px]" value={profileForm.outreach_cta} onChange={(event) => setProfileForm({ ...profileForm, outreach_cta: event.target.value })} />
            </label>
          </div>
          <Button className="mt-5 h-11 rounded-full px-5" disabled={busyKey === "profile"} onClick={() => void saveProfile()}>
            Save profile
          </Button>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Gmail and attachment</div>
            <div className="mt-4 grid gap-3 text-sm text-steel-600">
              <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                Gmail connected: {tenant.gmail_connected ? "Yes" : "No"}
              </div>
              <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                Connected email: {tenant.gmail_address || tenant.sender_email || "Not connected"}
              </div>
              <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                Token status: {tenant.gmail_token_status || "unknown"}
              </div>
              <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                Last token refresh: {tenant.gmail_last_token_refresh_at ? new Date(tenant.gmail_last_token_refresh_at).toLocaleString() : "Not yet recorded"}
              </div>
              <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                Attachment configured: {tenant.attachment_configured ? tenant.attachment_filename || "Yes" : "Missing"}
              </div>
              {!tenant.gmail_connected ? (
                <div className="rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-4 text-amber-800">
                  Run the Gmail OAuth setup script to connect this tenant’s inbox.
                </div>
              ) : null}
              <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">Worker healthy: {system?.worker.ok ? "Yes" : "No"}</div>
              <div className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">Health check: {health?.ok ? "Passing" : "Attention needed"}</div>
            </div>
          </Panel>

          <Panel>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Runtime reports</div>
            <div className="mt-4 space-y-3">
              {(system?.recent_runs ?? []).map((run) => (
                <div key={run.id} className="rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                  <div className="font-medium text-steel-900">
                    {run.mode?.startsWith("prospect_")
                      ? "Outreach batch"
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

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        {tenant.features.permit_scanning ? (
          <Panel>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Permit automation</div>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm text-steel-600">
                Daily cap
                <Input type="number" value={configForm.daily_send_cap} onChange={(event) => setConfigForm({ ...configForm, daily_send_cap: Number(event.target.value) })} />
              </label>
              <label className="grid gap-2 text-sm text-steel-600">
                Auto send trust threshold
                <Input type="number" value={configForm.auto_send_trust_threshold} onChange={(event) => setConfigForm({ ...configForm, auto_send_trust_threshold: Number(event.target.value) })} />
              </label>
              <label className="grid gap-2 text-sm text-steel-600">
                Manual send trust threshold
                <Input type="number" value={configForm.manual_send_trust_threshold} onChange={(event) => setConfigForm({ ...configForm, manual_send_trust_threshold: Number(event.target.value) })} />
              </label>
              <div className="flex items-center justify-between rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                <div>
                  <div className="font-medium text-steel-900">Permit auto-send on schedule</div>
                  <div className="text-sm text-steel-600">Allow scheduled permit automation to send without an operator click.</div>
                </div>
                <Switch checked={configForm.permit_auto_send_enabled} onCheckedChange={(checked) => setConfigForm({ ...configForm, permit_auto_send_enabled: checked })} />
              </div>
              <div className="flex items-center justify-between rounded-[16px] border border-steel-200 bg-white px-4 py-4">
                <div>
                  <div className="font-medium text-steel-900">Warm up mode</div>
                  <div className="text-sm text-steel-600">Keep permit sending volume capped while the mailbox warms up.</div>
                </div>
                <Switch checked={configForm.warm_up_mode} onCheckedChange={(checked) => setConfigForm({ ...configForm, warm_up_mode: checked })} />
              </div>
              <label className="grid gap-2 text-sm text-steel-600">
                Warm up daily cap
                <Input type="number" value={configForm.warm_up_daily_cap} onChange={(event) => setConfigForm({ ...configForm, warm_up_daily_cap: Number(event.target.value) })} />
              </label>
            </div>
          </Panel>
        ) : (
          <Panel>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Workspace scope</div>
            <div className="mt-4 rounded-[20px] border border-steel-200 bg-white px-4 py-4 text-sm leading-6 text-steel-600">
              Permit scanning is disabled for this tenant. This workspace is currently configured for CRM and outreach operations only.
            </div>
          </Panel>
        )}

        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Outreach schedule</div>
          <div className="mt-4 grid gap-4">
            <div className="flex items-center justify-between rounded-[16px] border border-steel-200 bg-white px-4 py-4">
              <div>
                <div className="font-medium text-steel-900">Prospects pilot enabled</div>
                <div className="text-sm text-steel-600">Run category-based prospect batches on the worker schedule.</div>
              </div>
              <Switch checked={configForm.prospect_pilot_enabled} onCheckedChange={(checked) => setConfigForm({ ...configForm, prospect_pilot_enabled: checked })} />
            </div>
            <label className="grid gap-2 text-sm text-steel-600">
              Total daily sends per category
              <Input
                type="number"
                value={configForm.prospect_daily_per_category ?? configForm.prospect_initial_daily_per_category}
                onChange={(event) => setConfigForm({
                  ...configForm,
                  prospect_daily_per_category: Number(event.target.value),
                  prospect_initial_daily_per_category: Number(event.target.value),
                  prospect_follow_up_daily_per_category: Number(event.target.value),
                })}
              />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Timezone
              <Input value={configForm.prospect_timezone} onChange={(event) => setConfigForm({ ...configForm, prospect_timezone: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Initial send time
              <Input value={configForm.prospect_initial_send_time} onChange={(event) => setConfigForm({ ...configForm, prospect_initial_send_time: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Follow-up send time
              <Input value={configForm.prospect_follow_up_send_time} onChange={(event) => setConfigForm({ ...configForm, prospect_follow_up_send_time: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Follow-up offsets in days
              <Input
                value={(configForm.prospect_follow_up_offsets_days ?? [configForm.prospect_follow_up_delay_days, 14]).join(", ")}
                onChange={(event) => {
                  const values = event.target.value
                    .split(",")
                    .map((value) => Number(value.trim()))
                    .filter((value) => Number.isFinite(value) && value > 0)
                  setConfigForm({
                    ...configForm,
                    prospect_follow_up_offsets_days: values,
                    prospect_follow_up_delay_days: values[0] ?? configForm.prospect_follow_up_delay_days,
                  })
                }}
              />
            </label>
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Email templates</div>
        <div className="mt-4 flex flex-wrap gap-2">
          {templatePlaceholders.map((placeholder) => (
            <div key={placeholder} className="rounded-full border border-steel-200 bg-white px-3 py-1 font-mono text-[11px] text-steel-600">
              {placeholder}
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-6">
          {groupedTemplates.map(([group, items]) => (
            <div key={group} className="space-y-4">
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-steel-500">{group}</div>
              <div className="grid gap-4 xl:grid-cols-2">
                {items.map((template) => {
                  const draft = drafts[template.id] || {
                    subject_template: template.subject_template,
                    body_template: template.body_template,
                  }
                  const preview = previewByTemplateId[template.id]
                  const saveKey = `template:${template.id}`
                  return (
                    <div key={template.id} className="rounded-[24px] border border-steel-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-base font-semibold text-steel-900">{kindLabel(template.template_kind)}</div>
                          <div className="text-xs uppercase tracking-[0.18em] text-steel-500">{categoryLabel(template.category)}</div>
                        </div>
                        {template.defaults ? (
                          <div className="rounded-full border border-steel-200 bg-steel-50 px-3 py-1 text-[11px] font-medium text-steel-600">
                            Default seed
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-4 grid gap-3">
                        <label className="grid gap-2 text-sm text-steel-600">
                          Subject
                          <Input
                            value={draft.subject_template}
                            onChange={(event) => setDrafts((current) => ({
                              ...current,
                              [template.id]: {
                                ...draft,
                                subject_template: event.target.value,
                              },
                            }))}
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-steel-600">
                          Body
                          <Textarea
                            className="min-h-[240px]"
                            value={draft.body_template}
                            onChange={(event) => setDrafts((current) => ({
                              ...current,
                              [template.id]: {
                                ...draft,
                                body_template: event.target.value,
                              },
                            }))}
                          />
                        </label>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          className="h-10 rounded-full px-4"
                          disabled={busyKey === saveKey}
                          onClick={() => {
                            setBusyKey(saveKey)
                            void onSaveTemplate(template.id, draft).then((nextTemplate) => {
                              if (nextTemplate) {
                                setDrafts((current) => ({
                                  ...current,
                                  [template.id]: {
                                    subject_template: nextTemplate.subject_template,
                                    body_template: nextTemplate.body_template,
                                  },
                                }))
                              }
                            }).finally(() => setBusyKey(null))
                          }}
                          type="button"
                        >
                          Save
                        </Button>
                        <Button
                          className="h-10 rounded-full px-4"
                          disabled={busyKey === saveKey}
                          onClick={() => {
                            setBusyKey(saveKey)
                            void onResetTemplate(template.id).then((nextTemplate) => {
                              if (nextTemplate) {
                                setDrafts((current) => ({
                                  ...current,
                                  [template.id]: {
                                    subject_template: nextTemplate.subject_template,
                                    body_template: nextTemplate.body_template,
                                  },
                                }))
                                setPreviewByTemplateId((current) => ({
                                  ...current,
                                  [template.id]: undefined,
                                }))
                              }
                            }).finally(() => setBusyKey(null))
                          }}
                          type="button"
                          variant="outline"
                        >
                          Reset to default
                        </Button>
                        <Button
                          className="h-10 rounded-full px-4"
                          onClick={() => {
                            void onPreviewTemplate({
                              id: template.id,
                              subject_template: draft.subject_template,
                              body_template: draft.body_template,
                            }).then((result) => {
                              setPreviewByTemplateId((current) => ({
                                ...current,
                                [template.id]: result.preview,
                              }))
                            })
                          }}
                          type="button"
                          variant="ghost"
                        >
                          Preview
                        </Button>
                      </div>

                      {preview ? (
                        <div className="mt-4 rounded-[18px] border border-steel-200 bg-steel-50 px-4 py-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-steel-500">Preview subject</div>
                          <div className="mt-2 text-sm font-medium text-steel-900">{preview.subject}</div>
                          <div className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-steel-500">Preview body</div>
                          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-steel-700">{preview.body}</pre>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="flex justify-end">
        <Button className="h-11 rounded-full px-5" disabled={busyKey === "config"} onClick={() => void saveConfig()}>
          Save automation settings
        </Button>
      </div>
    </div>
  )
}
