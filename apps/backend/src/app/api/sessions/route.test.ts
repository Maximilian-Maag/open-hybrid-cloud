import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { GET, DELETE } from './route'
import { DELETE as DELETE_ONE } from './[id]/route'
import { PUT as PUT_USER } from '@/app/api/admin/users/[id]/route'
import { getSession } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { auditLog, sessions } from '@/lib/db/schema'
import { createUser, makeSession } from '@/test/helpers'
import type { SessionInfo } from '@open-hybrid-cloud/types'

/**
 * The session list and revocation API (issue #37).
 *
 * The interesting assertions are not "the endpoint returns 200" but the two
 * things the feature is for: a revoked session stops working on the next request,
 * and one user can neither see nor end another's sessions.
 */

const makeReq = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

const idParams = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) })

const authed = (token: string) =>
  new NextRequest('http://localhost/api/anything', { headers: { authorization: `Bearer ${token}` } })

describe('GET /api/sessions', () => {
  it('requires authentication', async () => {
    expect((await GET(makeReq('http://localhost/api/sessions'))).status).toBe(401)
  })

  it('lists the caller\'s own live sessions, newest activity first, marking this one', async () => {
    const user = await createUser({ email: 'sl-own@test.dev' })
    const laptop = await makeSession(user, { userAgent: 'Laptop' })
    const phone = await makeSession(user, { userAgent: 'Phone' })
    // Someone else's session must never appear in it.
    await makeSession(await createUser({ email: 'sl-other@test.dev' }))

    // Backdated so the ordering assertion below means something: two rows written
    // in the same millisecond would come back in whatever order the plan gives.
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(sessions.id, laptop.sessionId))

    const res = await GET(makeReq('http://localhost/api/sessions', phone.auth))
    expect(res.status).toBe(200)
    const body: SessionInfo[] = await res.json()

    expect(body).toHaveLength(2)
    expect(body.every((s) => s.userId === user.id)).toBe(true)
    expect(body.map((s) => s.id)).toEqual([phone.sessionId, laptop.sessionId])
    expect(body[0].current).toBe(true)
    expect(body[1].current).toBe(false)
    expect(body[1].userAgent).toBe('Laptop')
    expect(body[1].ip).toBe('203.0.113.7')
  })

  it('never exposes the token or its hash', async () => {
    // The whole point of storing only a digest is undone if the digest is served.
    const user = await createUser({ email: 'sl-nohash@test.dev' })
    const { auth } = await makeSession(user)
    const body = await (await GET(makeReq('http://localhost/api/sessions', auth))).text()
    expect(body).not.toMatch(/tokenHash|token_hash/)
    expect(body).not.toMatch(/[0-9a-f]{64}/)
  })

  it('omits revoked and expired sessions — this is what is live, not the history', async () => {
    const user = await createUser({ email: 'sl-live@test.dev' })
    const mine = await makeSession(user)
    const revoked = await makeSession(user)
    const expired = await makeSession(user)
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, revoked.sessionId))
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, expired.sessionId))

    const body: SessionInfo[] = await (await GET(makeReq('http://localhost/api/sessions', mine.auth))).json()
    expect(body.map((s) => s.id)).toEqual([mine.sessionId])
  })

  it('lets root list another user\'s sessions', async () => {
    const target = await createUser({ email: 'sl-target@test.dev' })
    await makeSession(target)
    const root = await createUser({ role: 'root', email: 'sl-root@test.dev' })
    const { auth } = await makeSession(root)

    const res = await GET(makeReq(`http://localhost/api/sessions?userId=${target.id}`, auth))
    expect(res.status).toBe(200)
    const body: SessionInfo[] = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].userId).toBe(target.id)
    // Root is looking at someone else's list, so nothing in it is root's own.
    expect(body[0].current).toBe(false)
  })

  it('refuses a non-root user asking for someone else\'s sessions', async () => {
    const target = await createUser({ email: 'sl-victim@test.dev' })
    const admin = await createUser({ role: 'admin', email: 'sl-admin@test.dev' })
    const { auth } = await makeSession(admin)

    const res = await GET(makeReq(`http://localhost/api/sessions?userId=${target.id}`, auth))
    expect(res.status).toBe(403)
  })

  it.each(['0', '-1', 'abc', '1.5'])('rejects a malformed userId (%s)', async (raw) => {
    const root = await createUser({ role: 'root', email: `sl-bad-${raw}@test.dev` })
    const { auth } = await makeSession(root)
    expect((await GET(makeReq(`http://localhost/api/sessions?userId=${raw}`, auth))).status).toBe(400)
  })

  it('writes the lookup to the audit log, including whose list it was', async () => {
    const target = await createUser({ email: 'sl-audited@test.dev' })
    await makeSession(target)
    const root = await createUser({ role: 'root', email: 'sl-auditor@test.dev' })
    const { auth } = await makeSession(root)

    await GET(makeReq(`http://localhost/api/sessions?userId=${target.id}`, auth))

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'session.list'))
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe(root.id)
    expect(rows[0].entityId).toBe(target.id)
    expect(rows[0].details).toContain(String(target.id))
  })
})

describe('DELETE /api/sessions/[id]', () => {
  it('requires authentication', async () => {
    expect((await DELETE_ONE(makeReq('http://localhost/api/sessions/1'), idParams(1))).status).toBe(401)
  })

  it('revokes a session, and the next request with its token is refused', async () => {
    // This is the acceptance criterion of the whole issue.
    const user = await createUser({ email: 'rv-user@test.dev' })
    const keep = await makeSession(user, { userAgent: 'Laptop' })
    const doomed = await makeSession(user, { userAgent: 'Old phone' })

    expect(await getSession(authed(doomed.token))).not.toBeNull()

    const res = await DELETE_ONE(
      makeReq(`http://localhost/api/sessions/${doomed.sessionId}`, keep.auth),
      idParams(doomed.sessionId),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revoked: 1 })

    expect(await getSession(authed(doomed.token))).toBeNull()
    // And the session that did the revoking is untouched.
    expect(await getSession(authed(keep.token))).not.toBeNull()
  })

  it('lets a user end the session they are sitting in', async () => {
    const user = await createUser({ email: 'rv-self@test.dev' })
    const { auth, token, sessionId } = await makeSession(user)

    const res = await DELETE_ONE(
      makeReq(`http://localhost/api/sessions/${sessionId}`, auth),
      idParams(sessionId),
    )
    expect(res.status).toBe(200)
    expect(await getSession(authed(token))).toBeNull()
  })

  it('reports 404 — not 403 — for a session belonging to someone else', async () => {
    // Whether session 812 exists is not something one user should learn about
    // another, so "not yours" and "not there" answer identically.
    const victim = await createUser({ email: 'rv-victim@test.dev' })
    const theirs = await makeSession(victim)
    const attacker = await createUser({ role: 'admin', email: 'rv-attacker@test.dev' })
    const { auth } = await makeSession(attacker)

    const res = await DELETE_ONE(
      makeReq(`http://localhost/api/sessions/${theirs.sessionId}`, auth),
      idParams(theirs.sessionId),
    )
    expect(res.status).toBe(404)
    // And it really is untouched.
    expect(await getSession(authed(theirs.token))).not.toBeNull()
  })

  it('reports 404 for a session that does not exist', async () => {
    const user = await createUser({ email: 'rv-missing@test.dev' })
    const { auth } = await makeSession(user)
    expect((await DELETE_ONE(makeReq('http://localhost/api/sessions/999999', auth), idParams(999999))).status)
      .toBe(404)
  })

  it('lets root revoke any user\'s session', async () => {
    const target = await createUser({ email: 'rv-target@test.dev' })
    const theirs = await makeSession(target)
    const root = await createUser({ role: 'root', email: 'rv-root@test.dev' })
    const { auth } = await makeSession(root)

    const res = await DELETE_ONE(
      makeReq(`http://localhost/api/sessions/${theirs.sessionId}`, auth),
      idParams(theirs.sessionId),
    )
    expect(res.status).toBe(200)
    expect(await getSession(authed(theirs.token))).toBeNull()
  })

  it('is a no-op the second time, and does not audit it twice', async () => {
    const user = await createUser({ email: 'rv-twice@test.dev' })
    const mine = await makeSession(user)
    const other = await makeSession(user)

    await DELETE_ONE(makeReq('http://localhost/x', mine.auth), idParams(other.sessionId))
    const again = await DELETE_ONE(makeReq('http://localhost/x', mine.auth), idParams(other.sessionId))
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ revoked: 0 })

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'session.revoked'))
    expect(rows).toHaveLength(1)
  })

  it.each(['0', '-1', 'abc', '1.5'])('rejects a malformed session id (%s)', async (raw) => {
    const user = await createUser({ email: `rv-bad-${raw}@test.dev` })
    const { auth } = await makeSession(user)
    expect((await DELETE_ONE(makeReq('http://localhost/x', auth), idParams(raw))).status).toBe(400)
  })

  it('records the revocation in the audit log', async () => {
    const user = await createUser({ email: 'rv-audit@test.dev' })
    const mine = await makeSession(user)
    const other = await makeSession(user)

    await DELETE_ONE(makeReq('http://localhost/x', mine.auth), idParams(other.sessionId))

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'session.revoked'))
      .orderBy(desc(auditLog.id))
    expect(rows[0].userId).toBe(user.id)
    expect(rows[0].entityId).toBe(other.sessionId)
  })
})

describe('DELETE /api/sessions (sign out everywhere else)', () => {
  it('requires authentication', async () => {
    expect((await DELETE(makeReq('http://localhost/api/sessions'))).status).toBe(401)
  })

  it('ends every other session of the caller and keeps this one', async () => {
    const user = await createUser({ email: 'so-user@test.dev' })
    const here = await makeSession(user, { userAgent: 'Here' })
    const a = await makeSession(user, { userAgent: 'A' })
    const b = await makeSession(user, { userAgent: 'B' })
    const bystander = await makeSession(await createUser({ email: 'so-bystander@test.dev' }))

    const res = await DELETE(makeReq('http://localhost/api/sessions', here.auth))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revoked: 2 })

    expect(await getSession(authed(here.token))).not.toBeNull()
    expect(await getSession(authed(a.token))).toBeNull()
    expect(await getSession(authed(b.token))).toBeNull()
    // Another user's sessions are not "everywhere else".
    expect(await getSession(authed(bystander.token))).not.toBeNull()
  })

  it('reports zero when there is nothing else to end', async () => {
    const user = await createUser({ email: 'so-alone@test.dev' })
    const { auth } = await makeSession(user)
    expect(await (await DELETE(makeReq('http://localhost/api/sessions', auth))).json()).toEqual({ revoked: 0 })
  })

  it('does not count sessions that were already revoked', async () => {
    const user = await createUser({ email: 'so-already@test.dev' })
    const here = await makeSession(user)
    const gone = await makeSession(user)
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, gone.sessionId))

    expect(await (await DELETE(makeReq('http://localhost/api/sessions', here.auth))).json())
      .toEqual({ revoked: 0 })
  })

  it('lets root end all of another user\'s sessions, sparing none', async () => {
    const target = await createUser({ email: 'so-target@test.dev' })
    const one = await makeSession(target)
    const two = await makeSession(target)
    const root = await createUser({ role: 'root', email: 'so-root@test.dev' })
    const rootSession = await makeSession(root)

    const res = await DELETE(makeReq(`http://localhost/api/sessions?userId=${target.id}`, rootSession.auth))
    expect(await res.json()).toEqual({ revoked: 2 })
    expect(await getSession(authed(one.token))).toBeNull()
    expect(await getSession(authed(two.token))).toBeNull()
    expect(await getSession(authed(rootSession.token))).not.toBeNull()
  })

  it('refuses a non-root user acting on someone else', async () => {
    const target = await createUser({ email: 'so-victim@test.dev' })
    const theirs = await makeSession(target)
    const admin = await createUser({ role: 'admin', email: 'so-admin@test.dev' })
    const { auth } = await makeSession(admin)

    const res = await DELETE(makeReq(`http://localhost/api/sessions?userId=${target.id}`, auth))
    expect(res.status).toBe(403)
    expect(await getSession(authed(theirs.token))).not.toBeNull()
  })

  it('records it in the audit log, naming the session it kept', async () => {
    const user = await createUser({ email: 'so-audit@test.dev' })
    const here = await makeSession(user)
    await makeSession(user)

    await DELETE(makeReq('http://localhost/api/sessions', here.auth))

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'session.revoked_others'))
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe(user.id)
    expect(rows[0].details).toContain(String(here.sessionId))
  })
})

describe('deactivating an account', () => {
  it('ends its sessions instead of leaving them live until the token expires', async () => {
    // `active` is only read at login, so before there were rows to revoke a
    // deactivated user simply stayed signed in — up to 8 h, or 30 days with
    // "remember me". Clicking "Deactivate" does not mean "in a month".
    const target = await createUser({ email: 'da-target@test.dev' })
    const theirs = await makeSession(target)
    const root = await createUser({ role: 'root', email: 'da-root@test.dev' })
    const rootSession = await makeSession(root)

    const res = await PUT_USER(
      new NextRequest(`http://localhost/api/admin/users/${target.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: false }),
        headers: { 'content-type': 'application/json', authorization: rootSession.auth },
      }),
      idParams(target.id),
    )
    expect(res.status).toBe(200)

    expect(await getSession(authed(theirs.token))).toBeNull()
    // Root, who did it, is unaffected.
    expect(await getSession(authed(rootSession.token))).not.toBeNull()

    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'session.revoked_others'))
    expect(audit).toHaveLength(1)
    expect(audit[0].userId).toBe(root.id)
    expect(audit[0].details).toMatch(/deactivated/i)
  })

  it('leaves the sessions alone for any other change to the account', async () => {
    const target = await createUser({ email: 'da-rename@test.dev' })
    const theirs = await makeSession(target)
    const root = await createUser({ role: 'root', email: 'da-root2@test.dev' })
    const rootSession = await makeSession(root)

    await PUT_USER(
      new NextRequest(`http://localhost/api/admin/users/${target.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: 'New Name' }),
        headers: { 'content-type': 'application/json', authorization: rootSession.auth },
      }),
      idParams(target.id),
    )

    expect(await getSession(authed(theirs.token))).not.toBeNull()
  })
})
