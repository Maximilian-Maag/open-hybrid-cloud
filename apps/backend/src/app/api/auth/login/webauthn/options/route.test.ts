import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createUser } from '@/test/helpers'
import { signMfaChallenge } from '@/lib/auth/mfaChallenge'
import { db } from '@/lib/db/client'
import { users, webauthnCredentials } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * The HTTP surface of the WebAuthn options endpoint at sign-in (#181).
 *
 * Unauthenticated by design, and the only thing standing in for a session is the
 * MFA challenge token: the caller has already proved the password, and the
 * browser needs the credential list to prompt for the right key. Everything that
 * is not a valid, unexpired challenge for a live account gets the same answer —
 * which is what this file is for, because "the same answer" is easy to break.
 */

const makeReq = (body?: unknown) =>
  new NextRequest('http://localhost/api/auth/login/webauthn/options', {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json' },
  })

const withHash = async (over?: { active?: boolean }) => {
  const user = await createUser({ role: 'admin', ...(over ?? {}) })
  const [row] = await db.select().from(users).where(eq(users.id, user.id))
  return { user, passwordHash: row.passwordHash as string }
}

describe('POST /api/auth/login/webauthn/options', () => {
  it.each([
    ['no body at all', undefined],
    ['no token', {}],
    ['an empty token', { mfaToken: '' }],
  ])('rejects %s with 400', async (_name, body) => {
    expect((await POST(makeReq(body))).status).toBe(400)
  })

  // 401 and not 400: a token that parses but does not verify is an expired or
  // forged sign-in attempt, not a malformed request.
  it('answers 401 for a token that is not a challenge', async () => {
    const res = await POST(makeReq({ mfaToken: 'not.a.jwt' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/expired/i)
  })

  /*
   * The same 401, for a deactivated account. An account that is switched off
   * between password and second factor must not get as far as being told which
   * keys it has — and the message must not differ from the expired one, or the
   * difference itself answers "does this account still exist".
   */
  it('answers the same 401 for a deactivated account', async () => {
    const { user, passwordHash } = await withHash()
    const token = await signMfaChallenge(user.id, passwordHash)
    await db.update(users).set({ active: false }).where(eq(users.id, user.id))

    const res = await POST(makeReq({ mfaToken: token }))

    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/expired/i)
  })

  // The challenge is bound to the password it was issued against, so changing
  // the password invalidates every sign-in attempt already in flight.
  it('answers 401 once the password has changed under it', async () => {
    const { user, passwordHash } = await withHash()
    const token = await signMfaChallenge(user.id, passwordHash)
    await db.update(users).set({ passwordHash: '$2a$04$differenthashdifferenthashdiff' }).where(eq(users.id, user.id))

    expect((await POST(makeReq({ mfaToken: token }))).status).toBe(401)
  })

  // A valid challenge for an account with no key at all: 400 rather than a
  // ceremony with an empty allow-list, which the browser would prompt for and
  // then fail on.
  it('answers 400 when the account has no security key', async () => {
    const { user, passwordHash } = await withHash()
    const token = await signMfaChallenge(user.id, passwordHash)

    const res = await POST(makeReq({ mfaToken: token }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no security key/i)
  })

  it('answers with options for a valid challenge', async () => {
    const { user, passwordHash } = await withHash()
    await db.insert(webauthnCredentials).values({
      userId: user.id,
      credentialId: 'dGVzdC1jcmVkZW50aWFs',
      // base64url text, the way `finishRegistration` stores it.
      publicKey: Buffer.from([1, 2, 3]).toString('base64url'),
      counter: 0,
      transports: ['usb'],
      label: 'Test key',
      backedUp: false,
      deviceType: 'singleDevice',
    })
    const token = await signMfaChallenge(user.id, passwordHash)

    const res = await POST(makeReq({ mfaToken: token }))

    expect(res.status).toBe(200)
    const body = await res.json()
    // The ceremony's own shape, which the browser hands straight to
    // navigator.credentials — including the allow-list that is the whole point
    // of asking the server which keys this account has.
    expect(typeof body.challenge).toBe('string')
    expect(body.rpId).toBeDefined()
    expect(body.allowCredentials).toHaveLength(1)
  })
})
