import { db } from '@/lib/db/client'
import { products, productEnvironments, deploymentEnvironments, parameters, type Parameter } from '@/lib/db/schema'
import { eq, or, and, sql } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'

/**
 * Load the parameter definitions that apply to a product in a given
 * environment. Merges the global-, category- and product-scoped rows from the
 * `parameters` table and filters by environment (env-specific rows plus rows
 * that apply to every environment, i.e. environment_id IS NULL).
 *
 * Shared by the catalog (to render the order form) and the order service (to
 * validate submitted parameters server-side) so both agree on which
 * definitions are in scope.
 */
export const loadApplicableParameters = async (
  productId: number,
  categoryId: number,
  environmentId?: number,
): Promise<Parameter[]> => {
  const scopeWhere = or(
    eq(parameters.scope, 'global'),
    and(eq(parameters.scope, 'category'), eq(parameters.scopeId, categoryId)),
    and(eq(parameters.scope, 'product'), eq(parameters.scopeId, productId)),
  )

  const paramWhere =
    environmentId !== undefined
      ? and(
          scopeWhere,
          or(sql`${parameters.environmentId} IS NULL`, eq(parameters.environmentId, environmentId)),
        )
      : scopeWhere

  return db.select().from(parameters).where(paramWhere)
}

/**
 * Collapse the applicable rows to one definition per parameter name, applying
 * scope precedence (product > category > global) and preferring an
 * environment-specific row over an all-environments (NULL) row. This is the
 * effective definition a submitted value is validated against.
 */
export const resolveParameterDefs = (rows: Parameter[]): Parameter[] => {
  const scopeRank: Record<string, number> = { global: 0, category: 1, product: 2 }
  const byName = new Map<string, Parameter>()

  for (const row of rows) {
    const current = byName.get(row.name)
    if (!current) {
      byName.set(row.name, row)
      continue
    }
    const moreSpecificScope = scopeRank[row.scope] > scopeRank[current.scope]
    const sameScopeButEnvSpecific =
      scopeRank[row.scope] === scopeRank[current.scope] &&
      row.environmentId !== null &&
      current.environmentId === null
    if (moreSpecificScope || sameScopeButEnvSpecific) {
      byName.set(row.name, row)
    }
  }

  return [...byName.values()]
}

export interface CatalogItem {
  id: number
  categoryId: number
  baseLanguage: string
  createdAt: Date
  name: string
  description: string
}

export interface ProductDetail extends CatalogItem {
  environments: unknown[]
  parameters: unknown[]
}

export const listCatalog = async (
  lang: string,
  search?: string,
  categoryId?: number,
): Promise<Result<CatalogItem[]>> => {
  const rows = await db
    .select({
      id: products.id,
      categoryId: products.categoryId,
      baseLanguage: products.baseLanguage,
      createdAt: products.createdAt,
      name: sql<string>`COALESCE(
        (SELECT name FROM product_translations WHERE product_id = ${products.id} AND language_code = ${lang}),
        (SELECT name FROM product_translations WHERE product_id = ${products.id} AND language_code = 'en'),
        (SELECT name FROM product_translations WHERE product_id = ${products.id} AND language_code = 'de'),
        (SELECT name FROM product_translations WHERE product_id = ${products.id} LIMIT 1)
      )`,
      description: sql<string>`COALESCE(
        (SELECT description FROM product_translations WHERE product_id = ${products.id} AND language_code = ${lang}),
        (SELECT description FROM product_translations WHERE product_id = ${products.id} AND language_code = 'en'),
        (SELECT description FROM product_translations WHERE product_id = ${products.id} AND language_code = 'de'),
        ''
      )`,
    })
    .from(products)
    .where(categoryId !== undefined ? eq(products.categoryId, categoryId) : undefined)
    .orderBy(products.id)

  const filtered = search
    ? rows.filter((r) =>
        r.name?.toLowerCase().includes(search.toLowerCase()) ||
        r.description?.toLowerCase().includes(search.toLowerCase()),
      )
    : rows

  return ok(filtered as CatalogItem[])
}

export const getProduct = async (
  productId: number,
  lang: string,
  environmentId?: number,
): Promise<Result<ProductDetail>> => {
  const productRows = await db
    .select({
      id: products.id,
      categoryId: products.categoryId,
      baseLanguage: products.baseLanguage,
      createdAt: products.createdAt,
      name: sql<string>`COALESCE(
        (SELECT name FROM product_translations WHERE product_id = ${products.id} AND language_code = ${lang}),
        (SELECT name FROM product_translations WHERE product_id = ${products.id} AND language_code = 'en'),
        (SELECT name FROM product_translations WHERE product_id = ${products.id} AND language_code = 'de'),
        (SELECT name FROM product_translations WHERE product_id = ${products.id} LIMIT 1)
      )`,
      description: sql<string>`COALESCE(
        (SELECT description FROM product_translations WHERE product_id = ${products.id} AND language_code = ${lang}),
        (SELECT description FROM product_translations WHERE product_id = ${products.id} AND language_code = 'en'),
        (SELECT description FROM product_translations WHERE product_id = ${products.id} AND language_code = 'de'),
        ''
      )`,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)

  if (!productRows.length) return err(404, 'Product not found')

  const product = productRows[0]

  const envRows = await db
    .select({
      productId: productEnvironments.productId,
      environmentId: productEnvironments.environmentId,
      price: productEnvironments.price,
      currency: productEnvironments.currency,
      costCenterMode: productEnvironments.costCenterMode,
      forcedCostCenter: productEnvironments.forcedCostCenter,
      environmentName: deploymentEnvironments.name,
    })
    .from(productEnvironments)
    .leftJoin(
      deploymentEnvironments,
      eq(productEnvironments.environmentId, deploymentEnvironments.id),
    )
    .where(eq(productEnvironments.productId, productId))

  const paramRows = await loadApplicableParameters(productId, product.categoryId, environmentId)

  return ok({ ...product, environments: envRows, parameters: paramRows } as ProductDetail)
}

export const getProductImage = async (
  productId: number,
): Promise<Result<{ data: Buffer; mime: string } | null>> => {
  const rows = await db
    .select({ image: products.image })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)

  if (!rows.length) return err(404, 'Product not found')
  if (!rows[0].image) return ok(null)

  return ok({ data: rows[0].image, mime: 'image/png' })
}
