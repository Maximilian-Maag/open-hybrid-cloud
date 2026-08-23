import { type NextRequest, NextResponse } from 'next/server'
import { parseRouteId, invalidId } from '@/lib/http'
import { getProductImage } from '@/lib/services/catalog'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')

  const result = await getProductImage(productId)

  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  if (!result.data) return new NextResponse(null, { status: 404 })

  return new NextResponse(new Uint8Array(result.data.data), {
    headers: {
      'Content-Type': result.data.mime,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
