import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { POST } from './route'
import { POST as LOGIN } from '../route'
import { createUser, currentTotpCode, enrollTotp } from '@/test/helpers'
import { verifyToken } from '@/lib/auth/jwt'
import { db } from '@/lib/db/client'
import { sessions, users, userTotp } from '@/lib/db/schema'
import { MFA_MAX_FAILED_ATTEMPTS } from '@/lib/services/twoFactor'

const makeRequest = (url: string, body: unknown) =>
  new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const mfaRequest = (body: unknown) => makeRequest('http://localhost/api/auth/login/mfa', body)

/**
 * Each test uses a fresh random email: the login route's rate-limit buckets live
 * in a module-level Map that persists for the whole file.
 */
let seq = 0
const freshEmail = () => `mfa-${Date.now()}-${++seq}@test.dev`

/** Run the password step and return the challenge it hands out. */
const passwordStep = async (email: string, password: string) => {
  const res = await LOGIN(makeRequest('http://localhost/api/auth/login', { email, password }))
  return { status: res.status, body: await res.json() }
}

describe('POST /api/auth/login with a second factor enrolled', () => {
  it('returns a challenge and NO session token', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    await enrollTotp(u.id)

    const { status, body } = await passwordStep(email, 'pw-correct')
    expect(status).toBe(200)
    expect(body.mfaRequired).toBe(true)
    expect(body.mfaToken).toBeTruthy()
    expect(body.expiresIn).toBe(300)
    // The absence of these is the acceptance criterion.
    expect(body.token).toBeUndefined()
    expect(body.user).toBeUndefined()
  })

  it('hands out a challenge that is not itself a usable session token', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    await enrollTotp(u.id)

    const { body } = await passwordStep(email, 'pw-correct')
    expect(await verifyToken(body.mfaToken)).toBeNull()
  })

  it('still refuses a wrong password before any challenge is minted', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    await enrollTotp(u.id)

    const { status, body } = await passwordStep(email, 'pw-wrong')
    expect(status).toBe(401)
    expect(body.mfaToken).toBeUndefined()
  })

  it('leaves an account with no factor on the one-step path', async () => {
    const email = freshEmail()
    await createUser({ email, password: 'pw-correct' })
    const { status, body } = await passwordStep(email, 'pw-correct')
    expect(status).toBe(200)
    expect(body.mfaRequired).toBeUndefined()
    expect(body.token).toBeTruthy()
  })
})

describe('POST /api/auth/login/mfa', () => {
  it('trades a challenge plus a valid code for a session', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct', role: 'root' })
    const secret = await enrollTotp(u.id)

    const { body: challenge } = await passwordStep(email, 'pw-correct')
    const res = await POST(mfaRequest({ mfaToken: challenge.mfaToken, code: currentTotpCode(secret) }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.user).toMatchObject({ id: u.id, email, role: 'root' })
    const claims = await verifyToken(body.token)
    expect(claims?.user).toMatchObject({ id: u.id, email, role: 'root' })
    // Minted through createSession like every other sign-in, so it is revocable
    // (#37) — the token names a live row, and that row belongs to this user.
    expect(claims?.sid).toEqual(expect.any(Number))
    const rows = await db.select().from(sessions).where(eq(sessions.userId, u.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(claims?.sid)
    expect(rows[0].revokedAt).toBeNull()
  })

  /**
   * The invariant the two features have to preserve together (#36 + #37): the
   * password step of an account with a second factor opens NOTHING. A revocation
   * check cannot save you from a session that should never have existed.
   */
  it('writes no session row until the code has been verified', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    const secret = await enrollTotp(u.id)

    const { body: challenge } = await passwordStep(email, 'pw-correct')
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0)

    // A wrong code does not open one either.
    await POST(mfaRequest({ mfaToken: challenge.mfaToken, code: '000000' }))
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0)

    const res = await POST(mfaRequest({ mfaToken: challenge.mfaToken, code: currentTotpCode(secret) }))
    expect(res.status).toBe(200)
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(1)
  })

  it('keeps the "remember me" lifetime chosen at the password step', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    const secret = await enrollTotp(u.id)

    const res = await LOGIN(
      makeRequest('http://localhost/api/auth/login', { email, password: 'pw-correct', rememberMe: true }),
    )
    const challenge = await res.json()
    expect(challenge.mfaRequired).toBe(true)

    expect(
      (await POST(mfaRequest({ mfaToken: challenge.mfaToken, code: currentTotpCode(secret) }))).status,
    ).toBe(200)

    const [row] = await db.select().from(sessions).where(eq(sessions.userId, u.id))
    // Far beyond the 8 h default: the choice survived the second step.
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(24 * 60 * 60 * 1000)
  })

  it('rejects a wrong code and issues nothing', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    await enrollTotp(u.id)

    const { body: challenge } = await passwordStep(email, 'pw-correct')
    const res = await POST(mfaRequest({ mfaToken: challenge.mfaToken, code: '000000' }))
    expect(res.status).toBe(400)
    expect((await res.json()).token).toBeUndefined()
  })

  it('rejects a made-up challenge', async () => {
    const res = await POST(mfaRequest({ mfaToken: 'not-a-token', code: '000000' }))
    expect(res.status).toBe(401)
  })

  it('rejects a session token presented as a challenge', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    // A user with no factor, so the login hands out a real session token.
    const { body } = await passwordStep(email, 'pw-correct')
    await enrollTotp(u.id)

    const res = await POST(mfaRequest({ mfaToken: body.token, code: '000000' }))
    expect(res.status).toBe(401)
  })

  it('refuses a challenge issued before the password changed', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    const secret = await enrollTotp(u.id)
    const { body: challenge } = await passwordStep(email, 'pw-correct')

    await db.update(users).set({ passwordHash: '$2a$04$something.else.entirely.here.ok' }).where(eq(users.id, u.id))

    const res = await POST(mfaRequest({ mfaToken: challenge.mfaToken, code: currentTotpCode(secret) }))
    expect(res.status).toBe(401)
  })

  it('refuses a challenge for an account that has since been deactivated', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    const secret = await enrollTotp(u.id)
    const { body: challenge } = await passwordStep(email, 'pw-correct')

    await db.update(users).set({ active: false }).where(eq(users.id, u.id))

    const res = await POST(mfaRequest({ mfaToken: challenge.mfaToken, code: currentTotpCode(secret) }))
    expect(res.status).toBe(401)
  })

  it('cannot be reused: the code is spent once the session is issued', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    const secret = await enrollTotp(u.id)
    const code = currentTotpCode(secret)

    const { body: first } = await passwordStep(email, 'pw-correct')
    expect((await POST(mfaRequest({ mfaToken: first.mfaToken, code }))).status).toBe(200)

    // Same challenge, same code — the replay guard, not the challenge, stops it.
    const replay = await POST(mfaRequest({ mfaToken: first.mfaToken, code }))
    expect(replay.status).toBe(400)
    expect((await replay.json()).error).toMatch(/already been used/)
  })

  it('accepts a recovery code when the authenticator is gone', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    await enrollTotp(u.id, { recoveryCodes: ['ABCDE-FGHJK-LMNPQ-RSTUV'] })

    const { body: challenge } = await passwordStep(email, 'pw-correct')
    const res = await POST(
      mfaRequest({ mfaToken: challenge.mfaToken, code: 'ABCDE-FGHJK-LMNPQ-RSTUV' }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).token).toBeTruthy()
  })

  it('answers 429 once the factor locks, and stops issuing sessions', async () => {
    const email = freshEmail()
    const u = await createUser({ email, password: 'pw-correct' })
    const secret = await enrollTotp(u.id)
    const { body: challenge } = await passwordStep(email, 'pw-correct')

    let last = 0
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i++) {
      last = (await POST(mfaRequest({ mfaToken: challenge.mfaToken, code: '000000' }))).status
    }
    expect(last).toBe(429)

    const withCorrectCode = await POST(
      mfaRequest({ mfaToken: challenge.mfaToken, code: currentTotpCode(secret) }),
    )
    expect(withCorrectCode.status).toBe(429)
    expect((await withCorrectCode.json()).token).toBeUndefined()

    expect((await db.select().from(userTotp).where(eq(userTotp.userId, u.id)))[0].lockedUntil).not.toBeNull()
  })

  it('rejects a malformed body', async () => {
    for (const body of [{}, { mfaToken: '' }, { code: '123456' }, { mfaToken: 'x', code: '' }]) {
      const res = await POST(mfaRequest(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })
})
