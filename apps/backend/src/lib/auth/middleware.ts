import { type NextRequest, NextResponse } from 'next/server'
import { verifyToken } from './jwt'
import { validateSession } from './sessions'
import { canHoldSecondFactor, secondFactorOutstanding } from '@/lib/services/twoFactor'
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

/**
 * The machine-readable reason a request was refused for want of an enrolment.
 *
 * A `code`, not just prose: the frontend has to tell this apart from an ordinary
 * 403 to send the user to the enrolment screen instead of showing "Forbidden",
 * and matching on an English sentence is not a contract.
 */
export const SECOND_FACTOR_REQUIRED = 'second_factor_required'

/**
 * Who is calling — refused if they owe us a second factor (issue #197).
 *
 * This is the control, and the frontend redirect is the convenience. An
 * administrative account with no confirmed factor can hold a perfectly valid
 * session token: the password was right, the session row exists, nothing is
 * expired. What it cannot do is *use* it, on any route that goes through here,
 * which is every route except the handful listed at
 * `requireAuthPendingSecondFactor`. Someone who navigates past the redirect, or
 * skips the browser entirely and calls the API with the token, meets the same
 * 403.
 *
 * 403 rather than 401 for the same reason the enrollment route already gives: the
 * browser's API client treats a 401 as an expired session and signs the user out
 * globally, and being signed out is exactly what must NOT happen here — enrolling
 * needs the session to work.
 *
 * The order of the two checks is the whole cost argument. `canHoldSecondFactor`
 * reads the role out of the token that has already been verified, so a project
 * manager is rejected from the expensive branch without touching the database;
 * only `root` and `admin` pay for the lookup.
 */
export const requireAuth = async (req: NextRequest): Promise<AuthenticatedUser | NextResponse> => {
  const user = await getSession(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (canHoldSecondFactor(user.role) && (await secondFactorOutstanding(user.id))) {
    return NextResponse.json(
      {
        error:
          'Two-factor authentication is required for administrator accounts. Set up an authenticator to continue.',
        code: SECOND_FACTOR_REQUIRED,
      },
      { status: 403 },
    )
  }
  return user
}

/**
 * Who is calling, allowing an account that still owes a second factor.
 *
 * For the endpoints that enrolment itself needs, and nothing else:
 *
 *   * `GET /api/users/me/2fa` — the status the enrolment screen renders from
 *   * `POST /api/users/me/2fa/enroll` and `/confirm` — the enrolment
 *   * `GET /api/users/me` — the profile the app shell needs to draw anything
 *
 * A route that uses this is deliberately readable as an exception. Adding one is
 * a decision about what an un-enrolled administrator may reach, so it costs a
 * line here rather than being a flag somebody passes in passing.
 *
 * Signing out needs nothing from this list: it is NextAuth clearing its own
 * cookie on the frontend, and it never calls the backend.
 */
export const requireAuthPendingSecondFactor = async (
  req: NextRequest,
): Promise<AuthenticatedUser | NextResponse> => {
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
