import { describe, it, expect } from 'vitest'
import {
  resolveOfferingPrice,
  validateQuantity,
  listActiveSizes,
  listActiveSizesForProduct,
  MAX_ORDER_QUANTITY,
} from './sizes'
import {
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  linkProductEnvironment,
  createSize,
} from '@/test/helpers'

const setup = async () => {
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Server')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id, undefined, 'Frankfurt')
  const other = await createEnvironment(ci.id, undefined, 'Linode')
  await linkProductEnvironment(product.id, env.id, { price: '99.00', currency: 'EUR' })
  await linkProductEnvironment(product.id, other.id, { price: '77.00', currency: 'EUR' })
  return { cat, product, env, other }
}

describe('resolveOfferingPrice', () => {
  it('falls back to the offering price for an offering with no sizes', async () => {
    // The backwards-compatibility case: this is every offering that existed
    // before sizes did, and it must keep pricing exactly as it always has.
    const { product, env } = await setup()

    const result = await resolveOfferingPrice(product.id, env.id, null)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({
      sizeCode: null,
      sizeLabel: null,
      price: '99.00',
      currency: 'EUR',
    })
  })

  it('uses the chosen size price once the offering has sizes', async () => {
    const { product, env } = await setup()
    await createSize(product.id, env.id, { code: 'S', price: '10.00', sortOrder: 1 })
    await createSize(product.id, env.id, { code: 'XL', label: 'Extra large', price: '400.00', sortOrder: 2 })

    const result = await resolveOfferingPrice(product.id, env.id, 'XL')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Not the offering's 99.00: price moved to the size (issue #98).
    expect(result.data).toEqual({
      sizeCode: 'XL',
      sizeLabel: 'Extra large',
      price: '400.00',
      currency: 'EUR',
    })
  })

  it('refuses an order that names no size when the offering has some', async () => {
    const { product, env } = await setup()
    await createSize(product.id, env.id, { code: 'S', price: '10.00' })

    const result = await resolveOfferingPrice(product.id, env.id, undefined)

    expect(result.ok).toBe(false)
    // Rather than silently charging the offering's legacy price for an
    // unspecified size, which would be a guess presented as a bill.
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('refuses a size the offering does not have, and a retired one', async () => {
    const { product, env } = await setup()
    await createSize(product.id, env.id, { code: 'S', price: '10.00' })
    await createSize(product.id, env.id, { code: 'OLD', price: '5.00', active: false })

    expect((await resolveOfferingPrice(product.id, env.id, 'XXL')).ok).toBe(false)
    expect((await resolveOfferingPrice(product.id, env.id, 'OLD')).ok).toBe(false)
  })

  it('refuses a size against an offering that has none', async () => {
    const { product, env } = await setup()

    const result = await resolveOfferingPrice(product.id, env.id, 'M')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/no sizes/i)
  })

  it('keeps sizes per environment, so the same code can cost different amounts', async () => {
    const { product, env, other } = await setup()
    await createSize(product.id, env.id, { code: 'XL', price: '400.00' })
    await createSize(product.id, other.id, { code: 'XL', price: '560.00' })

    const frankfurt = await resolveOfferingPrice(product.id, env.id, 'XL')
    const linode = await resolveOfferingPrice(product.id, other.id, 'XL')

    expect(frankfurt.ok && frankfurt.data.price).toBe('400.00')
    expect(linode.ok && linode.data.price).toBe('560.00')
  })

  it('refuses an offering that does not exist at all', async () => {
    const { product } = await setup()
    const result = await resolveOfferingPrice(product.id, 999_999, null)
    expect(result.ok).toBe(false)
  })
})

describe('listActiveSizes', () => {
  it('returns active sizes in the admin-arranged order and hides retired ones', async () => {
    const { product, env } = await setup()
    await createSize(product.id, env.id, { code: 'L', price: '200.00', sortOrder: 3 })
    await createSize(product.id, env.id, { code: 'S', price: '10.00', sortOrder: 1 })
    await createSize(product.id, env.id, { code: 'GONE', price: '1.00', sortOrder: 0, active: false })

    const sizes = await listActiveSizes(product.id, env.id)

    expect(sizes.map((s) => s.code)).toEqual(['S', 'L'])
  })
})

describe('listActiveSizesForProduct', () => {
  it('groups a product\'s sizes by environment in one query', async () => {
    const { product, env, other } = await setup()
    await createSize(product.id, env.id, { code: 'S', price: '10.00' })
    await createSize(product.id, other.id, { code: 'M', price: '20.00' })

    const byEnvironment = await listActiveSizesForProduct(product.id)

    expect(byEnvironment.get(env.id)?.map((s) => s.code)).toEqual(['S'])
    expect(byEnvironment.get(other.id)?.map((s) => s.code)).toEqual(['M'])
  })
})

describe('validateQuantity', () => {
  it('defaults to one', () => {
    const result = validateQuantity(undefined)
    expect(result.ok && result.data).toBe(1)
  })

  it('accepts a whole number up to the cap and refuses anything else', () => {
    expect(validateQuantity(20).ok).toBe(true)
    expect(validateQuantity(MAX_ORDER_QUANTITY).ok).toBe(true)
    expect(validateQuantity(MAX_ORDER_QUANTITY + 1).ok).toBe(false)
    expect(validateQuantity(0).ok).toBe(false)
    expect(validateQuantity(-3).ok).toBe(false)
    expect(validateQuantity(1.5).ok).toBe(false)
  })
})
