import { createHash, randomInt } from 'node:crypto'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { userRecoveryCodes, userTotp, users } from '@/lib/db/schema'
import { logAudit } from '@/lib/audit'
import { ok, err, type Result } from '@/lib/services/result'
import {
  base32Encode,
  formatSecretForDisplay,
  generateTotpSecret,
  otpauthUrl,
  verifyTotp,
} from '@/lib/auth/totp'
import { decryptTotpSecret, encryptTotpSecret } from '@/lib/auth/totpSecret'
import { qrSvgFor } from '@/lib/auth/qr'

/**
 * Everything about the second factor: enrollment, verification, recovery codes,
 * the lockout, and the audit trail.
 *
 * The rules that matter, in one place so a reviewer can check them against the
 * issue without reading the routes:
 *
 *   1. A confirmed factor can never be switched off through the API. There is no
 *      `disable` function here, and nothing sets `secret` back to NULL. The only
 *      exits are a re-enrollment (which replaces it) and an operator deleting the
 *      row in the database — see docs/guides/root.md.
 *   2. Re-enrollment always costs a second factor: a current TOTP code, or a
 *      recovery code. Password alone is not enough, or a stolen session would be
 *      able to swap the factor out and lock the owner out of their own account.
 *   3. An accepted code's step is recorded, and anything at or below it is
 *      refused afterwards. A code is single-use, not "valid for 90 seconds".
 *   4. Failures are counted in the database and lock the factor. Six digits is a
 *      10^6 space; a few guesses per second gets through it in days.
 */

/**
 * Failures allowed before the second factor locks.
 *
 * Five, and then fifteen minutes. The arithmetic is the argument: 10^6 codes at
 * 5 per 15 minutes is 5.7 years of continuous guessing for a 50% chance, against
 * roughly two hours if the limit were 100 per 15 minutes. Five is also more than
 * a person mistypes in a row, so a legitimate user who fat-fingers a code twice
 * never meets it.
 *
 * The counter is CONSECUTIVE — a success clears it — so an occasional wrong code
 * over weeks of normal use never accumulates into a lockout.
 */
export const MFA_MAX_FAILED_ATTEMPTS = 5
export const MFA_LOCKOUT_MS = 15 * 60 * 1000

/**
 * How long a started-but-unconfirmed enrollment stays valid.
 *
 * A pending secret is a secret someone might have photographed off a screen and
 * then walked away from, so it does not sit in the database indefinitely waiting
 * to be confirmed by whoever finds the QR code later.
 */
export const PENDING_ENROLLMENT_TTL_MS = 15 * 60 * 1000

/** How many one-time recovery codes an enrollment issues. */
export const RECOVERY_CODE_COUNT = 10

/**
 * Characters in a recovery code, excluding the base32 alphabet's absent 0/1/8/9
 * so nothing can be misread between a screenshot and a keyboard.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/**
 * 20 characters from a 32-symbol alphabet is 100 bits.
 *
 * That number is the reason the hash below is a plain SHA-256 and not bcrypt: a
 * password KDF exists to make a *guessable* secret expensive to guess, and there
 * is nothing to guess here. 2^100 is unreachable whatever the hash costs, while
 * bcrypt at this codebase's cost factor of 12 takes about a second per
 * comparison — which for a set of ten codes would mean a ten-second login and a
 * free denial-of-service lever. SHA-256 also lets verification be a single
 * indexed lookup instead of a comparison per row, so the response time reveals
 * nothing about how many codes are left or which one matched.
 *
 * No salt, for the same reason: a salt defeats precomputation across a shared
 * search space, and a 100-bit random value has no search space to share.
 */
const RECOVERY_CODE_LENGTH = 20
const RECOVERY_CODE_GROUP = 5

export interface TwoFactorStatus {
  /** A confirmed factor is present, so login requires a code. */
  enabled: boolean
  confirmedAt: Date | null
  /** An enrollment has been started and not yet confirmed. */
  pending: boolean
  /** Unused recovery codes left. Zero with `enabled` true is a warning state. */
  recoveryCodesRemaining: number
  /** Set while the factor is locked out after repeated failures. */
  lockedUntil: Date | null
}

export interface EnrollmentOffer {
  /** The base32 secret, for someone typing it in by hand. */
  secret: string
  /** The same secret, grouped in fours. */
  secretFormatted: string
  /** The `otpauth://` URI behind the QR code. */
  otpauthUrl: string
  /** A self-contained SVG of the QR code, ready to inline. */
  qrSvg: string
}

/** The one place that decides what "2FA is on" means. */
const isConfirmed = (row: { secret: string | null; confirmedAt: Date | null } | undefined): boolean =>
  Boolean(row?.secret && row.confirmedAt)

const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(normalizeRecoveryCode(code), 'utf8').digest('hex')

/**
 * Recovery codes are shown grouped and in upper case; accept whatever the user
 * pastes back. Everything outside the alphabet is dropped rather than rejected,
 * because a trailing space or the dashes we printed ourselves are not an attack.
 */
export const normalizeRecoveryCode = (code: string): string =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** `'ABCDE-FGHJK-LMNPQ-RSTUV'` — grouped so it can be read off paper. */
const formatRecoveryCode = (raw: string): string =>
  (raw.match(new RegExp(`.{1,${RECOVERY_CODE_GROUP}}`, 'g')) ?? []).join('-')

/**
 * `randomInt` rather than `randomBytes(n) % 32`: the alphabet is 32 characters,
 * so a modulo would happen to be unbiased here — but the next person to change
 * the alphabet to 31 characters would not notice that it stopped being.
 */
const generateRecoveryCode = (): string =>
  Array.from({ length: RECOVERY_CODE_LENGTH }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('')

const loadRow = async (userId: number) => {
  const rows = await db.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1)
  return rows[0]
}

const countUnusedRecoveryCodes = async (userId: number): Promise<number> => {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(userRecoveryCodes)
    .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)))
  return row?.count ?? 0
}

/**
 * Whether a login as this user has to pass a second factor.
 *
 * Called from the login path, so it is deliberately the cheapest possible query
 * and takes no view on anything else: a user with no row, or with a row that was
 * never confirmed, is not protected and logs in with a password alone. That is
 * the bootstrap case — the very first login after installation cannot require a
 * factor that has not been set up yet.
 */
export const requiresSecondFactor = async (userId: number): Promise<boolean> => {
  const rows = await db
    .select({ secret: userTotp.secret, confirmedAt: userTotp.confirmedAt })
    .from(userTotp)
    .where(eq(userTotp.userId, userId))
    .limit(1)
  return isConfirmed(rows[0])
}

export const getTwoFactorStatus = async (userId: number): Promise<Result<TwoFactorStatus>> => {
  const row = await loadRow(userId)
  const pendingFresh =
    Boolean(row?.pendingSecret) &&
    row?.pendingCreatedAt !== null &&
    row?.pendingCreatedAt !== undefined &&
    Date.now() - row.pendingCreatedAt.getTime() < PENDING_ENROLLMENT_TTL_MS

  return ok({
    enabled: isConfirmed(row),
    confirmedAt: row?.confirmedAt ?? null,
    pending: pendingFresh,
    recoveryCodesRemaining: row ? await countUnusedRecoveryCodes(userId) : 0,
    // Only report a lock that is still in the future; a stale timestamp is not
    // a lock and showing one would just confuse whoever is reading the page.
    lockedUntil:
      row?.lockedUntil && row.lockedUntil.getTime() > Date.now() ? row.lockedUntil : null,
  })
}

/**
 * Start (or restart) an enrollment.
 *
 * The caller has already verified the password and, when a factor is already
 * confirmed, a second factor as well — see `beginEnrollment` in the route layer.
 * This function only mints the new secret and stores it as *pending*, so the
 * existing authenticator keeps working until a code proves the new one arrived.
 */
export const startEnrollment = async (
  userId: number,
  accountEmail: string,
  issuer: string,
): Promise<Result<EnrollmentOffer>> => {
  const secret = generateTotpSecret()
  const envelope = encryptTotpSecret(secret, userId)
  const now = new Date()

  await db
    .insert(userTotp)
    .values({ userId, pendingSecret: envelope, pendingCreatedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: userTotp.userId,
      set: { pendingSecret: envelope, pendingCreatedAt: now, updatedAt: now },
    })

  await logAudit(userId, 'auth.2fa.enroll_started', userId, 'TOTP enrollment started')

  const url = otpauthUrl({ issuer, account: accountEmail, secret })
  return ok({
    secret: base32Encode(secret).replace(/=+$/, ''),
    secretFormatted: formatSecretForDisplay(secret),
    otpauthUrl: url,
    qrSvg: qrSvgFor(url, { title: 'TOTP enrollment QR code' }),
  })
}

/**
 * Confirm a pending enrollment with a code from the authenticator, and issue the
 * recovery codes.
 *
 * Recovery codes are minted here rather than at `startEnrollment` on purpose: an
 * abandoned enrollment must not invalidate the codes the user is currently
 * relying on, and a set of codes for a secret that never reached a phone is
 * worse than useless — it is a set of standing credentials nobody wrote down.
 */
export const confirmEnrollment = async (
  userId: number,
  code: string,
): Promise<Result<{ recoveryCodes: string[] }>> => {
  const row = await loadRow(userId)
  if (!row?.pendingSecret || !row.pendingCreatedAt) {
    return err(400, 'No enrollment is in progress. Start again.')
  }
  if (Date.now() - row.pendingCreatedAt.getTime() >= PENDING_ENROLLMENT_TTL_MS) {
    // Clear it rather than leaving an expired secret in the row.
    await db
      .update(userTotp)
      .set({ pendingSecret: null, pendingCreatedAt: null, updatedAt: new Date() })
      .where(eq(userTotp.userId, userId))
    return err(400, 'This enrollment has expired. Start again.')
  }

  const lock = lockState(row)
  if (lock.locked) {
    await logAudit(
      userId,
      'auth.2fa.enroll_confirm_blocked',
      userId,
      `Confirmation attempted while locked out; lock expires ${lock.until.toISOString()}`,
    )
    return err(429, lockMessage(lock.until))
  }

  let pendingSecret: Buffer
  try {
    pendingSecret = decryptTotpSecret(row.pendingSecret, userId)
  } catch {
    // The stored envelope cannot be read — a rotated key, or a tampered row.
    // Fail, and say so plainly rather than letting the enrollment "succeed"
    // against a secret nobody can verify later.
    console.error('[2fa] Could not decrypt the pending TOTP secret; check TOTP_ENCRYPTION_KEY')
    await logAudit(userId, 'auth.2fa.enroll_failed', userId, 'Pending secret could not be decrypted')
    return err(500, 'The stored enrollment could not be read. Start again.')
  }

  const verification = verifyTotp(pendingSecret, code, Math.floor(Date.now() / 1000))
  if (!verification.valid) {
    const failure = await recordFailure(userId, 'enroll_confirm')
    return failureResult(failure, 'That code is not valid.')
  }

  const now = new Date()
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode)

  // One transaction: promoting the secret and replacing the recovery codes are a
  // single change. Half of it applied would leave a confirmed factor whose
  // recovery codes belong to the previous one.
  await db.transaction(async (tx) => {
    await tx
      .update(userTotp)
      .set({
        secret: row.pendingSecret,
        pendingSecret: null,
        pendingCreatedAt: null,
        confirmedAt: now,
        // The confirming code is spent, like any other.
        lastUsedStep: verification.step,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(userTotp.userId, userId))

    // Previous codes go, used or not: they were issued against the old secret
    // and leaving them live would mean an old backup code still bypasses the new
    // factor.
    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId))
    await tx
      .insert(userRecoveryCodes)
      .values(codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })))
  })

  await logAudit(
    userId,
    'auth.2fa.enabled',
    userId,
    `TOTP confirmed; ${RECOVERY_CODE_COUNT} recovery codes issued`,
  )

  return ok({ recoveryCodes: codes.map(formatRecoveryCode) })
}

interface LockState {
  locked: boolean
  until: Date
}

const lockState = (row: { lockedUntil: Date | null } | undefined): LockState => {
  const until = row?.lockedUntil ?? new Date(0)
  return { locked: until.getTime() > Date.now(), until }
}

const lockMessage = (until: Date | null): string => {
  const minutes = until ? Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000)) : 15
  return `Too many incorrect codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}

/**
 * Turn a counted failure into a response.
 *
 * The attempt that trips the limit answers 429, not 400: it IS a rate-limit
 * response, and a caller that only looks at the status would otherwise retry
 * straight into a locked door and log it as a bad password.
 */
const failureResult = (
  failure: { locked: boolean; lockedUntil: Date | null },
  message: string,
): Result<never> =>
  failure.locked ? err(429, lockMessage(failure.lockedUntil)) : err(400, message)

/**
 * Count a failure and lock the factor once the allowance is gone.
 *
 * The increment and the lock decision are one UPDATE so two requests racing each
 * other cannot both read "4 failures" and each write "5" — which is how a
 * counter-based limit becomes twice as generous under exactly the concurrency an
 * attacker would use.
 */
const recordFailure = async (
  userId: number,
  stage: string,
): Promise<{ attempts: number; locked: boolean; lockedUntil: Date | null }> => {
  const [updated] = await db
    .update(userTotp)
    .set({
      failedAttempts: sql`${userTotp.failedAttempts} + 1`,
      lockedUntil: sql`CASE WHEN ${userTotp.failedAttempts} + 1 >= ${MFA_MAX_FAILED_ATTEMPTS}
        THEN NOW() + ${sql.raw(`INTERVAL '${MFA_LOCKOUT_MS} milliseconds'`)}
        ELSE ${userTotp.lockedUntil} END`,
      updatedAt: new Date(),
    })
    .where(eq(userTotp.userId, userId))
    .returning({ failedAttempts: userTotp.failedAttempts, lockedUntil: userTotp.lockedUntil })

  const attempts = updated?.failedAttempts ?? 0
  const locked = Boolean(updated?.lockedUntil && updated.lockedUntil.getTime() > Date.now())

  // The audit entry names the count and whether the lock engaged: "one wrong
  // code" and "the fifth wrong code in a row, factor now locked" are the same
  // event to a user and completely different events to whoever reads this log.
  await logAudit(
    userId,
    locked ? 'auth.2fa.locked' : 'auth.2fa.failed',
    userId,
    locked
      ? `Second factor locked after ${attempts} consecutive failures (${stage}); locked until ${updated?.lockedUntil?.toISOString() ?? 'unknown'}`
      : `Invalid second factor (${stage}); ${attempts} of ${MFA_MAX_FAILED_ATTEMPTS} consecutive failures`,
  )

  return { attempts, locked, lockedUntil: updated?.lockedUntil ?? null }
}

const clearFailures = async (userId: number, extra: Record<string, unknown> = {}): Promise<void> => {
  await db
    .update(userTotp)
    .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date(), ...extra })
    .where(eq(userTotp.userId, userId))
}

export type SecondFactorKind = 'totp' | 'recovery_code'

export interface SecondFactorSuccess {
  kind: SecondFactorKind
  /** Unused recovery codes left afterwards, so the UI can warn when it is low. */
  recoveryCodesRemaining: number
}

/**
 * Verify a second factor: a TOTP code, or one of the recovery codes.
 *
 * Both are accepted through the same door because the caller cannot know which
 * the user has to hand — the whole point of a recovery code is that the
 * authenticator is gone. A recovery code is distinguishable by shape (letters
 * and 20 characters against six digits), so there is no ambiguity to resolve.
 */
export const verifySecondFactor = async (
  userId: number,
  submitted: string,
  { stage = 'login' }: { stage?: string } = {},
): Promise<Result<SecondFactorSuccess>> => {
  const row = await loadRow(userId)
  if (!isConfirmed(row) || !row?.secret) {
    // Nothing to verify against. This is a caller bug, not a user error, and
    // must not be reported as "wrong code" — that would let a login proceed on
    // the assumption that a factor exists when it does not.
    return err(400, 'No second factor is set up for this account.')
  }

  const lock = lockState(row)
  if (lock.locked) {
    // A blocked attempt is logged too. Without it the log shows five failures
    // and then silence, and the operator cannot tell whether the attacker gave
    // up or simply kept hammering a locked door.
    await logAudit(
      userId,
      'auth.2fa.blocked',
      userId,
      `Attempt while locked out (${stage}); lock expires ${lock.until.toISOString()}`,
    )
    return err(429, lockMessage(lock.until))
  }

  const normalized = normalizeRecoveryCode(submitted)

  // Recovery code first, by shape: a 20-character alphanumeric is never a TOTP
  // code, so this cannot shadow one.
  if (normalized.length === RECOVERY_CODE_LENGTH) {
    return verifyRecoveryCode(userId, normalized, stage)
  }

  let secret: Buffer
  try {
    secret = decryptTotpSecret(row.secret, userId)
  } catch {
    // Fail CLOSED. A secret we cannot read means we cannot check the factor, and
    // the one thing that must not happen is treating an unreadable factor as
    // absent and letting the login through.
    console.error('[2fa] Could not decrypt the stored TOTP secret; check TOTP_ENCRYPTION_KEY')
    await logAudit(userId, 'auth.2fa.error', userId, 'Stored secret could not be decrypted')
    return err(500, 'The second factor could not be verified. See the server log.')
  }

  const verification = verifyTotp(secret, submitted, Math.floor(Date.now() / 1000))
  if (!verification.valid || verification.step === null) {
    const failure = await recordFailure(userId, stage)
    return failureResult(failure, 'That code is not valid.')
  }

  // Replay guard. The ±1 window means a code stays arithmetically valid for 90
  // seconds; single use is what makes it useless to anyone who saw it after the
  // fact.
  //
  // One conditional UPDATE claims the step, for the same reason verifyRecoveryCode
  // spends a code in one statement: SELECT-then-UPDATE lets two simultaneous
  // requests carrying the SAME code both read the old `last_used_step`, both pass
  // the comparison, and both write — which makes "each code is usable once" true
  // only when nobody is trying. `lt` rather than `<>` so a code from an earlier
  // step in the window cannot be used after a later one.
  const [claimed] = await db
    .update(userTotp)
    .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date(), lastUsedStep: verification.step })
    .where(
      and(
        eq(userTotp.userId, userId),
        or(isNull(userTotp.lastUsedStep), lt(userTotp.lastUsedStep, verification.step)),
      ),
    )
    .returning({ userId: userTotp.userId })

  if (!claimed) {
    const failure = await recordFailure(userId, `${stage}:replay`)
    return failureResult(failure, 'That code has already been used. Wait for the next one.')
  }
  await logAudit(userId, 'auth.2fa.verified', userId, `Second factor accepted (${stage}, TOTP)`)

  return ok({ kind: 'totp', recoveryCodesRemaining: await countUnusedRecoveryCodes(userId) })
}

/**
 * Spend a recovery code.
 *
 * A single conditional UPDATE does the lookup and the spending together, so two
 * simultaneous requests with the same code cannot both succeed: the second finds
 * `used_at` already set and matches nothing. Doing it as SELECT-then-UPDATE would
 * make "each code is usable once" true only when nobody is trying.
 */
const verifyRecoveryCode = async (
  userId: number,
  normalized: string,
  stage: string,
): Promise<Result<SecondFactorSuccess>> => {
  const now = new Date()
  const [spent] = await db
    .update(userRecoveryCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(userRecoveryCodes.userId, userId),
        eq(userRecoveryCodes.codeHash, hashRecoveryCode(normalized)),
        isNull(userRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: userRecoveryCodes.id })

  if (!spent) {
    const failure = await recordFailure(userId, `${stage}:recovery_code`)
    return failureResult(failure, 'That recovery code is not valid.')
  }

  await clearFailures(userId)
  const remaining = await countUnusedRecoveryCodes(userId)
  await logAudit(
    userId,
    'auth.2fa.recovery_code_used',
    userId,
    `Recovery code spent (${stage}); ${remaining} of ${RECOVERY_CODE_COUNT} remaining`,
  )

  return ok({ kind: 'recovery_code', recoveryCodesRemaining: remaining })
}

/**
 * The issuer shown in the authenticator app.
 *
 * Taken from the configured shop name where possible so the entry says what the
 * user recognises rather than the product's internal name. The colon is stripped
 * because it is the `otpauth` label separator, and a shop called "Acme: Cloud"
 * would otherwise produce an entry attributed to "Acme".
 */
export const totpIssuer = (shopName: string | null | undefined): string => {
  const cleaned = (shopName ?? '').replace(/:/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : 'Open Hybrid Cloud'
}

/**
 * The user a 2FA operation applies to, with the password hash the caller needs
 * to re-check the password.
 *
 * Only local password accounts are eligible: an SSO user has no password to
 * re-authenticate with, and their MFA is Entra ID's job (see issue #36). Saying
 * so explicitly beats returning "wrong password" for an account that has none.
 */
export const loadLocalAccount = async (
  userId: number,
): Promise<Result<{ id: number; email: string; passwordHash: string; role: string }>> => {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      role: users.role,
      active: users.active,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const user = rows[0]
  if (!user || !user.active) return err(404, 'User not found')
  if (!user.passwordHash) {
    return err(
      400,
      'This account signs in through single sign-on; its second factor is managed by the identity provider.',
    )
  }
  return ok({ id: user.id, email: user.email, passwordHash: user.passwordHash, role: user.role })
}
