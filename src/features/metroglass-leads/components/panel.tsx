import type { ReactNode } from "react"

interface PanelProps {
  children: ReactNode
  className?: string
}

export function Panel({ children, className = "" }: PanelProps) {
  return (
    <section className={`rounded-[16px] border border-[#E5D7C8] bg-white/96 p-4 shadow-[0_16px_36px_rgba(26,26,26,0.08)] ${className}`}>
      {children}
    </section>
  )
}
