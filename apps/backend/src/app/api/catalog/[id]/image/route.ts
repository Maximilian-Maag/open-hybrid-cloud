import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const productId = parseInt(id, 10)

  const rows = await db
    .select({ image: products.image })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)

  if (!rows.length || !rows[0].image) {
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(rows[0].image, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
