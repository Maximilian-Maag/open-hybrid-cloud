import { type NextRequest } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { refreshElementOutputs } from '@/lib/services/infrastructure'

/**
 * Read this element's Terraform outputs again from its pipeline logs (#218).
 *
 * `requireAuth`, not `requireRole('admin')` like the sibling retry endpoint. The
 * difference is what the action does: retry re-fires CI against real
 * infrastructure, and this fetches a text file the caller can already see the
 * result of. The service scopes it to elements the caller may read, and answers
 * 404 for anything else — the same answer the detail endpoint gives, for the same
 * reason.
 *
 * POST because it writes: the outputs it parses are stored on the element.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const elementId = parseRouteId(id)
  if (elementId === null) return invalidId('infrastructure id')

  return toResponse(await refreshElementOutputs(session, elementId))
}
