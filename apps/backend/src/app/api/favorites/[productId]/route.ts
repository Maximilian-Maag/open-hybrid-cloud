import { type NextRequest } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { addFavorite, removeFavorite } from '@/lib/services/favorites'

/**
 * Favourites are always the caller's own — the user id comes from the session and
 * is never accepted from the request, so there is no way to star something on
 * another user's behalf.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const productId = parseRouteId((await params).productId)
  if (productId === null) return invalidId('product id')

  return toResponse(await addFavorite(session, productId))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const productId = parseRouteId((await params).productId)
  if (productId === null) return invalidId('product id')

  return toResponse(await removeFavorite(session, productId))
}
