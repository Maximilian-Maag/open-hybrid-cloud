import { type NextRequest, NextResponse } from 'next/server'
import { getProductImageById } from '@/lib/services/catalog'
import { parseRouteId } from '@/lib/http'

/**
 * One picture of a product's gallery (issue #107).
 *
 * Same conventions as `/catalog/{id}/image`, which serves the first one: the
 * stored MIME type rather than a guess, and a one-hour public cache because the
 * bytes at a given image id never change — a replaced picture is a new row with a
 * new id, so there is nothing to invalidate.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const { id, imageId } = await params
  const productId = parseRouteId(id)
  const imageRowId = parseRouteId(imageId)
  if (productId === null || imageRowId === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const result = await getProductImageById(productId, imageRowId)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })

  return new NextResponse(new Uint8Array(result.data.data), {
    headers: {
      'Content-Type': result.data.mime,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
