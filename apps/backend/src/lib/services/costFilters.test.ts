import { describe, it, expect } from 'vitest'
import { parseCostFilters } from './costFilters'

const parse = (qs: string, now?: Date) => parseCostFilters(new URLSearchParams(qs), now)
const NOW = new Date('2026-08-18T12:00:00.000Z')

describe('parseCostFilters', () => {
  it('returns an empty filter set for an empty query', () => {
    const result = parse('')
    expect(result.ok && result.data).toEqual({})
  })

  it('parses a project filter', () => {
    const result = parse('projectId=7')
    expect(result.ok && result.data.projectId).toBe(7)
  })

  it.each(['projectId=0', 'projectId=-1', 'projectId=abc'])('rejects a bad projectId (%s)', (qs) => {
    const result = parse(qs)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('ignores a blank projectId rather than rejecting it', () => {
    // An unset <select> submits an empty value.
    expect(parse('projectId=').ok).toBe(true)
  })

  it('resolves currentMonth to the first of this month', () => {
    const result = parse('range=currentMonth', NOW)
    expect(result.ok && result.data.from?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    // No upper bound: "this month" runs to now, and pinning it would exclude an
    // order placed while the page was open.
    expect(result.ok && result.data.to).toBeUndefined()
  })

  it('resolves last3Months inclusively of the current one', () => {
    const result = parse('range=last3Months', NOW)
    expect(result.ok && result.data.from?.toISOString()).toBe('2026-06-01T00:00:00.000Z')
  })

  it('resolves last12Months across a year boundary', () => {
    const result = parse('range=last12Months', NOW)
    expect(result.ok && result.data.from?.toISOString()).toBe('2025-09-01T00:00:00.000Z')
  })

  it('resolves all to no lower bound at all', () => {
    // Rather than an arbitrary epoch, which would quietly become a real filter.
    const result = parse('range=all', NOW)
    expect(result.ok && result.data.from).toBeUndefined()
  })

  it('rejects an unknown range instead of silently showing everything', () => {
    const result = parse('range=lastWeek', NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/invalid range/i)
  })

  it('lets a preset override explicit dates', () => {
    // The preset is what the user picked; honouring both would be ambiguous.
    const result = parse('range=currentMonth&from=2020-01-01&to=2020-12-31', NOW)
    expect(result.ok && result.data.from?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(result.ok && result.data.to).toBeUndefined()
  })

  it('honours explicit dates when range is custom', () => {
    const result = parse('range=custom&from=2026-03-01&to=2026-03-31')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.from?.toISOString()).toBe('2026-03-01T00:00:00.000Z')
    // Widened to the end of the day, so a single-day range returns that day.
    expect(result.data.to?.toISOString()).toBe('2026-03-31T23:59:59.999Z')
  })

  it('accepts a full timestamp unchanged', () => {
    const result = parse('from=2026-03-01T09:30:00.000Z')
    expect(result.ok && result.data.from?.toISOString()).toBe('2026-03-01T09:30:00.000Z')
  })

  it.each(['from=nonsense', 'to=2026-13-45'])('rejects an unparseable date (%s)', (qs) => {
    expect(parse(qs).ok).toBe(false)
  })

  it('rejects an inverted range', () => {
    const result = parse('from=2026-06-01&to=2026-01-01')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/must not be after/i)
  })

  it('accepts a single-day range', () => {
    expect(parse('from=2026-03-01&to=2026-03-01').ok).toBe(true)
  })
})
