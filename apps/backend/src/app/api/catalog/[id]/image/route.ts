import { type NextRequest, NextResponse } from 'next/server'
import { parseRouteId, invalidId } from '@/lib/http'
import { getProductImage } from '@/lib/services/catalog'

/**
 * The picture a product leads with.
 *
 * Unauthenticated, and `/catalog/{id}/images/{imageId}` matches it deliberately —
 * the reasoning is written out there. In short: an `<img src>` carries no
 * `Authorization` header and no cross-origin session cookie, so `requireAuth` here
 * would only break every thumbnail in the catalogue.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  // `parseInt` read a leading number and dropped the rest, so `/catalog/12abc/image`
  // served product 12's picture. Digits-only, matching `/catalog/{id}/images/{imageId}`
  // and the rest of the API's route ids.
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
