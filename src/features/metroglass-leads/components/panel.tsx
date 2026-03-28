import type { ReactNode } from "react"

interface PanelProps {
  children: ReactNode
  className?: string
}

export function Panel({ children, className = "" }: PanelProps) {
  return (
    <section className={`rounded-[26px] border border-[#E7DACC] bg-[rgba(255,252,247,0.88)] p-5 shadow-[0_18px_36px_rgba(26,26,26,0.06)] backdrop-blur-md ${className}`}>
      {children}
    </section>
  )
}
