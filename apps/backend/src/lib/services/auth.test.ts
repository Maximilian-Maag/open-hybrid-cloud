import { describe, it, expect, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import {
  loginWithCredentials,
  getMe,
  updateMe,
  changePassword,
  upsertSsoUser,
} from './auth'
import { db } from '@/lib/db/client'
import { users, sessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createUser, makeSession } from '@/test/helpers'

describe('loginWithCredentials', () => {
  it('returns 401 for an unknown email', async () => {
    const result = await loginWithCredentials('nobody@test.dev', 'password123')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('returns 401 for wrong password', async () => {
    const u = await createUser({ email: 'alice@test.dev', password: 'correct-horse' })
    const result = await loginWithCredentials(u.email, 'wrong')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('returns 401 for an inactive user even with correct password', async () => {
    const u = await createUser({
      email: 'inactive@test.dev',
      password: 'correct',
      active: false,
    })
    const result = await loginWithCredentials(u.email, 'correct')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('returns ok with a non-empty token for valid credentials', async () => {
    const u = await createUser({ email: 'ok@test.dev', password: 'right-password' })
    const result = await loginWithCredentials(u.email, 'right-password')
    expect(result.ok).toBe(true)
    if (result.ok && !result.data.mfaRequired) {
      expect(typeof result.data.token).toBe('string')
      expect(result.data.token.length).toBeGreaterThan(0)
      expect(result.data.user).toMatchObject({ id: u.id, email: u.email })
    } else {
      expect.unreachable('an account without a second factor must get a session')
    }
  })
})

describe('getMe', () => {
  it('returns 404 for unknown user', async () => {
    const result = await getMe(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns profile fields without passwordHash', async () => {
    const u = await createUser({ email: 'me@test.dev', name: 'Me' })
    const result = await getMe(u.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.id).toBe(u.id)
      expect(result.data.email).toBe('me@test.dev')
      expect(result.data.name).toBe('Me')
      expect((result.data as unknown as { passwordHash?: string }).passwordHash).toBeUndefined()
    }
  })
})

describe('updateMe', () => {
  it('updates the user name in the DB and returns the new profile', async () => {
    const u = await createUser({ name: 'Old' })
    const result = await updateMe(u.id, { name: 'New Name' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('New Name')

    const [dbU] = await db.select().from(users).where(eq(users.id, u.id))
    expect(dbU.name).toBe('New Name')
  })

  it('returns 404 for unknown userId', async () => {
    const result = await updateMe(999_999, { name: 'Ghost' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})

describe('changePassword', () => {
  it('returns 400 when current password is wrong', async () => {
    const u = await createUser({ password: 'good' })
    const result = await changePassword(u.id, 'bad', 'new-password', 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('updates passwordHash in DB when current password is correct, verifiable with bcrypt', async () => {
    const u = await createUser({ password: 'old-pw' })
    const result = await changePassword(u.id, 'old-pw', 'brand-new', 1)
    expect(result.ok).toBe(true)

    const [dbU] = await db.select().from(users).where(eq(users.id, u.id))
    expect(dbU.passwordHash).not.toBeNull()
    if (dbU.passwordHash) {
      expect(await bcrypt.compare('brand-new', dbU.passwordHash)).toBe(true)
      expect(await bcrypt.compare('old-pw', dbU.passwordHash)).toBe(false)
    }
  })

  it('ends the account\'s other sessions but not the caller\'s', async () => {
    // The whole point of changing a password after a compromise (issue #184).
    // Before this the phished token outlived the change by up to its full 30-day
    // "remember me" lifetime, because nothing re-reads `password_hash` per request.
    const u = await createUser({ password: 'old-pw' })
    const mine = await makeSession(u)
    const stolen = await makeSession(u, { rememberMe: true })

    const result = await changePassword(u.id, 'old-pw', 'brand-new', mine.sessionId)
    expect(result.ok).toBe(true)

    const rows = await db.select().from(sessions).where(eq(sessions.userId, u.id))
    const byId = new Map(rows.map((r) => [r.id, r.revokedAt]))
    expect(byId.get(stolen.sessionId)).not.toBeNull()
    expect(byId.get(mine.sessionId)).toBeNull()
  })

  it('returns 400 for SSO accounts without a password hash', async () => {
    const [sso] = await db
      .insert(users)
      .values({
        email: 'sso@test.dev',
        name: 'SSO',
        role: 'project_manager',
        ssoSub: 'oidc|123',
        active: true,
      })
      .returning()
    const result = await changePassword(sso.id, 'whatever', 'new', 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })
})

describe('upsertSsoUser', () => {
  it('creates a new user with role project_manager on first call', async () => {
    const u = await upsertSsoUser('oidc|abc', 'sso@test.dev', 'SSO User')
    expect(u).not.toBeNull()
    expect(u?.role).toBe('project_manager')
    expect(u?.email).toBe('sso@test.dev')
    expect(u?.active).toBe(true)
  })

  it('returns the existing user on the same sub (no duplicate insert)', async () => {
    const first = await upsertSsoUser('oidc|same', 'sso@test.dev', 'Original')
    const second = await upsertSsoUser('oidc|same', 'sso@test.dev', 'Renamed')
    expect(second?.id).toBe(first?.id)
    expect(second?.name).toBe('Renamed')

    const rows = await db.select().from(users).where(eq(users.ssoSub, 'oidc|same'))
    expect(rows.length).toBe(1)
  })

  describe('email collision with a local account', () => {
    const SUB = 'oidc|colliding-subject'
    const EMAIL = 'taken@test.dev'

    const seedLocalAccount = async () => {
      await db.insert(users).values({
        email: EMAIL,
        name: 'Local Owner',
        passwordHash: 'x',
        role: 'project_manager',
        active: true,
      })
    }

    it('refuses rather than adopting the account, and does not create a second one', async () => {
      await seedLocalAccount()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await upsertSsoUser(SUB, EMAIL, 'SSO Claimant')
      expect(result).toBeNull()

      // The local account is untouched — no sso_sub written onto it.
      const rows = await db.select().from(users).where(eq(users.email, EMAIL))
      expect(rows.length).toBe(1)
      expect(rows[0].ssoSub).toBeNull()

      errorSpy.mockRestore()
    })

    /*
     * Application logs are shipped, aggregated and retained on their own schedule,
     * outside the reach of a deletion request for the account. A failed login must
     * not be what writes an address into them.
     */
    it('logs neither the subject nor the email address, only a correlation id', async () => {
      await seedLocalAccount()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await upsertSsoUser(SUB, EMAIL, 'SSO Claimant')

      expect(errorSpy).toHaveBeenCalledTimes(1)
      const logged = errorSpy.mock.calls[0].join(' ')
      expect(logged).not.toContain(EMAIL)
      expect(logged).not.toContain(SUB)
      // Not even the local part or the domain on their own.
      expect(logged).not.toContain('taken')
      expect(logged).not.toContain('test.dev')
      // A correlation id in its place, so an operator can tie the line to a report.
      expect(logged).toMatch(/ref [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
      // Still says what to do about it.
      expect(logged).toContain('sso_sub')

      errorSpy.mockRestore()
    })

    it('gives every occurrence its own correlation id', async () => {
      await seedLocalAccount()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await upsertSsoUser(SUB, EMAIL, 'SSO Claimant')
      await upsertSsoUser('oidc|another', EMAIL, 'SSO Claimant')

      const refs = errorSpy.mock.calls.map((c) => /ref ([0-9a-f-]{36})/.exec(c.join(' '))?.[1])
      expect(refs.length).toBe(2)
      expect(refs[0]).toBeTruthy()
      expect(refs[0]).not.toBe(refs[1])

      errorSpy.mockRestore()
    })
  })
})
