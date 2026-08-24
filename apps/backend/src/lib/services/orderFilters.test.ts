import { describe, it, expect } from 'vitest'
import { parseOrderFilters } from './orderFilters'
import { ORDERS_MAX_LIMIT } from './orders'

const parse = (query: string) => parseOrderFilters(new URLSearchParams(query))

describe('parseOrderFilters', () => {
  it('reads the filters the pages send', () => {
    const result = parse('status=pending&projectId=4&limit=10&offset=20')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ status: 'pending', projectId: 4, limit: 10, offset: 20 })
    }
  })

  it('returns no filters for an empty query', () => {
    const result = parse('')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual({})
  })

  it('rejects a status outside the vocabulary rather than ignoring it', () => {
    // A quietly ignored `status=pendign` returns every order and reads as "these
    // are all pending" — a far more misleading answer than an error.
    const result = parse('status=pendign')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('treats status=all as no status filter', () => {
    const result = parse('status=all')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBeUndefined()
  })

  it('accepts every status an order can actually hold', () => {
    for (const status of ['pending', 'provisioning', 'completed', 'failed', 'rejected']) {
      const result = parse(`status=${status}`)
      expect(result.ok, status).toBe(true)
      if (result.ok) expect(result.data.status).toBe(status)
    }
  })

  it('rejects a malformed projectId rather than dropping it', () => {
    for (const query of ['projectId=abc', 'projectId=0', 'projectId=-1', 'projectId=1.5']) {
      const result = parse(query)
      expect(result.ok, query).toBe(false)
      if (!result.ok) expect(result.status).toBe(400)
    }
  })

  it('rejects a limit or offset that cannot mean anything', () => {
    for (const query of ['limit=0', 'limit=-5', 'limit=ten', 'offset=-1', 'offset=x']) {
      const result = parse(query)
      expect(result.ok, query).toBe(false)
    }
  })

  it('caps an oversized limit instead of refusing it', () => {
    const result = parse('limit=100000')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.limit).toBe(ORDERS_MAX_LIMIT)
  })
})
