import { describe, it, expect } from 'vitest'
import {
  findProductName,
  findUserEmail,
  findUserName,
  findAdminEmails,
  findCiSourceForEnv,
} from './queries'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
} from '@/test/helpers'
import { db } from '@/lib/db/client'
import { products, deploymentEnvironments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

describe('findProductName', () => {
  it('returns the English translation when one exists', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'My Cool Product')
    expect(await findProductName(product.id)).toBe('My Cool Product')
  })

  it('returns a fallback string when no English translation exists', async () => {
    const cat = await createCategory()
    // Insert product without translation via direct insert
    const [row] = await db
      .insert(products)
      .values({ categoryId: cat.id, baseLanguage: 'de' })
      .returning()
    expect(await findProductName(row.id)).toBe(`Product #${row.id}`)
  })
})

describe('findUserEmail', () => {
  it('returns the email when the user exists', async () => {
    const user = await createUser({ email: 'alice@test.dev' })
    expect(await findUserEmail(user.id)).toBe('alice@test.dev')
  })

  it('returns null when the user does not exist', async () => {
    expect(await findUserEmail(999_999)).toBeNull()
  })
})

describe('findUserName', () => {
  it('returns the name when the user exists', async () => {
    const user = await createUser({ name: 'Bob' })
    expect(await findUserName(user.id)).toBe('Bob')
  })

  it('returns a fallback string when the user does not exist', async () => {
    expect(await findUserName(12345)).toBe('User #12345')
  })
})

describe('findAdminEmails', () => {
  it('returns active admin and root emails, excluding project_manager and inactive', async () => {
    const admin = await createUser({ email: 'admin@test.dev', role: 'admin', active: true })
    const root = await createUser({ email: 'root@test.dev', role: 'root', active: true })
    await createUser({ email: 'pm@test.dev', role: 'project_manager', active: true })
    await createUser({ email: 'inactive-admin@test.dev', role: 'admin', active: false })

    const emails = await findAdminEmails()
    expect(emails.sort()).toEqual([admin.email, root.email].sort())
  })

  it('returns an empty array when no admins exist', async () => {
    await createUser({ role: 'project_manager' })
    expect(await findAdminEmails()).toEqual([])
  })
})

describe('findCiSourceForEnv', () => {
  it('returns CI source fields when the environment is linked', async () => {
    const ci = await createCiSource({ name: 'MyGitLab', url: 'https://gl.example.com' })
    const env = await createEnvironment(ci.id)

    const result = await findCiSourceForEnv(env.id)
    expect(result).not.toBeNull()
    expect(result?.url).toBe('https://gl.example.com')
    expect(result?.accessToken).toBe('test-token')
    expect(result?.provider).toBe('gitlab')
  })

  it('returns null for an unknown environment id', async () => {
    expect(await findCiSourceForEnv(987654)).toBeNull()
  })

  // Issue #121: GitLab's pipeline and job endpoints are all project-scoped, and the
  // CI source stores only the host — the project is named once, in the environment's
  // trigger URL, so this is where the job-log path has to get it from.
  it('derives the project the environment triggers from its webhook URL', async () => {
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    expect((await findCiSourceForEnv(env.id))?.projectRef).toBe('1')
  })

  it('keeps an encoded project path as GitLab wants it', async () => {
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await db
      .update(deploymentEnvironments)
      .set({ webhookUrl: 'https://gl.example.com/api/v4/projects/group%2Finfra/trigger/pipeline' })
      .where(eq(deploymentEnvironments.id, env.id))

    expect((await findCiSourceForEnv(env.id))?.projectRef).toBe('group%2Finfra')
  })

  it('reports no project rather than guessing when the webhook URL names none', async () => {
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await db
      .update(deploymentEnvironments)
      .set({ webhookUrl: 'https://gl.example.com/api/v4/trigger/pipeline' })
      .where(eq(deploymentEnvironments.id, env.id))

    expect((await findCiSourceForEnv(env.id))?.projectRef).toBeNull()
  })
})
