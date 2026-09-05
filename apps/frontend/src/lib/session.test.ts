import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  REMEMBER_ME_SESSION_MAX_AGE_SECONDS,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  apiTokenExpiry,
  isApiTokenExpired,
  expiredLoginUrl,
} from './session'

/** A JWT-shaped string with the given payload — signature irrelevant, it is never verified here. */
const tokenWith = (payload: unknown): string => {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${b64}.not-a-real-signature`
}

describe('apiTokenExpiry', () => {
  it('reads the exp claim of the backend token', () => {
    expect(apiTokenExpiry(tokenWith({ sub: '1', exp: 1_800_000_000 }))).toBe(1_800_000_000)
  })

  it('survives base64url payloads containing - and _', () => {
    // A padding-free payload with URL-safe characters is the normal case, not an
    // edge one: `atob` rejects it unless it is normalised first.
    const token = tokenWith({ sub: '1', email: 'a+b/c@example.com', exp: 1_700_000_000 })
    expect(apiTokenExpiry(token)).toBe(1_700_000_000)
  })

  it('returns null rather than guessing when the token cannot be read', () => {
    expect(apiTokenExpiry('')).toBeNull()
    expect(apiTokenExpiry('not-a-jwt')).toBeNull()
    expect(apiTokenExpiry('header.@@not-base64@@.sig')).toBeNull()
    expect(apiTokenExpiry(tokenWith({ sub: '1' }))).toBeNull()
    expect(apiTokenExpiry(tokenWith({ exp: 'soon' }))).toBeNull()
  })
})

describe('isApiTokenExpired', () => {
  const now = 1_700_000_000_000 // ms

  it('is false when no expiry is known', () => {
    // A session issued before the expiry was recorded, or a token whose claims
    // could not be read. The backend still gets to decide; guessing "expired"
    // here would sign people out of working sessions.
    expect(isApiTokenExpired(undefined, now)).toBe(false)
    expect(isApiTokenExpired(null, now)).toBe(false)
  })

  it('is false while the token still has real time left', () => {
    expect(isApiTokenExpired(now / 1000 + 3600, now)).toBe(false)
  })

  it('is true once the expiry has passed', () => {
    expect(isApiTokenExpired(now / 1000 - 1, now)).toBe(true)
  })

  it('treats the last few seconds as expired, for clock skew', () => {
    // Starting a page render with a token that dies mid-flight buys nothing.
    expect(isApiTokenExpired(now / 1000 + 5, now)).toBe(true)
    expect(isApiTokenExpired(now / 1000 + 31, now)).toBe(false)
  })
})

describe('expiredLoginUrl', () => {
  it('flags the reason and keeps the way back', () => {
    expect(expiredLoginUrl('/orders/7')).toBe('/login?expired=1&callbackUrl=%2Forders%2F7')
  })

  it('does not send the login page back to itself', () => {
    expect(expiredLoginUrl('/login')).toBe('/login?expired=1')
  })
})

describe('session lifetimes', () => {
  it('mirrors the backend: 8 h by default, 30 days with remember me', () => {
    // These are copies of DEFAULT_SESSION_TTL_SECONDS and
    // REMEMBER_ME_SESSION_TTL_SECONDS in the backend's lib/auth/sessions.ts. The
    // backend decides; this side quotes it, so the two must not drift.
    expect(DEFAULT_SESSION_MAX_AGE_SECONDS).toBe(8 * 60 * 60)
    expect(REMEMBER_ME_SESSION_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60)
  })

  it('sizes the cookie to the longest session, never shorter', () => {
    // #103 was a cookie that outlived its token. The reverse — a cookie that dies
    // before its session — would sign a "remember me" user out after 8 h, which is
    // the same bug pointing the other way. So the cookie takes the ceiling, and
    // what actually ends a session is the token's own exp (checked below and in
    // the middleware) plus the 401 path for a revoked one (#37).
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(REMEMBER_ME_SESSION_MAX_AGE_SECONDS)
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBeGreaterThanOrEqual(DEFAULT_SESSION_MAX_AGE_SECONDS)
  })

  it('still ends a short session on time even though the cookie is long', () => {
    // The guarantee that replaced #103's shared constant: per-session and exact,
    // read off the token the session is actually carrying.
    const now = 1_700_000_000_000
    // Named for what it is: isApiTokenExpired takes an `exp` claim in seconds,
    // not an issued-at. Derived from the issue time so the arithmetic is visible
    // rather than a bare offset that reads like the wrong thing.
    const issuedAt = now / 1000 - 9 * 60 * 60
    const exp = issuedAt + 8 * 60 * 60
    expect(isApiTokenExpired(exp, now)).toBe(true)
  })
})
