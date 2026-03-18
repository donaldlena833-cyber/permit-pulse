import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface StatItem {
  id: string
  label: string
  value: string
  helper: string
  tone: "warm" | "bronze" | "olive" | "neutral"
  icon: LucideIcon
}

interface StatsGridProps {
  items: StatItem[]
}

export function StatsGrid({ items }: StatsGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon

        return (
          <div
            key={item.id}
            className={cn(
              "rounded-[28px] border bg-white/75 p-5 shadow-[0_24px_80px_rgba(70,55,37,0.08)] backdrop-blur-xl transition-transform duration-200 hover:-translate-y-1 dark:bg-dark-card/90",
              item.tone === "warm" && "border-orange-200/80 dark:border-orange-800/40",
              item.tone === "bronze" && "border-navy-200/80 dark:border-dark-border/80",
              item.tone === "olive" && "border-emerald-200/80 dark:border-emerald-900/40",
              item.tone === "neutral" && "border-navy-200/80 dark:border-dark-border/80",
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-navy-400 dark:text-dark-muted">
                  {item.label}
                </div>
                <div className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-navy-900 dark:text-dark-text">
                  {item.value}
                </div>
                <p className="mt-2 text-sm leading-6 text-navy-500 dark:text-dark-muted">{item.helper}</p>
              </div>
              <div className="rounded-2xl bg-cream-100 p-3 text-orange-600 dark:bg-orange-900/20 dark:text-orange-200">
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
