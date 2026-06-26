import { NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { products, productTranslations } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { translateProduct } from '@/lib/ai'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseInt(id, 10)

  // Get product's base language translation
  const productRows = await db
    .select({ baseLanguage: products.baseLanguage })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)

  if (!productRows.length) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const baseLanguage = productRows[0].baseLanguage

  const baseTranslationRows = await db
    .select({ name: productTranslations.name, description: productTranslations.description })
    .from(productTranslations)
    .where(
      sql`${productTranslations.productId} = ${productId} AND ${productTranslations.languageCode} = ${baseLanguage}`,
    )
    .limit(1)

  if (!baseTranslationRows.length) {
    return NextResponse.json({ error: 'Base translation not found' }, { status: 404 })
  }

  const { name, description } = baseTranslationRows[0]

  const translations = await translateProduct(name, description)

  // Upsert all translations
  for (const [lang, t] of Object.entries(translations)) {
    await db
      .insert(productTranslations)
      .values({ productId, languageCode: lang, name: t.name, description: t.description })
      .onConflictDoUpdate({
        target: [productTranslations.productId, productTranslations.languageCode],
        set: { name: t.name, description: t.description },
      })
  }

  return NextResponse.json({ success: true, languages: Object.keys(translations) })
}
