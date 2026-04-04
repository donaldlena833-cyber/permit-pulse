export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "Never"
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return "Unknown"
  const diffMs = Date.now() - timestamp
  const diffMinutes = Math.floor(diffMs / 60000)
  if (diffMinutes < 1) return "Just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Unknown"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Unknown"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

export function formatScore(value: number | null | undefined): string {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "0.00"
}

export function formatLeadStatus(value: string | null | undefined): string {
  if (!value) return "Unknown"
  if (value === "email_required") return "Email Required"
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatProspectCategory(value: string | null | undefined): string {
  if (!value) return "Prospect"
  if (value === "gc") return "GC"
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatProspectStatus(value: string | null | undefined): string {
  if (!value) return "Unknown"
  if (value === "opted_out") return "Opted out"
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatProspectQueueState(value: string | null | undefined): string {
  if (!value) return "Queued"
  if (value === "queued_initial") return "Queued for Initial"
  if (value === "queued_follow_up") return "Queued for Follow-up"
  if (value === "follow_up_sent") return "Follow-up Sent"
  if (value === "pending_review") return "Reply Review"
  if (value === "opted_out") return "Opted out"
  if (value === "suppressed") return "Suppressed"
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}
