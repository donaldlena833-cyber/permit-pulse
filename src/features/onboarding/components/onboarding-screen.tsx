import { useEffect, useState } from "react"
import { CheckCircle2, LoaderCircle, Mailbox, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { OnboardingPayload } from "@/features/metroglass-leads/types/api"

interface OnboardingScreenProps {
  state: OnboardingPayload | null
  loading?: boolean
  onBootstrap: (payload: {
    name: string
    business_name: string
    website?: string | null
    sender_name?: string | null
    sender_email?: string | null
    billing_email?: string | null
    phone?: string | null
  }) => Promise<void>
  onSaveProfile: (payload: Record<string, unknown>) => Promise<void>
  onUploadAttachment: (file: File) => Promise<void>
  onConnectMailbox: () => Promise<void>
}

export function OnboardingScreen({
  state,
  loading = false,
  onBootstrap,
  onSaveProfile,
  onUploadAttachment,
  onConnectMailbox,
}: OnboardingScreenProps) {
  const [bootstrapForm, setBootstrapForm] = useState({
    name: state?.account?.name || "",
    business_name: state?.account?.business_name || "",
    website: state?.account?.website || "",
    sender_name: state?.account?.sender_name || "",
    sender_email: state?.account?.sender_email || state?.email || "",
    billing_email: state?.account?.billing_email || state?.email || "",
    phone: state?.account?.phone || "",
  })
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    setBootstrapForm({
      name: state?.account?.name || "",
      business_name: state?.account?.business_name || "",
      website: state?.account?.website || "",
      sender_name: state?.account?.sender_name || "",
      sender_email: state?.account?.sender_email || state?.email || "",
      billing_email: state?.account?.billing_email || state?.email || "",
      phone: state?.account?.phone || "",
    })
  }, [state?.account, state?.email])

  const ready = state?.onboarding
  const needsBootstrap = Boolean(state?.requires_bootstrap)

  const runBusy = async (key: string, work: () => Promise<void>) => {
    setBusyKey(key)
    try {
      await work()
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(184,138,82,0.16),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(48,95,114,0.12),transparent_24%),linear-gradient(180deg,rgba(251,248,242,0.98),rgba(245,239,229,0.94))]" />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-[32px] border border-navy-200/70 bg-white/88 p-6 shadow-[0_24px_90px_rgba(70,55,37,0.12)] backdrop-blur-xl sm:p-8">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-orange-600">Workspace onboarding</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-navy-900">
              {needsBootstrap ? "Start the workspace" : `Finish setup for ${state?.account?.business_name || "your workspace"}`}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-navy-600">
              This flow creates the workspace, locks access to invited members only, and makes sure the sender identity, mailbox, and default PDF all belong to the same tenant.
            </p>

            <div className="mt-6 space-y-3">
              {[
                { done: ready?.business_info_completed, label: "Business info" },
                { done: ready?.sender_identity_completed, label: "Sender identity" },
                { done: ready?.attachment_completed, label: "Default PDF uploaded" },
                { done: ready?.mailbox_completed, label: "Workspace Gmail connected" },
                { done: ready?.first_campaign_ready, label: "First campaign marked ready" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-[18px] border border-navy-200 bg-cream-50/90 px-4 py-3 text-sm text-navy-700">
                  <CheckCircle2 className={`h-5 w-5 ${item.done ? "text-emerald-500" : "text-steel-300"}`} />
                  {item.label}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] border border-navy-200/70 bg-white/92 p-6 shadow-[0_24px_90px_rgba(70,55,37,0.12)] backdrop-blur-xl sm:p-8">
            <div className="grid gap-4">
              <label className="grid gap-2 text-sm text-navy-600">
                Workspace label
                <Input value={bootstrapForm.name} onChange={(event) => setBootstrapForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label className="grid gap-2 text-sm text-navy-600">
                Business name
                <Input value={bootstrapForm.business_name} onChange={(event) => setBootstrapForm((current) => ({ ...current, business_name: event.target.value }))} />
              </label>
              <label className="grid gap-2 text-sm text-navy-600">
                Website
                <Input value={bootstrapForm.website} onChange={(event) => setBootstrapForm((current) => ({ ...current, website: event.target.value }))} />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm text-navy-600">
                  Sender name
                  <Input value={bootstrapForm.sender_name} onChange={(event) => setBootstrapForm((current) => ({ ...current, sender_name: event.target.value }))} />
                </label>
                <label className="grid gap-2 text-sm text-navy-600">
                  Sender email
                  <Input value={bootstrapForm.sender_email} onChange={(event) => setBootstrapForm((current) => ({ ...current, sender_email: event.target.value }))} />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm text-navy-600">
                  Billing email
                  <Input value={bootstrapForm.billing_email} onChange={(event) => setBootstrapForm((current) => ({ ...current, billing_email: event.target.value }))} />
                </label>
                <label className="grid gap-2 text-sm text-navy-600">
                  Phone
                  <Input value={bootstrapForm.phone} onChange={(event) => setBootstrapForm((current) => ({ ...current, phone: event.target.value }))} />
                </label>
              </div>
            </div>

            {needsBootstrap ? (
              <Button
                className="mt-6 h-12 rounded-2xl bg-orange-500 px-6 text-white hover:bg-orange-600"
                disabled={loading || busyKey === "bootstrap"}
                onClick={() => void runBusy("bootstrap", async () => {
                  await onBootstrap(bootstrapForm)
                })}
              >
                {loading || busyKey === "bootstrap" ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Creating workspace
                  </>
                ) : (
                  "Create workspace"
                )}
              </Button>
            ) : (
              <div className="mt-6 grid gap-4">
                <Button
                  className="h-12 rounded-2xl px-6"
                  onClick={() => void runBusy("profile", async () => {
                    await onSaveProfile(bootstrapForm)
                  })}
                  variant="outline"
                >
                  Save business and sender info
                </Button>
                <div className="rounded-[22px] border border-navy-200 bg-cream-50/90 px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-navy-900">
                    <Upload className="h-4 w-4 text-orange-600" />
                    Upload default attachment
                  </div>
                  <Input accept="application/pdf" className="mt-3" type="file" onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)} />
                  <Button
                    className="mt-3 h-11 rounded-2xl px-5"
                    disabled={!attachmentFile || busyKey === "attachment"}
                    onClick={() => void runBusy("attachment", async () => {
                      if (!attachmentFile) {
                        return
                      }
                      await onUploadAttachment(attachmentFile)
                      setAttachmentFile(null)
                    })}
                  >
                    Upload PDF
                  </Button>
                </div>
                <div className="rounded-[22px] border border-navy-200 bg-cream-50/90 px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-navy-900">
                    <Mailbox className="h-4 w-4 text-orange-600" />
                    Connect the workspace inbox
                  </div>
                  <p className="mt-2 text-sm leading-6 text-navy-600">This mailbox becomes the sender identity and the reply-sync source for the tenant.</p>
                  <Button className="mt-3 h-11 rounded-2xl px-5" disabled={busyKey === "mailbox"} onClick={() => void runBusy("mailbox", onConnectMailbox)}>
                    Connect Gmail
                  </Button>
                </div>
                <Button
                  className="h-12 rounded-2xl bg-orange-500 px-6 text-white hover:bg-orange-600"
                  disabled={busyKey === "finish"}
                  onClick={() => void runBusy("finish", async () => {
                    await onSaveProfile({ first_campaign_ready: true })
                  })}
                >
                  Mark first campaign ready
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
