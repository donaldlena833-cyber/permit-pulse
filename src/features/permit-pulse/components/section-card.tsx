import type { ReactNode } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface SectionCardProps {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card
      className={cn(
        "rounded-[28px] border border-navy-200/70 bg-white/75 shadow-[0_24px_80px_rgba(70,55,37,0.08)] backdrop-blur-xl dark:border-dark-border/70 dark:bg-dark-card/90",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
        <div className="space-y-1">
          <CardTitle className="text-lg tracking-[-0.02em] text-navy-800 dark:text-dark-text">{title}</CardTitle>
          {description ? (
            <CardDescription className="text-sm leading-6 text-navy-500 dark:text-dark-muted">
              {description}
            </CardDescription>
          ) : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className={cn("space-y-4", contentClassName)}>{children}</CardContent>
    </Card>
  )
}
