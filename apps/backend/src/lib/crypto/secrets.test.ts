import { describe, it, expect, afterEach } from 'vitest'
import {
  encryptSecret,
  decryptSecret,
  isEncryptedEnvelope,
  isSecretEncryptionConfigured,
  isValidSecretKey,
  secretEncryptionUnavailableReason,
  SECRET_KEY_ENV,
  SECRET_KEY_HEX_LENGTH,
  SecretEncryptionUnavailableError,
} from './secrets'

const KEY_A = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const KEY_B = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

/** vitest.config.ts sets a key for the whole suite; restore it after meddling. */
const configuredKey = process.env[SECRET_KEY_ENV]

afterEach(() => {
  if (configuredKey === undefined) delete process.env[SECRET_KEY_ENV]
  else process.env[SECRET_KEY_ENV] = configuredKey
})

describe('isValidSecretKey', () => {
  it('accepts 64 hex characters in either case', () => {
    expect(isValidSecretKey(KEY_A)).toBe(true)
    expect(isValidSecretKey(KEY_A.toUpperCase())).toBe(true)
  })

  it('rejects a key of the wrong length', () => {
    expect(isValidSecretKey('ab')).toBe(false)
    expect(isValidSecretKey(KEY_A + 'ab')).toBe(false)
  })

  it('rejects 64 non-hex characters', () => {
    // The likely mistake is a base64 key, which is the right shape and the
    // wrong bytes.
    expect(isValidSecretKey('z'.repeat(SECRET_KEY_HEX_LENGTH))).toBe(false)
  })
})

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a value', () => {
    process.env[SECRET_KEY_ENV] = KEY_A
    const envelope = encryptSecret('glpat-super-secret-token')
    expect(decryptSecret(envelope)).toBe('glpat-super-secret-token')
  })

  it('round-trips an empty string, unicode and a long value', () => {
    process.env[SECRET_KEY_ENV] = KEY_A
    for (const plaintext of ['', 'pässwörd-✓', 'x'.repeat(8192)]) {
      expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext)
    }
  })

  it('never produces the plaintext in the envelope', () => {
    process.env[SECRET_KEY_ENV] = KEY_A
    const envelope = encryptSecret('needle-in-the-haystack')
    expect(envelope).not.toContain('needle')
    expect(isEncryptedEnvelope(envelope)).toBe(true)
  })

  it('produces a different envelope every time for the same input', () => {
    // The IV is random per value. If this ever fails, GCM has lost
    // confidentiality outright — two ciphertexts under one (key, IV) pair leak
    // the XOR of their plaintexts.
    process.env[SECRET_KEY_ENV] = KEY_A
    const envelopes = new Set(Array.from({ length: 20 }, () => encryptSecret('same-token')))
    expect(envelopes.size).toBe(20)
  })

  it('refuses a value encrypted under a different key', () => {
    process.env[SECRET_KEY_ENV] = KEY_A
    const envelope = encryptSecret('token')

    process.env[SECRET_KEY_ENV] = KEY_B
    expect(() => decryptSecret(envelope)).toThrow()
  })

  it('refuses a tampered ciphertext rather than returning wrong plaintext', () => {
    process.env[SECRET_KEY_ENV] = KEY_A
    const envelope = encryptSecret('transfer-to-account-1')

    // Flip the last byte of the payload. GCM's tag makes this indistinguishable
    // from a wrong key, which is the property worth having: there is no way to
    // get a silently different plaintext out.
    const [, payload] = envelope.split(':')
    const raw = Buffer.from(payload, 'base64')
    raw[raw.length - 1] ^= 0xff
    expect(() => decryptSecret(`v1:${raw.toString('base64')}`)).toThrow()
  })

  it('refuses a truncated envelope', () => {
    process.env[SECRET_KEY_ENV] = KEY_A
    expect(() => decryptSecret('v1:AAAA')).toThrow(SecretEncryptionUnavailableError)
    expect(() => decryptSecret('v1:AAAA')).toThrow(/truncated/i)
  })

  it('refuses an unknown envelope version', () => {
    process.env[SECRET_KEY_ENV] = KEY_A
    expect(() => decryptSecret('v2:AAAA')).toThrow(/version/i)
    // A plaintext value that was never an envelope, e.g. a legacy
    // ci_sources.access_token, must not be mistaken for one.
    expect(() => decryptSecret('glpat-plain-text')).toThrow(/version/i)
    expect(isEncryptedEnvelope('glpat-plain-text')).toBe(false)
  })

  it('keeps the rejected value out of the message', () => {
    process.env[SECRET_KEY_ENV] = KEY_A
    // The message ends up in integrations.last_error, which every read path
    // returns. On a legacy plaintext credential the text before the first ':'
    // is the username half of a basic-auth pair.
    expect(() => decryptSecret('svc-account:hunter2')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('svc-account') }),
    )
  })

  it('picks up a key that changed after the first use', () => {
    // The cache is keyed on the raw env value, not latched on first read. A
    // latched cache would make this test pass with the OLD key, and would also
    // survive a config reload in a long-lived process.
    process.env[SECRET_KEY_ENV] = KEY_A
    const underA = encryptSecret('token')
    process.env[SECRET_KEY_ENV] = KEY_B
    const underB = encryptSecret('token')

    expect(decryptSecret(underB)).toBe('token')
    expect(() => decryptSecret(underA)).toThrow()
  })
})

describe('when the key is not configured', () => {
  it('reports itself unavailable rather than throwing at import time', () => {
    delete process.env[SECRET_KEY_ENV]
    expect(isSecretEncryptionConfigured()).toBe(false)
    expect(secretEncryptionUnavailableReason()).toContain(SECRET_KEY_ENV)
    expect(secretEncryptionUnavailableReason()).toContain('not set')
  })

  it('treats an empty string as absent', () => {
    process.env[SECRET_KEY_ENV] = ''
    expect(isSecretEncryptionConfigured()).toBe(false)
  })

  it('refuses to encrypt — there is no plaintext fallback', () => {
    delete process.env[SECRET_KEY_ENV]
    expect(() => encryptSecret('token')).toThrow(SecretEncryptionUnavailableError)
  })

  it('reports a malformed key with the fix in the message', () => {
    process.env[SECRET_KEY_ENV] = 'not-a-key'
    expect(isSecretEncryptionConfigured()).toBe(false)
    const reason = secretEncryptionUnavailableReason()
    expect(reason).toContain(`${SECRET_KEY_HEX_LENGTH} hex characters`)
    expect(reason).toContain('openssl rand -hex 32')
  })

  it('is available again once a valid key is set', () => {
    process.env[SECRET_KEY_ENV] = KEY_A
    expect(isSecretEncryptionConfigured()).toBe(true)
    expect(secretEncryptionUnavailableReason()).toBeNull()
  })
})
