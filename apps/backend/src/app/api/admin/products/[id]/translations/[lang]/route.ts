import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { productTranslations } from '@/lib/db/schema'

const UpsertTranslationSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lang: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, lang } = await params
  const productId = parseInt(id, 10)

  const body = await req.json().catch(() => null)
  const parsed = UpsertTranslationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [row] = await db
    .insert(productTranslations)
    .values({
      productId,
      languageCode: lang,
      name: parsed.data.name,
      description: parsed.data.description,
    })
    .onConflictDoUpdate({
      target: [productTranslations.productId, productTranslations.languageCode],
      set: { name: parsed.data.name, description: parsed.data.description },
    })
    .returning()

  return NextResponse.json(row)
}
