import { type FormEvent, useState } from "react"
import { LoaderCircle, Mail, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { InvitePreviewPayload } from "@/features/metroglass-leads/types/api"

interface InviteAcceptScreenProps {
  invite: InvitePreviewPayload | null
  loading: boolean
  error?: string | null
  authenticated: boolean
  onAccept: () => Promise<void>
  onLogin: (email: string, password: string) => Promise<void>
  onSignup: (email: string, password: string) => Promise<void>
}

export function InviteAcceptScreen({
  invite,
  loading,
  error,
  authenticated,
  onAccept,
  onLogin,
  onSignup,
}: InviteAcceptScreenProps) {
  const [email, setEmail] = useState(invite?.invite.email || "")
  const [password, setPassword] = useState("")

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onLogin(email.trim(), password)
  }

  const handleSignup = async () => {
    await onSignup(email.trim(), password)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(184,138,82,0.16),transparent_30%),linear-gradient(180deg,rgba(251,248,242,0.98),rgba(245,239,229,0.94))]" />
      <div className="relative mx-auto flex min-h-screen max-w-4xl items-center px-4 py-6 sm:px-8">
        <div className="w-full rounded-[32px] border border-navy-200/70 bg-white/90 p-6 shadow-[0_24px_90px_rgba(70,55,37,0.12)] backdrop-blur-xl sm:p-8">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-orange-600">Workspace invite</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-navy-900">
            Join {invite?.account.business_name || "this workspace"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-navy-600">
            You were invited as a {invite?.invite.role || "member"} on {invite?.invite.email || "your email address"}.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[20px] border border-navy-200 bg-cream-50/90 px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-navy-900">
                <Mail className="h-4 w-4 text-orange-600" />
                Invited email
              </div>
              <div className="mt-2 text-sm text-navy-600">{invite?.invite.email || "Unknown"}</div>
            </div>
            <div className="rounded-[20px] border border-navy-200 bg-cream-50/90 px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-navy-900">
                <UserPlus className="h-4 w-4 text-orange-600" />
                Role
              </div>
              <div className="mt-2 text-sm text-navy-600">{invite?.invite.role || "member"}</div>
            </div>
          </div>

          {authenticated ? (
            <Button className="mt-6 h-12 rounded-2xl bg-orange-500 px-6 text-white hover:bg-orange-600" disabled={loading} onClick={() => void onAccept()}>
              {loading ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Accepting invite
                </>
              ) : (
                "Accept workspace invite"
              )}
            </Button>
          ) : (
            <form className="mt-6 grid gap-4" onSubmit={handleLogin}>
              <label className="grid gap-2 text-sm text-navy-600">
                Email
                <Input value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm text-navy-600">
                Password
                <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              <div className="flex flex-wrap gap-3">
                <Button className="h-12 rounded-2xl bg-orange-500 px-6 text-white hover:bg-orange-600" disabled={loading} type="submit">
                  {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Sign in to accept"}
                </Button>
                <Button className="h-12 rounded-2xl px-6" disabled={loading} onClick={() => void handleSignup()} type="button" variant="outline">
                  Create account and accept
                </Button>
              </div>
            </form>
          )}

          {error ? (
            <div className="mt-4 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
