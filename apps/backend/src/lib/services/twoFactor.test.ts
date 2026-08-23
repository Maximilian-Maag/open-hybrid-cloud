import { describe, it, expect } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { auditLog, userRecoveryCodes, users, userTotp } from '@/lib/db/schema'
import { createUser, currentTotpCode, enrollTotp, waitUntilBlocked } from '@/test/helpers'
import { base32Decode, generateTotpSecret, totp } from '@/lib/auth/totp'
import { encryptTotpSecret, isEncryptedTotpSecret } from '@/lib/auth/totpSecret'
import {
  confirmEnrollment,
  getTwoFactorStatus,
  loadTwoFactorAccount,
  MFA_LOCKOUT_MS,
  MFA_MAX_FAILED_ATTEMPTS,
  normalizeRecoveryCode,
  PENDING_ENROLLMENT_TTL_MS,
  RECOVERY_CODE_COUNT,
  requiresSecondFactor,
  startEnrollment,
  totpIssuer,
  verifySecondFactor,
} from './twoFactor'

const auditActions = async (userId: number): Promise<string[]> => {
  const rows = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.userId, userId))
  return rows.map((r) => r.action)
}

const auditDetails = async (userId: number, action: string): Promise<string[]> => {
  const rows = await db
    .select({ details: auditLog.details, action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.userId, userId))
  return rows.filter((r) => r.action === action).map((r) => r.details)
}

/**
 * Every 2FA path is root-only (#36), so the fixture user is root unless a test is
 * specifically about some other role.
 */
const createRoot = (overrides?: Parameters<typeof createUser>[0]) =>
  createUser({ role: 'root', ...overrides })

const row = async (userId: number) =>
  (await db.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1))[0]

/** Enroll and confirm through the real service, returning the secret and codes. */
const fullyEnroll = async (userId: number, email = 'root@test.dev') => {
  const offer = await startEnrollment(userId, email, 'Open Hybrid Cloud')
  expect(offer.ok).toBe(true)
  if (!offer.ok) throw new Error('unreachable')
  const secret = base32Decode(offer.data.secret)
  const confirmed = await confirmEnrollment(userId, totp(secret, Math.floor(Date.now() / 1000)))
  expect(confirmed.ok).toBe(true)
  if (!confirmed.ok) throw new Error('unreachable')
  return { secret, recoveryCodes: confirmed.data.recoveryCodes, offer: offer.data }
}

describe('requiresSecondFactor', () => {
  it('is false for a user with no row — the bootstrap case', async () => {
    const u = await createRoot()
    expect(await requiresSecondFactor(u.id)).toBe(false)
  })

  it('is false while an enrollment is only pending', async () => {
    const u = await createRoot()
    await enrollTotp(u.id, { confirmed: false })
    expect(await requiresSecondFactor(u.id)).toBe(false)
  })

  it('is true once an enrollment is confirmed', async () => {
    const u = await createRoot()
    await enrollTotp(u.id)
    expect(await requiresSecondFactor(u.id)).toBe(true)
  })
})

describe('startEnrollment', () => {
  it('stores the secret encrypted, never in the clear', async () => {
    const u = await createRoot({ email: 'enc@test.dev' })
    const offer = await startEnrollment(u.id, u.email, 'Open Hybrid Cloud')
    expect(offer.ok).toBe(true)
    if (!offer.ok) return

    const stored = await row(u.id)
    expect(stored.pendingSecret).toBeTruthy()
    expect(isEncryptedTotpSecret(stored.pendingSecret ?? '')).toBe(true)
    // The base32 the user was shown must not appear anywhere in the column.
    expect(stored.pendingSecret).not.toContain(offer.data.secret)
    expect(stored.secret).toBeNull()
  })

  it('offers a QR code, a key URI and a typable secret that all describe the same key', async () => {
    const u = await createRoot({ email: 'qr@test.dev' })
    const offer = await startEnrollment(u.id, u.email, 'Open Hybrid Cloud')
    if (!offer.ok) return expect.unreachable()

    const fromUrl = new URL(offer.data.otpauthUrl).searchParams.get('secret')
    expect(fromUrl).toBe(offer.data.secret)
    expect(offer.data.secretFormatted.replace(/ /g, '')).toBe(offer.data.secret)
    expect(base32Decode(offer.data.secret)).toHaveLength(20)
    expect(offer.data.qrSvg.startsWith('<svg')).toBe(true)
    expect(offer.data.otpauthUrl).toContain('algorithm=SHA1')
    expect(offer.data.otpauthUrl).toContain('digits=6')
    expect(offer.data.otpauthUrl).toContain('period=30')
  })

  it('leaves a confirmed factor working while a re-enrollment is in flight', async () => {
    const u = await createRoot({ email: 'reenroll@test.dev' })
    const { secret } = await fullyEnroll(u.id, u.email)

    await startEnrollment(u.id, u.email, 'Open Hybrid Cloud')

    const stored = await row(u.id)
    expect(stored.secret).toBeTruthy()
    expect(stored.confirmedAt).not.toBeNull()
    expect(stored.pendingSecret).toBeTruthy()
    expect(stored.pendingSecret).not.toBe(stored.secret)
    // The OLD authenticator still verifies — losing access halfway through a
    // re-enrollment must not lock anyone out.
    expect(await requiresSecondFactor(u.id)).toBe(true)
    const check = await verifySecondFactor(u.id, currentTotpCode(secret, 1))
    expect(check.ok).toBe(true)
  })

  it('replaces an earlier pending secret rather than accumulating them', async () => {
    const u = await createRoot()
    const first = await startEnrollment(u.id, u.email, 'OHC')
    const second = await startEnrollment(u.id, u.email, 'OHC')
    if (!first.ok || !second.ok) return expect.unreachable()
    expect(second.data.secret).not.toBe(first.data.secret)

    // Only the newest one confirms.
    const stale = await confirmEnrollment(u.id, totp(base32Decode(first.data.secret), Math.floor(Date.now() / 1000)))
    expect(stale.ok).toBe(false)
  })

  it('records the start in the audit log', async () => {
    const u = await createRoot()
    await startEnrollment(u.id, u.email, 'OHC')
    expect(await auditActions(u.id)).toContain('auth.2fa.enroll_started')
  })
})

describe('confirmEnrollment', () => {
  it('refuses when nothing is pending', async () => {
    const u = await createRoot()
    const result = await confirmEnrollment(u.id, '000000')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('promotes the pending secret and issues recovery codes on a valid code', async () => {
    const u = await createRoot({ email: 'confirm@test.dev' })
    const { recoveryCodes } = await fullyEnroll(u.id, u.email)

    const stored = await row(u.id)
    expect(stored.secret).toBeTruthy()
    expect(stored.pendingSecret).toBeNull()
    expect(stored.pendingCreatedAt).toBeNull()
    expect(stored.confirmedAt).not.toBeNull()
    expect(recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT)
    expect(new Set(recoveryCodes).size).toBe(RECOVERY_CODE_COUNT)
  })

  it('stores recovery codes hashed, and never the codes themselves', async () => {
    const u = await createRoot()
    const { recoveryCodes } = await fullyEnroll(u.id)

    const stored = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, u.id))
    expect(stored).toHaveLength(RECOVERY_CODE_COUNT)
    for (const code of recoveryCodes) {
      // Neither the printed form nor the normalised form appears in any row.
      expect(stored.some((r) => r.codeHash === code)).toBe(false)
      expect(stored.some((r) => r.codeHash === normalizeRecoveryCode(code))).toBe(false)
      expect(stored.some((r) => r.codeHash.includes(normalizeRecoveryCode(code)))).toBe(false)
    }
    // SHA-256 hex.
    for (const r of stored) expect(r.codeHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('issues 100 bits per recovery code, grouped so it can be read off paper', async () => {
    const u = await createRoot()
    const { recoveryCodes } = await fullyEnroll(u.id)
    for (const code of recoveryCodes) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/)
      expect(normalizeRecoveryCode(code)).toHaveLength(20)
      // 0/1/8/9 and I/O are absent, so nothing can be misread off a screenshot.
      expect(code).not.toMatch(/[01OI]/)
    }
  })

  it('rejects a wrong code and does not activate the factor', async () => {
    const u = await createRoot()
    await startEnrollment(u.id, u.email, 'OHC')
    const result = await confirmEnrollment(u.id, '000000')
    expect(result.ok).toBe(false)

    const stored = await row(u.id)
    expect(stored.secret).toBeNull()
    expect(stored.confirmedAt).toBeNull()
    expect(await requiresSecondFactor(u.id)).toBe(false)
  })

  it('spends the confirming code, so it cannot be replayed at the next login', async () => {
    const u = await createRoot()
    const offer = await startEnrollment(u.id, u.email, 'OHC')
    if (!offer.ok) return expect.unreachable()
    const secret = base32Decode(offer.data.secret)
    const code = currentTotpCode(secret)

    expect((await confirmEnrollment(u.id, code)).ok).toBe(true)

    const replay = await verifySecondFactor(u.id, code)
    expect(replay.ok).toBe(false)
    if (!replay.ok) expect(replay.message).toMatch(/already been used/)
  })

  it('accepts a code exactly once even when two requests race (replay, concurrent)', async () => {
    const u = await createRoot()
    const offer = await startEnrollment(u.id, u.email, 'OHC')
    if (!offer.ok) return expect.unreachable()
    const secret = base32Decode(offer.data.secret)

    // Confirm with one step, then race the NEXT step's code against itself.
    expect((await confirmEnrollment(u.id, currentTotpCode(secret))).ok).toBe(true)
    const code = currentTotpCode(secret, 1)

    // Sequential replay tests pass even against a read-then-write guard, which is
    // exactly how a non-atomic claim survives review. Fire both at once instead.
    const [a, b] = await Promise.all([
      verifySecondFactor(u.id, code),
      verifySecondFactor(u.id, code),
    ])

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    const rejected = a.ok ? b : a
    if (!rejected.ok) expect(rejected.message).toMatch(/already been used/)
  })

  it('drops recovery codes issued against a previous secret', async () => {
    const u = await createRoot()
    const first = await fullyEnroll(u.id)

    // Re-enroll from scratch.
    const offer = await startEnrollment(u.id, u.email, 'OHC')
    if (!offer.ok) return expect.unreachable()
    await confirmEnrollment(u.id, currentTotpCode(base32Decode(offer.data.secret), 1))

    // An old backup code must not bypass the new factor.
    const stale = await verifySecondFactor(u.id, first.recoveryCodes[0])
    expect(stale.ok).toBe(false)
    expect(await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, u.id))).toHaveLength(
      RECOVERY_CODE_COUNT,
    )
  })

  it('refuses an enrollment that has gone stale', async () => {
    const u = await createRoot()
    const offer = await startEnrollment(u.id, u.email, 'OHC')
    if (!offer.ok) return expect.unreachable()

    await db
      .update(userTotp)
      .set({ pendingCreatedAt: new Date(Date.now() - PENDING_ENROLLMENT_TTL_MS - 1000) })
      .where(eq(userTotp.userId, u.id))

    const result = await confirmEnrollment(u.id, currentTotpCode(base32Decode(offer.data.secret)))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/expired/)
    // And the stale secret is gone rather than left lying in the row.
    expect((await row(u.id)).pendingSecret).toBeNull()
  })

  it('logs the activation', async () => {
    const u = await createRoot()
    await fullyEnroll(u.id)
    expect(await auditActions(u.id)).toContain('auth.2fa.enabled')
  })

  it('does not promote its own secret over an enrollment that replaced it', async () => {
    const u = await createRoot()
    const offer = await startEnrollment(u.id, u.email, 'OHC')
    if (!offer.ok) return expect.unreachable()
    const code = currentTotpCode(base32Decode(offer.data.secret))

    // Hold the row so the confirmation gets past its read and stops at its
    // write: the exact window in which a second tab starts a new enrollment.
    const newer = encryptTotpSecret(generateTotpSecret(), u.id)
    const holder = db.transaction(async (tx) => {
      await tx.select().from(userTotp).where(eq(userTotp.userId, u.id)).for('update')
      await waitUntilBlocked('the confirmation never reached its UPDATE')
      await tx
        .update(userTotp)
        .set({ pendingSecret: newer, pendingCreatedAt: new Date() })
        .where(eq(userTotp.userId, u.id))
    })

    const confirming = confirmEnrollment(u.id, code)
    const [result] = await Promise.all([confirming, holder])

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)

    // The newer enrollment is untouched, and nothing was activated against a
    // secret the user had already walked away from.
    const stored = await row(u.id)
    expect(stored.pendingSecret).toBe(newer)
    expect(stored.secret).toBeNull()
    expect(stored.confirmedAt).toBeNull()
  })

  it('expiring a stale enrollment does not clear the one that replaced it', async () => {
    const u = await createRoot()
    const offer = await startEnrollment(u.id, u.email, 'OHC')
    if (!offer.ok) return expect.unreachable()
    await db
      .update(userTotp)
      .set({ pendingCreatedAt: new Date(Date.now() - PENDING_ENROLLMENT_TTL_MS - 1000) })
      .where(eq(userTotp.userId, u.id))

    const newer = encryptTotpSecret(generateTotpSecret(), u.id)
    const holder = db.transaction(async (tx) => {
      await tx.select().from(userTotp).where(eq(userTotp.userId, u.id)).for('update')
      await waitUntilBlocked('the confirmation never reached its UPDATE')
      await tx
        .update(userTotp)
        .set({ pendingSecret: newer, pendingCreatedAt: new Date() })
        .where(eq(userTotp.userId, u.id))
    })

    const [result] = await Promise.all([
      confirmEnrollment(u.id, currentTotpCode(base32Decode(offer.data.secret))),
      holder,
    ])

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/expired/)
    // The expiry clear is conditional, so it wiped nothing: an unconditional
    // one would have thrown away a secret stored seconds ago.
    expect((await row(u.id)).pendingSecret).toBe(newer)
  })
})

describe('verifySecondFactor — TOTP', () => {
  it('accepts a current code', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)
    const result = await verifySecondFactor(u.id, currentTotpCode(secret))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.kind).toBe('totp')
  })

  it('accepts the adjacent window for clock skew', async () => {
    for (const offset of [-1, 1]) {
      const u = await createRoot()
      const secret = await enrollTotp(u.id)
      const result = await verifySecondFactor(u.id, currentTotpCode(secret, offset))
      expect(result.ok, `offset ${offset}`).toBe(true)
    }
  })

  it('rejects two steps out', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)
    expect((await verifySecondFactor(u.id, currentTotpCode(secret, -2))).ok).toBe(false)
  })

  it('refuses a code that has already been used inside its window (replay)', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)
    const code = currentTotpCode(secret)

    expect((await verifySecondFactor(u.id, code)).ok).toBe(true)
    const replay = await verifySecondFactor(u.id, code)
    expect(replay.ok).toBe(false)
    if (!replay.ok) expect(replay.message).toMatch(/already been used/)
  })

  it('refuses an earlier code in the window after a later one was accepted', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)

    expect((await verifySecondFactor(u.id, currentTotpCode(secret, 1))).ok).toBe(true)
    // The current-step code is arithmetically valid but belongs to an earlier
    // step than the one already spent.
    const earlier = await verifySecondFactor(u.id, currentTotpCode(secret, 0))
    expect(earlier.ok).toBe(false)
  })

  it('records the accepted step so the replay guard survives a restart', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)
    await verifySecondFactor(u.id, currentTotpCode(secret))
    expect((await row(u.id)).lastUsedStep).toBe(Math.floor(Date.now() / 1000 / 30))
  })

  it('refuses when no factor is set up, instead of reporting a wrong code', async () => {
    const u = await createRoot()
    const result = await verifySecondFactor(u.id, '123456')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/No second factor/)
  })

  it('fails closed when the stored secret cannot be decrypted', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)
    // Simulate a rotated key / tampered row.
    await db
      .update(userTotp)
      .set({ secret: 'v1.AAAAAAAAAAAAAAAA.AAAA.AAAAAAAAAAAAAAAAAAAAAA' })
      .where(eq(userTotp.userId, u.id))

    const result = await verifySecondFactor(u.id, currentTotpCode(secret))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(500)
    expect(await auditActions(u.id)).toContain('auth.2fa.error')
  })

  it('logs an accepted factor', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)
    await verifySecondFactor(u.id, currentTotpCode(secret))
    expect(await auditActions(u.id)).toContain('auth.2fa.verified')
  })
})

describe('verifySecondFactor — recovery codes', () => {
  it('accepts a recovery code and spends it', async () => {
    const u = await createRoot()
    const { recoveryCodes } = await fullyEnroll(u.id)

    const result = await verifySecondFactor(u.id, recoveryCodes[0])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.kind).toBe('recovery_code')
      expect(result.data.recoveryCodesRemaining).toBe(RECOVERY_CODE_COUNT - 1)
    }
  })

  it('accepts each code exactly once', async () => {
    const u = await createRoot()
    const { recoveryCodes } = await fullyEnroll(u.id)

    expect((await verifySecondFactor(u.id, recoveryCodes[3])).ok).toBe(true)
    const second = await verifySecondFactor(u.id, recoveryCodes[3])
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.message).toMatch(/not valid/)
  })

  it('keeps the spent row so the audit trail can show it was used', async () => {
    const u = await createRoot()
    const { recoveryCodes } = await fullyEnroll(u.id)
    await verifySecondFactor(u.id, recoveryCodes[0])

    const all = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, u.id))
    expect(all).toHaveLength(RECOVERY_CODE_COUNT)
    expect(all.filter((r) => r.usedAt !== null)).toHaveLength(1)
  })

  it('accepts a code however the user pastes it back', async () => {
    const u = await createRoot()
    const { recoveryCodes } = await fullyEnroll(u.id)
    const raw = recoveryCodes[0]

    // Lower case, no dashes, stray whitespace.
    const mangled = ` ${raw.replace(/-/g, '').toLowerCase()} `
    expect((await verifySecondFactor(u.id, mangled)).ok).toBe(true)
  })

  it('does not accept one user’s recovery code for another user', async () => {
    const a = await createRoot()
    const b = await createRoot()
    const { recoveryCodes } = await fullyEnroll(a.id)
    await enrollTotp(b.id)

    expect((await verifySecondFactor(b.id, recoveryCodes[0])).ok).toBe(false)
    // And a's code is still unspent.
    const unused = await db
      .select()
      .from(userRecoveryCodes)
      .where(and(eq(userRecoveryCodes.userId, a.id), isNull(userRecoveryCodes.usedAt)))
    expect(unused).toHaveLength(RECOVERY_CODE_COUNT)
  })

  it('logs the use and how many are left', async () => {
    const u = await createRoot()
    const { recoveryCodes } = await fullyEnroll(u.id)
    await verifySecondFactor(u.id, recoveryCodes[0])

    const details = await auditDetails(u.id, 'auth.2fa.recovery_code_used')
    expect(details).toHaveLength(1)
    expect(details[0]).toContain(`${RECOVERY_CODE_COUNT - 1} of ${RECOVERY_CODE_COUNT}`)
  })

  it('a wrong 20-character string is a failure, not a TOTP attempt', async () => {
    const u = await createRoot()
    await enrollTotp(u.id)
    const result = await verifySecondFactor(u.id, 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/recovery code is not valid/)
  })
})

describe('rate limiting', () => {
  it('locks the factor after the allowed number of consecutive failures', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)

    for (let i = 1; i < MFA_MAX_FAILED_ATTEMPTS; i++) {
      const attempt = await verifySecondFactor(u.id, '000000')
      expect(attempt.ok, `attempt ${i}`).toBe(false)
      if (!attempt.ok) expect(attempt.status, `attempt ${i}`).toBe(400)
    }

    const last = await verifySecondFactor(u.id, '000000')
    expect(last.ok).toBe(false)
    if (!last.ok) {
      expect(last.status).toBe(429)
      expect(last.message).toMatch(/Too many incorrect codes/)
    }

    // And now even the RIGHT code is refused — that is the point of a lock.
    const correct = await verifySecondFactor(u.id, currentTotpCode(secret))
    expect(correct.ok).toBe(false)
    if (!correct.ok) expect(correct.status).toBe(429)
  })

  it('locks for the configured window', async () => {
    const u = await createRoot()
    await enrollTotp(u.id)
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i++) await verifySecondFactor(u.id, '000000')

    const lockedUntil = (await row(u.id)).lockedUntil
    expect(lockedUntil).not.toBeNull()
    const remaining = (lockedUntil?.getTime() ?? 0) - Date.now()
    // Allow a generous margin for the round trips above.
    expect(remaining).toBeGreaterThan(MFA_LOCKOUT_MS - 60_000)
    expect(remaining).toBeLessThanOrEqual(MFA_LOCKOUT_MS + 1000)
  })

  it('lets the user back in once the lock expires', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i++) await verifySecondFactor(u.id, '000000')

    await db
      .update(userTotp)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(userTotp.userId, u.id))

    expect((await verifySecondFactor(u.id, currentTotpCode(secret))).ok).toBe(true)
  })

  it('counts CONSECUTIVE failures — a success clears the tally', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)

    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS - 1; i++) await verifySecondFactor(u.id, '000000')
    expect((await row(u.id)).failedAttempts).toBe(MFA_MAX_FAILED_ATTEMPTS - 1)

    expect((await verifySecondFactor(u.id, currentTotpCode(secret))).ok).toBe(true)
    expect((await row(u.id)).failedAttempts).toBe(0)
    expect((await row(u.id)).lockedUntil).toBeNull()
  })

  it('counts recovery-code failures towards the same limit', async () => {
    const u = await createRoot()
    await enrollTotp(u.id)
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS - 1; i++) {
      await verifySecondFactor(u.id, 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ')
    }
    const last = await verifySecondFactor(u.id, 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ')
    expect(last.ok).toBe(false)
    if (!last.ok) expect(last.status).toBe(429)
  })

  it('counts replay attempts, so a replay loop is not free', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)
    const code = currentTotpCode(secret)
    await verifySecondFactor(u.id, code)

    await verifySecondFactor(u.id, code)
    expect((await row(u.id)).failedAttempts).toBe(1)
    expect(await auditDetails(u.id, 'auth.2fa.failed')).toEqual([
      expect.stringContaining('login:replay'),
    ])
  })

  it('names the attempt count and the lock in the audit entries', async () => {
    const u = await createRoot()
    await enrollTotp(u.id)
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i++) await verifySecondFactor(u.id, '000000')

    const failures = await auditDetails(u.id, 'auth.2fa.failed')
    expect(failures).toHaveLength(MFA_MAX_FAILED_ATTEMPTS - 1)
    expect(failures[0]).toContain(`1 of ${MFA_MAX_FAILED_ATTEMPTS}`)
    expect(failures[failures.length - 1]).toContain(
      `${MFA_MAX_FAILED_ATTEMPTS - 1} of ${MFA_MAX_FAILED_ATTEMPTS}`,
    )

    const locks = await auditDetails(u.id, 'auth.2fa.locked')
    expect(locks).toHaveLength(1)
    expect(locks[0]).toMatch(/locked after 5 consecutive failures/)
    expect(locks[0]).toMatch(/locked until /)
  })

  it('logs attempts made while already locked, so the log does not just go quiet', async () => {
    const u = await createRoot()
    await enrollTotp(u.id)
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i++) await verifySecondFactor(u.id, '000000')

    await verifySecondFactor(u.id, '111111')
    await verifySecondFactor(u.id, '222222')
    expect(await auditDetails(u.id, 'auth.2fa.blocked')).toHaveLength(2)
  })

  it('does not let a locked-out attacker keep the lock from ever expiring', async () => {
    const u = await createRoot()
    const secret = await enrollTotp(u.id)
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i++) await verifySecondFactor(u.id, '000000')
    const originalLock = (await row(u.id)).lockedUntil

    // Attempts while locked are rejected before the counter is touched, so they
    // cannot push the expiry further out.
    await verifySecondFactor(u.id, '000000')
    await verifySecondFactor(u.id, currentTotpCode(secret))
    expect((await row(u.id)).lockedUntil?.getTime()).toBe(originalLock?.getTime())
    expect((await row(u.id)).failedAttempts).toBe(MFA_MAX_FAILED_ATTEMPTS)
  })

  it('blocks a confirmation attempt while the factor is locked', async () => {
    const u = await createRoot()
    await enrollTotp(u.id)
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i++) await verifySecondFactor(u.id, '000000')
    await startEnrollment(u.id, u.email, 'OHC')

    const result = await confirmEnrollment(u.id, '000000')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(429)
    expect(await auditActions(u.id)).toContain('auth.2fa.enroll_confirm_blocked')
  })
})

describe('getTwoFactorStatus', () => {
  it('reports nothing for a user who never enrolled', async () => {
    const u = await createRoot()
    const status = await getTwoFactorStatus(u.id)
    expect(status.ok).toBe(true)
    if (status.ok) {
      expect(status.data).toEqual({
        enabled: false,
        confirmedAt: null,
        pending: false,
        recoveryCodesRemaining: 0,
        lockedUntil: null,
      })
    }
  })

  it('reports a pending enrollment', async () => {
    const u = await createRoot()
    await startEnrollment(u.id, u.email, 'OHC')
    const status = await getTwoFactorStatus(u.id)
    if (!status.ok) return expect.unreachable()
    expect(status.data.pending).toBe(true)
    expect(status.data.enabled).toBe(false)
  })

  it('does not report a stale pending enrollment as pending', async () => {
    const u = await createRoot()
    await startEnrollment(u.id, u.email, 'OHC')
    await db
      .update(userTotp)
      .set({ pendingCreatedAt: new Date(Date.now() - PENDING_ENROLLMENT_TTL_MS - 1) })
      .where(eq(userTotp.userId, u.id))

    const status = await getTwoFactorStatus(u.id)
    if (!status.ok) return expect.unreachable()
    expect(status.data.pending).toBe(false)
  })

  it('reports the live state and never the secret', async () => {
    const u = await createRoot()
    const { recoveryCodes } = await fullyEnroll(u.id)
    await verifySecondFactor(u.id, recoveryCodes[0])

    const status = await getTwoFactorStatus(u.id)
    if (!status.ok) return expect.unreachable()
    expect(status.data.enabled).toBe(true)
    expect(status.data.confirmedAt).toBeInstanceOf(Date)
    expect(status.data.recoveryCodesRemaining).toBe(RECOVERY_CODE_COUNT - 1)
    expect(JSON.stringify(status.data)).not.toMatch(/secret/i)
  })

  it('does not report an expired lock as a lock', async () => {
    const u = await createRoot()
    await enrollTotp(u.id)
    await db
      .update(userTotp)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(userTotp.userId, u.id))

    const status = await getTwoFactorStatus(u.id)
    if (!status.ok) return expect.unreachable()
    expect(status.data.lockedUntil).toBeNull()
  })
})

describe('loadTwoFactorAccount', () => {
  it('returns the account for a local password user', async () => {
    const u = await createRoot({ email: 'local@test.dev', role: 'root' })
    const result = await loadTwoFactorAccount(u.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.email).toBe('local@test.dev')
  })

  it('refuses an SSO account, and says why', async () => {
    const [u] = await db
      .insert((await import('@/lib/db/schema')).users)
      .values({ email: 'sso@test.dev', name: 'SSO', role: 'admin', ssoSub: 'sub-1', active: true })
      .returning()

    const result = await loadTwoFactorAccount(u.id)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toMatch(/single sign-on/)
    }
  })

  it('refuses a deactivated account', async () => {
    const u = await createRoot({ active: false })
    const result = await loadTwoFactorAccount(u.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})

describe('totpIssuer', () => {
  it('uses the configured shop name', () => {
    expect(totpIssuer('Acme Cloud')).toBe('Acme Cloud')
  })

  it('strips the colon that would split the otpauth label', () => {
    expect(totpIssuer('Acme: Cloud')).toBe('Acme  Cloud')
  })

  it('falls back to the product name when branding is empty', () => {
    expect(totpIssuer('')).toBe('Open Hybrid Cloud')
    expect(totpIssuer(null)).toBe('Open Hybrid Cloud')
    expect(totpIssuer('   ')).toBe('Open Hybrid Cloud')
  })
})

describe('root only (#36)', () => {
  const OTHER_ROLES = ['admin', 'project_manager'] as const

  it('refuses to load a non-root account, whatever else is right about it', async () => {
    for (const role of OTHER_ROLES) {
      const u = await createUser({ role })
      const result = await loadTwoFactorAccount(u.id)
      expect(result.ok, role).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe(403)
        expect(result.message).toMatch(/root account only/)
      }
    }
  })

  it('refuses to start an enrollment for a non-root account', async () => {
    for (const role of OTHER_ROLES) {
      const u = await createUser({ role })
      const result = await startEnrollment(u.id, u.email, 'OHC')
      expect(result.ok, role).toBe(false)
      if (!result.ok) expect(result.status).toBe(403)
      // And nothing was written, so a role check added later cannot be walked
      // around by an enrollment that was already half-started.
      expect(await row(u.id)).toBeUndefined()
    }
  })

  it('refuses to confirm for a non-root account even when a row is pending', async () => {
    const u = await createUser({ role: 'admin' })
    // Bypass the service to build the state a missing guard would have left.
    const secret = await enrollTotp(u.id, { confirmed: false })

    const result = await confirmEnrollment(u.id, currentTotpCode(secret))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
    expect((await row(u.id)).confirmedAt).toBeNull()
    expect(await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, u.id))).toHaveLength(0)
  })

  it('refuses to report status for a non-root account', async () => {
    const u = await createUser({ role: 'project_manager' })
    const result = await getTwoFactorStatus(u.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('still requires a confirmed factor at login for a demoted account', async () => {
    // The documented decision: enrollment is root-only, so this row can only
    // come from a root account that was demoted afterwards. That user holds the
    // authenticator, so asking for the code is neither a silent downgrade nor a
    // lockout — see the comment on requiresSecondFactor.
    const u = await createRoot()
    const secret = await enrollTotp(u.id)
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, u.id))

    expect(await requiresSecondFactor(u.id)).toBe(true)
    // And the factor still verifies, so the login can actually complete.
    expect((await verifySecondFactor(u.id, currentTotpCode(secret))).ok).toBe(true)
  })
})

describe('2FA cannot be disabled', () => {
  it('has no service function that clears a confirmed factor', async () => {
    const service = await import('./twoFactor')
    for (const name of Object.keys(service)) {
      expect(name).not.toMatch(/disable|remove|delete|reset/i)
    }
  })

  it('leaves the factor enabled through every failure path', async () => {
    const u = await createRoot()
    await enrollTotp(u.id)

    // A pile of failures, a lock, and an abandoned re-enrollment.
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS + 3; i++) await verifySecondFactor(u.id, '000000')
    await startEnrollment(u.id, u.email, 'OHC')
    await confirmEnrollment(u.id, '000000')

    expect(await requiresSecondFactor(u.id)).toBe(true)
  })
})
