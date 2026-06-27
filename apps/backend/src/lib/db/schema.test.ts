import { describe, it, expect } from 'vitest'
import { db } from '@/lib/db/client'
import { users, categories, products, productTranslations, orders } from './schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder,
} from '@/test/helpers'

describe('users table', () => {
  it('inserts and retrieves a user', async () => {
    const user = await createUser({ email: 'db-test@example.com', role: 'admin' })
    const rows = await db.select().from(users).where(eq(users.id, user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('db-test@example.com')
    expect(rows[0].role).toBe('admin')
    expect(rows[0].active).toBe(true)
  })

  it('enforces unique email constraint', async () => {
    await createUser({ email: 'unique@example.com' })
    await expect(createUser({ email: 'unique@example.com' })).rejects.toThrow()
  })

  it('stores a bcrypt password hash (not plaintext)', async () => {
    const user = await createUser({ password: 'secret123' })
    const rows = await db.select().from(users).where(eq(users.id, user.id))
    expect(rows[0].passwordHash).not.toBe('secret123')
    expect(rows[0].passwordHash).toMatch(/^\$2[aby]\$/)
  })
})

describe('categories table', () => {
  it('inserts and retrieves a category', async () => {
    const cat = await createCategory('Compute')
    const rows = await db.select().from(categories).where(eq(categories.id, cat.id))
    expect(rows[0].name).toBe('Compute')
  })
})

describe('products table', () => {
  it('inserts a product with translation', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Kubernetes Cluster')

    const translations = await db
      .select()
      .from(productTranslations)
      .where(eq(productTranslations.productId, product.id))

    expect(translations).toHaveLength(1)
    expect(translations[0].name).toBe('Kubernetes Cluster')
    expect(translations[0].languageCode).toBe('en')
  })

  it('cascades delete from category to product', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id)

    await db.delete(categories).where(eq(categories.id, cat.id))

    const rows = await db.select().from(products).where(eq(products.id, product.id))
    expect(rows).toHaveLength(0)
  })
})

describe('orders table', () => {
  it('inserts an order with pending status', async () => {
    const user = await createUser()
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(user.id)

    const order = await createOrder(project.id, product.id, env.id, user.id)

    const rows = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
    expect(rows[0].pipelineId).toEqual([])
  })

  it('can store pipeline IDs as JSON array', async () => {
    const user = await createUser()
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(user.id)

    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['42', '43'],
    })

    const rows = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(rows[0].pipelineId).toEqual(['42', '43'])
  })
})
