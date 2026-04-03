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

export function parseCsvText(text: string): Array<Record<string, string>> {
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
