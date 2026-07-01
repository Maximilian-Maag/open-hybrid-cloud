import { describe, it, expect } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'
import bcrypt from 'bcryptjs'
import {
  listUsers,
  createUser as createUserSvc,
  getUserById,
  updateUser,
  deleteUser,
} from './users'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createUser } from '@/test/helpers'

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

describe('listUsers', () => {
  it('returns all users without exposing passwordHash', async () => {
    await createUser({ email: 'one@test.dev' })
    await createUser({ email: 'two@test.dev' })

    const result = await listUsers()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(2)
      for (const u of result.data) {
        expect((u as unknown as { passwordHash?: string }).passwordHash).toBeUndefined()
      }
    }
  })
})

describe('createUser', () => {
  it('inserts a user with hashed password', async () => {
    const result = await createUserSvc({
      email: 'new@test.dev',
      name: 'New',
      role: 'admin',
      password: 'super-secret',
      active: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.email).toBe('new@test.dev')

    const [dbU] = await db.select().from(users).where(eq(users.id, result.data.id))
    expect(dbU.passwordHash).not.toBeNull()
    if (dbU.passwordHash) {
      expect(await bcrypt.compare('super-secret', dbU.passwordHash)).toBe(true)
    }
  })

  it('returns 409 on duplicate email', async () => {
    await createUserSvc({
      email: 'dup@test.dev',
      name: 'X',
      role: 'admin',
      password: 'p',
      active: true,
    })
    const result = await createUserSvc({
      email: 'dup@test.dev',
      name: 'X',
      role: 'admin',
      password: 'p',
      active: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
  })
})

describe('getUserById', () => {
  it('returns 404 for unknown id', async () => {
    const result = await getUserById(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns the user when found', async () => {
    const u = await createUser({ email: 'find@test.dev' })
    const result = await getUserById(u.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.email).toBe('find@test.dev')
  })
})

describe('updateUser', () => {
  it('returns 404 for unknown id', async () => {
    const result = await updateUser(999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updates name/role/active', async () => {
    const u = await createUser({ name: 'Before', role: 'project_manager', active: true })
    const result = await updateUser(u.id, { name: 'After', role: 'admin', active: false })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('After')
      expect(result.data.role).toBe('admin')
      expect(result.data.active).toBe(false)
    }
  })

  it('hashes the new password when provided', async () => {
    const u = await createUser({ password: 'before' })
    const result = await updateUser(u.id, { password: 'after-pw' })
    expect(result.ok).toBe(true)

    const [dbU] = await db.select().from(users).where(eq(users.id, u.id))
    if (dbU.passwordHash) {
      expect(await bcrypt.compare('after-pw', dbU.passwordHash)).toBe(true)
    }
  })
})

describe('deleteUser', () => {
  it('returns 400 when deleting self', async () => {
    const u = await createUser({ role: 'admin' })
    const result = await deleteUser(makeSession(u), u.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('returns 404 for unknown id', async () => {
    const admin = await createUser({ role: 'admin' })
    const result = await deleteUser(makeSession(admin), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('deletes the user from DB', async () => {
    const admin = await createUser({ role: 'admin', email: 'a@test.dev' })
    const target = await createUser({ email: 'target@test.dev' })

    const result = await deleteUser(makeSession(admin), target.id)
    expect(result.ok).toBe(true)

    const rows = await db.select().from(users).where(eq(users.id, target.id))
    expect(rows.length).toBe(0)
  })
})
