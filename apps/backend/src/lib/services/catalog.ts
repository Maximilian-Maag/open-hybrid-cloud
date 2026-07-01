import { db } from '@/lib/db/client'
import { products, productEnvironments, deploymentEnvironments, parameters } from '@/lib/db/schema'
import { eq, or, and, sql } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'

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

  const paramWhere = environmentId
    ? and(
        or(
          eq(parameters.scope, 'global'),
          and(eq(parameters.scope, 'category'), eq(parameters.scopeId, product.categoryId)),
          and(eq(parameters.scope, 'product'), eq(parameters.scopeId, productId)),
        ),
        or(
          sql`${parameters.environmentId} IS NULL`,
          eq(parameters.environmentId, environmentId),
        ),
      )
    : or(
        eq(parameters.scope, 'global'),
        and(eq(parameters.scope, 'category'), eq(parameters.scopeId, product.categoryId)),
        and(eq(parameters.scope, 'product'), eq(parameters.scopeId, productId)),
      )

  const paramRows = await db.select().from(parameters).where(paramWhere)

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
