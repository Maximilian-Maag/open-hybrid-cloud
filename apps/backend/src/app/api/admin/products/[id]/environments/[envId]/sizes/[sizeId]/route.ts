import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
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
  const productId = Number(id)
  const environmentId = Number(envId)
  const size = Number(sizeId)
  if (
    !Number.isInteger(productId) || productId <= 0 ||
    !Number.isInteger(environmentId) || environmentId <= 0 ||
    !Number.isInteger(size) || size <= 0
  ) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  return toResponse(await deleteSize(productId, environmentId, size))
}
