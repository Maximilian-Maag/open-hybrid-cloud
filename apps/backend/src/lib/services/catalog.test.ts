import { describe, it, expect } from 'vitest'
import { listCatalog, getProduct, getProductImage } from './catalog'
import { db } from '@/lib/db/client'
import {
  products,
  productTranslations,
  productEnvironments,
  parameters,
} from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
} from '@/test/helpers'

describe('listCatalog', () => {
  it('returns products with translation in requested language', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'English Name')
    await db.insert(productTranslations).values({
      productId: product.id,
      languageCode: 'de',
      name: 'Deutscher Name',
      description: 'Beschreibung',
    })

    const result = await listCatalog('de')
    expect(result.ok).toBe(true)
    if (result.ok) {
      const row = result.data.find((r) => r.id === product.id)
      expect(row?.name).toBe('Deutscher Name')
      expect(row?.description).toBe('Beschreibung')
    }
  })

  it('falls back to English when requested language is not available', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'English Name')
    // only English translation exists from helper

    const result = await listCatalog('fr')
    expect(result.ok).toBe(true)
    if (result.ok) {
      const row = result.data.find((r) => r.id === product.id)
      expect(row?.name).toBe('English Name')
    }
  })

  it('case-insensitive substring search on name filters results', async () => {
    const cat = await createCategory()
    await createProduct(cat.id, 'Alpha Product')
    await createProduct(cat.id, 'Beta Service')

    const result = await listCatalog('en', 'alpha')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe('Alpha Product')
    }
  })

  it('category filter restricts to that category', async () => {
    const cat1 = await createCategory('Cat 1')
    const cat2 = await createCategory('Cat 2')
    await createProduct(cat1.id, 'P1')
    await createProduct(cat2.id, 'P2')

    const result = await listCatalog('en', undefined, cat2.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].categoryId).toBe(cat2.id)
    }
  })
})

describe('getProduct', () => {
  it('returns 404 for unknown product', async () => {
    const result = await getProduct(999_999, 'en')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns product with environments and parameters at all scopes', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'My Product')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    // product_environment link
    await db.insert(productEnvironments).values({
      productId: product.id,
      environmentId: env.id,
      price: '100.00',
    })

    // global, category, product params
    await db.insert(parameters).values([
      { scope: 'global', scopeId: 0, name: 'GLOBAL_P', type: 'string' },
      { scope: 'category', scopeId: cat.id, name: 'CAT_P', type: 'string' },
      { scope: 'product', scopeId: product.id, name: 'PROD_P', type: 'string' },
      // Unrelated category param shouldn't show
      { scope: 'category', scopeId: 9999, name: 'OTHER_CAT_P', type: 'string' },
    ])

    const result = await getProduct(product.id, 'en')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.id).toBe(product.id)
    expect(result.data.environments.length).toBe(1)

    const paramNames = (result.data.parameters as { name: string }[]).map((p) => p.name).sort()
    expect(paramNames).toEqual(['CAT_P', 'GLOBAL_P', 'PROD_P'])
  })
})

describe('getProductImage', () => {
  it('returns null data when no image set', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'P')

    const result = await getProductImage(product.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBeNull()
  })

  it('returns { data, mime } when image exists', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'P')
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await db.update(products).set({ image: buf }).where(eq(products.id, product.id))

    const result = await getProductImage(product.id)
    expect(result.ok).toBe(true)
    if (result.ok && result.data) {
      expect(Buffer.from(result.data.data).equals(buf)).toBe(true)
      expect(result.data.mime).toBe('image/png')
    }
  })

  it('returns 404 for unknown product', async () => {
    const result = await getProductImage(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})
