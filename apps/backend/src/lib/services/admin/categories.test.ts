import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ci/webhooks', () => ({
  triggerProductWebhooks: vi.fn().mockResolvedValue(['pipe-destroy']),
}))

import {
  listCategories,
  createCategory,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from './categories'
import { triggerProductWebhooks } from '@/lib/ci/webhooks'
import { db } from '@/lib/db/client'
import { categories, infrastructureElements } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory as seedCategory,
  createProduct as seedProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder as seedOrder,
  createInfraElement,
} from '@/test/helpers'

const mockedWebhooks = vi.mocked(triggerProductWebhooks)

beforeEach(() => {
  mockedWebhooks.mockReset().mockResolvedValue(['pipe-destroy'])
})

describe('listCategories', () => {
  it('returns empty when none exist', async () => {
    const result = await listCategories()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })

  it('returns categories ordered by displayOrder then name', async () => {
    await createCategory({ name: 'B', displayOrder: 1 })
    await createCategory({ name: 'A', displayOrder: 1 })
    await createCategory({ name: 'C', displayOrder: 0 })

    const result = await listCategories()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.map((c) => c.name)).toEqual(['C', 'A', 'B'])
    }
  })
})

describe('createCategory', () => {
  it('inserts a category', async () => {
    const result = await createCategory({ name: 'New', displayOrder: 5 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('New')
      expect(result.data.displayOrder).toBe(5)
    }
  })
})

describe('getCategoryById', () => {
  it('returns 404 for unknown id', async () => {
    const result = await getCategoryById(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns the category when found', async () => {
    const created = await createCategory({ name: 'Find' })
    if (!created.ok) throw new Error('seed failed')
    const result = await getCategoryById(created.data.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('Find')
  })
})

describe('updateCategory', () => {
  it('returns 404 for unknown id', async () => {
    const result = await updateCategory(999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updates the name', async () => {
    const created = await createCategory({ name: 'Old' })
    if (!created.ok) throw new Error('seed failed')
    const result = await updateCategory(created.data.id, { name: 'Newer' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('Newer')
  })
})

describe('deleteCategory', () => {
  it('returns 404 for unknown id', async () => {
    const result = await deleteCategory(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('deletes the category from DB', async () => {
    const created = await createCategory({ name: 'Del' })
    if (!created.ok) throw new Error('seed failed')
    const result = await deleteCategory(created.data.id)
    expect(result.ok).toBe(true)

    const rows = await db.select().from(categories).where(eq(categories.id, created.data.id))
    expect(rows.length).toBe(0)
  })

  // FA-09.7: cascade decommissioning on category delete
  it('cascade-decommissions all active infra of every product in the category (FA-09.7)', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await seedCategory('CatCascade')
    const product1 = await seedProduct(cat.id, 'P1')
    const product2 = await seedProduct(cat.id, 'P2')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(pm.id)
    const orderA = await seedOrder(project.id, product1.id, env.id, pm.id)
    const orderB = await seedOrder(project.id, product2.id, env.id, pm.id)
    await createInfraElement(orderA.id, project.id, env.id, product1.id)
    await createInfraElement(orderB.id, project.id, env.id, product2.id)

    const result = await deleteCategory(cat.id)
    expect(result.ok).toBe(true)

    expect(mockedWebhooks).toHaveBeenCalledTimes(2)
    const calls = mockedWebhooks.mock.calls.map((c) => c[0]).sort()
    expect(calls).toEqual([product1.id, product2.id].sort())
    // All infra rows for products in that category are gone
    const rows = await db.select().from(infrastructureElements)
    expect(rows.length).toBe(0)
  })

  // FA-09.8: skip already-in-flight elements
  it('does not trigger destroy for infra already decommissioning/decommissioned (FA-09.8)', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await seedCategory('CatSkip')
    const product = await seedProduct(cat.id, 'P')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(pm.id)
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id, { status: 'decommissioning' })
    await createInfraElement(order.id, project.id, env.id, product.id, { status: 'decommissioned' })
    await createInfraElement(order.id, project.id, env.id, product.id, { status: 'active' })

    const result = await deleteCategory(cat.id)
    expect(result.ok).toBe(true)

    expect(mockedWebhooks).toHaveBeenCalledTimes(1)
  })
})
