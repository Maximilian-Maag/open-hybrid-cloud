import { ok, err, type Result } from '@/lib/services/result'
import { auditBoundary, type AuditFilters } from '@/lib/services/audit'

/** Largest page the list endpoint will serve, whatever the caller asks for. */
export const AUDIT_MAX_PAGE_SIZE = 200

/** What `pageSize` defaults to — the page size the admin UI requests. */
export const AUDIT_DEFAULT_PAGE_SIZE = 50

export interface AuditQuery {
  filters: AuditFilters
  page: number
  pageSize: number
}

/**
 * Parse the audit log's query parameters.
 *
 * Shared by the list and the export, for the same reason `parseInfraFilters` and
 * `parseCostFilters` are: an export taken under a different filter set than the
 * list it was read from is worse than no export at all.
 *
 * Rejects malformed input rather than coercing it (issue #143). Everything here
 * went through a bare `parseInt` before:
 *   - `?page=0` became `OFFSET -50`
 *   - `?page=abc` / `?pageSize=abc` became `LIMIT NaN`
 *   - `?pageSize=-5` became `LIMIT -5`
 * all of which are unhandled 500s. Worse, `?userId=abc` became `NaN`, which is
 * falsy where the filter is applied, so the filter was silently dropped and the
 * WHOLE audit log came back under a query that looked filtered.
 */
export const parseAuditFilters = (params: URLSearchParams): Result<AuditQuery> => {
  const filters: AuditFilters = {}

  const userId = params.get('userId')
  if (userId !== null && userId !== '') {
    const id = Number(userId)
    if (!Number.isInteger(id) || id <= 0) return err(400, 'Invalid userId')
    filters.userId = id
  }

  const action = params.get('action')?.trim()
  if (action) filters.action = action

  // Kept as the strings the service already accepts (it widens a bare date to
  // cover the whole named day itself), but validated through the service's own
  // boundary parser — so a value the service would silently drop is a 400 here
  // instead of a filter that quietly disappears.
  const from = params.get('from')
  if (from) {
    if (auditBoundary(from, 'start') === null) return err(400, 'Invalid from')
    filters.from = from
  }

  const to = params.get('to')
  if (to) {
    if (auditBoundary(to, 'end') === null) return err(400, 'Invalid to')
    filters.to = to
  }

  const fromDate = filters.from ? auditBoundary(filters.from, 'start') : null
  const toDate = filters.to ? auditBoundary(filters.to, 'end') : null
  if (fromDate && toDate && fromDate > toDate) {
    return err(400, 'from must not be after to')
  }

  const page = parsePositiveInt(params.get('page'), 1)
  if (page === 'invalid') return err(400, 'Invalid page — expected a positive integer')

  const pageSize = parsePositiveInt(params.get('pageSize'), AUDIT_DEFAULT_PAGE_SIZE)
  if (pageSize === 'invalid') return err(400, 'Invalid pageSize — expected a positive integer')

  return ok({
    filters,
    page,
    // Capped rather than rejected: a caller asking for more rows than the page can
    // carry gets the largest page there is, which is what the old Math.min did.
    pageSize: Math.min(pageSize, AUDIT_MAX_PAGE_SIZE),
  })
}

const parsePositiveInt = (raw: string | null, fallback: number): number | 'invalid' => {
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) return 'invalid'
  return value
}
