import { NextResponse } from 'next/server'
import type { Result } from '@/lib/services/result'

export const toResponse = <T>(result: Result<T>, successStatus = 200): NextResponse =>
  result.ok
    ? NextResponse.json(result.data ?? { success: true }, { status: successStatus })
    : NextResponse.json({ error: result.message }, { status: result.status })

/**
 * A path segment as a positive database id, or null if it is not one.
 *
 * `parseInt` is the wrong tool for a route parameter: it reads a leading number
 * and discards the rest, so `/products/1abc/image` and `/products/1.5/image`
 * both resolve to product 1 and quietly act on a record the caller never asked
 * for. Digits only, then a safe-integer check so an id beyond 2^53 cannot
 * silently become a different number.
 */
export const parseRouteId = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
