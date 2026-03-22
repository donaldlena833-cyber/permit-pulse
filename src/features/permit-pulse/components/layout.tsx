import type { ReactNode } from "react"
import {
  LayoutDashboard,
  Layers3,
  LogOut,
  MoonStar,
  SearchCheck,
  Settings2,
  SunMedium,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/features/permit-pulse/lib/format"
import type { AppTheme, MainSection } from "@/types/permit-pulse"
import { cn } from "@/lib/utils"

const NAV_ITEMS: Array<{
  id: MainSection
  label: string
  description: string
  icon: typeof LayoutDashboard
}> = [
  { id: "dashboard", label: "Dashboard", description: "What needs attention now", icon: LayoutDashboard },
  { id: "opportunities", label: "Opportunities", description: "Review and qualify", icon: SearchCheck },
  { id: "pipeline", label: "Pipeline", description: "Track active work", icon: Layers3 },
  { id: "system", label: "System", description: "Automation and scoring", icon: Settings2 },
]

interface AppShellProps {
  children: ReactNode
  section: MainSection
  onSectionChange: (section: MainSection) => void
  onScan: () => void
  scanning: boolean
  searchValue: string
  onSearchChange: (value: string) => void
  theme: AppTheme
  onToggleTheme: () => void
  lastScanAt: string | null
  userEmail: string
  onLogout: () => Promise<void>
}

export function AppShell({
  children,
  section,
  onSectionChange,
  onScan,
  scanning,
  searchValue,
  onSearchChange,
  theme,
  onToggleTheme,
  lastScanAt,
  userEmail,
  onLogout,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(184,138,82,0.18),transparent_38%),radial-gradient(circle_at_80%_10%,rgba(52,47,43,0.08),transparent_28%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(184,138,82,0.16),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(255,252,247,0.04),transparent_22%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-[1720px]">
        <aside className="hidden w-[286px] shrink-0 flex-col border-r border-navy-200/70 bg-cream-50/70 px-6 py-6 backdrop-blur-xl lg:flex dark:border-dark-border/70 dark:bg-dark-card/70">
          <div className="rounded-[30px] border border-orange-100 bg-white/70 p-5 shadow-sm dark:border-orange-900/20 dark:bg-dark-bg/30">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(184,138,82,0.35)]">
                MG
              </div>
              <div>
                <div className="text-sm font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">MetroGlass Leads</div>
                <div className="text-xs uppercase tracking-[0.18em] text-navy-400 dark:text-dark-muted">
                  Internal operator tool
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-navy-500 dark:text-dark-muted">
              Scan, qualify, enrich, and move real glazing opportunities into outreach without losing the thread.
            </p>
          </div>

          <nav className="mt-8 space-y-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = section === item.id

              return (
                <button
                  key={item.id}
                  className={cn(
                    "w-full rounded-[24px] border px-4 py-3 text-left transition-all duration-200",
                    isActive
                      ? "border-orange-200 bg-orange-50 shadow-sm dark:border-orange-800/50 dark:bg-orange-900/20"
                      : "border-transparent bg-transparent hover:border-navy-200 hover:bg-white/60 dark:hover:border-dark-border/80 dark:hover:bg-dark-card/80",
                  )}
                  onClick={() => onSectionChange(item.id)}
                  type="button"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "rounded-2xl p-2",
                        isActive
                          ? "bg-orange-500 text-white"
                          : "bg-cream-100 text-navy-600 dark:bg-dark-border/60 dark:text-dark-text",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-navy-800 dark:text-dark-text">{item.label}</div>
                      <div className="text-xs text-navy-500 dark:text-dark-muted">{item.description}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </nav>

          <div className="mt-auto rounded-[28px] border border-navy-200/70 bg-white/60 p-5 dark:border-dark-border/70 dark:bg-dark-card/70">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-600 dark:text-orange-300">
              Signed in
            </div>
            <p className="mt-3 break-all text-sm leading-6 text-navy-500 dark:text-dark-muted">{userEmail}</p>
            <div className="mt-4 flex gap-2">
              <Button className="h-10 flex-1 rounded-full" onClick={onToggleTheme} type="button" variant="outline">
                {theme === "dark" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
                Theme
              </Button>
              <Button className="h-10 rounded-full px-4" onClick={() => void onLogout()} type="button" variant="outline">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
          <header className="sticky top-0 z-30 border-b border-navy-200/70 bg-cream-50/85 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8 dark:border-dark-border/70 dark:bg-dark-bg/85">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-xs font-semibold text-white shadow-[0_14px_30px_rgba(184,138,82,0.3)] lg:hidden">
                    MG
                  </div>
                  <div className="min-w-0 lg:hidden">
                    <div className="truncate text-sm font-semibold tracking-[-0.03em] text-navy-900 dark:text-dark-text">
                      MetroGlass Leads
                    </div>
                    <div className="text-[11px] text-navy-500 dark:text-dark-muted">
                      {lastScanAt ? `Last scan ${formatDate(lastScanAt)}` : "No scan yet"}
                    </div>
                  </div>
                  <div className="hidden items-center gap-3 lg:flex">
                    <Badge className="rounded-full border-orange-200 bg-orange-50 px-3 py-1 text-[11px] font-semibold text-orange-700 dark:border-orange-800/50 dark:bg-orange-900/20 dark:text-orange-200">
                      MetroGlassPro
                    </Badge>
                    <span className="text-xs text-navy-500 dark:text-dark-muted">
                      {lastScanAt ? `Last scan ${formatDate(lastScanAt)}` : "No scan yet"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3">
                  <Button
                    className="h-10 rounded-full bg-orange-500 px-4 text-white shadow-[0_16px_30px_rgba(184,138,82,0.3)] hover:bg-orange-600 sm:px-5"
                    disabled={scanning}
                    onClick={onScan}
                  >
                    {scanning ? "Scanning..." : "Scan"}
                  </Button>
                  <Button
                    className="h-10 rounded-full border-navy-200 bg-white/90 px-3 hover:bg-cream-100 dark:border-dark-border dark:bg-dark-card"
                    onClick={onToggleTheme}
                    type="button"
                    variant="outline"
                  >
                    {theme === "dark" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
                  </Button>
                  <Button
                    className="hidden h-10 rounded-full border-navy-200 bg-white/90 px-3 hover:bg-cream-100 dark:border-dark-border dark:bg-dark-card lg:inline-flex"
                    onClick={() => void onLogout()}
                    type="button"
                    variant="outline"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {section === "opportunities" ? (
                <div className="relative">
                  <Input
                    className="h-11 rounded-full border-navy-200 bg-white/90 pl-4 text-sm shadow-sm dark:border-dark-border dark:bg-dark-card"
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder="Search address, GC, owner, notes..."
                    value={searchValue}
                  />
                </div>
              ) : null}
            </div>
          </header>

          <main className="flex-1 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">{children}</main>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-navy-200/80 bg-white/94 px-3 py-2 backdrop-blur-xl lg:hidden dark:border-dark-border/80 dark:bg-dark-card/94">
        <div className="grid grid-cols-4 gap-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = section === item.id

            return (
              <button
                key={item.id}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-[18px] px-3 py-2 text-[11px] font-medium transition-colors",
                  isActive
                    ? "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-200"
                    : "text-navy-500 dark:text-dark-muted",
                )}
                onClick={() => onSectionChange(item.id)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
