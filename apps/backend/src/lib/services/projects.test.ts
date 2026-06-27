import { describe, it, expect } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'
import { listProjects, getProjectById, createProject, updateProject, deleteProject } from './projects'
import { db } from '@/lib/db/client'
import { projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createUser, createProject as seedProject } from '@/test/helpers'

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

describe('listProjects', () => {
  it('admin sees all projects', async () => {
    const admin = await createUser({ role: 'admin', email: 'a@test.dev' })
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    await seedProject(pm1.id)
    await seedProject(pm2.id)

    const result = await listProjects(makeSession(admin))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.length).toBe(2)
  })

  it('PM sees only their own projects', async () => {
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    const own = await seedProject(pm1.id)
    await seedProject(pm2.id)

    const result = await listProjects(makeSession(pm1))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].id).toBe(own.id)
    }
  })
})

describe('getProjectById', () => {
  it('returns 404 for unknown project', async () => {
    const admin = await createUser({ role: 'admin' })
    const result = await getProjectById(makeSession(admin), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('PM gets 403 for another user\'s project', async () => {
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    const p = await seedProject(pm2.id)

    const result = await getProjectById(makeSession(pm1), p.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('admin can see any project', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const p = await seedProject(pm.id)

    const result = await getProjectById(makeSession(admin), p.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.id).toBe(p.id)
  })
})

describe('createProject', () => {
  it('creates project with session.id as ownerId', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const result = await createProject(makeSession(pm), {
      name: 'My Proj',
      description: 'desc',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('My Proj')
      expect(result.data.ownerId).toBe(pm.id)
      expect(result.data.description).toBe('desc')
    }
  })
})

describe('updateProject', () => {
  it('returns 404 for unknown project', async () => {
    const admin = await createUser({ role: 'admin' })
    const result = await updateProject(makeSession(admin), 999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('PM gets 403 for another user\'s project', async () => {
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    const p = await seedProject(pm2.id)

    const result = await updateProject(makeSession(pm1), p.id, { name: 'Hijacked' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('admin can update any project, updating name and description', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const p = await seedProject(pm.id)

    const result = await updateProject(makeSession(admin), p.id, {
      name: 'Updated',
      description: 'New desc',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('Updated')
      expect(result.data.description).toBe('New desc')
    }

    const [dbProj] = await db.select().from(projects).where(eq(projects.id, p.id))
    expect(dbProj.name).toBe('Updated')
    expect(dbProj.description).toBe('New desc')
  })
})

describe('deleteProject', () => {
  it('returns 404 for unknown project', async () => {
    const admin = await createUser({ role: 'admin' })
    const result = await deleteProject(makeSession(admin), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('deletes the project from DB and returns ok(undefined)', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const p = await seedProject(pm.id)

    const result = await deleteProject(makeSession(admin), p.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBeUndefined()

    const rows = await db.select().from(projects).where(eq(projects.id, p.id))
    expect(rows.length).toBe(0)
  })
})
