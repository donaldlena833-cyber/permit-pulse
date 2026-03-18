import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface PageHeaderProps {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
  className?: string
}

export function PageHeader({ eyebrow, title, description, action, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-600 dark:text-orange-300">
          {eyebrow}
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-navy-900 dark:text-dark-text sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-navy-500 dark:text-dark-muted sm:text-base">{description}</p>
      </div>
      {action}
    </div>
  )
}
