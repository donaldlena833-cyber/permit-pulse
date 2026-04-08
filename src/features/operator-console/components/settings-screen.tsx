import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Panel } from "@/features/operator-console/components/panel"
import {
  archiveWorkspaceAttachmentRequest,
  beginWorkspaceGmailConnect,
  createWorkspaceInviteRequest,
  disableWorkspaceMemberRequest,
  fetchAuditLog,
  resendWorkspaceInviteRequest,
  setWorkspaceAttachmentDefault,
  transferWorkspaceOwnershipRequest,
  updateWorkspaceMemberRoleRequest,
} from "@/features/operator-console/lib/remote"
import type {
  AuditEvent,
  ConfigPayload,
  HealthPayload,
  SystemPayload,
} from "@/features/operator-console/types/api"

interface SettingsScreenProps {
  health: HealthPayload | null
  config: ConfigPayload | null
  system: SystemPayload | null
  onSaveConfig: (patch: Partial<ConfigPayload>) => Promise<void>
  onSaveWorkspaceProfile: (payload: {
    name?: string
    business_name?: string
    website?: string | null
    sender_name?: string | null
    sender_email?: string | null
    billing_email?: string | null
    phone?: string | null
    outreach_pitch?: string | null
    outreach_focus?: string | null
    outreach_cta?: string | null
    first_campaign_ready?: boolean
  }) => Promise<void>
  onUploadWorkspaceAttachment: (payload: {
    filename: string
    content_type: string
    content_base64: string
    make_default?: boolean
    archive_previous_default?: boolean
  }) => Promise<void>
  onRefreshWorkspace: () => Promise<void>
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return "Not yet"
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function statusDot(status?: string) {
  if (status === "healthy" || status === "active" || status === "completed") return "bg-emerald-500"
  if (status === "warning" || status === "trialing" || status === "in_progress" || status === "invited") return "bg-amber-500"
  if (status === "stale" || status === "past_due" || status === "disabled") return "bg-rose-500"
  return "bg-steel-300"
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }

  return btoa(binary)
}

export function SettingsScreen({
  health,
  config,
  system,
  onSaveConfig,
  onSaveWorkspaceProfile,
  onUploadWorkspaceAttachment,
  onRefreshWorkspace,
}: SettingsScreenProps) {
  const [form, setForm] = useState<ConfigPayload | null>(config)
  const [workspaceForm, setWorkspaceForm] = useState({
    name: system?.account?.name || "",
    business_name: system?.account?.business_name || "",
    website: system?.account?.website || "",
    sender_name: system?.account?.sender_name || "",
    sender_email: system?.account?.sender_email || "",
    billing_email: system?.account?.billing_email || "",
    phone: system?.account?.phone || "",
    outreach_pitch: system?.account?.outreach_pitch || "",
    outreach_focus: system?.account?.outreach_focus || "",
    outreach_cta: system?.account?.outreach_cta || "",
    first_campaign_ready: Boolean(system?.onboarding?.first_campaign_ready),
  })
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [archiveOldDefault, setArchiveOldDefault] = useState(true)
  const [memberForm, setMemberForm] = useState({
    email: "",
    full_name: "",
    role: "member" as "admin" | "member",
  })
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    setForm(config)
  }, [config])

  useEffect(() => {
    setWorkspaceForm({
      name: system?.account?.name || "",
      business_name: system?.account?.business_name || "",
      website: system?.account?.website || "",
      sender_name: system?.account?.sender_name || "",
      sender_email: system?.account?.sender_email || "",
      billing_email: system?.account?.billing_email || "",
      phone: system?.account?.phone || "",
      outreach_pitch: system?.account?.outreach_pitch || "",
      outreach_focus: system?.account?.outreach_focus || "",
      outreach_cta: system?.account?.outreach_cta || "",
      first_campaign_ready: Boolean(system?.onboarding?.first_campaign_ready),
    })
  }, [system?.account, system?.onboarding?.first_campaign_ready])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const payload = await fetchAuditLog(1, 12)
        if (!cancelled) {
          setAudit(payload.events)
        }
      } catch {
        if (!cancelled) {
          setAudit([])
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [system?.account?.id])

  if (!form || !system) {
    return null
  }

  const currentMember = system.current_member
  const canManageWorkspace = currentMember.role === "owner" || currentMember.role === "admin"
  const isOwner = currentMember.role === "owner"

  const withBusy = async (key: string, work: () => Promise<void>, successMessage?: string) => {
    setBusyKey(key)
    try {
      await work()
      await onRefreshWorkspace()
      if (successMessage) {
        toast.success(successMessage)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed")
    } finally {
      setBusyKey(null)
    }
  }

  const uploadAttachment = async () => {
    if (!attachmentFile) {
      return
    }

    const content_base64 = await fileToBase64(attachmentFile)
    await withBusy("upload-attachment", async () => {
      await onUploadWorkspaceAttachment({
        filename: attachmentFile.name,
        content_type: attachmentFile.type || "application/pdf",
        content_base64,
        make_default: true,
        archive_previous_default: archiveOldDefault,
      })
      setAttachmentFile(null)
    }, "Workspace PDF uploaded")
  }

  const createInvite = async () => {
    await withBusy("create-invite", async () => {
      const result = await createWorkspaceInviteRequest(memberForm)
      const inviteUrl = result.auth_invite_url || result.invite_url
      if (inviteUrl && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl).catch(() => undefined)
      }
      setMemberForm({
        email: "",
        full_name: "",
        role: "member",
      })
    }, "Invite created")
  }

  const metrics = system.metrics
  const onboarding = system.onboarding
  const mailboxSelfServeEnabled = Boolean(system.capabilities?.mailbox_self_serve_connect)

  return (
    <div className="space-y-5 pb-28">
      <Panel className="bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Workspace Settings</div>
        <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.05em] text-steel-900">Growth-ready controls</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-steel-600">
          Manage onboarding, attachment files, workspace access, audit history, and the send policy for this internal operator workspace.
        </p>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Workspace Snapshot</div>
          <div className="mt-4 grid gap-3">
            <div className="rounded-[18px] border border-steel-200 bg-white px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-steel-500">Workspace mode</div>
              <div className="mt-2 text-sm text-steel-900">Internal operator workspace with future-ready workspace boundaries</div>
            </div>
            <div className="rounded-[18px] border border-steel-200 bg-white px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-steel-500">Onboarding</div>
              <div className="mt-2 flex items-center gap-2 text-sm text-steel-900">
                <span className={`h-2.5 w-2.5 rounded-full ${statusDot(onboarding?.status)}`} />
                {onboarding?.status || system.account.onboarding_status || "pending"}
              </div>
              <div className="mt-3 grid gap-2 text-xs text-steel-600">
                <div>Business info: {onboarding?.business_info_completed ? "Done" : "Pending"}</div>
                <div>Sender identity: {onboarding?.sender_identity_completed ? "Done" : "Pending"}</div>
                <div>Attachment: {onboarding?.attachment_completed ? "Done" : "Pending"}</div>
                <div>Mailbox: {onboarding?.mailbox_completed ? "Done" : "Pending"}</div>
                <div>First campaign: {onboarding?.first_campaign_ready ? "Done" : "Pending"}</div>
              </div>
            </div>
            <div className="rounded-[18px] border border-steel-200 bg-white px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-steel-500">Workspace Health</div>
              <div className="mt-3 grid gap-2 text-sm text-steel-700">
                <div>Mailbox connected: {system.health.mailbox_connected ? system.health.mailbox_email : "No"}</div>
                <div>Default attachment: {system.health.attachment_loaded ? system.health.attachment_filename : "Missing or not loaded"}</div>
                <div>Run freshness: {system.health.run_freshness.status}{system.health.run_freshness.age_minutes !== null ? ` · ${system.health.run_freshness.age_minutes}m ago` : ""}</div>
                <div>Reply sync freshness: {system.health.reply_sync_freshness.status}{system.health.reply_sync_freshness.age_minutes !== null ? ` · ${system.health.reply_sync_freshness.age_minutes}m ago` : ""}</div>
                <div>Global worker check: {health?.ok ? "Healthy" : "Offline"}</div>
              </div>
            </div>
            <div className="rounded-[18px] border border-steel-200 bg-white px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-steel-500">Metrics (30 days)</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-steel-700">
                <div>{metrics?.lead_sends_30d ?? 0} lead sends</div>
                <div>{metrics?.prospect_sends_30d ?? 0} prospect sends</div>
                <div>{metrics?.prospect_positive_replies_30d ?? 0} positive replies</div>
                <div>{metrics?.prospect_opt_outs_30d ?? 0} opt-outs</div>
                <div>{metrics?.runs_30d ?? 0} automation runs</div>
                <div>{metrics?.runs_failed_30d ?? 0} failed runs</div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Profile and Sender Identity</div>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm text-steel-600">
              Workspace label
              <Input value={workspaceForm.name} onChange={(event) => setWorkspaceForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Business name
              <Input value={workspaceForm.business_name} onChange={(event) => setWorkspaceForm((current) => ({ ...current, business_name: event.target.value }))} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Website
              <Input value={workspaceForm.website} onChange={(event) => setWorkspaceForm((current) => ({ ...current, website: event.target.value }))} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm text-steel-600">
                Sender name
                <Input value={workspaceForm.sender_name} onChange={(event) => setWorkspaceForm((current) => ({ ...current, sender_name: event.target.value }))} />
              </label>
              <label className="grid gap-2 text-sm text-steel-600">
                Sender email
                <Input value={workspaceForm.sender_email} onChange={(event) => setWorkspaceForm((current) => ({ ...current, sender_email: event.target.value }))} />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm text-steel-600">
                Billing email
                <Input value={workspaceForm.billing_email} onChange={(event) => setWorkspaceForm((current) => ({ ...current, billing_email: event.target.value }))} />
              </label>
              <label className="grid gap-2 text-sm text-steel-600">
                Phone
                <Input value={workspaceForm.phone} onChange={(event) => setWorkspaceForm((current) => ({ ...current, phone: event.target.value }))} />
              </label>
            </div>
            <label className="grid gap-2 text-sm text-steel-600">
              Outreach pitch
              <textarea
                className="min-h-[90px] rounded-[16px] border border-steel-200 bg-white px-3 py-3 text-sm text-steel-900"
                value={workspaceForm.outreach_pitch}
                onChange={(event) => setWorkspaceForm((current) => ({ ...current, outreach_pitch: event.target.value }))}
              />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Outreach focus
              <textarea
                className="min-h-[90px] rounded-[16px] border border-steel-200 bg-white px-3 py-3 text-sm text-steel-900"
                value={workspaceForm.outreach_focus}
                onChange={(event) => setWorkspaceForm((current) => ({ ...current, outreach_focus: event.target.value }))}
              />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Closing CTA
              <textarea
                className="min-h-[90px] rounded-[16px] border border-steel-200 bg-white px-3 py-3 text-sm text-steel-900"
                value={workspaceForm.outreach_cta}
                onChange={(event) => setWorkspaceForm((current) => ({ ...current, outreach_cta: event.target.value }))}
              />
            </label>
            <div className="flex items-center justify-between rounded-[16px] border border-steel-200 bg-white px-4 py-4">
              <div>
                <div className="font-medium text-steel-900">First campaign ready</div>
                <div className="text-sm text-steel-600">Mark onboarding complete once the workspace is ready to start its first live campaign.</div>
              </div>
              <Switch
                checked={workspaceForm.first_campaign_ready}
                onCheckedChange={(checked) => setWorkspaceForm((current) => ({ ...current, first_campaign_ready: checked }))}
              />
            </div>
          </div>
          <Button
            className="mt-5 h-11 rounded-full px-5"
            disabled={!canManageWorkspace || busyKey === "save-profile"}
            onClick={() => void withBusy("save-profile", async () => {
              await onSaveWorkspaceProfile(workspaceForm)
            }, "Workspace profile updated")}
          >
            Save workspace profile
          </Button>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Workspace Files</div>
          <div className="mt-4 space-y-3">
            {(system.attachments ?? []).map((attachment) => (
              <div key={attachment.id} className="rounded-[18px] border border-steel-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-steel-900">{attachment.filename}</div>
                    <div className="mt-1 text-sm text-steel-600">
                      {(attachment.file_size_bytes / 1024 / 1024).toFixed(2)} MB · {attachment.status}
                      {attachment.is_default ? " · default" : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!attachment.is_default && attachment.status === "active" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void withBusy(`attachment-default-${attachment.id}`, async () => {
                          await setWorkspaceAttachmentDefault(attachment.id)
                        }, "Default attachment updated")}
                      >
                        Make default
                      </Button>
                    ) : null}
                    {attachment.status === "active" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void withBusy(`attachment-archive-${attachment.id}`, async () => {
                          await archiveWorkspaceAttachmentRequest(attachment.id)
                        }, "Attachment archived")}
                      >
                        Archive
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {system.attachments?.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-steel-200 bg-white px-4 py-4 text-sm text-steel-500">
                No PDFs uploaded yet.
              </div>
            ) : null}
          </div>
          <div className="mt-5 grid gap-3">
            <Input accept="application/pdf" type="file" onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)} />
            <div className="flex items-center justify-between rounded-[16px] border border-steel-200 bg-white px-4 py-4">
              <div>
                <div className="font-medium text-steel-900">Archive previous default</div>
                <div className="text-sm text-steel-600">Keep the library clean when replacing the active outbound PDF.</div>
              </div>
              <Switch checked={archiveOldDefault} onCheckedChange={setArchiveOldDefault} />
            </div>
          </div>
          <Button
            className="mt-5 h-11 rounded-full px-5"
            disabled={!canManageWorkspace || !attachmentFile || busyKey === "upload-attachment"}
            onClick={() => void uploadAttachment()}
          >
            Upload PDF to workspace library
          </Button>
        </Panel>

        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Mailbox Setup</div>
          <div className="mt-4 grid gap-4">
            <div className="rounded-[18px] border border-steel-200 bg-white px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-steel-500">Default mailbox</div>
              <div className="mt-2 text-sm text-steel-900">{system.default_mailbox?.email || "No mailbox connected yet"}</div>
              <div className="mt-1 text-sm text-steel-600">Last sync: {formatDateTime(system.default_mailbox?.last_synced_at)}</div>
            </div>
            <div className="rounded-[18px] border border-steel-200 bg-white px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-steel-500">Connection mode</div>
              <div className="mt-2 text-sm text-steel-900">{mailboxSelfServeEnabled ? "Self-serve connect enabled" : "Manual setup only"}</div>
              <div className="mt-1 text-sm text-steel-600">
                {mailboxSelfServeEnabled
                  ? "Use the workspace Gmail flow to authorize the sending inbox."
                  : "New workspaces do not self-connect Gmail yet. Keep sender identity current above, then wire the mailbox through the worker when the workspace is ready to go live."}
              </div>
            </div>
            {mailboxSelfServeEnabled ? (
              <Button
                className="h-11 rounded-full px-5"
                disabled={!canManageWorkspace || busyKey === "gmail-connect"}
                onClick={() => void withBusy("gmail-connect", async () => {
                  const result = await beginWorkspaceGmailConnect("/app/settings")
                  window.location.assign(result.authorization_url)
                })}
              >
                Connect workspace Gmail
              </Button>
            ) : (
              <div className="rounded-[18px] border border-dashed border-steel-200 bg-white px-4 py-4 text-sm text-steel-600">
                Billing and self-serve mailbox setup are intentionally hidden while PermitPulse remains an internal MetroGlass operator system.
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Members and Invites</div>
          <div className="mt-4 space-y-3">
            {system.members.map((member) => {
              const isCurrent = member.email === currentMember.email
              return (
                <div key={member.id || member.email} className="rounded-[18px] border border-steel-200 bg-white px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-steel-900">{member.full_name || member.email}</div>
                      <div className="mt-1 text-sm text-steel-600">
                        {member.email} · {member.role} · {member.status}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {member.status === "invited" && member.id ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void withBusy(`resend-${member.id}`, async () => {
                            const result = await resendWorkspaceInviteRequest(member.id!)
                            const inviteUrl = result.auth_invite_url || result.invite_url
                            if (inviteUrl && navigator.clipboard?.writeText) {
                              await navigator.clipboard.writeText(inviteUrl).catch(() => undefined)
                            }
                          }, "Invite resent")}
                        >
                          Resend
                        </Button>
                      ) : null}
                      {isOwner && member.id && member.role !== "owner" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void withBusy(`role-${member.id}`, async () => {
                            await updateWorkspaceMemberRoleRequest(member.id!, member.role === "admin" ? "member" : "admin")
                          }, member.role === "admin" ? "Member downgraded" : "Member promoted")}
                        >
                          {member.role === "admin" ? "Make member" : "Make admin"}
                        </Button>
                      ) : null}
                      {isOwner && member.id && member.role !== "owner" && member.status === "active" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void withBusy(`transfer-${member.id}`, async () => {
                            await transferWorkspaceOwnershipRequest(member.id!)
                          }, "Ownership transferred")}
                        >
                          Transfer owner
                        </Button>
                      ) : null}
                      {!isCurrent && member.id && member.role !== "owner" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void withBusy(`disable-${member.id}`, async () => {
                            await disableWorkspaceMemberRequest(member.id!)
                          }, "Member disabled")}
                        >
                          Disable
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Invite teammate</div>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm text-steel-600">
              Full name
              <Input value={memberForm.full_name} onChange={(event) => setMemberForm((current) => ({ ...current, full_name: event.target.value }))} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Email
              <Input value={memberForm.email} onChange={(event) => setMemberForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label className="grid gap-2 text-sm text-steel-600">
              Role
              <select
                className="h-10 rounded-[14px] border border-steel-200 bg-white px-3 text-sm text-steel-900"
                value={memberForm.role}
                onChange={(event) => setMemberForm((current) => ({
                  ...current,
                  role: event.target.value as "admin" | "member",
                }))}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          <Button
            className="mt-5 h-11 rounded-full px-5"
            disabled={!canManageWorkspace || !memberForm.email || busyKey === "create-invite"}
            onClick={() => void createInvite()}
          >
            Send invite
          </Button>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Outbound Safety</div>
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
                <div className="text-sm text-steel-600">Leave this off until the workspace mailbox and PDF are fully verified.</div>
              </div>
              <Switch checked={form.permit_auto_send_enabled} onCheckedChange={(checked) => setForm({ ...form, permit_auto_send_enabled: checked })} />
            </div>
            <div className="flex items-center justify-between rounded-[16px] border border-steel-200 bg-white px-4 py-4">
              <div>
                <div className="font-medium text-steel-900">Follow-up automation</div>
                <div className="text-sm text-steel-600">Keep reply handling and follow-up sends coordinated inside the same workspace mailbox.</div>
              </div>
              <Switch checked={form.follow_up_enabled} onCheckedChange={(checked) => setForm({ ...form, follow_up_enabled: checked })} />
            </div>
          </div>
          <Button
            className="mt-5 h-11 rounded-full px-5"
            disabled={!canManageWorkspace || busyKey === "save-config"}
            onClick={() => void withBusy("save-config", async () => {
              await onSaveConfig(form)
            }, "Send policy updated")}
          >
            Save send policy
          </Button>
        </Panel>

        <Panel>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel-500">Audit Trail</div>
          <div className="mt-4 space-y-3">
            {audit.map((event) => (
              <div key={event.id} className="rounded-[18px] border border-steel-200 bg-white px-4 py-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-steel-500">
                  <span className={`h-2.5 w-2.5 rounded-full ${statusDot(event.actor_type === "system" ? "warning" : "healthy")}`} />
                  {event.event_type.replace(/_/g, " ")}
                </div>
                <div className="mt-2 text-sm text-steel-700">{formatDateTime(event.created_at)}</div>
                {event.actor_id ? <div className="mt-1 text-sm text-steel-600">Actor: {event.actor_id}</div> : null}
              </div>
            ))}
            {audit.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-steel-200 bg-white px-4 py-4 text-sm text-steel-500">
                Audit events will appear here as the workspace is configured and used.
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  )
}
