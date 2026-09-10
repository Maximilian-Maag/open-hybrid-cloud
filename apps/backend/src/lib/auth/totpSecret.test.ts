import { describe, it, expect, afterEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  decryptTotpSecret,
  encryptTotpSecret,
  isEncryptedTotpSecret,
  resetTotpKeyCache,
} from './totpSecret'
import { generateTotpSecret } from './totp'

afterEach(() => {
  vi.unstubAllEnvs()
  resetTotpKeyCache()
})

describe('encryptTotpSecret / decryptTotpSecret', () => {
  it('round-trips a secret', () => {
    const secret = generateTotpSecret()
    const envelope = encryptTotpSecret(secret, 7)
    expect(decryptTotpSecret(envelope, 7).equals(secret)).toBe(true)
  })

  it('never stores the secret in the clear', () => {
    const secret = generateTotpSecret()
    const envelope = encryptTotpSecret(secret, 1)
    expect(envelope).not.toContain(secret.toString('base64url'))
    expect(envelope).not.toContain(secret.toString('hex'))
    expect(envelope).not.toContain(secret.toString('base64'))
  })

  it('produces a different envelope every time, so equal secrets are not equal ciphertexts', () => {
    const secret = generateTotpSecret()
    const seen = new Set(Array.from({ length: 20 }, () => encryptTotpSecret(secret, 1)))
    expect(seen.size).toBe(20)
  })

  it('is versioned so a future format can be told apart', () => {
    const envelope = encryptTotpSecret(generateTotpSecret(), 1)
    expect(envelope.startsWith('v1.')).toBe(true)
    expect(isEncryptedTotpSecret(envelope)).toBe(true)
    expect(isEncryptedTotpSecret('GEZDGNBVGY3TQOJQ')).toBe(false)
  })

  it('refuses a row copied onto another user (the AAD binds it)', () => {
    const envelope = encryptTotpSecret(generateTotpSecret(), 7)
    expect(() => decryptTotpSecret(envelope, 8)).toThrow()
  })

  it('refuses a tampered ciphertext rather than returning different bytes', () => {
    const secret = generateTotpSecret()
    const parts = encryptTotpSecret(secret, 1).split('.')
    const ciphertext = Buffer.from(parts[2], 'base64url')
    ciphertext[0] ^= 0xff
    parts[2] = ciphertext.toString('base64url')
    expect(() => decryptTotpSecret(parts.join('.'), 1)).toThrow()
  })

  it('refuses a tampered auth tag', () => {
    const parts = encryptTotpSecret(generateTotpSecret(), 1).split('.')
    const tag = Buffer.from(parts[3], 'base64url')
    tag[0] ^= 0xff
    parts[3] = tag.toString('base64url')
    expect(() => decryptTotpSecret(parts.join('.'), 1)).toThrow()
  })

  it('refuses a malformed envelope instead of throwing something unreadable', () => {
    for (const bad of ['', 'v1', 'v1.a.b', 'v2.a.b.c', 'v1.a.b.c.d', 'not-an-envelope']) {
      expect(() => decryptTotpSecret(bad, 1), bad).toThrow(/Malformed TOTP secret envelope/)
    }
  })

  it('refuses an envelope whose IV or tag is the wrong length', () => {
    const parts = encryptTotpSecret(generateTotpSecret(), 1).split('.')
    expect(() =>
      decryptTotpSecret([parts[0], Buffer.alloc(8).toString('base64url'), parts[2], parts[3]].join('.'), 1),
    ).toThrow(/Malformed/)
    expect(() =>
      decryptTotpSecret([parts[0], parts[1], parts[2], Buffer.alloc(8).toString('base64url')].join('.'), 1),
    ).toThrow(/Malformed/)
  })

  it('cannot be decrypted with a different key', () => {
    vi.stubEnv('TOTP_ENCRYPTION_KEY', randomBytes(32).toString('hex'))
    resetTotpKeyCache()
    const envelope = encryptTotpSecret(generateTotpSecret(), 1)

    vi.stubEnv('TOTP_ENCRYPTION_KEY', randomBytes(32).toString('hex'))
    resetTotpKeyCache()
    expect(() => decryptTotpSecret(envelope, 1)).toThrow()
  })
})

describe('key resolution', () => {
  it('accepts a hex TOTP_ENCRYPTION_KEY', () => {
    vi.stubEnv('TOTP_ENCRYPTION_KEY', randomBytes(32).toString('hex'))
    resetTotpKeyCache()
    const secret = generateTotpSecret()
    expect(decryptTotpSecret(encryptTotpSecret(secret, 1), 1).equals(secret)).toBe(true)
  })

  it('accepts a base64 TOTP_ENCRYPTION_KEY', () => {
    vi.stubEnv('TOTP_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
    resetTotpKeyCache()
    const secret = generateTotpSecret()
    expect(decryptTotpSecret(encryptTotpSecret(secret, 1), 1).equals(secret)).toBe(true)
  })

  it('rejects a key of the wrong length instead of padding it', () => {
    vi.stubEnv('TOTP_ENCRYPTION_KEY', 'too-short')
    resetTotpKeyCache()
    expect(() => encryptTotpSecret(generateTotpSecret(), 1)).toThrow(/32 bytes/)
  })

  it('falls back to a key derived from JWT_SECRET, and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('TOTP_ENCRYPTION_KEY', '')
    vi.stubEnv('JWT_SECRET', 'a'.repeat(48))
    resetTotpKeyCache()

    const secret = generateTotpSecret()
    const envelope = encryptTotpSecret(secret, 1)
    encryptTotpSecret(secret, 1)

    expect(decryptTotpSecret(envelope, 1).equals(secret)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/re-enrollment/)
    warn.mockRestore()
  })

  it('does not derive the AES key from the raw JWT_SECRET bytes', () => {
    vi.stubEnv('TOTP_ENCRYPTION_KEY', '')
    const jwtSecret = 'b'.repeat(32)
    vi.stubEnv('JWT_SECRET', jwtSecret)
    resetTotpKeyCache()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const secret = generateTotpSecret()
    const envelope = encryptTotpSecret(secret, 1)

    // If the key were literally the JWT secret, this key would decrypt it.
    vi.stubEnv('TOTP_ENCRYPTION_KEY', Buffer.from(jwtSecret, 'utf8').toString('hex'))
    resetTotpKeyCache()
    expect(() => decryptTotpSecret(envelope, 1)).toThrow()
  })

  it('fails closed when neither a key nor a usable JWT_SECRET is present', () => {
    vi.stubEnv('TOTP_ENCRYPTION_KEY', '')
    vi.stubEnv('JWT_SECRET', 'short')
    resetTotpKeyCache()
    expect(() => encryptTotpSecret(generateTotpSecret(), 1)).toThrow(/TOTP_ENCRYPTION_KEY/)
  })
})
