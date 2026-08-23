import { type NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId } from '@/lib/http'
import { revokeSession } from '@/lib/services/sessions'

/**
 * Revoke one session (issue #37).
 *
 * Yours, or anyone's if you are root. The owner is read off the row, so there is
 * nothing in the request that could claim a session belongs to the caller.
 * Revoking your own current session is allowed — it is how you end the session
 * you are sitting in, and the very next request with that token gets a 401.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const id = parseRouteId((await params).id)
  if (id === null) return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })

  return toResponse(await revokeSession(session, id))
}
