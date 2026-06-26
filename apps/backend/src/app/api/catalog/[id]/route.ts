import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import {
  products,
  productEnvironments,
  deploymentEnvironments,
  parameters,
} from '@/lib/db/schema'
import { eq, or, and, sql } from 'drizzle-orm'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseInt(id, 10)
  const { searchParams } = new URL(req.url)
  const lang = searchParams.get('lang') ?? 'en'
  const environmentIdParam = searchParams.get('environmentId')
  const environmentId = environmentIdParam ? parseInt(environmentIdParam, 10) : undefined

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

  if (!productRows.length) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const product = productRows[0]

  // Environments
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

  // Parameters: global OR (category, scopeId=categoryId) OR (product, scopeId=productId)
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

  return NextResponse.json({
    ...product,
    environments: envRows,
    parameters: paramRows,
  })
}
