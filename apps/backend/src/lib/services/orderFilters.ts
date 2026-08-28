import type { OrderStatus } from '@open-hybrid-cloud/types'
import { ok, err, type Result } from '@/lib/services/result'
import { parsePageWindow } from '@/lib/services/page'
import type { OrderFilters } from '@/lib/services/orders'

/**
 * Every status an order can hold, as a runtime list.
 *
 * The shared `OrderStatus` union is types-only and vanishes at compile time, so
 * a query string cannot be checked against it. Kept here beside the parser that
 * needs it — the alternative, casting whatever arrived, is how `status=complete`
 * becomes "you have no orders".
 */
export const ORDER_STATUS_FILTERS = [
  'pending',
  'provisioning',
  'completed',
  'failed',
  'rejected',
] as const satisfies readonly OrderStatus[]

/**
 * Parse the order list filters out of a query string.
 *
 * Rejects malformed input rather than dropping it, the convention
 * `parseInfraFilters` set. That mattered immediately here: `projectId` was
 * being SENT by the project detail page and read by nobody, so the page showed
 * every order the viewer could see under the heading "Orders in this project"
 * — a silently ignored filter is indistinguishable from a filter that matched
 * everything.
 */
export const parseOrderFilters = (params: URLSearchParams): Result<OrderFilters> => {
  const filters: OrderFilters = {}

  const rawProject = params.get('projectId')
  if (rawProject !== null && rawProject !== '') {
    const projectId = Number(rawProject)
    if (!Number.isInteger(projectId) || projectId <= 0) return err(400, 'Invalid projectId')
    filters.projectId = projectId
  }

  const status = params.get('status')
  // 'all' is what an unfiltered dropdown submits; treat it as absent so the
  // client does not have to strip the parameter.
  if (status && status !== 'all') {
    if (!(ORDER_STATUS_FILTERS as readonly string[]).includes(status)) {
      return err(400, `Invalid status — expected one of ${ORDER_STATUS_FILTERS.join(', ')}`)
    }
    filters.status = status as OrderStatus
  }

  const window = parsePageWindow(params)
  if (window === 'invalid') return err(400, 'Invalid limit or offset — expected a non-negative whole number')
  Object.assign(filters, window)

  return ok(filters)
}
