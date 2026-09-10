import { type NextRequest } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { decommissionInfra } from '@/lib/services/infrastructure'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const elementId = parseRouteId(id)
  if (elementId === null) return invalidId('infrastructure id')
  return toResponse(await decommissionInfra(session, elementId))
}
