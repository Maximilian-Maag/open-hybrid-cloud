/**
 * When the backend token dies, and how everything finds out.
 *
 * Two clocks used to run independently: the NextAuth cookie (30 days by default)
 * and the backend JWT it carries as `apiToken` (24 h, see the backend's
 * `lib/auth/jwt.ts`). For the 29 days in between, the cookie said "signed in"
 * while every API call came back 401 — a page that looks logged in, holds no
 * data, and explains nothing (issue #103).
 *
 * So the two are pinned together: `API_TOKEN_MAX_AGE_SECONDS` is the NextAuth
 * session lifetime as well, and the token's own `exp` is carried on the session so
 * the middleware can refuse a request before it is made. A 401 that still gets
 * through — a rotated signing secret, a revoked session (#37), clock skew — is
 * handled at the point of the failed call, in `lib/api.ts`.
 */

/**
 * How long the backend signs its tokens for. Must match the backend's
 * `signToken` (`.setExpirationTime('24h')`); if that changes, this changes.
 */
export const API_TOKEN_MAX_AGE_SECONDS = 24 * 60 * 60

/**
 * Seconds of slack before an `exp` counts as past.
 *
 * A token with two seconds left is not worth starting a page render with, and a
 * little clock skew between the frontend and backend containers should not be the
 * difference between a rendered page and a 401.
 */
const EXPIRY_SKEW_SECONDS = 30

/**
 * The `exp` claim of a JWT, without verifying it.
 *
 * Deliberately unverified: this is our own token on its way back to the backend,
 * which validates it properly on every request. Reading the claim here only
 * decides whether it is worth trying — treating it as an authority would be a
 * mistake, treating it as a hint is what stops the pointless 401.
 *
 * Uses `atob` rather than `Buffer`, because the middleware runs in the Edge
 * runtime where `Buffer` does not exist.
 */
export const apiTokenExpiry = (token: string): number | null => {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const claims: unknown = JSON.parse(atob(padded))
    const exp = (claims as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null
  } catch {
    // A token we cannot read is not a token we should act on: say "no expiry
    // known" and let the backend be the one to reject it.
    return null
  }
}

/**
 * Is this session's backend token past its expiry?
 *
 * `undefined`/`null` means "no expiry recorded" — a session issued before this
 * existed, or a token whose claims could not be read. Those are treated as *not*
 * expired on purpose: the backend still gets to decide, and the 401 path catches
 * it. Guessing "expired" here would sign people out of working sessions.
 */
export const isApiTokenExpired = (exp: number | null | undefined, nowMs: number = Date.now()): boolean =>
  typeof exp === 'number' && exp * 1000 <= nowMs + EXPIRY_SKEW_SECONDS * 1000

/** Where an ended session sends you, keeping the way back. */
export const expiredLoginUrl = (pathname: string): string => {
  const params = new URLSearchParams({ expired: '1' })
  if (pathname && pathname !== '/login') params.set('callbackUrl', pathname)
  return `/login?${params.toString()}`
}
