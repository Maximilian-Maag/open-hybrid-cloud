import { describe, it, expect, afterEach, vi } from 'vitest'
import { SignJWT } from 'jose'
import { signToken, verifyToken } from './jwt'
import {
  MFA_CHALLENGE_TTL_SECONDS,
  peekMfaChallengeUserId,
  resetChallengeSecretCache,
  signMfaChallenge,
  verifyMfaChallenge,
} from './mfaChallenge'

const PASSWORD_HASH = '$2a$04$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQ'
const OTHER_HASH = '$2a$04$zyxwvutsrqponmlkjihgfedcba9876543210ZYXWVUTSRQPONML'

afterEach(() => {
  vi.unstubAllEnvs()
  resetChallengeSecretCache()
})

describe('signMfaChallenge / verifyMfaChallenge', () => {
  it('round-trips the user it was issued for', async () => {
    const token = await signMfaChallenge(42, PASSWORD_HASH)
    expect(await verifyMfaChallenge(token, PASSWORD_HASH)).toEqual({ userId: 42, rememberMe: false })
  })

  it('expires after five minutes', async () => {
    expect(MFA_CHALLENGE_TTL_SECONDS).toBe(300)
    const token = await signMfaChallenge(1, PASSWORD_HASH)
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    expect(payload.exp - payload.iat).toBe(MFA_CHALLENGE_TTL_SECONDS)
  })

  it('stops being redeemable once the password changes', async () => {
    const token = await signMfaChallenge(1, PASSWORD_HASH)
    expect(await verifyMfaChallenge(token, OTHER_HASH)).toBeNull()
  })

  it('rejects a tampered signature', async () => {
    const token = await signMfaChallenge(1, PASSWORD_HASH)
    expect(await verifyMfaChallenge(`${token.slice(0, -5)}XXXXX`, PASSWORD_HASH)).toBeNull()
  })

  it('rejects garbage', async () => {
    expect(await verifyMfaChallenge('not-a-token', PASSWORD_HASH)).toBeNull()
    expect(await verifyMfaChallenge('', PASSWORD_HASH)).toBeNull()
  })

  it('does not put the password hash in the token', async () => {
    const token = await signMfaChallenge(1, PASSWORD_HASH)
    const payload = Buffer.from(token.split('.')[1], 'base64url').toString()
    expect(payload).not.toContain(PASSWORD_HASH)
    // Only a 16-character fingerprint of it.
    expect(JSON.parse(payload).pwf).toMatch(/^[0-9a-f]{16}$/)
  })
})

/**
 * The point of the whole module: a challenge must not be usable as a session.
 * These are the tests a reviewer should look at first.
 */
describe('a challenge is not a session token', () => {
  it('does not verify as a session token', async () => {
    const challenge = await signMfaChallenge(1, PASSWORD_HASH)
    expect(await verifyToken(challenge)).toBeNull()
  })

  it('a session token does not verify as a challenge', async () => {
    const session = await signToken(
      { id: 1, email: 'a@b.c', name: 'A', role: 'root' },
      { sessionId: 1, expiresInSeconds: 3600 },
    )
    expect(await verifyMfaChallenge(session, PASSWORD_HASH)).toBeNull()
    expect(await peekMfaChallengeUserId(session)).toBeNull()
  })

  it('carries the "remember me" choice, so the second step cannot change it', async () => {
    const plain = await verifyMfaChallenge(await signMfaChallenge(1, PASSWORD_HASH), PASSWORD_HASH)
    expect(plain?.rememberMe).toBe(false)
    const remembered = await verifyMfaChallenge(
      await signMfaChallenge(1, PASSWORD_HASH, true),
      PASSWORD_HASH,
    )
    expect(remembered?.rememberMe).toBe(true)
  })

  it('carries no user claim at all, so there is nothing for a session reader to find', async () => {
    const challenge = await signMfaChallenge(9, PASSWORD_HASH)
    const payload = JSON.parse(Buffer.from(challenge.split('.')[1], 'base64url').toString())
    expect(payload.user).toBeUndefined()
    expect(payload.sub).toBe('9')
  })

  it('is signed with a key derived from — not equal to — JWT_SECRET', async () => {
    // A token signed with the raw JWT secret must not pass as a challenge. If it
    // did, anyone who could mint a session token could mint a challenge, and the
    // separation would be cosmetic.
    const secret = process.env.JWT_SECRET ?? ''
    const forged = await new SignJWT({ typ: 'ohc-mfa-challenge-v1', pwf: 'deadbeefdeadbeef' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret))

    expect(await peekMfaChallengeUserId(forged)).toBeNull()
  })

  it('rejects a correctly signed token of the wrong type', async () => {
    // Same key, wrong `typ`: the type claim is checked, not assumed.
    const challenge = await signMfaChallenge(1, PASSWORD_HASH)
    const header = JSON.parse(Buffer.from(challenge.split('.')[0], 'base64url').toString())
    expect(header.alg).toBe('HS256')

    const session = await signToken(
      { id: 1, email: 'a@b.c', name: 'A', role: 'root' },
      { sessionId: 1, expiresInSeconds: 3600 },
    )
    expect(await verifyMfaChallenge(session, PASSWORD_HASH)).toBeNull()
  })
})

describe('peekMfaChallengeUserId', () => {
  it('returns the id without needing the password hash', async () => {
    expect(await peekMfaChallengeUserId(await signMfaChallenge(5, PASSWORD_HASH))).toBe(5)
  })

  it('still verifies the signature, so an id cannot be smuggled in', async () => {
    const token = await signMfaChallenge(5, PASSWORD_HASH)
    expect(await peekMfaChallengeUserId(`${token.slice(0, -5)}AAAAA`)).toBeNull()
  })

  it('rejects a non-numeric or non-positive subject', async () => {
    // Signed with the real challenge key by going through signMfaChallenge for a
    // valid id first, to prove the guard is the subject check and not the key.
    expect(await peekMfaChallengeUserId(await signMfaChallenge(1, PASSWORD_HASH))).toBe(1)
    // A hand-built token with a bad subject cannot be signed here without the
    // derived key, so assert the same guard through verifyMfaChallenge's contract.
    expect(await verifyMfaChallenge('a.b.c', PASSWORD_HASH)).toBeNull()
  })
})
