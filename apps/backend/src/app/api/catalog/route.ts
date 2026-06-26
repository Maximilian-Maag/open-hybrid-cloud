import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { searchParams } = new URL(req.url)
  const lang = searchParams.get('lang') ?? 'en'
  const search = searchParams.get('search')
  const categoryId = searchParams.get('categoryId')
    ? parseInt(searchParams.get('categoryId')!, 10)
    : undefined

  // Get translations for requested lang, fallback to 'en', then 'de'
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
    .where(
      and(
        categoryId !== undefined ? eq(products.categoryId, categoryId) : undefined,
      ),
    )
    .orderBy(products.id)

  // Filter by search term (post-query, since name comes from subquery)
  const filtered = search
    ? rows.filter((r) =>
        r.name?.toLowerCase().includes(search.toLowerCase()) ||
        r.description?.toLowerCase().includes(search.toLowerCase()),
      )
    : rows

  return NextResponse.json(filtered)
}
