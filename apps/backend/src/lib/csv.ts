/**
 * CSV serialisation shared by the audit and infrastructure exports.
 *
 * Extracted so the neutralisation rules below have one implementation: they were
 * arrived at by fixing a formula-injection hole in the audit export, and a second
 * copy would eventually drift out of sync with them.
 */

/**
 * Escape one cell.
 *
 * Neutralises spreadsheet formula injection: a cell starting with = + - @ (or a
 * tab/CR) is evaluated as a formula by Excel/Sheets. Exported fields carry
 * user-supplied names and parameter values, so such a cell is prefixed with a
 * quote.
 */
export const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  let str = String(value)
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`
  // Quote on CR as well as LF/comma/quote — a bare \r can otherwise start a new
  // CSV record whose first cell looks like a formula.
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/** Serialise a header row plus body rows into a CSV document. */
export const toCsv = (header: string[], rows: unknown[][]): string =>
  [header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n')
