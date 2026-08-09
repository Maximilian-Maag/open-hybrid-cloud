import { describe, it, expect } from 'vitest'
import {
  listEnvironments,
  createEnvironment,
  getEnvironmentById,
  updateEnvironment,
  deleteEnvironment,
  getCallbackSecret,
  regenerateCallbackSecret,
  generateCallbackSecret,
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

  it('auto-generates a callback_secret; the operator never provides it', async () => {
    const ci = await createCiSource()
    const result = await createEnvironment({
      name: 'autosecret',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.callbackSecret).toMatch(/^ohc-cb-[0-9a-f]{64}$/)
      // and NOT equal to the outbound trigger token — separate concerns
      expect(result.data.callbackSecret).not.toBe('tok')
    }
  })
})

describe('generateCallbackSecret', () => {
  it('produces the ohc-cb-<hex> shape and yields unique values', () => {
    const a = generateCallbackSecret()
    const b = generateCallbackSecret()
    expect(a).toMatch(/^ohc-cb-[0-9a-f]{64}$/)
    expect(b).toMatch(/^ohc-cb-[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
})

describe('getCallbackSecret', () => {
  it('returns 404 for unknown id', async () => {
    const result = await getCallbackSecret(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns the stored secret verbatim', async () => {
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'reveal',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const result = await getCallbackSecret(created.data.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.callbackSecret).toBe(created.data.callbackSecret)
  })
})

describe('regenerateCallbackSecret', () => {
  it('returns 404 for unknown id', async () => {
    const result = await regenerateCallbackSecret(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('rotates the secret to a new value and persists it', async () => {
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'rotate',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const before = created.data.callbackSecret
    const rotated = await regenerateCallbackSecret(created.data.id)
    expect(rotated.ok).toBe(true)
    if (!rotated.ok) return
    expect(rotated.data.callbackSecret).toMatch(/^ohc-cb-[0-9a-f]{64}$/)
    expect(rotated.data.callbackSecret).not.toBe(before)

    const reread = await getCallbackSecret(created.data.id)
    if (reread.ok) expect(reread.data.callbackSecret).toBe(rotated.data.callbackSecret)
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
