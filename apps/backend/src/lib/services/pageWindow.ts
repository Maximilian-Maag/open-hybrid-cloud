import { ok, err, type Result } from '@/lib/services/result'

/** The page window a list request asks for, as the list services take it. */
export interface PageWindow {
  limit?: number
  offset?: number
}

/**
 * Parse `limit`/`offset` out of a query string, capped at the list's ceiling.
 *
 * One parser for every paginated list, so `limit=0`, `limit=-1` and `limit=1e9`
 * cannot mean three different things on three endpoints. `limit` is capped
 * rather than refused — asking for more than a page is a reasonable thing to do,
 * and the ceiling is an implementation limit, not a mistake the caller made —
 * while a non-numeric or negative value is rejected, because silently ignoring it
 * serves the whole first page and looks like the parameter was honoured.
 */
export const parsePageWindow = (params: URLSearchParams, maxLimit: number): Result<PageWindow> => {
  const window: PageWindow = {}

  const rawLimit = params.get('limit')
  if (rawLimit !== null && rawLimit !== '') {
    const limit = Number(rawLimit)
    if (!Number.isInteger(limit) || limit <= 0) return err(400, 'Invalid limit')
    window.limit = Math.min(limit, maxLimit)
  }

  const rawOffset = params.get('offset')
  if (rawOffset !== null && rawOffset !== '') {
    const offset = Number(rawOffset)
    if (!Number.isInteger(offset) || offset < 0) return err(400, 'Invalid offset')
    window.offset = offset
  }

  return ok(window)
}
