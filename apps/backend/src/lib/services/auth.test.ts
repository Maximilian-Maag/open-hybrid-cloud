import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import {
  loginWithCredentials,
  getMe,
  updateMe,
  changePassword,
  upsertSsoUser,
} from './auth'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createUser } from '@/test/helpers'

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
    if (result.ok) {
      expect(typeof result.data).toBe('string')
      expect(result.data.length).toBeGreaterThan(0)
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
    const result = await changePassword(u.id, 'bad', 'new-password')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('updates passwordHash in DB when current password is correct, verifiable with bcrypt', async () => {
    const u = await createUser({ password: 'old-pw' })
    const result = await changePassword(u.id, 'old-pw', 'brand-new')
    expect(result.ok).toBe(true)

    const [dbU] = await db.select().from(users).where(eq(users.id, u.id))
    expect(dbU.passwordHash).not.toBeNull()
    if (dbU.passwordHash) {
      expect(await bcrypt.compare('brand-new', dbU.passwordHash)).toBe(true)
      expect(await bcrypt.compare('old-pw', dbU.passwordHash)).toBe(false)
    }
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
    const result = await changePassword(sso.id, 'whatever', 'new')
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
})
