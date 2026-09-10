import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { insecureTransportRefusal, isLoopback, INSECURE_TRANSPORT_FLAG } from './transport'

/**
 * The gate in front of every outbound GitLab call (#329).
 *
 * `validateWebUrl` rejected `file:` and `gopher:` and then permitted plaintext
 * http to any host on the internet — while each of those calls carries a
 * credential: the trigger token on a pipeline trigger, `PRIVATE-TOKEN` on every
 * list, branch, tree and file read.
 */
const before = process.env[INSECURE_TRANSPORT_FLAG]

beforeEach(() => {
  delete process.env[INSECURE_TRANSPORT_FLAG]
})
afterEach(() => {
  if (before === undefined) delete process.env[INSECURE_TRANSPORT_FLAG]
  else process.env[INSECURE_TRANSPORT_FLAG] = before
})

describe('insecureTransportRefusal', () => {
  it('allows https to any host', () => {
    expect(insecureTransportRefusal('https://gitlab.example.com/api/v4')).toBeNull()
  })

  it('refuses plaintext http to a host that is not loopback', () => {
    const refusal = insecureTransportRefusal('http://gitlab.internal.example.com')
    expect(refusal).toMatch(/plaintext http/i)
    // The message has to name the switch, or the operator's only move is to
    // downgrade the whole deployment by guesswork.
    expect(refusal).toContain(INSECURE_TRANSPORT_FLAG)
    expect(refusal).toContain('gitlab.internal.example.com')
  })

  it.each([
    ['127.0.0.1', 'http://127.0.0.1:8080'],
    ['another 127/8 address', 'http://127.13.9.2:8080'],
    ['localhost', 'http://localhost:8080'],
    ['a .localhost name', 'http://wiremock.localhost:8080'],
    ['bracketed IPv6 loopback', 'http://[::1]:8080'],
  ])('allows plaintext http to loopback (%s)', (_name, url) => {
    // The e2e WireMock speaks http on :8080 and never leaves the machine.
    expect(insecureTransportRefusal(url)).toBeNull()
  })

  it('allows plaintext http elsewhere once the operator sets the flag', () => {
    process.env[INSECURE_TRANSPORT_FLAG] = '1'
    expect(insecureTransportRefusal('http://gitlab.internal.example.com')).toBeNull()
  })

  it('takes only "1" for the flag, not any truthy string', () => {
    // `ALLOW_INSECURE_CI_TRANSPORT=false` must not switch the guard off, which is
    // what a plain truthiness check would do.
    process.env[INSECURE_TRANSPORT_FLAG] = 'false'
    expect(insecureTransportRefusal('http://gitlab.internal.example.com')).toMatch(/plaintext http/i)
  })

  it('refuses a protocol that is neither http nor https, flag or no flag', () => {
    process.env[INSECURE_TRANSPORT_FLAG] = '1'
    expect(insecureTransportRefusal('file:///etc/passwd')).toMatch(/disallowed url protocol/i)
  })

  it('refuses a value that is not a URL at all', () => {
    expect(insecureTransportRefusal('gitlab.example.com')).toMatch(/not a url/i)
  })
})

describe('isLoopback', () => {
  // `evil-localhost.example.com` ends with neither `.localhost` nor `localhost`
  // as a label, and `127.0.0.1.example.com` only starts with the digits.
  it.each([
    'localhost.evil.example.com',
    '127.0.0.1.example.com',
    'notlocalhost',
    '10.0.0.1',
    '0.0.0.0',
  ])('does not mistake %s for loopback', (host) => {
    expect(isLoopback(host)).toBe(false)
  })
})
