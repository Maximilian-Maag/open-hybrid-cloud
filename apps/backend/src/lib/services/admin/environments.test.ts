import { describe, it, expect } from 'vitest'
import {
  listEnvironments,
  createEnvironment,
  getEnvironmentById,
  updateEnvironment,
  deleteEnvironment,
} from './environments'
import { db } from '@/lib/db/client'
import { deploymentEnvironments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createCiSource } from '@/test/helpers'

describe('listEnvironments', () => {
  it('returns environments joined with ciSourceName', async () => {
    const ci = await createCiSource({ name: 'MyGitLab' })
    await createEnvironment({
      name: 'prod',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })

    const result = await listEnvironments()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe('prod')
      expect(result.data[0].ciSourceName).toBe('MyGitLab')
    }
  })
})

describe('createEnvironment', () => {
  it('inserts an environment', async () => {
    const ci = await createCiSource()
    const result = await createEnvironment({
      name: 'dev',
      description: 'devvy',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('dev')
      expect(result.data.description).toBe('devvy')
    }
  })
})

describe('getEnvironmentById', () => {
  it('returns 404 for unknown id', async () => {
    const result = await getEnvironmentById(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns the environment when found', async () => {
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'find',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const result = await getEnvironmentById(created.data.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('find')
  })
})

describe('updateEnvironment', () => {
  it('returns 404 for unknown id', async () => {
    const result = await updateEnvironment(999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updates fields', async () => {
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'old',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const result = await updateEnvironment(created.data.id, { name: 'new' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('new')
  })
})

describe('deleteEnvironment', () => {
  it('returns 404 for unknown id', async () => {
    const result = await deleteEnvironment(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('deletes from DB', async () => {
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'del',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const result = await deleteEnvironment(created.data.id)
    expect(result.ok).toBe(true)

    const rows = await db
      .select()
      .from(deploymentEnvironments)
      .where(eq(deploymentEnvironments.id, created.data.id))
    expect(rows.length).toBe(0)
  })

  // Regression: env delete used to explode with a bare "500: FK violation"
  // when infra elements still referenced it. Now returns 409 with a message
  // the admin UI can display verbatim.
  it('returns 409 when infrastructure elements still reference the environment', async () => {
    const { createUser, createCategory, createProduct, createProject, createOrder, createInfraElement } =
      await import('@/test/helpers')
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'in-use',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const prod = await createProduct(cat.id)
    const proj = await createProject(pm.id)
    const order = await createOrder(proj.id, prod.id, created.data.id, pm.id)
    await createInfraElement(order.id, proj.id, created.data.id, prod.id)

    const result = await deleteEnvironment(created.data.id)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.message).toMatch(/infrastructure element/i)
    }
  })
})
