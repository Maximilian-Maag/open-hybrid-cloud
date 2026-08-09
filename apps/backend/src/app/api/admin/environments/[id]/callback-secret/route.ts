import { type NextRequest } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
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
  return toResponse(await getCallbackSecret(parseInt(id, 10)))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  return toResponse(await regenerateCallbackSecret(parseInt(id, 10)))
}
