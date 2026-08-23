import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Encryption at rest for the TOTP shared secret.
 *
 * A TOTP secret is not a password: verification needs the secret itself, so it
 * cannot be hashed. Anyone who reads the column can mint valid codes forever, so
 * the column holds ciphertext and the key lives outside the database — a stolen
 * dump or a SQL-injection read then yields nothing usable.
 *
 * AES-256-GCM rather than CBC: the tag makes the ciphertext tamper-evident, so
 * an attacker with write access to the row cannot swap in a secret of their own
 * choosing without the failure being visible as a decryption error rather than a
 * silently different secret.
 *
 * NOTE FOR REVIEW: issue #111 introduces `src/lib/crypto/` for exactly this
 * purpose. That branch had not landed when this was written, so this is a
 * deliberately minimal stand-in. When both are in, this file should be reduced
 * to a thin adapter over #111's helper — the envelope format below is versioned
 * (`v1.`) precisely so that can happen without a data migration.
 */

const ALGORITHM = 'aes-256-gcm'
const ENVELOPE_VERSION = 'v1'
/** 96 bits, the GCM-recommended nonce length. */
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

/**
 * Where the key comes from.
 *
 * `TOTP_ENCRYPTION_KEY` is the supported production setting: 32 bytes, hex or
 * base64. When it is absent the key is derived from `JWT_SECRET` instead, so a
 * developer or an existing deployment does not have to add a variable before
 * 2FA works at all — but that couples the two, and rotating `JWT_SECRET` then
 * makes every enrolled authenticator undecryptable. Hence the warning: silently
 * losing everyone's second factor on a routine secret rotation is exactly the
 * kind of surprise an operator should be told about once, up front.
 */
const KEY_DERIVATION_INFO = 'open-hybrid-cloud/totp-secret/v1'

let cachedKey: Buffer | null = null
let warnedAboutFallback = false

const parseConfiguredKey = (raw: string): Buffer => {
  const trimmed = raw.trim()
  const asHex = /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, 'hex') : null
  const key = asHex ?? Buffer.from(trimmed, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOTP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (64 hex chars or 44 base64 chars); got ${key.length}`,
    )
  }
  return key
}

/**
 * Resolved lazily, like the JWT secret, and for the same reason: a module-load
 * throw would fire during `next build` page-data collection, where no secret is
 * present. This still fails closed at request time.
 */
const getKey = (): Buffer => {
  if (cachedKey) return cachedKey

  const configured = process.env.TOTP_ENCRYPTION_KEY
  if (configured && configured.trim().length > 0) {
    cachedKey = parseConfiguredKey(configured)
    return cachedKey
  }

  const jwtSecret = process.env.JWT_SECRET ?? ''
  if (jwtSecret.length < 32) {
    throw new Error(
      'Set TOTP_ENCRYPTION_KEY (32 bytes, hex or base64), or a JWT_SECRET of at least 32 characters to derive it from',
    )
  }
  if (!warnedAboutFallback) {
    warnedAboutFallback = true
    console.warn(
      '[totp] TOTP_ENCRYPTION_KEY is not set; deriving the secret-encryption key from JWT_SECRET. ' +
        'Rotating JWT_SECRET will make every enrolled authenticator unreadable and require re-enrollment.',
    )
  }
  // HKDF rather than using JWT_SECRET directly, so the AES key is not the same
  // bytes as the token-signing key even when they share a source.
  cachedKey = Buffer.from(
    hkdfSync('sha256', Buffer.from(jwtSecret, 'utf8'), Buffer.alloc(0), KEY_DERIVATION_INFO, KEY_BYTES),
  )
  return cachedKey
}

/** Test-only: forget the cached key so a test can change the environment. */
export const resetTotpKeyCache = (): void => {
  cachedKey = null
  warnedAboutFallback = false
}

/**
 * Additional authenticated data binds the ciphertext to the row it belongs to.
 *
 * Without it, an attacker with UPDATE on the table could copy root's encrypted
 * secret onto their own user row and then generate codes for their own account
 * using root's authenticator — or, more usefully, copy their OWN enrolled secret
 * onto root's row and log in as root with their own phone. GCM verifies the AAD,
 * so a moved row fails to decrypt instead.
 */
const aadFor = (userId: number): Buffer => Buffer.from(`totp:${userId}`, 'utf8')

/**
 * Encrypt a raw TOTP secret for storage.
 *
 * Returns `v1.<iv>.<ciphertext>.<tag>`, base64url in each field: a single text
 * column, self-describing, and greppable for a version bump later.
 */
export const encryptTotpSecret = (secret: Buffer, userId: number): string => {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(aadFor(userId))
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    ENVELOPE_VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.')
}

/**
 * Decrypt a stored TOTP secret.
 *
 * Throws on a wrong key, a tampered row, a row moved between users, or a
 * malformed envelope. Callers must treat a throw as "this factor is unusable"
 * and must NOT fall back to letting the login through — see `verifySecondFactor`.
 */
export const decryptTotpSecret = (envelope: string, userId: number): Buffer => {
  const parts = envelope.split('.')
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error('Malformed TOTP secret envelope')
  }
  const [, ivB64, ciphertextB64, tagB64] = parts
  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Malformed TOTP secret envelope')
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv, { authTagLength: TAG_BYTES })
  decipher.setAAD(aadFor(userId))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64url')), decipher.final()])
}

/** True when `value` looks like an envelope this module wrote. */
export const isEncryptedTotpSecret = (value: string): boolean =>
  value.startsWith(`${ENVELOPE_VERSION}.`) && value.split('.').length === 4
