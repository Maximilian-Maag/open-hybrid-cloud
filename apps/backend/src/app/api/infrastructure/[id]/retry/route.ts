import { type NextRequest } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { retryProvisioning } from '@/lib/services/infrastructure'

/**
 * Admin and above only. Retrying re-fires CI pipelines against real
 * infrastructure, which is a heavier action than the decommission an orderer may
 * perform on their own elements.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const elementId = parseRouteId(id)
  if (elementId === null) return invalidId('infrastructure id')

  return toResponse(await retryProvisioning(session, elementId))
}
