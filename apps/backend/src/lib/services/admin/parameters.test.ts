import { describe, it, expect } from 'vitest'
import {
  listParameters,
  createParameter,
  updateParameter,
  deleteParameter,
} from './parameters'
import { db } from '@/lib/db/client'
import { parameters, productVersions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  linkProductEnvironment,
} from '@/test/helpers'

describe('listParameters', () => {
  it('returns all when no filter', async () => {
    await createParameter({ scope: 'global', name: 'G1', type: 'string' })
    await createParameter({ scope: 'product', scopeId: 1, name: 'P1', type: 'string' })

    const result = await listParameters({})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.length).toBe(2)
  })

  it('filters by scope=product', async () => {
    await createParameter({ scope: 'global', name: 'G1', type: 'string' })
    await createParameter({ scope: 'product', scopeId: 1, name: 'P1', type: 'string' })
    await createParameter({ scope: 'category', scopeId: 1, name: 'C1', type: 'string' })

    const result = await listParameters({ scope: 'product' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].scope).toBe('product')
    }
  })

  it('filters by scopeId', async () => {
    await createParameter({ scope: 'product', scopeId: 10, name: 'A', type: 'string' })
    await createParameter({ scope: 'product', scopeId: 20, name: 'B', type: 'string' })

    const result = await listParameters({ scope: 'product', scopeId: 10 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe('A')
    }
  })
})

describe('createParameter', () => {
  it('inserts a parameter with all defaults', async () => {
    const result = await createParameter({ scope: 'global', name: 'X', type: 'string' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.scope).toBe('global')
      expect(result.data.scopeId).toBe(0)
      expect(result.data.required).toBe(false)
      expect(result.data.sensitive).toBe(false)
    }
  })

  it('stores label when provided', async () => {
    const result = await createParameter({ scope: 'global', name: 'region', label: 'Region', type: 'string' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.label).toBe('Region')
  })

  it('stores empty label by default', async () => {
    const result = await createParameter({ scope: 'global', name: 'region', type: 'string' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.label).toBe('')
  })
})

describe('updateParameter', () => {
  it('returns 404 for unknown id', async () => {
    const result = await updateParameter(999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updates fields', async () => {
    const created = await createParameter({ scope: 'global', name: 'old', type: 'string' })
    if (!created.ok) throw new Error('seed failed')
    const result = await updateParameter(created.data.id, { name: 'new', required: true })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('new')
      expect(result.data.required).toBe(true)
    }
  })

  it('updates label field', async () => {
    const created = await createParameter({ scope: 'global', name: 'x', type: 'string', label: 'Old Label' })
    if (!created.ok) throw new Error('seed failed')
    const result = await updateParameter(created.data.id, { label: 'New Label' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.label).toBe('New Label')
  })
})

describe('deleteParameter', () => {
  it('returns 404 for unknown id', async () => {
    const result = await deleteParameter(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('removes from DB', async () => {
    const created = await createParameter({ scope: 'global', name: 'del', type: 'string' })
    if (!created.ok) throw new Error('seed failed')
    const result = await deleteParameter(created.data.id)
    expect(result.ok).toBe(true)

    const rows = await db.select().from(parameters).where(eq(parameters.id, created.data.id))
    expect(rows.length).toBe(0)
  })
})


// Issue #38. Parameter definitions are part of the offering snapshot, so a change
// to one has to leave a version behind — otherwise it silently folds itself into
// whatever unrelated edit happens to be recorded next, and the parameter history
// the diff advertises is unreachable.
describe('parameter changes record a product version', () => {
  const offering = async () => {
    const admin = await createUser({ role: 'admin', email: `param-ver-${Math.random()}@test.dev` })
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Nginx Gateway')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id)
    return { admin, cat, product, env }
  }

  const versionsFor = async (productId: number) =>
    db.select().from(productVersions).where(eq(productVersions.productId, productId))

  it('records one for a product-scoped parameter, with a snapshot to diff against', async () => {
    const { admin, product, env } = await offering()

    const created = await createParameter(
      { scope: 'product', scopeId: product.id, name: 'REGION', type: 'string' },
      admin.id,
    )
    expect(created.ok).toBe(true)

    const rows = await versionsFor(product.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].summary).toBe('Parameter REGION added')
    expect(rows[0].environmentId).toBe(env.id)
    expect(rows[0].createdBy).toBe(admin.id)
    // The snapshot is what makes the change diffable rather than merely logged.
    expect(rows[0].snapshot).not.toBeNull()
  })

  it('records one on update and on delete', async () => {
    const { admin, product } = await offering()
    const created = await createParameter(
      { scope: 'product', scopeId: product.id, name: 'REGION', type: 'string' },
      admin.id,
    )
    if (!created.ok) throw new Error('setup failed')

    await updateParameter(created.data.id, { sensitive: true }, admin.id)
    await deleteParameter(created.data.id, admin.id)

    const summaries = (await versionsFor(product.id)).map((r) => r.summary)
    expect(summaries).toEqual([
      'Parameter REGION added',
      'Parameter REGION updated',
      'Parameter REGION removed',
    ])
  })

  it('records a category-scoped change against every product in the category', async () => {
    const { admin, cat, product, env } = await offering()
    const sibling = await createProduct(cat.id, 'Managed Postgres')
    await linkProductEnvironment(sibling.id, env.id)

    await createParameter({ scope: 'category', scopeId: cat.id, name: 'TIER', type: 'string' }, admin.id)

    expect(await versionsFor(product.id)).toHaveLength(1)
    expect(await versionsFor(sibling.id)).toHaveLength(1)
  })

  it('records only the named environment when the parameter pins one', async () => {
    const { admin, product, env } = await offering()
    const ci = await createCiSource()
    const other = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, other.id)

    await createParameter(
      { scope: 'product', scopeId: product.id, environmentId: env.id, name: 'REGION', type: 'string' },
      admin.id,
    )

    const rows = await versionsFor(product.id)
    expect(rows.map((r) => r.environmentId)).toEqual([env.id])
  })
})
