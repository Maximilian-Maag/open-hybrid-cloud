import { describe, it, expect } from 'vitest'
import {
  API_TOKEN_MAX_AGE_SECONDS,
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

describe('API_TOKEN_MAX_AGE_SECONDS', () => {
  it('matches the 24h the backend signs its tokens for', () => {
    // The whole point of #103: if these two lifetimes drift apart again, the
    // cookie outlives the token and the "logged in with no data" state is back.
    expect(API_TOKEN_MAX_AGE_SECONDS).toBe(86_400)
  })
})
