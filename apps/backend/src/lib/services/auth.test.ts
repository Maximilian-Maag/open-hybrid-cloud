import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import {
  loginWithCredentials,
  getMe,
  updateMe,
  changePassword,
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
    const mine = await makeSession(u)
    const result = await changePassword({ id: u.id, sessionId: mine.sessionId }, 'bad', 'new-password')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('updates passwordHash in DB when current password is correct, verifiable with bcrypt', async () => {
    const u = await createUser({ password: 'old-pw' })
    const mine = await makeSession(u)
    const result = await changePassword({ id: u.id, sessionId: mine.sessionId }, 'old-pw', 'brand-new')
    expect(result.ok).toBe(true)

    const [dbU] = await db.select().from(users).where(eq(users.id, u.id))
    expect(dbU.passwordHash).not.toBeNull()
    if (dbU.passwordHash) {
      expect(await bcrypt.compare('brand-new', dbU.passwordHash)).toBe(true)
      expect(await bcrypt.compare('old-pw', dbU.passwordHash)).toBe(false)
    }
  })

  // Changing the password is the one remediation every user and every helpdesk
  // reaches for after a suspected compromise, and it used to leave every session
  // alive — an attacker holding a stolen token kept it, up to thirty days with
  // "remember me" (#184).
  it('ends the account\'s other sessions', async () => {
    const u = await createUser({ password: 'old-pw' })
    const mine = await makeSession(u)
    const laptop = await makeSession(u)
    const phone = await makeSession(u)

    const result = await changePassword({ id: u.id, sessionId: mine.sessionId }, 'old-pw', 'brand-new')

    expect(result.ok).toBe(true)
    const rows = await db.select().from(sessions).where(eq(sessions.userId, u.id))
    const live = rows.filter((r) => r.revokedAt === null).map((r) => r.id)
    expect(live).toEqual([mine.sessionId])
    expect(rows.filter((r) => r.revokedAt !== null).map((r) => r.id).sort())
      .toEqual([laptop.sessionId, phone.sessionId].sort())
  })

  // They just proved the old password and are sitting in that tab. Signing them
  // out of it would make the remediation feel like a failure.
  it('keeps the session the change was made from', async () => {
    const u = await createUser({ password: 'old-pw' })
    const mine = await makeSession(u)

    await changePassword({ id: u.id, sessionId: mine.sessionId }, 'old-pw', 'brand-new')

    const [row] = await db.select().from(sessions).where(eq(sessions.id, mine.sessionId))
    expect(row.revokedAt).toBeNull()
  })

  it('leaves every session alone when the current password is wrong', async () => {
    const u = await createUser({ password: 'good' })
    const mine = await makeSession(u)
    const other = await makeSession(u)

    await changePassword({ id: u.id, sessionId: mine.sessionId }, 'bad', 'new-password')

    const rows = await db.select().from(sessions).where(eq(sessions.userId, u.id))
    expect(rows.every((r) => r.revokedAt === null)).toBe(true)
    expect(rows.map((r) => r.id).sort()).toEqual([mine.sessionId, other.sessionId].sort())
  })

  it('does not touch another account\'s sessions', async () => {
    const u = await createUser({ password: 'old-pw' })
    const bystander = await createUser({ password: 'x', email: 'bystander@test.dev' })
    const mine = await makeSession(u)
    const theirs = await makeSession(bystander)

    await changePassword({ id: u.id, sessionId: mine.sessionId }, 'old-pw', 'brand-new')

    const [row] = await db.select().from(sessions).where(eq(sessions.id, theirs.sessionId))
    expect(row.revokedAt).toBeNull()
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
    const mine = await makeSession(sso)
    const result = await changePassword({ id: sso.id, sessionId: mine.sessionId }, 'whatever', 'new')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })
})
