import { describe, it, expect } from 'vitest'
import { parseAuditFilters, AUDIT_MAX_PAGE_SIZE, AUDIT_DEFAULT_PAGE_SIZE } from './auditFilters'

const parse = (query: string) => parseAuditFilters(new URLSearchParams(query))

describe('parseAuditFilters', () => {
  it('defaults to the first page at the UI page size', () => {
    const result = parse('')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.page).toBe(1)
      expect(result.data.pageSize).toBe(AUDIT_DEFAULT_PAGE_SIZE)
      expect(result.data.filters).toEqual({})
    }
  })

  // Each of these used to reach SQL: OFFSET -50, LIMIT NaN, LIMIT -5 (issue #143).
  it.each([
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=abc', 'page'],
    ['page=1.5', 'page'],
    ['pageSize=abc', 'pageSize'],
    ['pageSize=-5', 'pageSize'],
    ['pageSize=0', 'pageSize'],
  ])('rejects %s with a 400', (query, field) => {
    const result = parse(query)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toContain(field)
    }
  })

  it('caps pageSize rather than rejecting an over-large one', () => {
    const result = parse('pageSize=100000')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.pageSize).toBe(AUDIT_MAX_PAGE_SIZE)
  })

  // The worst of the bunch: NaN is falsy where the filter is applied, so the
  // filter was silently dropped and the WHOLE log came back.
  it('rejects a non-numeric userId instead of dropping the filter', () => {
    const result = parse('userId=abc')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toBe('Invalid userId')
    }
  })

  it('rejects a non-positive userId', () => {
    for (const query of ['userId=0', 'userId=-3']) {
      const result = parse(query)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(400)
    }
  })

  it('keeps a valid userId', () => {
    const result = parse('userId=42')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.filters.userId).toBe(42)
  })

  it('treats an empty parameter as absent', () => {
    const result = parse('userId=&page=&pageSize=&action=&from=&to=')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.filters).toEqual({})
      expect(result.data.page).toBe(1)
    }
  })

  it('trims the action filter', () => {
    const result = parse('action=%20order.created%20')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.filters.action).toBe('order.created')
  })

  it('accepts date-only and full ISO bounds', () => {
    const result = parse('from=2026-01-01&to=2026-12-31T12:00:00.000Z')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.filters.from).toBe('2026-01-01')
      expect(result.data.filters.to).toBe('2026-12-31T12:00:00.000Z')
    }
  })

  it.each(['from=not-a-date', 'to=not-a-date'])('rejects %s with a 400', (query) => {
    const result = parse(query)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejects an inverted range', () => {
    const result = parse('from=2026-06-01&to=2026-01-01')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('from must not be after to')
  })

  it('accepts a single-day range, which the widening makes non-empty', () => {
    const result = parse('from=2026-03-04&to=2026-03-04')
    expect(result.ok).toBe(true)
  })

  /*
   * The seven spellings `Number()` used to read as a perfectly good integer, under a
   * docstring that says this parser rejects malformed input rather than coercing it.
   * Every one of them named a different user than the caller typed. `Infinity` and
   * `1_000` were already rejected and are pinned here so the digits-first rule is
   * not loosened later into accepting them.
   */
  it.each([
    ['userId=1e3', 'an exponent — Number() reads it as 1000'],
    ['userId=0x10', 'a hex literal — Number() reads it as 16'],
    ['userId=0b11', 'a binary literal — Number() reads it as 3'],
    ['userId=0o17', 'an octal literal — Number() reads it as 15'],
    ['userId=%207%20', 'whitespace padding, which Number() trims away'],
    ['userId=%2B7', 'a leading plus'],
    ['userId=7.0', 'a trailing zero, which Number.isInteger accepted'],
    ['userId=Infinity', 'a word Number() has a value for'],
    ['userId=1_000', 'a numeric separator'],
  ])('rejects %s (%s)', (query) => {
    const result = parse(query)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toBe('Invalid userId')
    }
  })

  it.each([
    'page=1e3',
    'page=0x10',
    'page=%202%20',
    'page=%2B2',
    'page=2.0',
    'pageSize=1e2',
    'pageSize=0x10',
    'pageSize=%2010%20',
    'pageSize=10.0',
  ])('rejects %s rather than coercing it', (query) => {
    const result = parse(query)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  /*
   * All decimal digits, so the shape is right, but 9007199254740993 is not
   * representable: Number() hands back 9007199254740992. Answering about a
   * neighbouring user or page instead of the one asked for is the whole reason
   * Number.isSafeInteger and not Number.isInteger.
   */
  it.each([
    ['userId=9007199254740993', 'userId'],
    ['page=9007199254740993', 'page'],
    ['pageSize=9007199254740993', 'pageSize'],
  ])('rejects %s, which Number() would round to a different value', (query) => {
    expect(Number('9007199254740993')).toBe(9_007_199_254_740_992)

    const result = parse(query)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('still accepts the largest safe integer, which loses nothing', () => {
    const result = parse(`userId=${Number.MAX_SAFE_INTEGER}`)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.filters.userId).toBe(Number.MAX_SAFE_INTEGER)
  })
})
