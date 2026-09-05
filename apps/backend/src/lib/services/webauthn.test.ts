import { describe, it, expect, vi, beforeEach } from 'vitest'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { webauthnChallenges, webauthnCredentials, userRecoveryCodes, auditLog } from '@/lib/db/schema'
import { createUser, enrollTotp } from '@/test/helpers'

/**
 * The ceremonies themselves belong to `@simplewebauthn/server`, which has its own
 * test suite and its own cryptography. Mocking it is deliberate: what is worth
 * testing here is everything AROUND the ceremony, and that is where the rules
 * this service adds actually live —
 *
 *   * a challenge is spent exactly once, and cannot be replayed;
 *   * a registration challenge is not an authentication challenge;
 *   * an assertion only counts for the account the credential belongs to;
 *   * the signature counter may not go backwards;
 *   * a first factor issues recovery codes and a second one must not;
 *   * the last factor on an administrator cannot be removed.
 *
 * None of those are the library's job, and all of them are ways to be logged in
 * as somebody else.
 */
const verifyRegistration = vi.fn()
const verifyAuthentication = vi.fn()
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: 'reg-challenge' })),
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'auth-challenge' })),
  verifyRegistrationResponse: (...a: unknown[]) => verifyRegistration(...a),
  verifyAuthenticationResponse: (...a: unknown[]) => verifyAuthentication(...a),
}))

const {
  startRegistration,
  finishRegistration,
  startAuthentication,
  verifyAuthentication: verifyAssertion,
  removeCredential,
  listCredentials,
} = await import('./webauthn')

// Shared with 2FA enrolment and `changePassword` since the counter was
// consolidated — one budget per account, not one per door.
const { passwordRecheckLimit } = await import('@/lib/auth/passwordRecheck')

const SHOP = 'Acme'

const registrationInfo = (id: string, counter = 0) => ({
  verified: true,
  registrationInfo: {
    credential: { id, publicKey: new Uint8Array([1, 2, 3]), counter },
    credentialBackedUp: false,
    credentialDeviceType: 'singleDevice',
  },
})

const response = (id: string) => ({ id, response: { transports: ['usb'] } }) as never

beforeEach(() => {
  verifyRegistration.mockReset()
  verifyAuthentication.mockReset()
  // Module-level by design, so one case's wrong guesses would throttle the next.
  passwordRecheckLimit.clear()
})

/** An administrator who may hold a factor but has none yet. */
const admin = () => createUser({ role: 'admin', secondFactor: false })

const register = async (userId: number, id: string, label = 'Key') => {
  verifyRegistration.mockResolvedValueOnce(registrationInfo(id))
  await startRegistration(userId, SHOP)
  return finishRegistration(userId, { label, response: response(id) }, SHOP)
}

describe('registration', () => {
  it('stores the credential and lists it', async () => {
    const u = await admin()
    const result = await register(u.id, 'cred-1', 'YubiKey')
    expect(result.ok).toBe(true)

    const list = await listCredentials(u.id)
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('YubiKey')
  })

  it('issues recovery codes for a FIRST factor of any kind', async () => {
    const u = await admin()
    const result = await register(u.id, 'cred-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.recoveryCodes).toHaveLength(10)
  })

  it('does not reissue them for a second key', async () => {
    // Reissuing would silently invalidate the set the user already wrote down —
    // the one piece of paper between them and an operator with database access.
    const u = await admin()
    await register(u.id, 'cred-1')
    const before = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, u.id))

    const second = await register(u.id, 'cred-2', 'Backup')
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.data.recoveryCodes).toBeUndefined()

    const after = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, u.id))
    expect(after.map((r) => r.codeHash).sort()).toEqual(before.map((r) => r.codeHash).sort())
  })

  it('does not issue them when the account already has TOTP', async () => {
    const u = await createUser({ role: 'admin' })
    const result = await register(u.id, 'cred-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.recoveryCodes).toBeUndefined()
  })

  it('spends the challenge, so the same response cannot be replayed', async () => {
    const u = await admin()
    await register(u.id, 'cred-1')

    // No new ceremony started: the row is gone, and a replay has nothing to
    // verify against.
    verifyRegistration.mockResolvedValueOnce(registrationInfo('cred-1'))
    const replay = await finishRegistration(u.id, { label: 'Again', response: response('cred-1') }, SHOP)
    expect(replay.ok).toBe(false)
    if (!replay.ok) expect(replay.message).toMatch(/expired/i)
  })

  it('refuses a project manager, like every other 2FA entry point', async () => {
    const u = await createUser({ role: 'project_manager' })
    const result = await startRegistration(u.id, SHOP)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it.each([[''], ['   '], ['x'.repeat(65)]])('refuses the label %j', async (label) => {
    const u = await admin()
    await startRegistration(u.id, SHOP)
    const result = await finishRegistration(u.id, { label, response: response('c') }, SHOP)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('stores nothing when the library rejects the response', async () => {
    const u = await admin()
    await startRegistration(u.id, SHOP)
    verifyRegistration.mockRejectedValueOnce(new Error('origin mismatch'))

    const result = await finishRegistration(u.id, { label: 'Key', response: response('c') }, SHOP)
    expect(result.ok).toBe(false)
    expect(await listCredentials(u.id)).toHaveLength(0)
  })
})

describe('authentication', () => {
  const authInfo = (newCounter: number) => ({ verified: true, authenticationInfo: { newCounter } })

  it('accepts an assertion and advances the counter', async () => {
    const u = await admin()
    await register(u.id, 'cred-1')
    await startAuthentication(u.id, SHOP)

    verifyAuthentication.mockResolvedValueOnce(authInfo(5))
    const result = await verifyAssertion(u.id, response('cred-1'), SHOP)
    expect(result.ok).toBe(true)

    const [row] = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, 'cred-1'))
    expect(row.counter).toBe(5)
    expect(row.lastUsedAt).not.toBeNull()
  })

  it('refuses a credential registered to a different account', async () => {
    // Without the user id in the WHERE, a valid assertion from anybody's key
    // would satisfy a challenge issued for somebody else's password.
    const mine = await admin()
    const theirs = await admin()
    await register(theirs.id, 'their-cred')
    await startAuthentication(mine.id, SHOP).catch(() => undefined)

    // `mine` has no credential, so give them one and aim the assertion at the
    // other account's credential id.
    await register(mine.id, 'my-cred')
    await startAuthentication(mine.id, SHOP)
    const result = await verifyAssertion(mine.id, response('their-cred'), SHOP)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
    expect(verifyAuthentication).not.toHaveBeenCalled()
  })

  it('spends the challenge, so an assertion cannot be replayed', async () => {
    const u = await admin()
    await register(u.id, 'cred-1')
    await startAuthentication(u.id, SHOP)

    verifyAuthentication.mockResolvedValue(authInfo(5))
    expect((await verifyAssertion(u.id, response('cred-1'), SHOP)).ok).toBe(true)

    const replay = await verifyAssertion(u.id, response('cred-1'), SHOP)
    expect(replay.ok).toBe(false)
    if (!replay.ok) expect(replay.message).toMatch(/expired/i)
  })

  it('will not redeem a REGISTRATION challenge as an authentication', async () => {
    // They prove different things: registration runs inside an authenticated
    // session, so swapping them would be a second factor proved by a session that
    // never passed one.
    const u = await admin()
    await register(u.id, 'cred-1')
    await startRegistration(u.id, SHOP)

    const result = await verifyAssertion(u.id, response('cred-1'), SHOP)
    expect(result.ok).toBe(false)
    // And the registration challenge is still there — the wrong kind matches
    // nothing rather than consuming it.
    const [row] = await db
      .select()
      .from(webauthnChallenges)
      .where(and(eq(webauthnChallenges.userId, u.id), eq(webauthnChallenges.kind, 'register')))
    expect(row).toBeDefined()
  })

  it('refuses a counter that does not advance — a cloned authenticator', async () => {
    const u = await admin()
    await register(u.id, 'cred-1')
    await startAuthentication(u.id, SHOP)
    verifyAuthentication.mockResolvedValueOnce(authInfo(7))
    await verifyAssertion(u.id, response('cred-1'), SHOP)

    await startAuthentication(u.id, SHOP)
    verifyAuthentication.mockResolvedValueOnce(authInfo(7))
    const result = await verifyAssertion(u.id, response('cred-1'), SHOP)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('tolerates an authenticator that always reports 0', async () => {
    // Every passkey and much modern hardware does. Enforcing a rising counter
    // against them would lock out most users to claim a guarantee we do not have.
    const u = await admin()
    await register(u.id, 'cred-1')

    for (let i = 0; i < 2; i++) {
      await startAuthentication(u.id, SHOP)
      verifyAuthentication.mockResolvedValueOnce(authInfo(0))
      expect((await verifyAssertion(u.id, response('cred-1'), SHOP)).ok).toBe(true)
    }
  })

  it('refuses to start when the account has no key', async () => {
    const u = await admin()
    const result = await startAuthentication(u.id, SHOP)
    expect(result.ok).toBe(false)
  })
})

describe('removal', () => {
  it('removes a key when another factor remains', async () => {
    const u = await admin()
    await register(u.id, 'cred-1', 'One')
    await register(u.id, 'cred-2', 'Two')

    const list = await listCredentials(u.id)
    const result = await removeCredential(u.id, list[0].id, 'password123')
    expect(result.ok).toBe(true)
    expect(await listCredentials(u.id)).toHaveLength(1)
  })

  it('refuses to remove the last factor an administrator has', async () => {
    // #197 makes a factor mandatory, so this would sign them in and then refuse
    // them everything — the enrolment state reached by deleting rather than by
    // never having enrolled.
    const u = await admin()
    await register(u.id, 'cred-1')

    const [only] = await listCredentials(u.id)
    const result = await removeCredential(u.id, only.id, 'password123')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
    expect(await listCredentials(u.id)).toHaveLength(1)
  })

  it('allows removing the last KEY when TOTP is still confirmed', async () => {
    const u = await createUser({ role: 'admin' })
    await enrollTotp(u.id)
    await register(u.id, 'cred-1')

    const [only] = await listCredentials(u.id)
    expect((await removeCredential(u.id, only.id, 'password123')).ok).toBe(true)
  })

  // `startRegistration` can argue that touching the hardware is the proof.
  // Removal cannot, so a stolen session could strip a victim's spare keys one at
  // a time — and the recommended setup is a primary and a backup (#231).
  it('refuses removal without the account password', async () => {
    const u = await admin()
    await register(u.id, 'key-1')
    await register(u.id, 'key-2')
    const [first] = await listCredentials(u.id)

    const result = await removeCredential(u.id, first.id, 'not-the-password')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
    expect(await listCredentials(u.id)).toHaveLength(2)
  })

  it('records a refused removal in the audit log', async () => {
    const u = await admin()
    await register(u.id, 'key-1')
    await register(u.id, 'key-2')
    const [first] = await listCredentials(u.id)

    await removeCredential(u.id, first.id, 'not-the-password')

    const [entry] = await db
      .select().from(auditLog)
      .where(eq(auditLog.action, 'auth.webauthn.remove_denied'))
      .orderBy(desc(auditLog.id)).limit(1)
    expect(entry.userId).toBe(u.id)
    expect(entry.details).toMatch(/wrong password/i)
  })

  it('removes the key when the password is right', async () => {
    const u = await admin()
    await register(u.id, 'key-1')
    await register(u.id, 'key-2')
    const [first] = await listCredentials(u.id)

    const result = await removeCredential(u.id, first.id, 'password123')

    expect(result.ok).toBe(true)
    expect(await listCredentials(u.id)).toHaveLength(1)
  })

  // The password is checked BEFORE the last-factor guard, so a wrong password on
  // the only key answers 403 rather than telling the caller how many are left.
  it('does not leak the factor count to a caller with the wrong password', async () => {
    const u = await admin()
    await register(u.id, 'only-key')
    const [only] = await listCredentials(u.id)

    const result = await removeCredential(u.id, only.id, 'not-the-password')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  // The check runs inside an authenticated session, which is where a session
  // thief already is. Without a counter they could grind the account password
  // against a live bcrypt — worth far more than the key removal it guards.
  it('stops guessing at the password after five wrong ones', async () => {
    const u = await admin()
    await register(u.id, 'key-1')
    await register(u.id, 'key-2')
    const [first] = await listCredentials(u.id)

    for (let i = 0; i < 5; i++) {
      const attempt = await removeCredential(u.id, first.id, `guess-${i}`)
      expect(attempt.ok).toBe(false)
      if (!attempt.ok) expect(attempt.status).toBe(403)
    }

    const blocked = await removeCredential(u.id, first.id, 'guess-6')
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.status).toBe(429)

    // And the RIGHT password is refused too, because the budget is spent — that
    // is what makes it a limit rather than an inconvenience.
    const withTruth = await removeCredential(u.id, first.id, 'password123')
    expect(withTruth.ok).toBe(false)
    if (!withTruth.ok) expect(withTruth.status).toBe(429)
    expect(await listCredentials(u.id)).toHaveLength(2)
  })

  it('counts one account\'s guesses against that account only', async () => {
    const victim = await admin()
    const other = await admin()
    await register(victim.id, 'v-1')
    await register(victim.id, 'v-2')
    await register(other.id, 'o-1')
    await register(other.id, 'o-2')
    const [victimKey] = await listCredentials(victim.id)
    const [otherKey] = await listCredentials(other.id)

    for (let i = 0; i < 6; i++) await removeCredential(victim.id, victimKey.id, 'nope')

    const unaffected = await removeCredential(other.id, otherKey.id, 'password123')
    expect(unaffected.ok).toBe(true)
  })

  // Someone who mistyped twice and then got it right is not who this is for.
  it('gives the budget back when the password is right', async () => {
    const u = await admin()
    await register(u.id, 'key-1')
    await register(u.id, 'key-2')
    await register(u.id, 'key-3')
    const [first, second] = await listCredentials(u.id)

    for (let i = 0; i < 4; i++) await removeCredential(u.id, first.id, 'nope')
    expect((await removeCredential(u.id, first.id, 'password123')).ok).toBe(true)

    // Four more would have tripped the old count. The reset means they do not.
    for (let i = 0; i < 4; i++) await removeCredential(u.id, second.id, 'nope')
    expect((await removeCredential(u.id, second.id, 'password123')).ok).toBe(true)
  })

  it('logs the refusal so the burst is visible after the fact', async () => {
    const u = await admin()
    await register(u.id, 'key-1')
    await register(u.id, 'key-2')
    const [first] = await listCredentials(u.id)

    for (let i = 0; i < 6; i++) await removeCredential(u.id, first.id, 'nope')

    const [entry] = await db
      .select().from(auditLog)
      .where(eq(auditLog.action, 'auth.webauthn.remove_denied'))
      .orderBy(desc(auditLog.id)).limit(1)
    expect(entry.details).toMatch(/too many/i)
  })

  it('will not remove another account\'s credential', async () => {
    const mine = await admin()
    const theirs = await admin()
    await register(mine.id, 'mine-1')
    await register(mine.id, 'mine-2')
    await register(theirs.id, 'theirs-1')

    const [theirKey] = await listCredentials(theirs.id)
    const result = await removeCredential(mine.id, theirKey.id, 'password123')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
    expect(await listCredentials(theirs.id)).toHaveLength(1)
  })
})
