import { AlertCircle, ArrowUpRight, Building2, Sparkles, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { STATUS_LABELS } from "@/features/permit-pulse/lib/format"
import type {
  ContactabilityBreakdown,
  LeadStatus,
  LeadTier,
  PriorityLabel,
} from "@/types/permit-pulse"
import { cn } from "@/lib/utils"

function toneClasses(tone: "warm" | "bronze" | "neutral" | "olive" | "danger") {
  if (tone === "warm") {
    return "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-700/60 dark:bg-orange-900/20 dark:text-orange-200"
  }

  if (tone === "bronze") {
    return "border-navy-200 bg-cream-100 text-navy-700 dark:border-dark-border/70 dark:bg-navy-900/30 dark:text-dark-text"
  }

  if (tone === "olive") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200"
  }

  if (tone === "danger") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200"
  }

  return "border-navy-200 bg-cream-50 text-navy-600 dark:border-dark-border/70 dark:bg-dark-card/70 dark:text-dark-muted"
}

export function LeadScoreBadge({ tier, score }: { tier: LeadTier; score: number }) {
  const tone = tier === "hot" ? "warm" : tier === "warm" ? "bronze" : "neutral"
  const icon = tier === "hot" ? Zap : tier === "warm" ? Sparkles : AlertCircle
  const label = tier === "hot" ? "Hot" : tier === "warm" ? "Warm" : "Cold"
  const Icon = icon

  return (
    <Badge className={cn("gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium", toneClasses(tone))}>
      <Icon className="h-3.5 w-3.5" />
      {label} {score}
    </Badge>
  )
}

export function ContactabilityBadge({ contactability }: { contactability: ContactabilityBreakdown }) {
  const tone =
    contactability.label === "Excellent"
      ? "olive"
      : contactability.label === "Good"
        ? "bronze"
        : contactability.label === "Fair"
          ? "neutral"
          : "danger"

  return (
    <Badge className={cn("rounded-full px-3 py-1 text-[11px] font-medium", toneClasses(tone))}>
      Contactability {contactability.label} {contactability.total}
    </Badge>
  )
}

export function PriorityBadge({ label }: { label: PriorityLabel }) {
  const tone =
    label === "Attack Now"
      ? "warm"
      : label === "Research Today"
        ? "bronze"
        : label === "Worth a Try"
          ? "olive"
          : label === "Ignore"
            ? "danger"
            : "neutral"

  return (
    <Badge className={cn("gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium", toneClasses(tone))}>
      <ArrowUpRight className="h-3.5 w-3.5" />
      {label}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  const tone =
    status === "outreach-ready" || status === "qualified" || status === "won"
      ? "olive"
      : status === "contacted" || status === "drafted" || status === "follow-up-due"
        ? "bronze"
        : status === "lost" || status === "archived"
          ? "danger"
          : "neutral"

  return (
    <Badge className={cn("rounded-full px-3 py-1 text-[11px] font-medium", toneClasses(tone))}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

export function BoroughBadge({ borough }: { borough: string }) {
  return (
    <Badge className={cn("gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium", toneClasses("bronze"))}>
      <Building2 className="h-3.5 w-3.5" />
      {borough}
    </Badge>
  )
}
