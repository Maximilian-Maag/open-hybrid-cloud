import { describe, it, expect } from 'vitest'
import { totp, base32Encode, generateTotpSecret } from '@/lib/auth/totp'
import { totpCode } from '../../../../../e2e/helpers'

/**
 * The e2e suite carries its own TOTP implementation — `e2e/` is in neither app's
 * module graph, so it cannot import this one. A copy that disagreed would make
 * every authenticated e2e run fail at the code field with nothing to say why, so
 * the two are checked against each other here.
 */
describe('the e2e TOTP helper agrees with the backend', () => {
  it('produces the same code for the same secret and instant', () => {
    for (let i = 0; i < 20; i++) {
      const secret = generateTotpSecret()
      const at = 1_700_000_000_000 + i * 31_000
      const mine = totpCode(base32Encode(secret), at)
      const theirs = totp(secret, Math.floor(at / 1000))
      expect(mine, `iteration ${i}`).toBe(theirs)
    }
  })

  it('handles a secret written with the spaces the UI shows', () => {
    const secret = generateTotpSecret()
    const at = 1_700_000_000_000
    const grouped = base32Encode(secret).replace(/(.{4})/g, '$1 ').trim()
    expect(totpCode(grouped.replace(/\s/g, ''), at)).toBe(totp(secret, Math.floor(at / 1000)))
  })
})
