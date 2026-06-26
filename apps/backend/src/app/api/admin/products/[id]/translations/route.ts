import { NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { productTranslations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseInt(id, 10)

  const rows = await db
    .select()
    .from(productTranslations)
    .where(eq(productTranslations.productId, productId))
    .orderBy(productTranslations.languageCode)

  return NextResponse.json(rows)
}
