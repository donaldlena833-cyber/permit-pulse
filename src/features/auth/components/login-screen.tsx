import { type FormEvent, useState } from "react"
import { LoaderCircle, LockKeyhole, ScanSearch, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface LoginScreenProps {
  loading: boolean
  error?: string | null
  onSubmit: (email: string, password: string) => Promise<void>
  onSwitchToSignup?: () => void
}

export function LoginScreen({ loading, error, onSubmit, onSwitchToSignup }: LoginScreenProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onSubmit(email.trim(), password)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(184,138,82,0.18),transparent_30%),radial-gradient(circle_at_75%_5%,rgba(52,47,43,0.12),transparent_24%),linear-gradient(180deg,rgba(255,252,247,0.98),rgba(247,242,234,0.92))] dark:bg-[radial-gradient(circle_at_top_left,rgba(184,138,82,0.16),transparent_26%),radial-gradient(circle_at_75%_5%,rgba(255,252,247,0.04),transparent_20%),linear-gradient(180deg,rgba(22,20,18,0.98),rgba(28,24,20,0.96))]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center px-4 py-4 sm:px-8 sm:py-6">
        <div className="grid w-full gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
          <div className="hidden flex-col justify-between rounded-[32px] border border-navy-200/70 bg-white/75 p-5 shadow-[0_24px_90px_rgba(70,55,37,0.1)] backdrop-blur-xl sm:flex sm:p-8 dark:border-dark-border/70 dark:bg-dark-card/80">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-700 dark:border-orange-800/50 dark:bg-orange-900/20 dark:text-orange-200">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-white">
                  PP
                </div>
                PermitPulse Ops
              </div>
              <h1 className="mt-6 max-w-2xl text-[2rem] font-semibold tracking-[-0.05em] text-navy-900 sm:text-5xl dark:text-dark-text">
                Private lead ops for real contractor outreach work.
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-navy-600 sm:text-base sm:leading-7 dark:text-dark-muted">
                Run permit scanning, enrichment, lead research, and outbound follow-up from one private operator workspace.
              </p>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[24px] border border-navy-200/70 bg-cream-50/80 p-4 dark:border-dark-border/70 dark:bg-dark-bg">
                <ScanSearch className="h-5 w-5 text-orange-600 dark:text-orange-300" />
                <div className="mt-3 text-sm font-semibold text-navy-900 dark:text-dark-text">Scan and enrich</div>
                <p className="mt-1 text-sm leading-6 text-navy-500 dark:text-dark-muted">Let the system pull permits and build the first pass automatically.</p>
              </div>
              <div className="rounded-[24px] border border-navy-200/70 bg-cream-50/80 p-4 dark:border-dark-border/70 dark:bg-dark-bg">
                <LockKeyhole className="h-5 w-5 text-orange-600 dark:text-orange-300" />
                <div className="mt-3 text-sm font-semibold text-navy-900 dark:text-dark-text">Login only</div>
                <p className="mt-1 text-sm leading-6 text-navy-500 dark:text-dark-muted">The dashboard stays private. No public app surface, no open lead feed.</p>
              </div>
              <div className="rounded-[24px] border border-navy-200/70 bg-cream-50/80 p-4 dark:border-dark-border/70 dark:bg-dark-bg">
                <ShieldCheck className="h-5 w-5 text-orange-600 dark:text-orange-300" />
                <div className="mt-3 text-sm font-semibold text-navy-900 dark:text-dark-text">Long session</div>
                <p className="mt-1 text-sm leading-6 text-navy-500 dark:text-dark-muted">Stay signed in on your devices so the app is ready when you are.</p>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-navy-200/70 bg-white/88 p-5 shadow-[0_24px_90px_rgba(70,55,37,0.12)] backdrop-blur-xl sm:rounded-[32px] sm:p-8 dark:border-dark-border/70 dark:bg-dark-card/92">
            <div className="mb-5 flex items-center gap-3 rounded-full border border-orange-200 bg-orange-50/80 px-3.5 py-2 sm:hidden dark:border-orange-800/50 dark:bg-orange-900/20">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-xs font-semibold text-white">
                PP
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">PermitPulse Ops</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-orange-700 dark:text-orange-200">
                  Workspace access
                </div>
              </div>
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-600 dark:text-orange-300">
              Workspace access
            </div>
            <h2 className="mt-2 text-[1.75rem] font-semibold tracking-[-0.04em] text-navy-900 sm:mt-3 sm:text-3xl dark:text-dark-text">
              Sign in to your workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-navy-600 dark:text-dark-muted">
              Sign in to run scanning, enrichment, outreach, and workspace administration inside your operator workspace.
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-navy-500 dark:text-dark-muted">
                  Email or username
                </label>
                <Input
                  autoComplete="username"
                  className="h-12 rounded-2xl border-navy-200 bg-white/90 px-4 dark:border-dark-border dark:bg-dark-bg"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="operations@metroglasspro.com or lokeil"
                  type="text"
                  value={email}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-navy-500 dark:text-dark-muted">
                  Password
                </label>
                <Input
                  autoComplete="current-password"
                  className="h-12 rounded-2xl border-navy-200 bg-white/90 px-4 dark:border-dark-border dark:bg-dark-bg"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </div>

              {error ? (
                <div className="rounded-[20px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
                  {error}
                </div>
              ) : null}

              <Button
                className="h-12 w-full rounded-2xl bg-orange-500 text-base font-medium text-white shadow-[0_16px_30px_rgba(184,138,82,0.3)] hover:bg-orange-600"
                disabled={loading}
                type="submit"
              >
                {loading ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Signing in
                  </>
                ) : (
                  "Open dashboard"
                )}
              </Button>
            </form>

            {onSwitchToSignup ? (
              <button className="mt-4 text-sm font-medium text-orange-700" onClick={onSwitchToSignup} type="button">
                Need a new owner workspace? Create an account.
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
