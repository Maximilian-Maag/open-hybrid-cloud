import { ok, err, type Result } from '@/lib/services/result'
import {
  INFRA_STATUS_FILTERS,
  INFRA_SORT_FIELDS,
  type InfraFilters,
  type InfraStatusFilter,
  type InfraSortField,
} from '@/lib/services/infrastructure'

/**
 * Parse the infrastructure list filters out of a query string.
 *
 * Extracted from the list route so the export endpoint can reuse it verbatim —
 * an export that silently applied a different filter set than the list it was
 * taken from would be worse than no export at all.
 *
 * Rejects malformed input rather than dropping it: a mistyped `status=activ`
 * that is quietly ignored looks like "no such infrastructure exists", which is a
 * far more misleading answer than an error.
 */
export const parseInfraFilters = (params: URLSearchParams): Result<InfraFilters> => {
  const filters: InfraFilters = {}

  for (const key of ['productId', 'projectId', 'environmentId'] as const) {
    const raw = params.get(key)
    if (raw === null || raw === '') continue
    const value = Number(raw)
    if (!Number.isInteger(value) || value <= 0) return err(400, `Invalid ${key}`)
    filters[key] = value
  }

  const search = params.get('search')?.trim()
  if (search) filters.search = search

  const status = params.get('status')
  // 'all' is what the UI's unfiltered option submits; treat it as absent so the
  // client does not have to strip the parameter.
  if (status && status !== 'all') {
    if (!(INFRA_STATUS_FILTERS as readonly string[]).includes(status)) {
      return err(400, `Invalid status — expected one of ${INFRA_STATUS_FILTERS.join(', ')}`)
    }
    filters.status = status as InfraStatusFilter
  }

  // A bare YYYY-MM-DD is widened to cover the whole day: `to` is the end of the
  // named day, not its midnight, so a single-day range returns that day's rows.
  const from = parseBoundary(params.get('deployedFrom'), 'start')
  if (from === 'invalid') return err(400, 'Invalid deployedFrom')
  if (from) filters.deployedFrom = from

  const to = parseBoundary(params.get('deployedTo'), 'end')
  if (to === 'invalid') return err(400, 'Invalid deployedTo')
  if (to) filters.deployedTo = to

  if (filters.deployedFrom && filters.deployedTo && filters.deployedFrom > filters.deployedTo) {
    return err(400, 'deployedFrom must not be after deployedTo')
  }

  const sort = params.get('sort')
  if (sort) {
    if (!(INFRA_SORT_FIELDS as readonly string[]).includes(sort)) {
      return err(400, `Invalid sort — expected one of ${INFRA_SORT_FIELDS.join(', ')}`)
    }
    filters.sort = sort as InfraSortField
  }

  const direction = params.get('direction')
  if (direction) {
    if (direction !== 'asc' && direction !== 'desc') return err(400, 'Invalid direction — expected asc or desc')
    filters.direction = direction
  }

  return ok(filters)
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const parseBoundary = (raw: string | null, edge: 'start' | 'end'): Date | null | 'invalid' => {
  if (raw === null || raw === '') return null
  const iso = DATE_ONLY.test(raw)
    ? `${raw}T${edge === 'start' ? '00:00:00.000Z' : '23:59:59.999Z'}`
    : raw
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'invalid' : date
}
