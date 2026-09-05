import { createHash, createHmac } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

/**
 * The token handed out between the password check and the second factor.
 *
 * The requirement is that the backend must not issue a *usable* token before the
 * second factor. A challenge token is therefore not a session token with a flag
 * on it — it is signed with a different key, so it cannot verify as a session
 * token even if `verifyToken` were later made more permissive. That is the whole
 * point of deriving `getChallengeSecret` from `JWT_SECRET` through an HMAC
 * instead of reusing it: an accidental cross-acceptance becomes impossible
 * rather than merely unlikely.
 *
 * It also carries no `user` claim at all, only the user id — so the payload
 * shape `verifyToken` reads is not even present.
 */

const ALG = 'HS256'

/** Five minutes: long enough to fetch a phone, short enough to be uninteresting. */
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60

const CHALLENGE_TYPE = 'ohc-mfa-challenge-v1'

let cachedSecret: Uint8Array | null = null

/**
 * Resolved lazily for the same reason as the session secret: a module-load throw
 * would fire during `next build`, where `JWT_SECRET` is absent.
 */
const getChallengeSecret = (): Uint8Array => {
  if (cachedSecret) return cachedSecret
  const rawSecret = process.env.JWT_SECRET ?? ''
  if (rawSecret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long')
  }
  cachedSecret = new Uint8Array(
    createHmac('sha256', rawSecret).update(CHALLENGE_TYPE).digest(),
  )
  return cachedSecret
}

/** Test-only: forget the derived key so a test can change `JWT_SECRET`. */
export const resetChallengeSecretCache = (): void => {
  cachedSecret = null
}

/**
 * A short fingerprint of the password hash the challenge was issued against.
 *
 * Included so a challenge cannot outlive the credential that earned it: change
 * the password (or have an operator reset it) and any challenge already in
 * flight stops being redeemable. Truncated because it only needs to detect
 * change, and a full hash of the bcrypt hash in a token that goes to the browser
 * would be handing out material to attack offline.
 */
const credentialFingerprint = (passwordHash: string): string =>
  createHash('sha256').update(passwordHash).digest('hex').slice(0, 16)

export interface MfaChallenge {
  userId: number
  /**
   * The "remember me" choice from the password step (issue #37).
   *
   * It travels in the challenge rather than in the second step's request body
   * because it is decided at the password step and only the server can write it
   * here — so the request that redeems the challenge cannot promote an ordinary
   * 8 h session into a 30-day one.
   */
  rememberMe: boolean
}

/** Sign a challenge for a user whose password has just been verified. */
export const signMfaChallenge = (
  userId: number,
  passwordHash: string,
  rememberMe = false,
): Promise<string> =>
  new SignJWT({
    typ: CHALLENGE_TYPE,
    pwf: credentialFingerprint(passwordHash),
    ...(rememberMe ? { rem: true } : {}),
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${MFA_CHALLENGE_TTL_SECONDS}s`)
    .sign(getChallengeSecret())

/**
 * Verify a challenge and return the user it was issued for.
 *
 * Returns null for anything at all suspect — expired, wrong key, wrong type,
 * unparseable subject, or issued against a password that has since changed.
 * The caller must treat null as "start again from the password".
 */
export const verifyMfaChallenge = async (
  token: string,
  passwordHash: string,
): Promise<MfaChallenge | null> => {
  try {
    const { payload } = await jwtVerify(token, getChallengeSecret(), { algorithms: [ALG] })
    if (payload.typ !== CHALLENGE_TYPE) return null
    if (payload.pwf !== credentialFingerprint(passwordHash)) return null
    const userId = Number(payload.sub)
    if (!Number.isSafeInteger(userId) || userId <= 0) return null
    return { userId, rememberMe: payload.rem === true }
  } catch {
    return null
  }
}

/**
 * The user id in a challenge, without checking the credential fingerprint.
 *
 * Needed only to look the user up so their password hash can be fetched for the
 * real check above. It still verifies the signature and expiry, so it cannot be
 * used to smuggle an arbitrary id in — but it is not on its own sufficient to
 * authenticate anyone, and nothing outside `verifySecondFactorWithChallenge`
 * should call it.
 */
export const peekMfaChallengeUserId = async (token: string): Promise<number | null> => {
  try {
    const { payload } = await jwtVerify(token, getChallengeSecret(), { algorithms: [ALG] })
    if (payload.typ !== CHALLENGE_TYPE) return null
    const userId = Number(payload.sub)
    return Number.isSafeInteger(userId) && userId > 0 ? userId : null
  } catch {
    return null
  }
}
