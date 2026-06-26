import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { products, productTranslations, categories } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

const UpdateProductSchema = z.object({
  categoryId: z.number().int().positive().optional(),
  baseLanguage: z.string().optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseInt(id, 10)

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
    .where(eq(products.id, productId))
    .limit(1)

  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseInt(id, 10)

  const body = await req.json().catch(() => null)
  const parsed = UpdateProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { name, description, ...productFields } = parsed.data

  if (Object.keys(productFields).length > 0) {
    await db.update(products).set(productFields).where(eq(products.id, productId))
  }

  // Update the English translation if name/description provided
  if (name !== undefined || description !== undefined) {
    const productRows = await db
      .select({ baseLanguage: products.baseLanguage })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1)

    const lang = productRows[0]?.baseLanguage ?? 'en'
    const updateData: Partial<{ name: string; description: string }> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description

    await db
      .insert(productTranslations)
      .values({ productId, languageCode: lang, name: name ?? '', description: description ?? '' })
      .onConflictDoUpdate({
        target: [productTranslations.productId, productTranslations.languageCode],
        set: updateData,
      })

    // Also update English if different
    if (lang !== 'en') {
      await db
        .insert(productTranslations)
        .values({ productId, languageCode: 'en', name: name ?? '', description: description ?? '' })
        .onConflictDoUpdate({
          target: [productTranslations.productId, productTranslations.languageCode],
          set: updateData,
        })
    }
  }

  const updated = await db
    .select({
      id: products.id,
      categoryId: products.categoryId,
      baseLanguage: products.baseLanguage,
      createdAt: products.createdAt,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)

  return NextResponse.json(updated[0])
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const deleted = await db
    .delete(products)
    .where(eq(products.id, parseInt(id, 10)))
    .returning({ id: products.id })

  if (!deleted.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
