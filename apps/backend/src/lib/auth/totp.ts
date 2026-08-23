import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * RFC 4226 (HOTP) and RFC 6238 (TOTP), by hand.
 *
 * Deliberately dependency-free: the whole algorithm is an HMAC, a truncation and
 * a modulo, and node's `crypto` already ships the only primitive that is hard to
 * get right. Every constant below is fixed by the RFCs, and the test file checks
 * this file against the vectors published in RFC 4226 Appendix D and RFC 6238
 * Appendix B — an implementation verified only against its own expectations is
 * worth nothing, because a wrong-but-consistent one still produces six plausible
 * digits and no authenticator app would ever agree with it.
 */

/** Seconds per step. Fixed at 30 by every authenticator app in practice. */
export const TOTP_STEP_SECONDS = 30

/** Digits in a code. 6 is what Google Authenticator / Authy / Bitwarden show. */
export const TOTP_DIGITS = 6

/**
 * How many steps either side of "now" are accepted.
 *
 * 1 means a code stays usable for at most 90 s (previous, current, next step),
 * which is the usual allowance for a phone whose clock drifted and for the user
 * who started typing at second 29. Widening this multiplies an attacker's
 * per-guess success probability by the same factor, so it stays at 1.
 */
export const TOTP_WINDOW_STEPS = 1

/**
 * Length of a generated shared secret, in bytes.
 *
 * RFC 4226 §4 R6 requires at least 128 bits and recommends 160. 20 bytes is that
 * recommendation, and also what authenticator apps expect from a SHA-1 secret.
 */
export const TOTP_SECRET_BYTES = 20

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 §6 base32, padded — the form authenticator apps read. */
export const base32Encode = (data: Buffer): string => {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of data) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  while (out.length % 8 !== 0) out += '='
  return out
}

/**
 * RFC 4648 §6 base32 decode.
 *
 * Case-insensitive and tolerant of the spaces and dashes people paste out of a
 * "manual entry" box. Throws on anything else rather than quietly decoding a
 * different secret than the one that was typed.
 */
export const base32Decode = (input: string): Buffer => {
  const cleaned = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error(`Invalid base32 character: ${JSON.stringify(char)}`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  // Whatever is left over has to be zero padding, not a truncated byte.
  if (bits >= 5 || (value & ((1 << bits) - 1)) !== 0) {
    throw new Error('Invalid base32: trailing bits are not zero padding')
  }
  return Buffer.from(out)
}

/**
 * RFC 4226 §5.3 HOTP.
 *
 * The counter is written as a 64-bit big-endian integer via `BigInt` rather than
 * two 32-bit halves, because `counter << 32` in JS number arithmetic silently
 * wraps — and TOTP step counters pass 2^31 in the year 6053, which is far enough
 * away to be tempting and near enough to be wrong.
 */
export const hotp = (secret: Buffer, counter: number | bigint, digits = TOTP_DIGITS): string => {
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac('sha1', secret).update(counterBuf).digest()

  // Dynamic truncation: the low nibble of the last byte picks the offset of a
  // 4-byte slice, whose top bit is masked off so the value is positive.
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]

  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** The RFC 6238 step counter for an instant, given in seconds since the epoch. */
export const totpStep = (epochSeconds: number, step = TOTP_STEP_SECONDS): number =>
  Math.floor(epochSeconds / step)

/** The code an authenticator app would be showing at `epochSeconds`. */
export const totp = (
  secret: Buffer,
  epochSeconds: number,
  { step = TOTP_STEP_SECONDS, digits = TOTP_DIGITS }: { step?: number; digits?: number } = {},
): string => hotp(secret, totpStep(epochSeconds, step), digits)

/**
 * Constant-time comparison of two codes.
 *
 * `===` on strings short-circuits at the first differing character, which leaks
 * how many leading digits were right. Six digits is a small enough space that
 * the leak is worth closing, even though the rate limiter is the real defence.
 */
const codesMatch = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export interface TotpVerification {
  /** Whether `code` matched inside the accepted window. */
  valid: boolean
  /**
   * The step the code belongs to, or null when nothing matched. The caller must
   * persist this and refuse anything at or below it afterwards — otherwise a
   * code read over someone's shoulder stays usable for the rest of its window.
   */
  step: number | null
}

/**
 * Verify a submitted code against `secret` around `epochSeconds`.
 *
 * Returns the matching step so the caller can enforce single use. This function
 * deliberately keeps no state of its own: the replay guard has to survive a
 * process restart and be shared between instances, which only the database can
 * do.
 */
export const verifyTotp = (
  secret: Buffer,
  code: string,
  epochSeconds: number,
  {
    step = TOTP_STEP_SECONDS,
    digits = TOTP_DIGITS,
    window = TOTP_WINDOW_STEPS,
  }: { step?: number; digits?: number; window?: number } = {},
): TotpVerification => {
  const trimmed = code.replace(/\s/g, '')
  if (!new RegExp(`^[0-9]{${digits}}$`).test(trimmed)) return { valid: false, step: null }

  const current = totpStep(epochSeconds, step)
  // Every candidate is tested even after a match, so the work done does not
  // depend on WHICH step matched — a caller timing the response cannot tell a
  // slightly-early code from a slightly-late one.
  let matched: number | null = null
  for (let offset = -window; offset <= window; offset++) {
    const candidate = current + offset
    if (candidate < 0) continue
    if (codesMatch(hotp(secret, candidate, digits), trimmed) && matched === null) {
      matched = candidate
    }
  }
  return { valid: matched !== null, step: matched }
}

/** A fresh 160-bit shared secret. */
export const generateTotpSecret = (): Buffer => randomBytes(TOTP_SECRET_BYTES)

/**
 * The `otpauth://` URI an authenticator app reads out of the QR code
 * (github.com/google/google-authenticator/wiki/Key-Uri-Format).
 *
 * The issuer appears twice — once as the `issuer:account` label prefix and once
 * as a parameter — because different apps read one or the other, and an app that
 * finds neither shows an entry the user cannot tell apart from their others.
 */
export const otpauthUrl = ({
  issuer,
  account,
  secret,
  digits = TOTP_DIGITS,
  period = TOTP_STEP_SECONDS,
}: {
  issuer: string
  account: string
  secret: Buffer
  digits?: number
  period?: number
}): string => {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({
    secret: base32Encode(secret).replace(/=+$/, ''),
    issuer,
    algorithm: 'SHA1',
    digits: String(digits),
    period: String(period),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** `'ABCD EFGH IJKL'` — the grouping that makes a manual-entry secret typable. */
export const formatSecretForDisplay = (secret: Buffer): string =>
  (base32Encode(secret).replace(/=+$/, '').match(/.{1,4}/g) ?? []).join(' ')
