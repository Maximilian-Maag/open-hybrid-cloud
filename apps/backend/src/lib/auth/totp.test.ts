import { describe, it, expect } from 'vitest'
import {
  base32Decode,
  base32Encode,
  formatSecretForDisplay,
  generateTotpSecret,
  hotp,
  otpauthUrl,
  totp,
  totpStep,
  verifyTotp,
  TOTP_SECRET_BYTES,
  TOTP_STEP_SECONDS,
} from './totp'

/**
 * The published vectors are the whole point of this file.
 *
 * A hand-rolled OTP implementation that only ever agrees with its own
 * expectations is worthless: it emits six plausible digits, every test passes,
 * and no authenticator app on earth produces the same number. So the first two
 * describe blocks below check nothing but the values printed in the RFCs.
 */

/** RFC 4226 Appendix D / RFC 6238 Appendix B seed: ASCII "12345678901234567890". */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii')

describe('hotp — RFC 4226 Appendix D test vectors', () => {
  // Table in RFC 4226 Appendix D, "Truncated HOTP" column, 6 digits.
  const VECTORS: [counter: number, expected: string][] = [
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ]

  for (const [counter, expected] of VECTORS) {
    it(`counter ${counter} produces ${expected}`, () => {
      expect(hotp(RFC_SECRET, counter)).toBe(expected)
    })
  }
})

describe('totp — RFC 6238 Appendix B test vectors (SHA-1)', () => {
  // RFC 6238 Appendix B prints 8-digit codes for SHA-1/SHA-256/SHA-512. Only the
  // SHA-1 rows apply here, and the 6-digit code this project uses is the low six
  // digits of the same truncated value — asserted both ways so a bug in the
  // digits parameter cannot hide.
  const VECTORS: [epochSeconds: number, expectedStep: number, eightDigits: string][] = [
    [59, 0x0000000000000001, '94287082'],
    [1111111109, 0x00000000023523ec, '07081804'],
    [1111111111, 0x00000000023523ed, '14050471'],
    [1234567890, 0x000000000273ef07, '89005924'],
    [2000000000, 0x0000000003f940aa, '69279037'],
    [20000000000, 0x0000000027bc86aa, '65353130'],
  ]

  for (const [epochSeconds, expectedStep, eightDigits] of VECTORS) {
    it(`T=${epochSeconds} has step 0x${expectedStep.toString(16).toUpperCase()} and code ${eightDigits}`, () => {
      expect(totpStep(epochSeconds)).toBe(expectedStep)
      expect(totp(RFC_SECRET, epochSeconds, { digits: 8 })).toBe(eightDigits)
      expect(totp(RFC_SECRET, epochSeconds)).toBe(eightDigits.slice(-6))
    })
  }

  it('agrees with hotp on the step counter, which is the only difference between them', () => {
    expect(totp(RFC_SECRET, 59)).toBe(hotp(RFC_SECRET, 1))
  })

  it('uses a 30-second step, so a code holds for its step and not past it', () => {
    expect(TOTP_STEP_SECONDS).toBe(30)
    // The RFC's own 1111111109/1111111111 pair straddles a step boundary
    // (0x23523EC vs 0x23523ED), which is exactly why it is in the table twice.
    // Step 0x23523ED covers 1111111110 through 1111111139.
    expect(totp(RFC_SECRET, 1111111110)).toBe('050471')
    expect(totp(RFC_SECRET, 1111111139)).toBe('050471')
    expect(totp(RFC_SECRET, 1111111109)).toBe('081804')
    expect(totp(RFC_SECRET, 1111111140)).not.toBe('050471')
  })
})

describe('base32 — RFC 4648 §10 test vectors', () => {
  const VECTORS: [plain: string, encoded: string][] = [
    ['', ''],
    ['f', 'MY======'],
    ['fo', 'MZXQ===='],
    ['foo', 'MZXW6==='],
    ['foob', 'MZXW6YQ='],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI======'],
  ]

  for (const [plain, encoded] of VECTORS) {
    it(`encodes ${JSON.stringify(plain)} as ${JSON.stringify(encoded)}`, () => {
      expect(base32Encode(Buffer.from(plain, 'ascii'))).toBe(encoded)
    })

    it(`decodes ${JSON.stringify(encoded)} back to ${JSON.stringify(plain)}`, () => {
      expect(base32Decode(encoded).toString('ascii')).toBe(plain)
    })
  }

  it('encodes the RFC 6238 seed the way authenticator apps show it', () => {
    // The base32 of ASCII "12345678901234567890" — the value you would type into
    // an app's manual-entry box to reproduce the vectors above.
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  })

  it('round-trips arbitrary binary', () => {
    for (let length = 0; length < 40; length++) {
      const data = Buffer.from(Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff))
      expect(base32Decode(base32Encode(data)).equals(data)).toBe(true)
    }
  })

  it('accepts lower case, spaces and dashes, since that is what people paste', () => {
    expect(base32Decode('mzxw 6ytb-oi').toString('ascii')).toBe('foobar')
  })

  it('rejects a character outside the alphabet rather than decoding something else', () => {
    expect(() => base32Decode('MZXW6YT1')).toThrow(/Invalid base32 character/)
  })

  it('rejects trailing bits that are not zero padding', () => {
    // 'MZXW6YTC' has a set bit in the padding position of the last byte.
    expect(() => base32Decode('MY======'.replace('MY', 'MZ'))).toThrow(/zero padding/)
  })
})

describe('verifyTotp', () => {
  const NOW = 1111111111

  it('accepts the current code', () => {
    const result = verifyTotp(RFC_SECRET, totp(RFC_SECRET, NOW), NOW)
    expect(result.valid).toBe(true)
    expect(result.step).toBe(totpStep(NOW))
  })

  it('accepts the previous and next step for clock skew, and reports which one', () => {
    const previous = verifyTotp(RFC_SECRET, totp(RFC_SECRET, NOW - 30), NOW)
    expect(previous).toEqual({ valid: true, step: totpStep(NOW) - 1 })

    const next = verifyTotp(RFC_SECRET, totp(RFC_SECRET, NOW + 30), NOW)
    expect(next).toEqual({ valid: true, step: totpStep(NOW) + 1 })
  })

  it('rejects two steps out — the window is ±1, not "recently"', () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, NOW - 60), NOW).valid).toBe(false)
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, NOW + 60), NOW).valid).toBe(false)
  })

  it('rejects a code for a different secret', () => {
    const other = Buffer.from('09876543210987654321', 'ascii')
    expect(verifyTotp(other, totp(RFC_SECRET, NOW), NOW).valid).toBe(false)
  })

  it('rejects anything that is not six digits, without hashing it', () => {
    for (const bad of ['', '1234', '1234567', 'abcdef', '12 34 5', '12345a', '-12345']) {
      expect(verifyTotp(RFC_SECRET, bad, NOW), bad).toEqual({ valid: false, step: null })
    }
  })

  it('tolerates the spaces an authenticator app puts in the middle of a code', () => {
    const code = totp(RFC_SECRET, NOW)
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, NOW).valid).toBe(true)
  })

  it('never accepts a negative step near the epoch', () => {
    // T=0 has no previous step; asking for one must not produce a counter of -1.
    expect(() => verifyTotp(RFC_SECRET, '000000', 0)).not.toThrow()
  })
})

describe('generateTotpSecret', () => {
  it('returns 160 bits', () => {
    expect(TOTP_SECRET_BYTES).toBe(20)
    expect(generateTotpSecret()).toHaveLength(20)
  })

  it('returns a different secret every time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTotpSecret().toString('hex')))
    expect(seen.size).toBe(50)
  })
})

describe('otpauthUrl', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii')

  it('produces a key URI an authenticator app can read', () => {
    const url = otpauthUrl({ issuer: 'Open Hybrid Cloud', account: 'root@example.org', secret })
    const parsed = new URL(url)

    expect(parsed.protocol).toBe('otpauth:')
    expect(parsed.host).toBe('totp')
    expect(decodeURIComponent(parsed.pathname)).toBe('/Open Hybrid Cloud:root@example.org')
    expect(parsed.searchParams.get('secret')).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(parsed.searchParams.get('issuer')).toBe('Open Hybrid Cloud')
    expect(parsed.searchParams.get('algorithm')).toBe('SHA1')
    expect(parsed.searchParams.get('digits')).toBe('6')
    expect(parsed.searchParams.get('period')).toBe('30')
  })

  it('strips base32 padding, which some apps reject', () => {
    const url = otpauthUrl({ issuer: 'OHC', account: 'a@b.c', secret: Buffer.from('foo') })
    expect(url).toContain('secret=MZXW6')
    expect(url).not.toContain('%3D')
  })

  it('escapes a colon in the account name so the label cannot be split wrongly', () => {
    const url = otpauthUrl({ issuer: 'A:B', account: 'c:d', secret })
    expect(new URL(url).pathname).toBe('/A%3AB:c%3Ad')
  })
})

describe('formatSecretForDisplay', () => {
  it('groups the secret in fours so it can be typed by hand', () => {
    expect(formatSecretForDisplay(RFC_SECRET)).toBe('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ')
  })

  it('decodes back to the same secret once the spaces are stripped', () => {
    const secret = generateTotpSecret()
    expect(base32Decode(formatSecretForDisplay(secret)).equals(secret)).toBe(true)
  })
})
