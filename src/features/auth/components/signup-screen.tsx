import { type FormEvent, useState } from "react"
import { LoaderCircle, Sparkles, Users, Wallet } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface SignupScreenProps {
  loading: boolean
  error?: string | null
  onSubmit: (email: string, password: string) => Promise<void>
  onSwitchToLogin: () => void
}

export function SignupScreen({ loading, error, onSubmit, onSwitchToLogin }: SignupScreenProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onSubmit(email.trim(), password)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(184,138,82,0.16),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(48,95,114,0.12),transparent_24%),linear-gradient(180deg,rgba(251,248,242,0.98),rgba(245,239,229,0.94))]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center px-4 py-6 sm:px-8">
        <div className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="hidden rounded-[32px] border border-navy-200/70 bg-white/78 p-8 shadow-[0_24px_90px_rgba(70,55,37,0.12)] backdrop-blur-xl lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-700">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-white">PP</div>
                PermitPulse
              </div>
              <h1 className="mt-6 max-w-2xl text-[2rem] font-semibold tracking-[-0.05em] text-navy-900 sm:text-5xl">
                Create the workspace before you ever touch SQL, Wrangler, or a shared inbox.
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-navy-600">
                Owner signup starts the workspace, guided onboarding connects the sender identity, and teammates join later through invites.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[22px] border border-navy-200/70 bg-cream-50/90 p-4">
                <Users className="h-5 w-5 text-orange-600" />
                <div className="mt-3 text-sm font-semibold text-navy-900">Invite-only access</div>
                <p className="mt-1 text-sm leading-6 text-navy-500">No more manual password handoffs or email-domain auto joins.</p>
              </div>
              <div className="rounded-[22px] border border-navy-200/70 bg-cream-50/90 p-4">
                <Sparkles className="h-5 w-5 text-orange-600" />
                <div className="mt-3 text-sm font-semibold text-navy-900">Guided setup</div>
                <p className="mt-1 text-sm leading-6 text-navy-500">Business info, sender identity, workspace PDF, and first campaign in one flow.</p>
              </div>
              <div className="rounded-[22px] border border-navy-200/70 bg-cream-50/90 p-4">
                <Wallet className="h-5 w-5 text-orange-600" />
                <div className="mt-3 text-sm font-semibold text-navy-900">Owner billing</div>
                <p className="mt-1 text-sm leading-6 text-navy-500">Checkout and billing portal are locked to the owner role.</p>
              </div>
            </div>
          </div>

          <div className="rounded-[32px] border border-navy-200/70 bg-white/90 p-6 shadow-[0_24px_90px_rgba(70,55,37,0.12)] backdrop-blur-xl sm:p-8">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-600">Owner signup</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-navy-900">Create your account</h2>
            <p className="mt-2 text-sm leading-6 text-navy-600">You’ll set the workspace details and sender identity in the next step.</p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <label className="grid gap-2 text-sm text-navy-600">
                Email
                <Input
                  autoComplete="email"
                  className="h-12 rounded-2xl border-navy-200 bg-white/90 px-4"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="owner@yourcompany.com"
                  type="email"
                  value={email}
                />
              </label>
              <label className="grid gap-2 text-sm text-navy-600">
                Password
                <Input
                  autoComplete="new-password"
                  className="h-12 rounded-2xl border-navy-200 bg-white/90 px-4"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </label>

              {error ? (
                <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
              ) : null}

              <Button className="h-12 w-full rounded-2xl bg-orange-500 text-base font-medium text-white hover:bg-orange-600" disabled={loading} type="submit">
                {loading ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Creating account
                  </>
                ) : (
                  "Continue to workspace setup"
                )}
              </Button>
            </form>

            <button className="mt-4 text-sm font-medium text-orange-700" onClick={onSwitchToLogin} type="button">
              Already have access? Sign in instead.
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
