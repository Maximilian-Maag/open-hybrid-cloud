import { describe, it, expect } from 'vitest'
import { csvCell, toCsv } from './csv'

/**
 * The rules here were arrived at by fixing a formula-injection hole in the
 * audit export, so each case below is written against the way a cell gets out
 * of the file and into a spreadsheet's evaluator.
 */
describe('csvCell — formula injection', () => {
  // Excel and Sheets evaluate a cell that begins with any of these. The export
  // carries user-supplied names and parameter values, so the content is theirs.
  it.each(['=', '+', '-', '@', '\t'])('neutralises a cell starting with %j', (lead) => {
    expect(csvCell(`${lead}cmd|' /c calc'!A0`).startsWith("'")).toBe(true)
  })

  /*
   * `\r` gets the same prefix but is ALSO quoted, because a bare carriage
   * return can start a new record — so the neutralising quote ends up inside
   * the field rather than at the start of it. Asserted exactly, because
   * `startsWith("'")` would fail here and reads like a missing rule.
   */
  it('neutralises a cell starting with a carriage return, inside the quoting', () => {
    expect(csvCell('\r=cmd')).toBe('"\'\r=cmd"')
  })

  it('leaves an ordinary value unprefixed', () => {
    // Over-quoting every cell would corrupt every importer's first column.
    expect(csvCell('Managed Postgres')).toBe('Managed Postgres')
  })

  it('only looks at the FIRST character', () => {
    // `a=b` is not a formula; prefixing it would rewrite real data.
    expect(csvCell('a=b')).toBe('a=b')
  })
})

describe('csvCell — quoting', () => {
  it('quotes a cell containing a comma, so it stays one field', () => {
    expect(csvCell('Berlin, Germany')).toBe('"Berlin, Germany"')
  })

  it('doubles an embedded quote rather than ending the field', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes on a newline, so one cell cannot become two records', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it('quotes on a bare carriage return too', () => {
    // A lone \r can start a new CSV record, whose first cell would then be
    // unchecked by the formula rule above.
    expect(csvCell('a\rb').startsWith('"')).toBe(true)
  })

  it('needs no quotes when there is nothing to escape', () => {
    expect(csvCell('plain')).toBe('plain')
  })
})

describe('csvCell — absent values', () => {
  it('writes an empty field for null and undefined', () => {
    // Not the strings "null"/"undefined", which is what `String(value)` alone
    // would put in front of a reader.
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('keeps a zero, which is a value and not an absence', () => {
    expect(csvCell(0)).toBe('0')
  })

  it('keeps false for the same reason', () => {
    expect(csvCell(false)).toBe('false')
  })
})

describe('toCsv', () => {
  it('puts the header first and one record per row', () => {
    expect(toCsv(['a', 'b'], [[1, 2], [3, 4]])).toBe('a,b\n1,2\n3,4')
  })

  it('escapes the header as well as the body', () => {
    // A column name is as user-supplied as a value when it comes from a
    // parameter or a cost centre.
    expect(toCsv(['=cmd'], [])).toBe("'=cmd")
  })

  it('writes a header-only document when there are no rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b')
  })
})
