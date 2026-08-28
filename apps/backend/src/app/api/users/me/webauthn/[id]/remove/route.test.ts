import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'
import { passwordRecheckLimit } from '@/lib/auth/passwordRecheck'

/**
 * The HTTP surface of removing a security key (#181, #231).
 *
 * POST and not DELETE, which the sibling route used to be: the reverse proxy
 * drops a DELETE body, and this one carries the password. The service is covered
 * by webauthn.test.ts — what is here is the role, the id parsing, the schema and
 * the status codes.
 */

const makeReq = (id: string, body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/users/me/webauthn/${id}/remove`, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  // Shared across the three in-session password re-checks and module-level, so
  // one case's wrong guesses would throttle the next.
  passwordRecheckLimit.clear()
})

describe('POST /api/users/me/webauthn/[id]/remove', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await POST(makeReq('1', { password: 'x' }), ctx('1'))).status).toBe(401)
  })

  /*
   * The route is `requireAuth`, not `requireRole` — these are the caller's OWN
   * keys and the service scopes every read and write to `session.id`.
   *
   * The role check that does exist is the service's, and it is about something
   * else: `loadTwoFactorAccount` refuses a role that cannot hold a second factor
   * at all. So an admin with the right password gets past the gate and lands on
   * "no such key", while a project_manager is refused before that — 403 from the
   * service, not from the route.
   */
  it('lets an eligible caller through to the service', async () => {
    const user = await createUser({ role: 'admin' })
    const res = await POST(makeReq('999999', { password: 'password123' }, await makeAuthHeader(user)), ctx('999999'))
    // Past the password, past the last-factor guard, and no such key.
    expect(res.status).toBe(404)
  })

  it('refuses a role that cannot hold a second factor at all', async () => {
    const user = await createUser({ role: 'project_manager' })
    const res = await POST(makeReq('999999', { password: 'password123' }, await makeAuthHeader(user)), ctx('999999'))
    expect(res.status).toBe(403)
  })

  it('answers 403 for the wrong password', async () => {
    const user = await createUser({ role: 'admin' })
    const res = await POST(makeReq('1', { password: 'not-the-password' }, await makeAuthHeader(user)), ctx('1'))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/password is incorrect/i)
  })

  it.each([
    ['no body at all', undefined],
    ['no password', {}],
    ['an empty password', { password: '' }],
  ])('rejects %s with 400', async (_name, body) => {
    const user = await createUser({ role: 'admin' })
    expect((await POST(makeReq('1', body, await makeAuthHeader(user)), ctx('1'))).status).toBe(400)
  })

  // `Number('0x10')` is 16 — parseRouteId is digits-only, and here it decides
  // which of the caller's keys is removed.
  it.each(['0x10', ' 5 ', 'abc', '-1'])('refuses the malformed id %s with 400', async (id) => {
    const user = await createUser({ role: 'admin' })
    expect((await POST(makeReq(id, { password: 'password123' }, await makeAuthHeader(user)), ctx(id))).status).toBe(400)
  })
})
