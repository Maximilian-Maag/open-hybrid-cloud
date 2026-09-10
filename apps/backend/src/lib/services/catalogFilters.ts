import { ok, err, type Result } from '@/lib/services/result'
import { CATALOG_MAX_LIMIT, type CatalogFilters } from '@/lib/services/catalog'

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

  const rawLimit = params.get('limit')
  if (rawLimit !== null && rawLimit !== '') {
    const limit = Number(rawLimit)
    if (!Number.isInteger(limit) || limit <= 0) return err(400, 'Invalid limit')
    // Capped rather than refused: asking for more than a page is a reasonable
    // thing to do, and the ceiling is an implementation limit, not a mistake the
    // caller made.
    filters.limit = Math.min(limit, CATALOG_MAX_LIMIT)
  }

  const rawOffset = params.get('offset')
  if (rawOffset !== null && rawOffset !== '') {
    const offset = Number(rawOffset)
    if (!Number.isInteger(offset) || offset < 0) return err(400, 'Invalid offset')
    filters.offset = offset
  }

  return ok(filters)
}
