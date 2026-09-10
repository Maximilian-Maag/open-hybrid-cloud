import { describe, it, expect } from 'vitest'
import { parseOrderFilters, ORDER_STATUS_FILTERS } from './orderFilters'

const parse = (qs: string) => parseOrderFilters(new URLSearchParams(qs))

describe('parseOrderFilters', () => {
  it('returns an empty filter set for an empty query', () => {
    const result = parse('')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual({})
  })

  /*
   * The reason this parser exists. `/projects/7` fetched
   * `/api/orders?projectId=7` and the route read no query string at all, so the
   * card headed "Orders in this project" listed every order the viewer could
   * see — for an administrator, the whole installation, each row linking off
   * into somebody else's project (#158).
   */
  it('reads the projectId that was already being sent and ignored', () => {
    const result = parse('projectId=7')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.projectId).toBe(7)
  })

  it.each(['projectId=0', 'projectId=-1', 'projectId=abc', 'projectId=1.5'])(
    'rejects a projectId that is not a positive whole number (%s)',
    (qs) => {
      const result = parse(qs)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(400)
    },
  )

  it.each(ORDER_STATUS_FILTERS)('accepts the real status %s', (status) => {
    const result = parse(`status=${status}`)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBe(status)
  })

  /*
   * Rejected, not dropped: `status=complete` silently ignored comes back as the
   * full list, which reads as "the filter matched everything" rather than "that
   * is not a status".
   */
  it('rejects a status that does not exist, and names the ones that do', () => {
    const result = parse('status=complete')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toContain('completed')
    }
  })

  it('treats status=all as no filter, so an unfiltered dropdown needs no special case', () => {
    const result = parse('status=all')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBeUndefined()
  })

  it('reads the page window', () => {
    const result = parse('limit=25&offset=50')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toMatchObject({ limit: 25, offset: 50 })
  })

  it('rejects a malformed window', () => {
    const result = parse('limit=fifty')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('combines the filters rather than letting the last one win', () => {
    const result = parse('projectId=3&status=pending&limit=10&offset=20')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ projectId: 3, status: 'pending', limit: 10, offset: 20 })
    }
  })
})
