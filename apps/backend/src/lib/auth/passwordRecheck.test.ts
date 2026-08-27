import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { recheckPassword, passwordRecheckLimit } from './passwordRecheck'

/**
 * The counter the three in-session password re-checks share — 2FA enrolment,
 * `changePassword` and security-key removal.
 *
 * Until it existed, all three ran `bcrypt.compare` against the account password
 * with nothing counting the attempts, from inside an authenticated session,
 * which is where a session thief already is. The prize is the password, not the
 * action being guarded.
 */

// Cost 4 rather than the production 12: this file makes dozens of comparisons
// and the number under test is the count, not the work factor.
const HASH = bcrypt.hashSync('correct horse', 4)

beforeEach(() => {
  passwordRecheckLimit.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
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
  //
  // Asserted on the call and not on the clock. The first version of this timed
  // the refusal and expected under 2ms, which is a bcrypt cost factor and a CI
  // box's load away from being a flake — and it only ever measured the thing it
  // meant to check by proxy.
  it('does not pay for a comparison it has already refused', async () => {
    for (let i = 0; i < 6; i++) await recheckPassword(1, 'nope', HASH)

    const compare = vi.spyOn(bcrypt, 'compare')
    expect(await recheckPassword(1, 'nope', HASH)).toBe('throttled')
    expect(compare).not.toHaveBeenCalled()
  })

  /*
   * The reservation, not a check followed by a charge.
   *
   * `isOverLimit` before the compare and `count` after it looks equivalent and
   * is not: `bcrypt.compare` is awaited in between, so every concurrent request
   * reads a count under the cap, every one passes, and only then does the first
   * charge anything. The cap becomes a cap on SEQUENTIAL guessing and none at
   * all on parallel guessing — which is the shape a stolen session would use.
   *
   * Six at once against a cap of five: exactly one must be refused.
   */
  it('holds the cap when six guesses arrive at once', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, (_unused, i) => recheckPassword(9, `guess-${i}`, HASH)),
    )

    expect(outcomes.filter((o) => o === 'wrong')).toHaveLength(5)
    expect(outcomes.filter((o) => o === 'throttled')).toHaveLength(1)
  })

  it('lets six concurrent guesses cost six bcrypt rounds at most', async () => {
    const compare = vi.spyOn(bcrypt, 'compare')

    await Promise.all(Array.from({ length: 12 }, () => recheckPassword(11, 'nope', HASH)))

    // Five reserved slots, so five comparisons. The other seven are refused
    // before they reach one.
    expect(compare).toHaveBeenCalledTimes(5)
  })
})
