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
import { createSession } from '@/lib/auth/sessions'
import { users, sessions, auditLog } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import {
  createUser,
  createProject,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createOrder,
} from '@/test/helpers'

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

  it('ends every session when the role changes', async () => {
    // `role` is read from the token, not from the row, so a demoted admin keeps
    // admin until the token expires. With "remember me" that ceiling is 30 days,
    // which is why this branch is the one that has to close it.
    const u = await createUser({ role: 'admin' })
    await createSession({ user: makeSession(u), rememberMe: true })

    const live = () =>
      db.select().from(sessions).where(eq(sessions.userId, u.id))
    expect((await live()).filter((r) => r.revokedAt === null)).toHaveLength(1)

    const result = await updateUser(u.id, { role: 'project_manager' })
    expect(result.ok).toBe(true)
    expect((await live()).filter((r) => r.revokedAt === null)).toHaveLength(0)
  })

  it('leaves sessions alone when the role is resent unchanged', async () => {
    // A no-op PUT that echoes the current role must not sign the user out, which
    // is why the prior role is read rather than trusting `input.role !== undefined`.
    const u = await createUser({ role: 'admin' })
    await createSession({ user: makeSession(u), rememberMe: false })

    const result = await updateUser(u.id, { role: 'admin', name: 'Renamed' })
    expect(result.ok).toBe(true)

    const rows = await db.select().from(sessions).where(eq(sessions.userId, u.id))
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1)
  })

  // An admin setting somebody's password is remediating — usually a suspected
  // compromise — and leaving the old sessions alive is the one outcome that makes
  // the remediation pointless (#184). Nothing is spared here, unlike a user
  // changing their own: the person at the keyboard is not the account owner.
  it('ends every session when an admin resets the password', async () => {
    const u = await createUser({ password: 'before' })
    await createSession({ user: makeSession(u), rememberMe: true })
    await createSession({ user: makeSession(u), rememberMe: false })

    const live = () =>
      db.select().from(sessions).where(eq(sessions.userId, u.id))
    expect((await live()).filter((r) => r.revokedAt === null)).toHaveLength(2)

    const result = await updateUser(u.id, { password: 'after-pw' })

    expect(result.ok).toBe(true)
    expect((await live()).filter((r) => r.revokedAt === null)).toHaveLength(0)
  })

  it('says in the audit log that a password reset is what ended them', async () => {
    const u = await createUser({ password: 'before' })
    await createSession({ user: makeSession(u), rememberMe: false })

    await updateUser(u.id, { password: 'after-pw' })

    const [entry] = await db
      .select().from(auditLog)
      .where(eq(auditLog.action, 'session.revoked_others'))
      .orderBy(desc(auditLog.id)).limit(1)
    expect(entry.details).toMatch(/password reset/i)
  })

  it('leaves sessions alone for an update that is not a password or a role', async () => {
    const u = await createUser({ password: 'before' })
    await createSession({ user: makeSession(u), rememberMe: false })

    await updateUser(u.id, { name: 'Renamed' })

    const rows = await db.select().from(sessions).where(eq(sessions.userId, u.id))
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1)
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

describe('deleteUser reference checks (issue #142)', () => {
  // users.id has five NO ACTION referents, so the bare delete raised 23503 and
  // escaped as an unhandled 500 for almost any user who had ever acted.
  it('returns 409, not a 500, when the user authored an audit entry', async () => {
    const admin = await createUser({ role: 'root', email: 'root@test.dev' })
    const target = await createUser({ email: 'actor@test.dev' })
    await db.insert(auditLog).values({ userId: target.id, action: 'order.created', details: '' })

    const result = await deleteUser(makeSession(admin), target.id)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.message).toContain('audit log')
      // The 409 has to say what to do instead, or it is just a different failure.
      expect(result.message).toContain('Deactivate')
    }

    // Neither the account nor its history went anywhere.
    expect((await db.select().from(users).where(eq(users.id, target.id))).length).toBe(1)
    expect((await db.select().from(auditLog).where(eq(auditLog.userId, target.id))).length).toBe(1)
  })

  it('returns 409 when the user owns a project', async () => {
    const admin = await createUser({ role: 'root', email: 'root2@test.dev' })
    const target = await createUser({ email: 'owner@test.dev' })
    await createProject(target.id)

    const result = await deleteUser(makeSession(admin), target.id)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.message).toContain('owned project')
    }
  })

  it('returns 409 when the user placed an order', async () => {
    const admin = await createUser({ role: 'root', email: 'root3@test.dev' })
    const target = await createUser({ email: 'buyer@test.dev' })
    const category = await createCategory()
    const product = await createProduct(category.id)
    const source = await createCiSource()
    const env = await createEnvironment(source.id)
    const project = await createProject(target.id, 'P')
    await createOrder(project.id, product.id, env.id, target.id)

    const result = await deleteUser(makeSession(admin), target.id)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.message).toContain('order(s)')
    }
  })

  it('still deletes an account that has never acted, and records who did it', async () => {
    const admin = await createUser({ role: 'root', email: 'root4@test.dev' })
    const target = await createUser({ email: 'unused@test.dev' })

    const result = await deleteUser(makeSession(admin), target.id)
    expect(result.ok).toBe(true)
    expect((await db.select().from(users).where(eq(users.id, target.id))).length).toBe(0)

    const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'user.deleted'))
    expect(entries.length).toBe(1)
    expect(entries[0].userId).toBe(admin.id)
    expect(entries[0].entityId).toBe(target.id)
  })
})

describe('user audit trail (issue #137)', () => {
  it('records the creation with the new account\'s role', async () => {
    const actor = await createUser({ role: 'root', email: 'actor-c@test.dev' })
    const created = await createUserSvc({
      email: 'audited@test.dev',
      name: 'Audited',
      role: 'root',
      password: 'super-secret-value',
      active: true,
    }, actor.id)
    expect(created.ok).toBe(true)

    const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'user.created'))
    expect(entries.length).toBe(1)
    expect(entries[0].userId).toBe(actor.id)
    expect(entries[0].details).toContain('role root')
    // The password was in the same request and must not be anywhere near the log.
    expect(entries[0].details).not.toContain('super-secret-value')
  })

  it('records an update by field NAME, never by value', async () => {
    const actor = await createUser({ role: 'root', email: 'actor-u@test.dev' })
    const target = await createUser({ email: 'target-u@test.dev' })

    const result = await updateUser(target.id, { password: 'brand-new-password', role: 'admin' }, actor.id)
    expect(result.ok).toBe(true)

    const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'user.updated'))
    expect(entries.length).toBe(1)
    expect(entries[0].details).toContain('password')
    expect(entries[0].details).toContain('role now admin')
    expect(entries[0].details).not.toContain('brand-new-password')
  })

  it('rejects an empty update with a 400 instead of a 500', async () => {
    const target = await createUser({ email: 'target-e@test.dev' })
    const result = await updateUser(target.id, {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })
})

// A root deactivated its own account on a live installation and locked everybody
// out: the update revokes the account's sessions, so the request that switches
// you off signs you out, and the page that could switch you back on is behind
// the login you no longer pass. Recovery was an UPDATE against the database.
describe('updateUser lockout guards (issue #250)', () => {
  it('refuses to deactivate the account making the request', async () => {
    const root = await createUser({ role: 'root', email: 'self-off@test.dev' })
    await createUser({ role: 'root', email: 'spare-root-2@test.dev' })

    const result = await updateUser(root.id, { active: false }, root.id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
    const [row] = await db.select().from(users).where(eq(users.id, root.id))
    expect(row.active).toBe(true)
  })

  // A second root, so that only the self-guard can refuse this: with one root the
  // last-root guard below refuses it too and the test would pass either way.
  it('refuses to take root away from the account making the request', async () => {
    const root = await createUser({ role: 'root', email: 'self-demote@test.dev' })
    await createUser({ role: 'root', email: 'spare-root@test.dev' })

    const result = await updateUser(root.id, { role: 'admin' }, root.id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
    const [row] = await db.select().from(users).where(eq(users.id, root.id))
    expect(row.role).toBe('root')
  })

  it('lets the account making the request change anything else about itself', async () => {
    const root = await createUser({ role: 'root', email: 'self-rename@test.dev' })

    const result = await updateUser(root.id, { name: 'Renamed', active: true, role: 'root' }, root.id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('Renamed')
  })

  it('refuses to deactivate the last active root even for another actor', async () => {
    const root = await createUser({ role: 'root', email: 'last-root@test.dev' })
    const other = await createUser({ role: 'admin', email: 'other-admin@test.dev' })

    const result = await updateUser(root.id, { active: false }, other.id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
    const [row] = await db.select().from(users).where(eq(users.id, root.id))
    expect(row.active).toBe(true)
  })

  it('refuses to demote the last active root even for another actor', async () => {
    const root = await createUser({ role: 'root', email: 'last-root-demote@test.dev' })
    const other = await createUser({ role: 'admin', email: 'other-admin-2@test.dev' })

    const result = await updateUser(root.id, { role: 'admin' }, other.id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  // An inactive root is not a root anybody can sign in as, so it does not count
  // towards "somebody can still administer this".
  it('does not count an inactive root as the second root', async () => {
    const root = await createUser({ role: 'root', email: 'only-active@test.dev' })
    await createUser({ role: 'root', email: 'switched-off@test.dev', active: false })
    const other = await createUser({ role: 'admin', email: 'other-admin-3@test.dev' })

    const result = await updateUser(root.id, { active: false }, other.id)

    expect(result.ok).toBe(false)
  })

  it('deactivates a root when another active root remains', async () => {
    const root = await createUser({ role: 'root', email: 'first-root@test.dev' })
    await createUser({ role: 'root', email: 'second-root@test.dev' })
    const other = await createUser({ role: 'admin', email: 'other-admin-4@test.dev' })

    const result = await updateUser(root.id, { active: false }, other.id)

    expect(result.ok).toBe(true)
    const [row] = await db.select().from(users).where(eq(users.id, root.id))
    expect(row.active).toBe(false)
  })

  it('leaves a non-root account deactivatable when it is the only one', async () => {
    const admin = await createUser({ role: 'admin', email: 'lone-admin@test.dev' })
    const root = await createUser({ role: 'root', email: 'root-actor@test.dev' })

    const result = await updateUser(admin.id, { active: false }, root.id)

    expect(result.ok).toBe(true)
  })

  // Reactivating a root reads the same `before.role === 'root'` branch. It must
  // not be counted as losing a root.
  it('reactivates a deactivated root', async () => {
    const root = await createUser({ role: 'root', email: 'reactivate@test.dev', active: false })
    const other = await createUser({ role: 'root', email: 'reactivator@test.dev' })

    const result = await updateUser(root.id, { active: true }, other.id)

    expect(result.ok).toBe(true)
  })
})
