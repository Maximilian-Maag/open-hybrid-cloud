import { ok, err, type Result } from '@/lib/services/result'
import { ORDER_STATUSES, ORDERS_MAX_LIMIT, type OrderFilters, type OrderStatusFilter } from '@/lib/services/orders'
import { parsePageWindow } from '@/lib/services/pageWindow'

/**
 * Parse the order list filters out of a query string.
 *
 * Rejects malformed input rather than dropping it, the way `parseInfraFilters`
 * and `parseCatalogFilters` do: a mistyped `status=pendign` that is quietly
 * ignored returns every order and reads as "these are all pending", which is a
 * far more misleading answer than an error.
 *
 * `projectId` in particular used to be ignored — the project detail page has
 * always sent it, and always received every order the caller could see instead
 * of the project's own (issue #158).
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
  // 'all' is what an unfiltered UI option submits; treat it as absent so the
  // client does not have to strip the parameter, exactly as parseInfraFilters does.
  if (status && status !== 'all') {
    if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
      return err(400, `Invalid status — expected one of ${ORDER_STATUSES.join(', ')}`)
    }
    filters.status = status as OrderStatusFilter
  }

  const window = parsePageWindow(params, ORDERS_MAX_LIMIT)
  if (!window.ok) return window
  Object.assign(filters, window.data)

  return ok(filters)
}
