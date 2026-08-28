import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type * as SimpleWebAuthnServer from '@simplewebauthn/server'

// The library's own verification, stubbed: this file is about the three routes,
// not about the cryptography, which @simplewebauthn tests for itself.
const verifyRegistration = vi.fn()
vi.mock('@simplewebauthn/server', async (orig) => ({
  ...(await orig<typeof SimpleWebAuthnServer>()),
  verifyRegistrationResponse: (...a: unknown[]) => verifyRegistration(...a),
}))

import { GET } from './route'
import { POST as OPTIONS } from './register/options/route'
import { POST as VERIFY } from './register/verify/route'
import { createUser, makeAuthHeader, enrollTotp } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { webauthnCredentials } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { CREDENTIAL_LABEL_MAX } from '@/lib/services/webauthn'

/**
 * The HTTP surface of the three registration routes (#181).
 *
 * All three take `requireAuthPendingSecondFactor` rather than `requireAuth`, and
 * that is the interesting part: a user who has just proved their password but
 * has no second factor yet MUST be able to reach them, or enrolment is
 * impossible for the accounts that are required to enrol. The service is covered
 * by webauthn.test.ts; what is here is the gate, the schema and the headers.
 */

const req = (path: string, method: string, body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

/** An account that may hold a factor and has not enrolled one. */
const eligible = () => createUser({ role: 'admin', secondFactor: false })

describe('GET /api/users/me/webauthn', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await GET(req('/api/users/me/webauthn', 'GET'))).status).toBe(401)
  })

  it('lists nothing for an account with no keys', async () => {
    const user = await eligible()
    const res = await GET(req('/api/users/me/webauthn', 'GET', undefined, await makeAuthHeader(user)))
    expect(res.status).toBe(200)
    expect((await res.json()).credentials).toEqual([])
  })

  // The reason for `requireAuthPendingSecondFactor`: an account that HAS a
  // second factor but has not presented it yet is mid-sign-in, and the settings
  // page still has to be able to read this.
  it('answers an account that has a factor it has not presented', async () => {
    const user = await createUser({ role: 'root', secondFactor: false })
    await enrollTotp(user.id)
    const res = await GET(req('/api/users/me/webauthn', 'GET', undefined, await makeAuthHeader(user)))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/users/me/webauthn/register/options', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await OPTIONS(req('/api/users/me/webauthn/register/options', 'POST'))).status).toBe(401)
  })

  it('offers a ceremony to an eligible account', async () => {
    const user = await eligible()
    const res = await OPTIONS(req('/api/users/me/webauthn/register/options', 'POST', undefined, await makeAuthHeader(user)))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.challenge).toBe('string')
    // The account this credential belongs to, as bytes the authenticator stores.
    expect(body.user?.id).toBeDefined()
  })

  it('refuses a role that cannot hold a second factor', async () => {
    const user = await createUser({ role: 'project_manager' })
    const res = await OPTIONS(req('/api/users/me/webauthn/register/options', 'POST', undefined, await makeAuthHeader(user)))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/users/me/webauthn/register/verify', () => {
  const verifyPath = '/api/users/me/webauthn/register/verify'

  it('refuses an unauthenticated caller', async () => {
    expect((await VERIFY(req(verifyPath, 'POST', { label: 'Key', response: { id: 'x' } }))).status).toBe(401)
  })

  it.each([
    ['no body at all', undefined],
    ['no label', { response: { id: 'x' } }],
    ['an empty label', { label: '', response: { id: 'x' } }],
    ['a label past the bound', { label: 'x'.repeat(CREDENTIAL_LABEL_MAX + 1), response: { id: 'x' } }],
    ['no response', { label: 'Key' }],
    ['a response with no id', { label: 'Key', response: {} }],
  ])('rejects %s with 400', async (_name, body) => {
    const user = await eligible()
    expect((await VERIFY(req(verifyPath, 'POST', body, await makeAuthHeader(user)))).status).toBe(400)
  })

  /*
   * Recovery codes are shown once, in this response and nowhere else, so a copy
   * of it sitting in a proxy is a set of live credentials. The header is the only
   * thing preventing that, and nothing else in the tree asserts it.
   */
  it('forbids caching the response that carries the recovery codes', async () => {
    const user = await eligible()
    const auth = await makeAuthHeader(user)
    await OPTIONS(req('/api/users/me/webauthn/register/options', 'POST', undefined, auth))

    verifyRegistration.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: { id: 'new-key', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
        credentialBackedUp: false,
        credentialDeviceType: 'singleDevice',
      },
    })

    const res = await VERIFY(
      // `response.response` is the authenticator's own payload; the transports
      // live in there, not beside it.
      req(verifyPath, 'POST', { label: 'Yubikey', response: { id: 'new-key', response: { transports: ['usb'] } } }, auth),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    // First factor on the account, so it issues recovery codes.
    expect(Array.isArray(body.recoveryCodes)).toBe(true)
    expect(res.headers.get('cache-control')).toMatch(/no-store/)

    const rows = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, user.id))
    expect(rows.map((r) => r.label)).toEqual(['Yubikey'])
  })
})
