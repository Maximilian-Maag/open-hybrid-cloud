import { describe, it, expect } from 'vitest'
import { listSizes, upsertSize, deleteSize } from './sizes'
import { db } from '@/lib/db/client'
import { productEnvironmentSizes, productVersions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  linkProductEnvironment,
  createSize,
} from '@/test/helpers'

const setup = async () => {
  const root = await createUser({ role: 'root', email: 'root@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'VM')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id, undefined, 'Frankfurt')
  const unoffered = await createEnvironment(ci.id, undefined, 'Nowhere')
  await linkProductEnvironment(product.id, env.id, { price: '99.00' })
  return { root, product, env, unoffered }
}

describe('upsertSize', () => {
  it('creates a size and records it in the product history', async () => {
    const { root, product, env } = await setup()

    const result = await upsertSize(product.id, env.id, {
      code: 'XL',
      label: 'Extra large',
      price: '400.00',
      sortOrder: 5,
      userId: root.id,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({ code: 'XL', price: '400.00', sortOrder: 5, active: true })

    // A size's price IS what a customer is offered, so a change to it belongs in
    // the history that explains what an existing order's snapshot differs from.
    const versions = await db
      .select()
      .from(productVersions)
      .where(eq(productVersions.productId, product.id))
    expect(versions).toHaveLength(1)
    expect(versions[0].summary).toContain('XL')
  })

  it('upserts on the code rather than creating a duplicate, and says what changed', async () => {
    const { root, product, env } = await setup()
    await upsertSize(product.id, env.id, { code: 'XL', price: '400.00', userId: root.id })

    const result = await upsertSize(product.id, env.id, { code: 'XL', price: '450.00', userId: root.id })

    expect(result.ok).toBe(true)
    const rows = await db
      .select()
      .from(productEnvironmentSizes)
      .where(eq(productEnvironmentSizes.productId, product.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].price).toBe('450.00')

    const versions = await db.select().from(productVersions)
    expect(versions[1].summary).toContain('400.00')
    expect(versions[1].summary).toContain('450.00')
  })

  it('refuses a code that could not be passed through a shell safely', async () => {
    const { product, env } = await setup()

    expect((await upsertSize(product.id, env.id, { code: 'X L' })).ok).toBe(false)
    expect((await upsertSize(product.id, env.id, { code: 'X;rm -rf /' })).ok).toBe(false)
    expect((await upsertSize(product.id, env.id, { code: 'x-2.large_a' })).ok).toBe(true)
  })

  it('refuses a negative price, a nonsense price and a bad currency', async () => {
    const { product, env } = await setup()

    expect((await upsertSize(product.id, env.id, { code: 'A', price: '-5' })).ok).toBe(false)
    expect((await upsertSize(product.id, env.id, { code: 'A', price: '1.234' })).ok).toBe(false)
    expect((await upsertSize(product.id, env.id, { code: 'A', price: 'free' })).ok).toBe(false)
    expect((await upsertSize(product.id, env.id, { code: 'A', currency: 'EUROS' })).ok).toBe(false)
  })

  it('refuses a size for an environment the product is not offered in', async () => {
    const { product, unoffered } = await setup()

    const result = await upsertSize(product.id, unoffered.id, { code: 'M' })

    // A size nobody could ever reach from the catalogue is not worth storing.
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})

describe('listSizes', () => {
  it('includes retired sizes — this is the admin view', async () => {
    const { product, env } = await setup()
    await createSize(product.id, env.id, { code: 'S', sortOrder: 1 })
    await createSize(product.id, env.id, { code: 'GONE', sortOrder: 2, active: false })

    const result = await listSizes(product.id, env.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((s) => s.code)).toEqual(['S', 'GONE'])
  })
})

describe('deleteSize', () => {
  it('removes the size and records the withdrawal', async () => {
    const { product, env } = await setup()
    const size = await createSize(product.id, env.id, { code: 'S' })

    const result = await deleteSize(product.id, env.id, size.id)

    expect(result.ok).toBe(true)
    expect(await db.select().from(productEnvironmentSizes)).toHaveLength(0)
    const versions = await db.select().from(productVersions)
    expect(versions[versions.length - 1].summary).toContain('removed')
  })

  it('will not delete a size through another offering', async () => {
    const { product, env, unoffered } = await setup()
    const size = await createSize(product.id, env.id, { code: 'S' })

    const result = await deleteSize(product.id, unoffered.id, size.id)

    expect(result.ok).toBe(false)
    expect(await db.select().from(productEnvironmentSizes)).toHaveLength(1)
  })
})

describe('withdrawing an offering', () => {
  it('takes its sizes with it', async () => {
    const { product, env } = await setup()
    await createSize(product.id, env.id, { code: 'S' })

    // The composite foreign key cascades, so a size cannot outlive its offering.
    await db.execute(
      (await import('drizzle-orm')).sql`DELETE FROM product_environments WHERE product_id = ${product.id}`,
    )

    expect(await db.select().from(productEnvironmentSizes)).toHaveLength(0)
  })
})
