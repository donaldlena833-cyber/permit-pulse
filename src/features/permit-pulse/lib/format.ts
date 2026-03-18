import type {
  LeadStatus,
  PermitLead,
  PermitRecord,
} from "@/types/permit-pulse"

export const BOROUGH_OPTIONS = [
  "MANHATTAN",
  "BROOKLYN",
  "QUEENS",
  "BRONX",
  "STATEN ISLAND",
]

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  researching: "Researching",
  enriched: "Enriched",
  "outreach-ready": "Outreach ready",
  drafted: "Drafted",
  contacted: "Contacted",
  "follow-up-due": "Follow-up due",
  replied: "Replied",
  qualified: "Qualified",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
}

export function formatCurrency(value: number | string | undefined): string {
  const amount = typeof value === "string" ? Number.parseInt(value, 10) : value ?? 0

  if (Number.isNaN(amount)) {
    return "$0"
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

export function formatDate(value?: string): string {
  if (!value) {
    return "—"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "—"
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatRelativeDate(value?: string): string {
  if (!value) {
    return "No date"
  }

  const date = new Date(value)
  const diffInDays = Math.floor((Date.now() - date.getTime()) / 86400000)

  if (Number.isNaN(diffInDays)) {
    return "No date"
  }

  if (diffInDays <= 0) {
    return "Today"
  }

  if (diffInDays === 1) {
    return "Yesterday"
  }

  if (diffInDays < 7) {
    return `${diffInDays}d ago`
  }

  if (diffInDays < 30) {
    return `${Math.floor(diffInDays / 7)}w ago`
  }

  return `${Math.floor(diffInDays / 30)}mo ago`
}

export function getLeadAgeDays(value?: string): number {
  if (!value) {
    return 999
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 999
  }

  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
}

export function getPermitAddress(permit: Pick<PermitRecord, "house_no" | "street_name" | "borough" | "zip_code">): string {
  return [permit.house_no, permit.street_name, permit.borough, permit.zip_code]
    .filter(Boolean)
    .join(", ")
}

export function getApplicantDisplay(permit: PermitRecord): string {
  const business = permit.applicant_business_name?.trim()
  if (business) {
    return business
  }

  const fallback = [
    permit.applicant_first_name,
    permit.applicant_middle_name,
    permit.applicant_last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim()

  return fallback || "—"
}

export function getFilingRepDisplay(permit: PermitRecord): string {
  const business = permit.filing_representative_business_name?.trim()
  if (business) {
    return business
  }

  const fallback = [
    permit.filing_representative_first_name,
    permit.filing_representative_last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim()

  return fallback || "—"
}

export function getStatusLabel(status: LeadStatus): string {
  return STATUS_LABELS[status]
}

export function getSearchableLeadText(lead: PermitLead): string {
  return [
    lead.job_description,
    lead.owner_name,
    lead.owner_business_name,
    lead.applicant_business_name,
    lead.street_name,
    lead.nta,
    lead.enrichment.companyWebsite,
    lead.enrichment.directEmail,
    lead.enrichment.genericEmail,
    lead.enrichment.phone,
    lead.enrichment.contactPersonName,
    lead.enrichment.notes,
    lead.enrichment.researchNotes,
    lead.companyProfile.name,
    lead.companyProfile.domain,
    lead.contacts.map((contact) => [contact.email, contact.phone, contact.name].filter(Boolean).join(" ")).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function toCommaList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}
