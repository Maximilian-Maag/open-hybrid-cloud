import { describe, it, expect, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { clientIp, clientUserAgent, USER_AGENT_MAX_LENGTH } from './requestMeta'

/**
 * `X-Forwarded-For` is attacker-controlled unless a proxy we trust sets it, so
 * the cases below are written against what an attacker gets out of each
 * branch — the login rate limiter buckets on this value, and a session list
 * shows it to the account's owner as "where you signed in from".
 */
const req = (headers: Record<string, string>): NextRequest =>
  ({ headers: new Headers(headers) }) as NextRequest

const original = process.env.TRUST_PROXY
afterEach(() => {
  if (original === undefined) delete process.env.TRUST_PROXY
  else process.env.TRUST_PROXY = original
})

describe('clientIp — only when a proxy is trusted', () => {
  it('ignores the header when TRUST_PROXY is unset', () => {
    // The dangerous default has to be the safe one: unset means "no proxy", so
    // a header anyone can send must not become the rate-limit bucket.
    delete process.env.TRUST_PROXY
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }))).toBeNull()
  })

  it('ignores the header when TRUST_PROXY is some other value', () => {
    // Opt-in is exactly '1' or 'true'; anything else is not a yes.
    process.env.TRUST_PROXY = 'yes'
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }))).toBeNull()
  })

  it.each(['1', 'true'])('reads the header when TRUST_PROXY is %j', (value) => {
    process.env.TRUST_PROXY = value
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }))).toBe('1.2.3.4')
  })

  it('takes the FIRST hop, which is the client', () => {
    // The chain is client, proxy, proxy — taking the last records our own
    // load balancer as the user's address for every session in the list.
    process.env.TRUST_PROXY = '1'
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 10.0.0.2' }))).toBe('1.2.3.4')
  })

  it('trims the surrounding space the header format allows', () => {
    process.env.TRUST_PROXY = '1'
    expect(clientIp(req({ 'x-forwarded-for': '  1.2.3.4  , 10.0.0.1' }))).toBe('1.2.3.4')
  })

  it('is null when the header is absent even with a trusted proxy', () => {
    process.env.TRUST_PROXY = '1'
    expect(clientIp(req({}))).toBeNull()
  })

  it('is null rather than empty when the header is blank', () => {
    // An empty string stored as an address reads as a known location in the
    // session list; null is what "we do not know" looks like there.
    process.env.TRUST_PROXY = '1'
    expect(clientIp(req({ 'x-forwarded-for': '   ' }))).toBeNull()
  })
})

describe('clientUserAgent', () => {
  it('returns the header as sent', () => {
    expect(clientUserAgent(req({ 'user-agent': 'Mozilla/5.0' }))).toBe('Mozilla/5.0')
  })

  it('is null when absent', () => {
    expect(clientUserAgent(req({}))).toBeNull()
  })

  it('is null rather than empty when the header is only whitespace', () => {
    // Worth knowing what this does and does not prove: `Headers` trims on the
    // way in, so it arrives as '' and the `.trim()` in the code never sees the
    // spaces. The behaviour is still the one we want asserted.
    expect(clientUserAgent(req({ 'user-agent': '   ' }))).toBeNull()
  })

  it('truncates a client that sends kilobytes', () => {
    // It is displayed in a table cell and stored on every session row.
    const ua = 'x'.repeat(USER_AGENT_MAX_LENGTH + 50)
    expect(clientUserAgent(req({ 'user-agent': ua }))).toHaveLength(USER_AGENT_MAX_LENGTH)
  })

  it('leaves a header exactly at the cap alone', () => {
    // Off-by-one here silently shortens every real User-Agent at the boundary.
    const ua = 'y'.repeat(USER_AGENT_MAX_LENGTH)
    expect(clientUserAgent(req({ 'user-agent': ua }))).toBe(ua)
  })
})
