// CSV export helpers. Cells are escaped per RFC 4180: quotes doubled, fields
// containing commas/quotes/newlines wrapped in quotes. A UTF-8 BOM keeps Excel
// happy with the en-IN text.

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined }

function escapeCell(input: string | number | null | undefined): string {
  const text = input === null || input === undefined ? '' : String(input)
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map(column => escapeCell(column.header)).join(',')]
  for (const row of rows) lines.push(columns.map(column => escapeCell(column.value(row))).join(','))
  return `\uFEFF${lines.join('\r\n')}`
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
