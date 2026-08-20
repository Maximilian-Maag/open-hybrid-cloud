import { ok, err, type Result } from '@/lib/services/result'
import type { CostFilters } from '@/lib/services/costs'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse the cost report's query parameters.
 *
 * Shared by the report and the export, for the same reason the infrastructure
 * export shares its parser: a total and its breakdown must be over the same rows,
 * or the export is worse than useless.
 *
 * Also accepts a `range` shorthand for the presets the issue asks for, resolved
 * server-side so the browser's clock cannot shift what "last 3 months" means
 * between the report and its export.
 */
export const parseCostFilters = (
  params: URLSearchParams,
  now: Date = new Date(),
): Result<CostFilters> => {
  const filters: CostFilters = {}

  const projectId = params.get('projectId')
  if (projectId !== null && projectId !== '') {
    const id = Number(projectId)
    if (!Number.isInteger(id) || id <= 0) return err(400, 'Invalid projectId')
    filters.projectId = id
  }

  const range = params.get('range')
  if (range && range !== 'custom') {
    const resolved = resolveRange(range, now)
    if (!resolved) {
      return err(400, 'Invalid range — expected currentMonth, last3Months, last12Months, all or custom')
    }
    if (resolved.from) filters.from = resolved.from
    return ok(filters)
  }

  const from = parseBoundary(params.get('from'), 'start')
  if (from === 'invalid') return err(400, 'Invalid from')
  if (from) filters.from = from

  const to = parseBoundary(params.get('to'), 'end')
  if (to === 'invalid') return err(400, 'Invalid to')
  if (to) filters.to = to

  if (filters.from && filters.to && filters.from > filters.to) {
    return err(400, 'from must not be after to')
  }

  return ok(filters)
}

const resolveRange = (range: string, now: Date): { from: Date | null } | null => {
  switch (range) {
    case 'currentMonth':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) }
    case 'last3Months':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)) }
    case 'last12Months':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)) }
    case 'all':
      // No lower bound at all, rather than an arbitrary epoch.
      return { from: null }
    default:
      return null
  }
}

const parseBoundary = (raw: string | null, edge: 'start' | 'end'): Date | null | 'invalid' => {
  if (raw === null || raw === '') return null
  // A bare date is widened to cover the whole day, so a single-day range returns
  // that day's orders rather than only those created exactly at midnight.
  const iso = DATE_ONLY.test(raw)
    ? `${raw}T${edge === 'start' ? '00:00:00.000Z' : '23:59:59.999Z'}`
    : raw
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'invalid' : date
}
