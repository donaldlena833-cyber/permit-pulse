function finalizeRow(rows: string[][], row: string[]) {
  if (row.length === 0) {
    return
  }

  if (row.every((value) => value.trim() === "")) {
    return
  }

  rows.push(row)
}

function splitLine(line: string, delimiter: string) {
  const values: string[] = []
  let current = ""
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
      values.push(current)
      current = ""
      continue
    }

    current += char
  }

  values.push(current)
  return values
}

function detectDelimiter(text: string) {
  const candidates = [",", ";", "\t"]
  const sample = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5)

  let bestDelimiter = ","
  let bestScore = -1

  for (const delimiter of candidates) {
    const widths = sample
      .map((line) => splitLine(line, delimiter).length)
      .filter((width) => width > 1)

    if (!widths.length) {
      continue
    }

    const baseline = widths[0]
    const consistency = widths.filter((width) => width === baseline).length
    const score = baseline * 10 + consistency

    if (score > bestScore) {
      bestScore = score
      bestDelimiter = delimiter
    }
  }

  return bestDelimiter
}

function parseRows(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let current = ""
  let inQuotes = false
  const delimiter = detectDelimiter(text)

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
      row.push(current)
      current = ""
      continue
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1
      }
      row.push(current)
      current = ""
      finalizeRow(rows, row)
      row = []
      continue
    }

    current += char
  }

  row.push(current)
  finalizeRow(rows, row)

  return { rows, delimiter }
}

function slugHeader(value: string) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function compactText(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function extractPrimaryEmail(value: string) {
  const text = compactText(value)
  if (!text) {
    return null
  }

  const matches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)
  return matches?.[0]?.toLowerCase() ?? null
}

const EMAIL_ALIASES = [
  "email",
  "email_address",
  "email_addresses",
  "e_mail",
  "email_cc_list",
  "email_and_cc_list",
  "emails",
]

function extractRowEmail(row: Record<string, string>) {
  for (const alias of EMAIL_ALIASES) {
    const value = row[alias]
    const email = extractPrimaryEmail(value || "")
    if (email) {
      return email
    }
  }
  return null
}

export function parseCsvText(text: string): Array<Record<string, string>> {
  const { rows } = parseRows(text)

  if (rows.length === 0) {
    return []
  }

  const [headerRow, ...dataRows] = rows
  const headers = headerRow.map((value) => value.replace(/^\uFEFF/, "").trim())

  return dataRows
    .map((values) =>
      Object.fromEntries(
        headers.map((header, headerIndex) => [header || `column_${headerIndex + 1}`, (values[headerIndex] || "").trim()]),
      ),
    )
    .filter((entry) => Object.values(entry).some((value) => value !== ""))
}

export function analyzeCsvText(text: string) {
  const { rows, delimiter } = parseRows(text)

  if (rows.length === 0) {
    return {
      delimiter,
      headers: [],
      totalRows: 0,
      importableRows: 0,
      missingEmailRows: 0,
      duplicateEmailRows: 0,
      sampleRows: [] as Array<Record<string, string>>,
    }
  }

  const [headerRow, ...dataRows] = rows
  const headers = headerRow.map((value) => value.replace(/^\uFEFF/, "").trim())
  const normalizedRows = dataRows
    .map((values) =>
      Object.fromEntries(
        headers.map((header, headerIndex) => [slugHeader(header || `column_${headerIndex + 1}`), (values[headerIndex] || "").trim()]),
      ),
    )
    .filter((entry) => Object.values(entry).some((value) => value !== ""))

  const seenEmails = new Set<string>()
  let importableRows = 0
  let missingEmailRows = 0
  let duplicateEmailRows = 0

  for (const row of normalizedRows) {
    const email = extractRowEmail(row)
    if (!email) {
      missingEmailRows += 1
      continue
    }
    if (seenEmails.has(email)) {
      duplicateEmailRows += 1
      continue
    }
    seenEmails.add(email)
    importableRows += 1
  }

  return {
    delimiter,
    headers,
    totalRows: normalizedRows.length,
    importableRows,
    missingEmailRows,
    duplicateEmailRows,
    sampleRows: normalizedRows.slice(0, 3),
  }
}
