import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { products, productTranslations, categories } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

const CreateProductSchema = z.object({
  categoryId: z.number().int().positive(),
  baseLanguage: z.string().default('de'),
  name: z.string().min(1),
  description: z.string().default(''),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const rows = await db
    .select({
      id: products.id,
      categoryId: products.categoryId,
      baseLanguage: products.baseLanguage,
      createdAt: products.createdAt,
      categoryName: categories.name,
      name: sql<string>`(
        SELECT name FROM product_translations
        WHERE product_id = ${products.id} AND language_code = 'en'
        LIMIT 1
      )`,
      description: sql<string>`(
        SELECT description FROM product_translations
        WHERE product_id = ${products.id} AND language_code = 'en'
        LIMIT 1
      )`,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .orderBy(products.id)

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { categoryId, baseLanguage, name, description } = parsed.data

  const [product] = await db
    .insert(products)
    .values({ categoryId, baseLanguage })
    .returning()

  // Create default translation in base language
  await db
    .insert(productTranslations)
    .values({ productId: product.id, languageCode: baseLanguage, name, description })

  // Also create English translation if base language is different
  if (baseLanguage !== 'en') {
    await db
      .insert(productTranslations)
      .values({ productId: product.id, languageCode: 'en', name, description })
      .onConflictDoNothing()
  }

  return NextResponse.json({ ...product, name, description }, { status: 201 })
}
