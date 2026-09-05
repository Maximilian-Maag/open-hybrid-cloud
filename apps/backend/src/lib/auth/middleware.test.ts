import { describe, it, expect } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { signToken } from './jwt'
import { createSession } from './sessions'
import {
  getSession,
  requireAuth,
  requireAuthPendingSecondFactor,
  requireRole,
  isAuth,
  SECOND_FACTOR_REQUIRED,
  type AuthenticatedUser,
} from './middleware'
import { db } from '@/lib/db/client'
import { sessions, userTotp } from '@/lib/db/schema'
import { createUser, enrollTotp } from '@/test/helpers'
import type { Role } from '@open-hybrid-cloud/types'

const makeReq = (token?: string): NextRequest =>
  new NextRequest('http://localhost/api/test', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

/** A user in the database and a live session for them — what a real request has. */
const signedIn = async (role: Role, email: string) => {
  const user = await createUser({ role, email })
  const created = await createSession({
    user: { id: user.id, email: user.email, name: user.name, role },
    ip: '203.0.113.1',
    userAgent: 'vitest',
  })
  return { user, ...created }
}

describe('getSession', () => {
  it('returns null with no authorization header', async () => {
    expect(await getSession(makeReq())).toBeNull()
  })

  it('returns null for a non-Bearer header', async () => {
    const req = new NextRequest('http://localhost/', { headers: { authorization: 'Basic abc' } })
    expect(await getSession(req)).toBeNull()
  })

  it('returns null for an invalid token', async () => {
    expect(await getSession(makeReq('garbage'))).toBeNull()
  })

  it('returns the user, and the session the request came from', async () => {
    const { user, token, sessionId } = await signedIn('admin', 'mw-admin@test.dev')
    const session = await getSession(makeReq(token))
    expect(session).toMatchObject({ id: user.id, email: user.email, role: 'admin', sessionId })
  })

  // ── The check that makes #37 real ────────────────────────────────────────────

  it('rejects a revoked session on the very next request', async () => {
    // No cache, no grace period: the row is looked up per request precisely so
    // that "revoked" means revoked now and not in a minute.
    const { token, sessionId } = await signedIn('admin', 'mw-revoked@test.dev')
    expect(await getSession(makeReq(token))).not.toBeNull()

    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId))

    expect(await getSession(makeReq(token))).toBeNull()
  })

  it('rejects an expired session even though the signature still verifies', async () => {
    // Two clocks that could disagree — the token's `exp` and the row's
    // `expires_at`. The row is the one that decides, so shortening a session by
    // hand takes effect without waiting for the token to die.
    const { token, sessionId } = await signedIn('admin', 'mw-expired@test.dev')
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, sessionId))

    expect(await getSession(makeReq(token))).toBeNull()
  })

  it('rejects a token whose session row was deleted with its user', async () => {
    const { user, token } = await signedIn('admin', 'mw-deleted@test.dev')
    await db.delete(sessions).where(eq(sessions.userId, user.id))
    expect(await getSession(makeReq(token))).toBeNull()
  })

  it('rejects a token that names a session it was not issued for', async () => {
    // Needs JWT_SECRET to produce, so this is depth rather than the front line —
    // but token_hash is what makes a stolen `sid` useless on a re-signed token.
    const { user, sessionId } = await signedIn('admin', 'mw-swapped@test.dev')
    const forged = await signToken(
      { id: user.id, email: user.email, name: user.name, role: 'admin' },
      { sessionId, expiresInSeconds: 3600 },
    )
    expect(await getSession(makeReq(forged))).toBeNull()
  })

  it('rejects a token whose claimed user is not the session owner', async () => {
    const victim = await signedIn('project_manager', 'mw-victim@test.dev')
    const attacker = await createUser({ role: 'root', email: 'mw-attacker@test.dev' })
    // Same session row, a different user in the claims — an attempt to borrow
    // someone else's live session and promote yourself inside it.
    const forged = await signToken(
      { id: attacker.id, email: attacker.email, name: attacker.name, role: 'root' },
      { sessionId: victim.sessionId, expiresInSeconds: 3600 },
    )
    expect(await getSession(makeReq(forged))).toBeNull()
  })

  it('advances last_seen_at only once the touch interval has passed', async () => {
    // The alternative is a row update on every authenticated request, on the
    // hottest path in the app. Five-minute resolution is all the session list
    // ever claims.
    const { token, sessionId } = await signedIn('admin', 'mw-touch@test.dev')
    const read = async () =>
      (await db.select({ lastSeenAt: sessions.lastSeenAt }).from(sessions).where(eq(sessions.id, sessionId)))[0]
        .lastSeenAt

    const atLogin = await read()
    await getSession(makeReq(token))
    expect((await read()).getTime()).toBe(atLogin.getTime())

    // Backdate past the interval; the next request is the one that writes.
    const stale = new Date(Date.now() - 10 * 60 * 1000)
    await db.update(sessions).set({ lastSeenAt: stale }).where(eq(sessions.id, sessionId))
    await getSession(makeReq(token))
    expect((await read()).getTime()).toBeGreaterThan(stale.getTime())
  })
})

describe('requireAuth', () => {
  it('returns 401 with no token', async () => {
    const result = await requireAuth(makeReq())
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it('returns the user with a valid token', async () => {
    const { token } = await signedIn('admin', 'ra-admin@test.dev')
    expect(isAuth(await requireAuth(makeReq(token)))).toBe(true)
  })

  it('returns 401, not 403, once the session is revoked', async () => {
    // A revoked session is the same thing to a caller as an expired one, and the
    // frontend already turns a 401 into a sign-out and a trip to /login (#103).
    const { token, sessionId } = await signedIn('admin', 'ra-revoked@test.dev')
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId))

    const result = await requireAuth(makeReq(token))
    expect((result as NextResponse).status).toBe(401)
  })
})

// Issue #197. The session is valid in every other sense — right password, live
// row, unexpired — and that is the point: what is refused is the *use* of it.
describe('requireAuth, when an administrator owes a second factor', () => {
  /** An administrative account with no confirmed factor, and a live session. */
  const unenrolled = async (role: Role, email: string) => {
    const user = await createUser({ role, email, secondFactor: false })
    const created = await createSession({
      user: { id: user.id, email: user.email, name: user.name, role },
      ip: '203.0.113.1',
      userAgent: 'vitest',
    })
    return { user, ...created }
  }

  it.each([['root'], ['admin']] as const)(
    'refuses a %s with no confirmed factor',
    async (role) => {
      const { token } = await unenrolled(role, `ra-noenrol-${role}@test.dev`)
      const result = await requireAuth(makeReq(token))
      expect((result as NextResponse).status).toBe(403)
      expect(await (result as NextResponse).json()).toMatchObject({
        code: SECOND_FACTOR_REQUIRED,
      })
    },
  )

  it('403, never 401 — a 401 would sign the user out of the session they need to enroll with', async () => {
    const { token } = await unenrolled('admin', 'ra-not-401@test.dev')
    expect((await requireAuth(makeReq(token)) as NextResponse).status).not.toBe(401)
  })

  it('carries a machine-readable code, so the client need not match on English', async () => {
    const { token } = await unenrolled('admin', 'ra-code@test.dev')
    const body = await ((await requireAuth(makeReq(token))) as NextResponse).json()
    expect(body.code).toBe(SECOND_FACTOR_REQUIRED)
  })

  it('lets the same session through once a factor is confirmed', async () => {
    const { user, token } = await unenrolled('admin', 'ra-then-enrol@test.dev')
    expect((await requireAuth(makeReq(token)) as NextResponse).status).toBe(403)

    // No new sign-in: the gate has to lift for the session that was already open,
    // or enrolling would leave the account exactly where it started.
    await enrollTotp(user.id)
    expect(isAuth(await requireAuth(makeReq(token)))).toBe(true)
  })

  it('closes again the moment an operator clears the factor', async () => {
    // The emergency reset in docs/guides/root.md. A flag cached on the session
    // row would leave every existing session open after precisely the event that
    // should close them.
    const { user, token } = await signedIn('admin', 'ra-cleared@test.dev')
    expect(isAuth(await requireAuth(makeReq(token)))).toBe(true)

    await db.delete(userTotp).where(eq(userTotp.userId, user.id))
    expect((await requireAuth(makeReq(token)) as NextResponse).status).toBe(403)
  })

  it('never applies to a project manager, who may not hold a factor at all', async () => {
    const { token } = await signedIn('project_manager', 'ra-pm@test.dev')
    expect(isAuth(await requireAuth(makeReq(token)))).toBe(true)
  })

  it('stops requireRole too, so the gate cannot be walked around by an admin route', async () => {
    const { token } = await unenrolled('root', 'ra-role@test.dev')
    const result = await requireRole('admin')(makeReq(token))
    expect((result as NextResponse).status).toBe(403)
    expect((await (result as NextResponse).json()).code).toBe(SECOND_FACTOR_REQUIRED)
  })

  it('requireAuthPendingSecondFactor lets them through, which is how enrollment works at all', async () => {
    const { user, token } = await unenrolled('admin', 'ra-pending@test.dev')
    const result = await requireAuthPendingSecondFactor(makeReq(token))
    expect(isAuth(result)).toBe(true)
    expect((result as AuthenticatedUser).id).toBe(user.id)
  })

  it('requireAuthPendingSecondFactor still refuses no session at all', async () => {
    expect(((await requireAuthPendingSecondFactor(makeReq())) as NextResponse).status).toBe(401)
  })
})

describe('requireRole', () => {
  it('returns 401 when not authenticated', async () => {
    const result = await requireRole('admin')(makeReq())
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it('returns 403 when role rank is too low', async () => {
    const { token } = await signedIn('project_manager', 'rr-pm@test.dev')
    const result = await requireRole('admin')(makeReq(token))
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  it('passes when user has exact minimum role', async () => {
    const { token } = await signedIn('admin', 'rr-admin@test.dev')
    const result = await requireRole('admin')(makeReq(token))
    expect(isAuth(result)).toBe(true)
    if (isAuth(result)) expect(result.role).toBe('admin')
  })

  it('passes when user role exceeds minimum', async () => {
    const { token } = await signedIn('root', 'rr-root@test.dev')
    expect(isAuth(await requireRole('admin')(makeReq(token)))).toBe(true)
    expect(isAuth(await requireRole('project_manager')(makeReq(token)))).toBe(true)
  })

  it('project_manager passes project_manager-level check', async () => {
    const { token } = await signedIn('project_manager', 'rr-pm2@test.dev')
    expect(isAuth(await requireRole('project_manager')(makeReq(token)))).toBe(true)
  })

  it('refuses a revoked session before it ever looks at the role', async () => {
    const { token, sessionId } = await signedIn('root', 'rr-revoked@test.dev')
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId))
    expect((await requireRole('project_manager')(makeReq(token)) as NextResponse).status).toBe(401)
  })
})

describe('isAuth', () => {
  it('returns true for an authenticated caller', () => {
    const caller: AuthenticatedUser = {
      id: 1,
      email: 'admin@test.dev',
      name: 'Admin',
      role: 'admin',
      sessionId: 5,
    }
    expect(isAuth(caller)).toBe(true)
  })

  it('returns false for a NextResponse', () => {
    expect(isAuth(NextResponse.json({ error: 'x' }, { status: 401 }))).toBe(false)
  })
})
