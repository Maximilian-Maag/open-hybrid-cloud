import { type NextRequest } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { getCallbackSecret, regenerateCallbackSecret } from '@/lib/services/admin/environments'

// GET reveals the current secret so the Root can copy it into GitLab
// (Settings → Webhooks → Secret token). POST rotates it and returns the new
// value in the same shape — the operator has one shot to copy it before the
// old value stops matching in GitLab.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const environmentId = parseRouteId(id)
  if (environmentId === null) return invalidId('environment id')
  return toResponse(await getCallbackSecret(environmentId, session.id))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const environmentId = parseRouteId(id)
  if (environmentId === null) return invalidId('environment id')
  return toResponse(await regenerateCallbackSecret(environmentId, session.id))
}
