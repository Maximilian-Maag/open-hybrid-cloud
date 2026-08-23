import { type NextRequest, NextResponse } from 'next/server'
import { verifyToken } from './jwt'
import { validateSession } from './sessions'
import type { SessionUser, Role } from '@open-hybrid-cloud/types'

const ROLE_RANK: Record<Role, number> = { project_manager: 1, admin: 2, root: 3 }

/**
 * The caller, plus which session they are calling from.
 *
 * `sessionId` is the `sessions` row this request authenticated against (issue
 * #37). Routes need it to mark the caller's own entry in the session list and to
 * leave it alone when signing out everywhere else.
 */
export interface AuthenticatedUser extends SessionUser {
  sessionId: number
}

/**
 * Who is calling, or null.
 *
 * Two checks, in this order, and both are required:
 *
 *  1. the signature, which proves we minted the token;
 *  2. the session row, which proves it has not been revoked and has not expired.
 *
 * The second one is what the whole of #37 rests on. It costs a primary-key
 * lookup per authenticated request and is deliberately not cached — see the
 * reasoning at the top of `lib/auth/sessions.ts`.
 */
export const getSession = async (req: NextRequest): Promise<AuthenticatedUser | null> => {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null

  const token = auth.slice(7)
  const claims = await verifyToken(token)
  if (!claims) return null

  const row = await validateSession(claims.sid, token)
  if (!row) return null
  // The row owns the session; the token only claims to. If they disagree the
  // token is not describing this session, whatever its signature says.
  if (row.userId !== claims.user.id) return null

  return { ...claims.user, sessionId: claims.sid }
}

export const requireAuth = async (req: NextRequest): Promise<AuthenticatedUser | NextResponse> => {
  const user = await getSession(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return user
}

export const requireRole =
  (minRole: Role) =>
  async (req: NextRequest): Promise<AuthenticatedUser | NextResponse> => {
    const result = await requireAuth(req)
    if (result instanceof NextResponse) return result
    if (ROLE_RANK[result.role] < ROLE_RANK[minRole])
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return result
  }

export const isAuth = (v: AuthenticatedUser | NextResponse): v is AuthenticatedUser =>
  !(v instanceof NextResponse)
