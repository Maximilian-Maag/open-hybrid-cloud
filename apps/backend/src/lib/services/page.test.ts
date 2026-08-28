import { describe, it, expect } from 'vitest'
import {
  pageWindow,
  parsePageWindow,
  toPage,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  EXPORT_MAX_ROWS,
} from './page'

describe('pageWindow', () => {
  it('falls back to the default page size when the caller asks for none', () => {
    expect(pageWindow()).toEqual({ limit: LIST_DEFAULT_LIMIT, offset: 0 })
  })

  it('honours a window the caller does ask for', () => {
    expect(pageWindow(10, 30)).toEqual({ limit: 10, offset: 30 })
  })

  /*
   * The ceiling is the entire point of #158: the lists were not slow because
   * somebody asked for too much, they were slow because nothing could ask for
   * less than everything. A limit a client can raise without bound puts that
   * straight back.
   */
  it('caps a limit nobody should be able to ask for', () => {
    expect(pageWindow(100_000).limit).toBe(LIST_MAX_LIMIT)
  })

  it('lets an export raise its own ceiling, and no higher', () => {
    expect(pageWindow(EXPORT_MAX_ROWS, 0, EXPORT_MAX_ROWS).limit).toBe(EXPORT_MAX_ROWS)
    expect(pageWindow(EXPORT_MAX_ROWS + 1, 0, EXPORT_MAX_ROWS).limit).toBe(EXPORT_MAX_ROWS)
  })

  /*
   * Both come from a client doing arithmetic on a page number rather than from
   * a person. A negative OFFSET is not a small page — Postgres raises on it, so
   * the list would 500 rather than show page one.
   */
  it('corrects a window that arithmetic produced', () => {
    expect(pageWindow(0, -20)).toEqual({ limit: 1, offset: 0 })
    expect(pageWindow(-5, 0).limit).toBe(1)
  })
})

describe('parsePageWindow', () => {
  const parse = (qs: string) => parsePageWindow(new URLSearchParams(qs))

  it('is absent rather than defaulted when the query says nothing', () => {
    expect(parse('')).toEqual({})
  })

  it('reads a window out of the query', () => {
    expect(parse('limit=25&offset=50')).toEqual({ limit: 25, offset: 50 })
  })

  it('treats an empty value as absent, not as zero', () => {
    expect(parse('limit=&offset=')).toEqual({})
  })

  /*
   * Rejected rather than dropped, the convention parseInfraFilters set. A
   * silently ignored `limit` hands back page one under a DIFFERENT page size
   * than the caller believes it asked for, and the "1–50 of 3,914" it renders
   * then disagrees with the rows beside it.
   */
  it.each(['limit=fifty', 'limit=1.5', 'offset=-1', 'limit=NaN', 'limit= 50 x'])(
    'rejects a malformed window (%s)',
    (qs) => {
      expect(parse(qs)).toBe('invalid')
    },
  )

  /*
   * Out of range is not malformed. `pageWindow` clamps it, and there is nothing
   * for a person to correct in a number that was simply too big.
   */
  it('accepts a limit that is merely enormous, and leaves the clamping to pageWindow', () => {
    expect(parse('limit=1000000')).toEqual({ limit: 1_000_000 })
    expect(pageWindow(1_000_000).limit).toBe(LIST_MAX_LIMIT)
  })

  it('accepts offset=0, which is page one spelled out', () => {
    expect(parse('offset=0')).toEqual({ offset: 0 })
  })

  /*
   * `Number('1e3')` is 1000 and a whole number, so exponent notation gets
   * through. Pinned rather than fixed: it is an unambiguous spelling of an
   * integer, it is what the id filters in `parseInfraFilters` already accept,
   * and a parser that took `1000` but refused `1e3` would be a surprise with no
   * benefit.
   */
  it('takes exponent notation, the way the other filter parsers do', () => {
    expect(parse('offset=1e3')).toEqual({ offset: 1000 })
  })
})

describe('toPage', () => {
  /*
   * `total` is the match count, not the window's length — it is what "page 3 of
   * 40" is computed from, so counting the rows in hand would make every list
   * one page long.
   */
  it('reports the match count beside the window, not instead of it', () => {
    const page = toPage(['a', 'b'], 3_914, { limit: 50, offset: 100 })
    expect(page).toEqual({ items: ['a', 'b'], total: 3_914, limit: 50, offset: 100 })
  })
})
