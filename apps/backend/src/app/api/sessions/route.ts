import { type NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId } from '@/lib/http'
import { listSessions, revokeOtherSessions } from '@/lib/services/sessions'

/**
 * Active sessions (issue #37).
 *
 * `?userId=` is root-only and is the whole of the admin surface: root reading
 * another user's sessions is the same list through the same code path, so there is
 * no second implementation to keep in step. Omitting it means "mine".
 */
const INVALID = Symbol('invalid user id')

const parseUserId = (raw: string | null): number | undefined | typeof INVALID => {
  if (raw === null) return undefined
  return parseRouteId(raw) ?? INVALID
}

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const userId = parseUserId(req.nextUrl.searchParams.get('userId'))
  if (userId === INVALID) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })

  return toResponse(await listSessions(session, userId))
}

/** "Sign out everywhere else" — every live session for the user but this one. */
export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const userId = parseUserId(req.nextUrl.searchParams.get('userId'))
  if (userId === INVALID) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })

  return toResponse(await revokeOtherSessions(session, userId))
}
