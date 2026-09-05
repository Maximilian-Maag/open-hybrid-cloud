import { describe, it, expect, afterEach, vi } from 'vitest'
import { resolveRp } from './webauthnConfig'

/**
 * The one part of WebAuthn that works perfectly on localhost and breaks every key
 * on the deployed instance (issue #197, part 2).
 *
 * A credential is scoped to the Relying Party ID, and the assertion is signed
 * over the origin. The browser refuses a ceremony whose RP ID does not match the
 * page, and the server refuses an assertion whose origin does not match — so a
 * mistyped variable produces a feature that silently never works for anyone,
 * which is the shape of #196. Failing loudly at first use, naming the variable,
 * is worth more than any amount of documentation.
 */
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveRp', () => {
  it('falls back to localhost in development, so a fresh clone just works', () => {
    vi.stubEnv('WEBAUTHN_RP_ID', '')
    vi.stubEnv('WEBAUTHN_RP_ORIGIN', '')
    vi.stubEnv('NODE_ENV', 'test')

    const rp = resolveRp('Acme')
    expect(rp.rpId).toBe('localhost')
    expect(rp.origins).toContain('http://localhost:3000')
    expect(rp.rpName).toBe('Acme')
  })

  it('refuses to start in production without them', () => {
    vi.stubEnv('WEBAUTHN_RP_ID', '')
    vi.stubEnv('WEBAUTHN_RP_ORIGIN', '')
    vi.stubEnv('NODE_ENV', 'production')

    // Issuing credentials against a guessed RP ID would mint things nobody can
    // ever use, and the failure would land on users rather than the operator.
    expect(() => resolveRp('Acme')).toThrow(/WEBAUTHN_RP_ID and WEBAUTHN_RP_ORIGIN must be set/)
  })

  it('accepts a domain and a matching origin', () => {
    vi.stubEnv('WEBAUTHN_RP_ID', 'portal.example.com')
    vi.stubEnv('WEBAUTHN_RP_ORIGIN', 'https://portal.example.com')

    const rp = resolveRp('Acme')
    expect(rp.rpId).toBe('portal.example.com')
    expect(rp.origins).toEqual(['https://portal.example.com'])
  })

  it('takes several origins, for a portal reachable on more than one hostname', () => {
    vi.stubEnv('WEBAUTHN_RP_ID', 'example.com')
    vi.stubEnv('WEBAUTHN_RP_ORIGIN', 'https://portal.example.com, https://internal.example.com/')

    // The trailing slash goes: the browser sends a bare origin, and a mismatch
    // here fails at verification with nothing to say why.
    expect(resolveRp('Acme').origins).toEqual([
      'https://portal.example.com',
      'https://internal.example.com',
    ])
  })

  it.each([
    ['https://portal.example.com'],
    ['portal.example.com:443'],
    ['portal.example.com/login'],
  ])('rejects %s as an RP ID, because it is not a bare domain', (value) => {
    vi.stubEnv('WEBAUTHN_RP_ID', value)
    vi.stubEnv('WEBAUTHN_RP_ORIGIN', 'https://portal.example.com')

    // The browser's own refusal names neither the variable nor the file.
    expect(() => resolveRp('Acme')).toThrow(/must be a bare domain/)
  })

  it('rejects an origin with no scheme', () => {
    vi.stubEnv('WEBAUTHN_RP_ID', 'portal.example.com')
    vi.stubEnv('WEBAUTHN_RP_ORIGIN', 'portal.example.com')

    expect(() => resolveRp('Acme')).toThrow(/Include the scheme/)
  })

  it('rejects an origin the RP ID does not cover', () => {
    // The credential would be scoped to a domain the page does not belong to, and
    // could never be used. The browser enforces this too — by refusing the
    // ceremony, at every user, forever.
    vi.stubEnv('WEBAUTHN_RP_ID', 'portal.example.com')
    vi.stubEnv('WEBAUTHN_RP_ORIGIN', 'https://evil.example.net')

    expect(() => resolveRp('Acme')).toThrow(/is not "portal.example.com" or a subdomain/)
  })

  it('accepts a subdomain of the RP ID', () => {
    // The point of setting RP ID to the parent: one credential works across
    // subdomains.
    vi.stubEnv('WEBAUTHN_RP_ID', 'example.com')
    vi.stubEnv('WEBAUTHN_RP_ORIGIN', 'https://portal.example.com')

    expect(resolveRp('Acme').rpId).toBe('example.com')
  })

  it('does not accept a domain that merely ends with the RP ID', () => {
    // `notexample.com` ends with `example.com` as a string and is a different
    // registrable domain; a suffix check without the dot would have let it pass.
    vi.stubEnv('WEBAUTHN_RP_ID', 'example.com')
    vi.stubEnv('WEBAUTHN_RP_ORIGIN', 'https://notexample.com')

    expect(() => resolveRp('Acme')).toThrow(/is not "example.com" or a subdomain/)
  })
})
