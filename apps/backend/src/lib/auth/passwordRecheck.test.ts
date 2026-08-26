import { describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { recheckPassword, passwordRecheckLimit } from './passwordRecheck'

/**
 * The counter the three in-session password re-checks share.
 *
 * Until it existed, 2FA enrolment, `changePassword` and security-key removal all
 * ran `bcrypt.compare` against the account password with nothing counting the
 * attempts — from inside an authenticated session, which is where a session
 * thief already is. The prize is the password, not the action being guarded.
 */

// Cost 4 rather than the production 12: this file makes dozens of comparisons
// and the number under test is the count, not the work factor.
const HASH = bcrypt.hashSync('correct horse', 4)

beforeEach(() => {
  passwordRecheckLimit.clear()
})

describe('recheckPassword', () => {
  it('accepts the right password', async () => {
    expect(await recheckPassword(1, 'correct horse', HASH)).toBe('ok')
  })

  it('rejects the wrong one', async () => {
    expect(await recheckPassword(1, 'nope', HASH)).toBe('wrong')
  })

  it('stops answering after five wrong ones', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await recheckPassword(1, `guess-${i}`, HASH)).toBe('wrong')
    }
    expect(await recheckPassword(1, 'guess-6', HASH)).toBe('throttled')
  })

  // What makes it a limit rather than an inconvenience: once the budget is
  // spent, knowing the password does not help either.
  it('refuses even the right password once the budget is spent', async () => {
    for (let i = 0; i < 6; i++) await recheckPassword(1, 'nope', HASH)
    expect(await recheckPassword(1, 'correct horse', HASH)).toBe('throttled')
  })

  it('counts against the account, not everyone', async () => {
    for (let i = 0; i < 6; i++) await recheckPassword(1, 'nope', HASH)
    expect(await recheckPassword(2, 'correct horse', HASH)).toBe('ok')
  })

  it('gives the budget back when the password is right', async () => {
    for (let i = 0; i < 4; i++) await recheckPassword(1, 'nope', HASH)
    expect(await recheckPassword(1, 'correct horse', HASH)).toBe('ok')

    // Four more would have tripped the old count.
    for (let i = 0; i < 4; i++) expect(await recheckPassword(1, 'nope', HASH)).toBe('wrong')
  })

  // The reason there is one bucket and not three. Three buckets of five is a
  // budget of fifteen to anyone willing to alternate between the doors, and the
  // attacker picks the door.
  it('is one budget however many callers spend it', async () => {
    // Three guesses "at enrolment", three "at change-password" — same key.
    for (let i = 0; i < 3; i++) await recheckPassword(7, 'a', HASH)
    for (let i = 0; i < 2; i++) await recheckPassword(7, 'b', HASH)
    expect(await recheckPassword(7, 'c', HASH)).toBe('throttled')
  })

  // Over budget costs no bcrypt round: that is the half of a lockout that
  // protects the server rather than the account.
  it('does not pay for a comparison it has already refused', async () => {
    for (let i = 0; i < 6; i++) await recheckPassword(1, 'nope', HASH)

    const started = process.hrtime.bigint()
    expect(await recheckPassword(1, 'nope', HASH)).toBe('throttled')
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    // A cost-4 bcrypt is a few milliseconds; a return is microseconds. Generous
    // enough not to flake on a loaded CI box, tight enough to fail if the
    // compare moved back above the check.
    expect(elapsedMs).toBeLessThan(2)
  })
})
