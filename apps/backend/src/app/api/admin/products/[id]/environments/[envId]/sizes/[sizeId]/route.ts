import type { NextRequest } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { deleteSize } from '@/lib/services/admin/sizes'

/**
 * Remove one size of one offering.
 *
 * Deletion by id, while creation and update go through the code (see the sizes
 * collection route): the code is what an admin edits by, but deleting by a name
 * that has just been renamed is how the wrong row gets removed.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; envId: string; sizeId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, envId, sizeId } = await params
  // `Number` accepted `0x10` as 16 and ` 5 ` as 5, so a malformed segment
  // resolved to a real size (#143). parseRouteId is digits-only.
  const productId = parseRouteId(id)
  const environmentId = parseRouteId(envId)
  const size = parseRouteId(sizeId)
  if (productId === null || environmentId === null || size === null) {
    return invalidId('product, environment or size id')
  }

  return toResponse(await deleteSize(productId, environmentId, size, session.id))
}
