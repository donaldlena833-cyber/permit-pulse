import type { ReactNode } from "react"

interface PanelProps {
  children: ReactNode
  className?: string
}

export function Panel({ children, className = "" }: PanelProps) {
  return (
    <section className={`rounded-[24px] border border-[#E5D7C8] bg-[rgba(255,255,255,0.94)] p-5 shadow-[0_22px_46px_rgba(26,26,26,0.08)] backdrop-blur-sm ${className}`}>
      {children}
    </section>
  )
}
