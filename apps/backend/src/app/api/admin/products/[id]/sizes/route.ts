import type { NextRequest } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { getSizeMatrix } from '@/lib/services/admin/sizes'

/**
 * The product's sizes as a grid: sizes down, environments across (issue #249).
 *
 * The same rows the per-offering endpoint one level down returns, transposed.
 * That endpoint answers "what sizes does this offering have"; this one answers
 * "what does XL cost, everywhere" — which through the per-offering route is one
 * request per environment and a comparison the caller has to do itself.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')

  return toResponse(await getSizeMatrix(productId))
}
