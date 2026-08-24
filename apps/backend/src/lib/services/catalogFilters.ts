import { ok, err, type Result } from '@/lib/services/result'
import { CATALOG_MAX_LIMIT, type CatalogFilters } from '@/lib/services/catalog'
import { parsePageWindow } from '@/lib/services/pageWindow'

/**
 * Parse the catalogue list filters out of a query string.
 *
 * Rejects malformed input rather than dropping it, the same way
 * `parseInfraFilters` does: a mistyped `categoryId=abc` that is quietly ignored
 * returns the whole catalogue, which reads as "your filter matched everything"
 * and is a more misleading answer than an error.
 */
export const parseCatalogFilters = (params: URLSearchParams): Result<CatalogFilters> => {
  const filters: CatalogFilters = {}

  const rawCategory = params.get('categoryId')
  if (rawCategory !== null && rawCategory !== '') {
    const categoryId = Number(rawCategory)
    if (!Number.isInteger(categoryId) || categoryId <= 0) return err(400, 'Invalid categoryId')
    filters.categoryId = categoryId
  }

  const search = params.get('search')?.trim()
  if (search) filters.search = search

  const window = parsePageWindow(params, CATALOG_MAX_LIMIT)
  if (!window.ok) return window
  Object.assign(filters, window.data)

  return ok(filters)
}
