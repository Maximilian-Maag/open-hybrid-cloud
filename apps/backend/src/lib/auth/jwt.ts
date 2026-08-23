import { SignJWT, jwtVerify } from 'jose'
import type { SessionUser } from '@open-hybrid-cloud/types'

const ALG = 'HS256'

// Resolve the secret lazily on first use (request time) rather than at module
// load. A module-load throw would fire during `next build` page-data collection,
// where JWT_SECRET is not present — this still fails closed at runtime (an
// empty/short secret makes signing throw and verification return null, so no
// forged token is ever accepted) without breaking the build.
let cachedSecret: Uint8Array | null = null
const getSecret = (): Uint8Array => {
  if (cachedSecret) return cachedSecret
  const rawSecret = process.env.JWT_SECRET ?? ''
  if (rawSecret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long')
  }
  cachedSecret = new TextEncoder().encode(rawSecret)
  return cachedSecret
}

/**
 * What a session token says.
 *
 * `sid` is the `sessions` row this token was issued for (issue #37). It is the
 * whole reason a token can be revoked: the signature only proves we minted the
 * token, and nothing about a signature can ever be un-minted. The row can.
 */
export interface TokenClaims {
  user: SessionUser
  sid: number
}

export interface SignTokenOptions {
  /** `sessions.id` this token belongs to. */
  sessionId: number
  /**
   * Lifetime in seconds. Passed in rather than fixed here because it is now a
   * per-session decision — 8 h normally, up to 30 days with "remember me" — and
   * the value has to be the same one written to `sessions.expires_at`.
   */
  expiresInSeconds: number
}

export const signToken = (user: SessionUser, opts: SignTokenOptions): Promise<string> =>
  new SignJWT({ user, sid: opts.sessionId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + opts.expiresInSeconds)
    .sign(getSecret())

/**
 * Verify the signature and read the claims back.
 *
 * A token with no usable `sid` is rejected outright rather than treated as a
 * session-less token that still works. Only the holder of JWT_SECRET can mint
 * one, so in practice these are tokens we issued before #37 shipped — and
 * accepting them would mean revocation quietly did nothing for everyone still
 * carrying one. "Revocable except for the next day" is not revocable.
 */
export const verifyToken = async (token: string): Promise<TokenClaims | null> => {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALG] })
    const claims = payload as unknown as Partial<TokenClaims>
    if (!claims.user || typeof claims.sid !== 'number' || !Number.isInteger(claims.sid)) return null
    return { user: claims.user, sid: claims.sid }
  } catch {
    return null
  }
}
