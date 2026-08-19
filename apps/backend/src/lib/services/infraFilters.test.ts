import { describe, it, expect } from 'vitest'
import { parseInfraFilters } from './infraFilters'

const parse = (qs: string) => parseInfraFilters(new URLSearchParams(qs))

describe('parseInfraFilters', () => {
  it('returns an empty filter set for an empty query', () => {
    const result = parse('')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual({})
  })

  it('parses the id filters', () => {
    const result = parse('productId=3&projectId=4&environmentId=5')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toMatchObject({ productId: 3, projectId: 4, environmentId: 5 })
  })

  it.each(['productId=0', 'productId=-1', 'productId=abc', 'productId=1.5'])(
    'rejects a non-positive-integer id (%s)',
    (qs) => {
      const result = parse(qs)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(400)
    },
  )

  it('ignores blank id parameters rather than rejecting them', () => {
    // An unset <select> submits an empty value; that means "no filter", not
    // "malformed request".
    const result = parse('productId=&projectId=')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual({})
  })

  it('trims the search term and drops it when only whitespace', () => {
    const trimmed = parse('search=%20%20web%20%20')
    expect(trimmed.ok && trimmed.data.search).toBe('web')

    const blank = parse('search=%20%20')
    expect(blank.ok && blank.data.search).toBeUndefined()
  })

  it('accepts each real status and treats "all" as no filter', () => {
    for (const status of ['active', 'decommissioning', 'decommissioned']) {
      const result = parse(`status=${status}`)
      expect(result.ok && result.data.status).toBe(status)
    }
    const all = parse('status=all')
    expect(all.ok && all.data.status).toBeUndefined()
  })

  it("accepts 'failed', which is an order state rather than an element status", () => {
    // The list shows a Failed badge for an 'active' element whose order failed;
    // rejecting the value here would leave that badge unfilterable.
    const result = parse('status=failed')
    expect(result.ok && result.data.status).toBe('failed')
  })

  it('rejects an unknown status instead of silently ignoring it', () => {
    // Dropping it would render an unfiltered list as though the filter applied.
    const result = parse('status=activ')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toMatch(/invalid status/i)
    }
  })

  it('widens a date-only range to cover both whole days', () => {
    const result = parse('deployedFrom=2026-03-01&deployedTo=2026-03-31')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.deployedFrom?.toISOString()).toBe('2026-03-01T00:00:00.000Z')
    // Inclusive through the end of the named day — otherwise a single-day range
    // would match only rows deployed exactly at midnight.
    expect(result.data.deployedTo?.toISOString()).toBe('2026-03-31T23:59:59.999Z')
  })

  it('accepts a full timestamp unchanged', () => {
    const result = parse('deployedFrom=2026-03-01T09:30:00.000Z')
    expect(result.ok && result.data.deployedFrom?.toISOString()).toBe('2026-03-01T09:30:00.000Z')
  })

  it.each(['deployedFrom=not-a-date', 'deployedTo=2026-13-45'])('rejects an unparseable date (%s)', (qs) => {
    const result = parse(qs)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejects an inverted date range', () => {
    const result = parse('deployedFrom=2026-03-31&deployedTo=2026-03-01')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/must not be after/i)
  })

  it('accepts a single-day range where from and to name the same day', () => {
    const result = parse('deployedFrom=2026-03-01&deployedTo=2026-03-01')
    expect(result.ok).toBe(true)
  })

  it('parses sort and direction, and rejects anything off the whitelist', () => {
    const valid = parse('sort=name&direction=asc')
    expect(valid.ok && valid.data).toMatchObject({ sort: 'name', direction: 'asc' })

    for (const qs of ['sort=deployed_at', 'sort=id; DROP TABLE users', 'direction=sideways']) {
      const result = parse(qs)
      expect(result.ok, qs).toBe(false)
    }
  })
})
