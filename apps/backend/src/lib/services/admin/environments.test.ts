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
      // The create response must NOT leak the callback secret — it is only
      // revealed via the dedicated root-only endpoint.
      expect(result.data).not.toHaveProperty('callbackSecret')
      // But it was generated and persisted: read it back via the reveal path.
      const revealed = await getCallbackSecret(result.data.id)
      expect(revealed.ok).toBe(true)
      if (revealed.ok) {
        expect(revealed.data.callbackSecret).toMatch(/^ohc-cb-[0-9a-f]{64}$/)
        // and NOT equal to the outbound trigger token — separate concerns
        expect(revealed.data.callbackSecret).not.toBe('tok')
      }
    }
  })

  it('does not leak callbackSecret from create/get/update responses', async () => {
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'noleak',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')
    expect(created.data).not.toHaveProperty('callbackSecret')

    const fetched = await getEnvironmentById(created.data.id)
    expect(fetched.ok).toBe(true)
    if (fetched.ok) expect(fetched.data).not.toHaveProperty('callbackSecret')

    const updated = await updateEnvironment(created.data.id, { name: 'noleak2' })
    expect(updated.ok).toBe(true)
    if (updated.ok) expect(updated.data).not.toHaveProperty('callbackSecret')
  })

  // Migration 0006. The callback secret is what identifies the calling
  // environment on an inbound callback, so two environments must never be able
  // to share one — the 0004 backfill from the non-unique webhook_token made
  // that possible and left callbacks silently mis-scoped.
  it('rejects two environments sharing a callback secret at the DB level', async () => {
    const ci = await createCiSource()
    const first = await createEnvironment({
      name: 'unique-1',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    if (!first.ok) throw new Error('seed failed')
    const revealed = await getCallbackSecret(first.data.id)
    if (!revealed.ok) throw new Error('reveal failed')

    await expect(
      db.insert(deploymentEnvironments).values({
        name: 'unique-2',
        ciSourceId: ci.id,
        webhookUrl: 'http://e2',
        webhookToken: 'tok2',
        callbackSecret: revealed.data.callbackSecret,
      }),
    ).rejects.toThrow()
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

    // Compare against the value actually persisted in the DB (create no longer
    // returns the secret in its response).
    const [row] = await db
      .select({ callbackSecret: deploymentEnvironments.callbackSecret })
      .from(deploymentEnvironments)
      .where(eq(deploymentEnvironments.id, created.data.id))

    const result = await getCallbackSecret(created.data.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.callbackSecret).toBe(row.callbackSecret)
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

    const beforeReveal = await getCallbackSecret(created.data.id)
    if (!beforeReveal.ok) throw new Error('reveal failed')
    const before = beforeReveal.data.callbackSecret
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

  it('returns 409 when a product_environment offering still references the environment', async () => {
    const { createCategory, createProduct, linkProductEnvironment } = await import('@/test/helpers')
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'offered', ciSourceId: ci.id, webhookUrl: 'http://e', webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const cat = await createCategory()
    const prod = await createProduct(cat.id)
    await linkProductEnvironment(prod.id, created.data.id)

    const result = await deleteEnvironment(created.data.id)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.message).toMatch(/product-environment/i)
    }
  })

  it('returns 409 when a product_webhook still references the environment', async () => {
    const { createCategory, createProduct } = await import('@/test/helpers')
    const { productWebhooks } = await import('@/lib/db/schema')
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'webhooked', ciSourceId: ci.id, webhookUrl: 'http://e', webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const cat = await createCategory()
    const prod = await createProduct(cat.id)
    await db.insert(productWebhooks).values({
      productId: prod.id,
      environmentId: created.data.id,
      name: 'deploy',
      webhookUrl: 'http://trigger',
      webhookToken: 'wt',
    })

    const result = await deleteEnvironment(created.data.id)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.message).toMatch(/webhook/i)
    }
  })

  it('returns 409 when an order still references the environment', async () => {
    const { createUser, createCategory, createProduct, createProject, createOrder } =
      await import('@/test/helpers')
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'ordered', ciSourceId: ci.id, webhookUrl: 'http://e', webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const prod = await createProduct(cat.id)
    const proj = await createProject(pm.id)
    await createOrder(proj.id, prod.id, created.data.id, pm.id)

    const result = await deleteEnvironment(created.data.id)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.message).toMatch(/order/i)
    }
  })
})
