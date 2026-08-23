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
 *
 * Unauthenticated on purpose, agreeing with `/catalog/{id}/image` rather than with
 * the `requireAuth` on `/catalog` and `/catalog/{id}`. Both image routes are only
 * ever reached as an `<img src>` — ProductGallery, ProductImage, the admin upload
 * preview. The browser's image loader sends no `Authorization` header, and this API
 * is a different origin (:3001) from the frontend (:3000) that holds the session
 * cookie, so `requireAuth` would have nothing to read and would turn every picture
 * in the app into a broken image. Serving these under the token means fetching each
 * one as a blob instead, which also gives up the shared HTTP cache above.
 *
 * The exposure is the bytes alone, to whoever guesses a (product, image) pair: no
 * public route lists either id, and the pairing is checked in the service, so a URL
 * cannot be walked across products.
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
