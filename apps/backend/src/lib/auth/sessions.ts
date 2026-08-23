import { createHash, timingSafeEqual } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { sessions } from '@/lib/db/schema'
import { signToken } from './jwt'

/**
 * Session lifetimes, and the per-request check that makes revocation real.
 *
 * ## Lifetime
 *
 * Default 8 h; "remember me" extends it to 30 days (issue #37). Both are
 * overridable per deployment via `SESSION_TTL_SECONDS` and
 * `SESSION_REMEMBER_ME_TTL_SECONDS`, and both are clamped to 30 days — the issue
 * names that as the maximum, and an operator setting a year by accident should get
 * a month, not a year.
 *
 * The frontend's NextAuth cookie is sized to the ceiling (see the frontend's
 * `lib/session.ts`) and the exact end of *this* session travels in the token's own
 * `exp`, which the frontend middleware reads. That is what keeps #103 fixed now
 * that one shared constant can no longer describe every session.
 *
 * ## The per-request check
 *
 * `validateSession` runs on every authenticated request. It is one primary-key
 * lookup on `sessions` — an index probe plus one heap fetch, sub-millisecond on
 * any machine that can run this app, and on the same connection pool the request
 * was going to use anyway.
 *
 * A short-lived cache would make it cheaper and would also make "rejected
 * immediately on the next request" false for the length of the cache. Revocation
 * that takes effect in a few seconds is a different feature from revocation, and
 * the one the issue asks for is the second one. So: no cache. If the lookup ever
 * shows up in a profile, the answer is a covering index or a connection-pool
 * setting, not a window during which a revoked token still works.
 *
 * ## What "immediately" does and does not cover
 *
 * The check runs once, at the start of the request, before the route does
 * anything. A request that has already passed it runs to completion — revoking a
 * session does not reach into a handler that is halfway through writing an order
 * and stop it. That is deliberate: aborting mid-transaction is how you get a
 * half-created order, and the window is the length of one request. The guarantee
 * is per-request, and it is the strongest one available without cancelling work
 * already in flight.
 */

const DAY_SECONDS = 24 * 60 * 60

/** Hard ceiling on any session lifetime, from the issue: 30 days. */
export const SESSION_MAX_TTL_SECONDS = 30 * DAY_SECONDS

/** Lifetime of an ordinary session. */
export const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60

/** Lifetime of a "remember me" session. */
export const REMEMBER_ME_SESSION_TTL_SECONDS = SESSION_MAX_TTL_SECONDS

/**
 * How stale `last_seen_at` is allowed to get.
 *
 * The alternative — writing it on every request — turns every read of the
 * catalogue into a row update, a WAL record and a dirtied page, on the hottest
 * path in the app. "Last active, to within five minutes" is all the session list
 * can usefully say anyway; nobody reads it to the second.
 */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000

/** Read a positive-integer seconds value from the environment, or fall back. */
const ttlFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`[sessions] ${name}=${raw} is not a positive integer; using ${fallback}s`)
    return fallback
  }
  return Math.min(parsed, SESSION_MAX_TTL_SECONDS)
}

/** How long a session created now should last. */
export const sessionTtlSeconds = (rememberMe = false): number =>
  rememberMe
    ? ttlFromEnv('SESSION_REMEMBER_ME_TTL_SECONDS', REMEMBER_ME_SESSION_TTL_SECONDS)
    : ttlFromEnv('SESSION_TTL_SECONDS', DEFAULT_SESSION_TTL_SECONDS)

/** SHA-256, hex. The token itself is never stored — see the schema comment. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex')

/** Constant-time comparison of two hex digests of the same length. */
const hashesMatch = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

export interface CreateSessionInput {
  user: SessionUser
  ip?: string | null
  userAgent?: string | null
  rememberMe?: boolean
}

export interface CreatedSession {
  token: string
  sessionId: number
  expiresAt: Date
}

/**
 * Open a session and mint the token that names it.
 *
 * Chicken and egg: the token has to carry the row id, and the row has to store
 * the token's hash. One transaction, insert then update — two writes on the login
 * path, which is not a path worth optimising, in exchange for never having a
 * committed row whose `token_hash` does not match its token.
 */
export const createSession = async (input: CreateSessionInput): Promise<CreatedSession> => {
  const ttl = sessionTtlSeconds(input.rememberMe)
  const expiresAt = new Date(Date.now() + ttl * 1000)

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(sessions)
      .values({
        userId: input.user.id,
        // Replaced below, in this same transaction, once the token exists.
        tokenHash: '',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt,
      })
      .returning({ id: sessions.id })

    const token = await signToken(input.user, { sessionId: row.id, expiresInSeconds: ttl })
    await tx.update(sessions).set({ tokenHash: hashToken(token) }).where(eq(sessions.id, row.id))

    return { token, sessionId: row.id, expiresAt }
  })
}

/**
 * Is this session still good, and is this the token it was issued for?
 *
 * Returns the owning user id on success so a caller can cross-check it against
 * the token's claims; null means "reject this request". Four ways to fail, all of
 * them silent by design — a 401 must not tell a caller *why* its token is no good.
 *
 * The `token_hash` comparison is what stops a token that carries a valid `sid`
 * but is not the token that opened that session. Minting one needs JWT_SECRET, so
 * this is depth rather than the front line, but it is one cheap comparison on a
 * row already in hand.
 */
export const validateSession = async (
  sessionId: number,
  token: string,
  now: Date = new Date(),
): Promise<{ userId: number } | null> => {
  const rows = await db
    .select({
      userId: sessions.userId,
      tokenHash: sessions.tokenHash,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.revokedAt !== null) return null
  if (row.expiresAt.getTime() <= now.getTime()) return null
  if (!hashesMatch(row.tokenHash, hashToken(token))) return null

  await touchSession(sessionId, row.lastSeenAt, now)
  return { userId: row.userId }
}

/**
 * Advance `last_seen_at`, but only if it is already stale.
 *
 * Gated twice on purpose. The JavaScript check skips the round trip entirely for
 * the ~99.9 % of requests inside the window. The SQL predicate repeats the same
 * condition against the committed row, so a burst of concurrent requests that all
 * cross the boundary together produces one write, not one per request.
 */
const touchSession = async (sessionId: number, lastSeenAt: Date, now: Date): Promise<void> => {
  if (now.getTime() - lastSeenAt.getTime() < SESSION_TOUCH_INTERVAL_MS) return
  const staleBefore = new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS)
  await db
    .update(sessions)
    .set({ lastSeenAt: now })
    .where(and(eq(sessions.id, sessionId), lt(sessions.lastSeenAt, staleBefore)))
}
