import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'
import { signToken, verifyToken } from './jwt'
import type { SessionUser } from '@open-hybrid-cloud/types'

const user: SessionUser = { id: 1, email: 'test@example.com', name: 'Test User', role: 'admin' }

const sign = (u: SessionUser = user, sessionId = 42, expiresInSeconds = 3600) =>
  signToken(u, { sessionId, expiresInSeconds })

describe('signToken / verifyToken', () => {
  it('round-trips a user payload', async () => {
    const token = await sign()
    const result = await verifyToken(token)
    expect(result?.user).toMatchObject(user)
  })

  it('carries the session id the token belongs to', async () => {
    // Without `sid` there is nothing to revoke: the signature only proves we
    // minted the token, and a signature cannot be un-minted (#37).
    const result = await verifyToken(await sign(user, 987))
    expect(result?.sid).toBe(987)
  })

  it('honours the lifetime it is given', async () => {
    // 8 h normally, 30 days with "remember me" — the caller decides, because the
    // same number has to go into sessions.expires_at.
    const payload = (token: string) =>
      JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { exp: number }

    const short = payload(await sign(user, 1, 60))
    const long = payload(await sign(user, 1, 30 * 24 * 60 * 60))
    expect(long.exp - short.exp).toBeGreaterThan(29 * 24 * 60 * 60)
  })

  it('returns null for a garbage string', async () => {
    expect(await verifyToken('not-a-token')).toBeNull()
  })

  it('returns null for a tampered signature', async () => {
    const token = await sign()
    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(await verifyToken(tampered)).toBeNull()
  })

  it('refuses a validly signed token that carries no session id', async () => {
    // The shape of every token issued before #37. Only the holder of JWT_SECRET
    // can mint one, so these are ours — but accepting them would mean revocation
    // quietly did nothing for everyone still carrying one, for as long as it
    // lived. "Revocable except for the next day" is not revocable.
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '')
    const legacy = await new SignJWT({ user })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('24h')
      .sign(secret)

    expect(await verifyToken(legacy)).toBeNull()
  })

  it('refuses a session id that is not a whole number', async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '')
    for (const sid of [1.5, '7', null]) {
      const token = await new SignJWT({ user, sid })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('1h')
        .sign(secret)
      expect(await verifyToken(token), `sid=${String(sid)}`).toBeNull()
    }
  })

  it('produces different tokens for different users', async () => {
    expect(await sign(user)).not.toBe(await sign({ ...user, id: 2 }))
  })

  it('preserves all user fields', async () => {
    const rootUser: SessionUser = { id: 99, email: 'root@example.com', name: 'Root', role: 'root' }
    expect((await verifyToken(await sign(rootUser)))?.user).toMatchObject(rootUser)
  })
})
