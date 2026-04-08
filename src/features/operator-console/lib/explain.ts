import type { LeadEvent, LeadRow } from "@/features/operator-console/types/api"

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

export function describeLeadDecision(lead: LeadRow): string {
  if (lead.status === "new") {
    return "New signal. Automation still needs to resolve the company, contacts, and route."
  }
  if (lead.status === "email_required") {
    return "No approved route is available, so this lead is parked for manual research."
  }
  if (lead.status === "review") {
    return lead.contact_email
      ? "A possible route exists, but the evidence is still short of send-ready."
      : "The system found a promising lead, but it still needs better company or contact evidence."
  }
  if (lead.status === "ready") {
    if (lead.operator_vouched) {
      return "Operator-approved route is ready to send."
    }
    if (lead.active_email_role === "fallback") {
      return "The fallback route is active and cleared the send checks."
    }
    return "The current route cleared readiness checks and can be sent."
  }
  if (lead.status === "sent") {
    return "Initial outreach has already gone out. Watch replies, bounces, and follow-ups."
  }
  if (lead.status === "archived") {
    return "This lead is out of the active queue because it was closed, suppressed, or fully worked."
  }
  return "Review the lead detail to understand the current route and next action."
}

export function summarizeLeadEvent(event: LeadEvent): string | null {
  const detail = event.detail ?? {}
  const email = stringValue(detail.email)
  const nextEmail = stringValue(detail.next_email)
  const manualNote = stringValue(detail.manual_note)
  const notes = stringValue(detail.notes)

  switch (event.event_type) {
    case "operator_email_selected":
      return email ? `Operator selected ${email} as the active route.` : "Operator selected the active route."
    case "operator_manual_email_added":
      return email
        ? `${email} was added manually and stored as the active route.${manualNote ? ` ${manualNote}` : ""}`
        : "A manual email was added as the active route."
    case "fallback_activated":
      return nextEmail ? `Fallback route switched to ${nextEmail}.` : "Fallback route was activated."
    case "email_required":
      return "The lead was moved into manual email research."
    case "bounced":
      return "Delivery failed, and future follow-ups were paused."
    case "replied":
      return "A reply was recorded, and future follow-ups were cancelled."
    case "opted_out":
      return "Contact asked not to be reached again, so follow-ups were cancelled and the lead was archived."
    case "won":
      return notes ? `Lead marked won. ${notes}` : "Lead marked won."
    case "lost":
      return notes ? `Lead marked lost. ${notes}` : "Lead marked lost."
    default:
      return null
  }
}
