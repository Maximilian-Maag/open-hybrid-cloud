import type { Page } from '@open-hybrid-cloud/types'

export type { Page }

/**
 * Page size when a caller asks for a list without saying how much of it it wants.
 *
 * Deliberately larger than the catalogue's 24: these are table rows, not cards,
 * and a list page that shows fifty rows is one most installations never have to
 * page through at all.
 */
export const LIST_DEFAULT_LIMIT = 50

/**
 * Ceiling on a single request, so `?limit=100000` is a page and not a denial of
 * service.
 *
 * This is the number that makes the endpoint's cost bounded no matter what the
 * caller sends, which is the whole point of #158 — the lists were not slow
 * because anybody asked for too much, they were slow because nothing could be
 * asked for LESS than everything.
 */
export const LIST_MAX_LIMIT = 200

/**
 * The largest window an export may take.
 *
 * An export legitimately wants more than a screenful, so it is not held to
 * `LIST_MAX_LIMIT` — but "more than a screenful" is not "everything", and a
 * bound that exists is what separates a slow download from an OOM. Callers are
 * expected to notice a full window and say so rather than present a truncated
 * file as complete; `audit.ts` sets the precedent by fetching `maxRows + 1`.
 */
export const EXPORT_MAX_ROWS = 10_000

/**
 * Clamp a caller's window into something the database can be asked for.
 *
 * A negative offset is an error Postgres raises rather than a page, and a
 * `limit` of zero is a request for nothing that still pays for the count — both
 * come from a client doing arithmetic on a page number, so they are corrected
 * here rather than rejected. The clamp is silent on purpose: it protects the
 * server, and there is no version of "you asked for too many rows" a list page
 * could usefully show a person.
 */
export const pageWindow = (
  limit?: number,
  offset?: number,
  max: number = LIST_MAX_LIMIT,
): { limit: number; offset: number } => ({
  limit: Math.max(1, Math.min(limit ?? LIST_DEFAULT_LIMIT, max)),
  offset: Math.max(0, offset ?? 0),
})

/** Assemble the page contract around rows that have already been fetched. */
export const toPage = <T>(
  items: T[],
  total: number,
  window: { limit: number; offset: number },
): Page<T> => ({ items, total, limit: window.limit, offset: window.offset })

/**
 * Parse `limit` and `offset` out of a query string.
 *
 * Rejects rather than ignores, the convention `parseInfraFilters` set: a
 * mistyped `limit=fifty` that is quietly dropped hands back page one under a
 * different page size, and the caller's "showing 1–50 of 3,914" then disagrees
 * with what is on the screen. `pageWindow` still clamps whatever survives, so a
 * well-formed but enormous `limit` is a page rather than an error — the number
 * is out of range, not malformed, and there is nothing for a person to fix.
 */
export const parsePageWindow = (
  params: URLSearchParams,
): { limit?: number; offset?: number } | 'invalid' => {
  const window: { limit?: number; offset?: number } = {}
  for (const key of ['limit', 'offset'] as const) {
    const raw = params.get(key)
    if (raw === null || raw === '') continue
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0) return 'invalid'
    window[key] = value
  }
  return window
}
