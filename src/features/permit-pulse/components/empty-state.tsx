import type { LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[280px] flex-col items-center justify-center rounded-[28px] border border-dashed border-navy-200/80 bg-cream-100/60 px-6 py-10 text-center dark:border-dark-border/80 dark:bg-dark-card/60",
        className,
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-200">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-[-0.02em] text-navy-800 dark:text-dark-text">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-navy-500 dark:text-dark-muted">{description}</p>
      {actionLabel && onAction ? (
        <Button className="mt-6 rounded-full bg-orange-500 text-white hover:bg-orange-600" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
