import { describe, it, expect } from 'vitest'
import { parseCatalogFilters } from './catalogFilters'
import { CATALOG_MAX_LIMIT } from './catalog'

const parse = (query: string) => parseCatalogFilters(new URLSearchParams(query))

describe('parseCatalogFilters', () => {
  it('reads the filters the catalogue page sends', () => {
    const result = parse('search=nginx&categoryId=4&limit=12&offset=24')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ search: 'nginx', categoryId: 4, limit: 12, offset: 24 })
    }
  })

  it('returns no filters for an empty query', () => {
    const result = parse('')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual({})
  })

  it('trims a search term and treats a blank one as absent', () => {
    const spaces = parse('search=%20%20')
    expect(spaces.ok).toBe(true)
    if (spaces.ok) expect(spaces.data.search).toBeUndefined()

    const padded = parse('search=%20nginx%20')
    expect(padded.ok).toBe(true)
    if (padded.ok) expect(padded.data.search).toBe('nginx')
  })

  it('rejects a malformed categoryId rather than dropping it', () => {
    // Silently ignoring it returns the whole catalogue, which reads as "your
    // filter matched everything" — a worse answer than an error.
    for (const query of ['categoryId=abc', 'categoryId=0', 'categoryId=-1', 'categoryId=1.5']) {
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
    // Asking for more than a page is reasonable; the ceiling is our limit, not
    // the caller's mistake.
    const result = parse('limit=100000')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.limit).toBe(CATALOG_MAX_LIMIT)
  })

  it('accepts an offset of zero', () => {
    const result = parse('offset=0')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.offset).toBe(0)
  })
})
