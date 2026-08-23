import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm'
import type { SessionInfo } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { sessions } from '@/lib/db/schema'
import { logAudit, logAuditWith } from '@/lib/audit'
import { ok, err, type Result } from '@/lib/services/result'
import type { AuthenticatedUser } from '@/lib/auth/middleware'

/**
 * Listing and revoking sessions (issue #37).
 *
 * Two rules run through all of it:
 *
 *  - A user sees and ends their own sessions. Root sees and ends anyone's. There
 *    is no third case, and the target's owner is read from the row, never from
 *    the request.
 *  - Every list and every revocation is written to the audit log. Revocation is
 *    obvious — it is a security action on someone's access. Listing is there
 *    because "who looked at whose sessions" is exactly the question asked after
 *    an incident, and root can look at anyone's.
 */

const toSessionInfo = (
  row: {
    id: number
    userId: number
    ip: string | null
    userAgent: string | null
    createdAt: Date
    lastSeenAt: Date
    expiresAt: Date
  },
  currentSessionId: number,
): SessionInfo => ({
  id: row.id,
  userId: row.userId,
  ip: row.ip,
  userAgent: row.userAgent,
  createdAt: row.createdAt.toISOString(),
  lastSeenAt: row.lastSeenAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  current: row.id === currentSessionId,
})

/** Only live sessions: not revoked, not past their expiry. */
const liveSessionsOf = (userId: number) =>
  and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()))

/**
 * Active sessions for a user.
 *
 * Expired rows are filtered out rather than deleted: they are the history of an
 * account, and this is a list of what is live, not a cleanup job. `current` marks
 * the caller's own session so the UI can label it and refuse to offer a "sign
 * out" that would be a confusing way to log yourself out.
 */
export const listSessions = async (
  caller: AuthenticatedUser,
  targetUserId?: number,
): Promise<Result<SessionInfo[]>> => {
  const userId = targetUserId ?? caller.id
  if (userId !== caller.id && caller.role !== 'root') {
    return err(403, 'Only root can view sessions for another user')
  }

  const rows = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(liveSessionsOf(userId))
    .orderBy(desc(sessions.lastSeenAt))

  await logAudit(
    caller.id,
    'session.list',
    userId,
    userId === caller.id
      ? `Listed own sessions (${rows.length} active)`
      : `Listed sessions of user ${userId} (${rows.length} active)`,
  )

  return ok(rows.map((row) => toSessionInfo(row, caller.sessionId)))
}

/**
 * End every live session of a user, with no caller session involved.
 *
 * For the case where a session ends because of something that happened *to* the
 * account rather than something the user asked for — deactivation. Before #37 a
 * deactivated user stayed signed in until their token expired, because `active`
 * was only read at login; now the account and the sessions can be turned off
 * together, which is what an operator clicking "Deactivate" means by it.
 *
 * Returns how many were live. `actorId` may be null for a system action.
 */
export const revokeAllSessionsOf = async (
  actorId: number | null,
  userId: number,
  reason: string,
  // Pass the transaction when the revoke has to stand or fall with whatever
  // caused it. A deactivation that commits while the revoke fails leaves the
  // account disabled and still signed in, which is the failure this exists to
  // prevent.
  executor: Parameters<typeof logAuditWith>[0] = db,
): Promise<number> => {
  const revoked = await executor
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(liveSessionsOf(userId))
    .returning({ id: sessions.id })

  if (revoked.length === 0) return 0

  await logAuditWith(
    executor,
    actorId,
    'session.revoked_others',
    userId,
    `${reason}: signed out ${revoked.length} session(s) of user ${userId}`,
  )

  return revoked.length
}

/**
 * The same, but sparing one session — the one that asked for it.
 *
 * A sibling of `revokeAllSessionsOf` rather than of `revokeOtherSessions` below,
 * which does the same SQL for a different caller: that one answers an HTTP
 * request, so it authorizes a caller, returns a `Result` and runs on the pool.
 * This one is called by a write that FORCES the revoke — a password change — from
 * inside that write's transaction, where there is nobody to authorize and a
 * failure has to take the write down with it.
 *
 * Sparing the caller's own session is a deliberate exception to "a password
 * change ends every session". Someone who has just re-entered their current
 * password has re-authenticated in this tab a second ago; signing them out of it
 * teaches them that the safe action costs them their place, which is how people
 * learn not to take it.
 */
export const revokeOtherSessionsOf = async (
  actorId: number | null,
  userId: number,
  keepSessionId: number,
  reason: string,
  executor: Parameters<typeof logAuditWith>[0] = db,
): Promise<number> => {
  const revoked = await executor
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(liveSessionsOf(userId), ne(sessions.id, keepSessionId)))
    .returning({ id: sessions.id })

  if (revoked.length === 0) return 0

  await logAuditWith(
    executor,
    actorId,
    'session.revoked_others',
    userId,
    `${reason}: signed out ${revoked.length} other session(s) of user ${userId}, kept ${keepSessionId}`,
  )

  return revoked.length
}

/**
 * End one session.
 *
 * Idempotent in the sense that matters: revoking an already-revoked session is
 * not an error to the caller, because the outcome they asked for is the outcome
 * they have. It does not write a second audit entry either — the first one is the
 * event.
 */
export const revokeSession = async (
  caller: AuthenticatedUser,
  sessionId: number,
): Promise<Result<{ revoked: number }>> => {
  const rows = await db
    .select({ id: sessions.id, userId: sessions.userId, revokedAt: sessions.revokedAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)

  const row = rows[0]
  // 404 rather than 403 for a session that is not yours and not yours to see:
  // whether id 812 exists is not something one user should learn about another.
  if (!row || (row.userId !== caller.id && caller.role !== 'root')) {
    return err(404, 'Session not found')
  }
  if (row.revokedAt !== null) return ok({ revoked: 0 })

  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId))

  await logAudit(
    caller.id,
    'session.revoked',
    sessionId,
    row.userId === caller.id
      ? `Revoked own session ${sessionId}`
      : `Revoked session ${sessionId} of user ${row.userId}`,
  )

  return ok({ revoked: 1 })
}

/**
 * "Sign out everywhere else."
 *
 * Everything live for this user except the session making the request. Root may
 * do it to another user, in which case nothing is spared — root's own session is
 * not one of theirs.
 */
export const revokeOtherSessions = async (
  caller: AuthenticatedUser,
  targetUserId?: number,
): Promise<Result<{ revoked: number }>> => {
  const userId = targetUserId ?? caller.id
  if (userId !== caller.id && caller.role !== 'root') {
    return err(403, 'Only root can revoke sessions for another user')
  }

  const keep = userId === caller.id ? ne(sessions.id, caller.sessionId) : undefined

  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(liveSessionsOf(userId), keep))
    .returning({ id: sessions.id })

  await logAudit(
    caller.id,
    'session.revoked_others',
    userId,
    userId === caller.id
      ? `Signed out ${revoked.length} other session(s), kept ${caller.sessionId}`
      : `Signed out all ${revoked.length} session(s) of user ${userId}`,
  )

  return ok({ revoked: revoked.length })
}
