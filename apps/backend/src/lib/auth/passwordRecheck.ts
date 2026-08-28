import bcrypt from 'bcryptjs'
import { createRateLimitBucket } from '@/lib/rateLimit'

/**
 * Re-checking the account password from inside an already-authenticated session.
 *
 * Three places do it — 2FA enrolment, `changePassword`, and removing a security
 * key — and until this module none of them counted the attempts. The login route
 * has counted them since the beginning; these did not, and they are reached from
 * exactly the position a session thief is already in. A stolen session could
 * grind the password against a live `bcrypt.compare` for as long as it liked.
 *
 * What is being protected is not the action behind the check. It is the
 * password: the credential the user reuses somewhere else.
 *
 * ONE bucket for all three, deliberately. Three buckets of five would be a
 * budget of fifteen to anyone willing to alternate between the doors, and the
 * attacker chooses the door. The counter belongs to the account, not the
 * endpoint.
 */

/**
 * Five per fifteen minutes, per account.
 *
 * Five and not the login route's ten because this is a person who set the
 * password re-typing it, not someone signing in on a new device with autofill.
 * Per account and not per IP because the account is what is under attack.
 *
 * The per-process caveat in `rateLimit.ts` applies here as it does to login:
 * with `replicaCount: 2` the effective cap is ten. That is still the difference
 * between bounded and unbounded.
 */
export const passwordRecheckLimit = createRateLimitBucket(5, 15 * 60 * 1000)

export type PasswordRecheck = 'ok' | 'wrong' | 'throttled'

/**
 * Check `password` against `passwordHash` for `userId`, under the shared limit.
 *
 * The attempt is RESERVED before the compare, so an over-budget guess does not
 * even cost the bcrypt round — which is the half of a lockout that protects the
 * server rather than the account — and concurrent guesses cannot slip past a
 * check none of them has charged for yet.
 *
 * A correct password clears the counter: someone who mistyped twice and then got
 * it right is not who this is for.
 *
 * Callers map the three outcomes onto their own status codes and audit lines,
 * because a 403 here and a 400 there are existing contracts and not worth
 * breaking to share a counter.
 */
export const recheckPassword = async (
  userId: number,
  password: string,
  passwordHash: string,
): Promise<PasswordRecheck> => {
  const key = `password-recheck:${userId}`

  /*
   * `isRateLimited`, which counts AND checks in one call, and not the
   * `isOverLimit` / `count` pair around the compare.
   *
   * The pair looks equivalent and is not: `bcrypt.compare` is awaited between
   * them, so six concurrent requests all read a count under the cap, all pass,
   * and only then does the first of them charge anything. The cap becomes a cap
   * on SEQUENTIAL guessing and no cap at all on parallel guessing, which is the
   * shape an attacker with a stolen session would use.
   *
   * Reserving up front costs a successful attempt one slot for the duration of
   * one comparison, and the reset below gives it straight back.
   */
  if (passwordRecheckLimit.isRateLimited(key)) return 'throttled'

  if (!(await bcrypt.compare(password, passwordHash))) return 'wrong'

  passwordRecheckLimit.reset(key)
  return 'ok'
}
