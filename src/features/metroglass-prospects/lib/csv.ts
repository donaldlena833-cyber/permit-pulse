function finalizeRow(rows: string[][], row: string[]) {
  if (row.length === 0) {
    return
  }

  if (row.every((value) => value.trim() === "")) {
    return
  }

  rows.push(row)
}

export function parseCsvText(text: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let row: string[] = []
  let current = ""
  let inQuotes = false

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

    if (!inQuotes && char === ",") {
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
