import type { ReactNode } from "react"

interface PanelProps {
  children: ReactNode
  className?: string
}

export function Panel({ children, className = "" }: PanelProps) {
  return (
    <section className={`rounded-[22px] border border-steel-200 bg-white/92 p-5 shadow-soft backdrop-blur-sm ${className}`}>
      {children}
    </section>
  )
}
