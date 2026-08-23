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
})
