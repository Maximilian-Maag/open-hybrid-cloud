import { describe, it, expect } from 'vitest'
import { listCatalog, getProduct, getProductImage, CATALOG_MAX_LIMIT } from './catalog'
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
      const row = result.data.items.find((r) => r.id === product.id)
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
      const row = result.data.items.find((r) => r.id === product.id)
      expect(row?.name).toBe('English Name')
    }
  })

  it('case-insensitive substring search on name filters results', async () => {
    const cat = await createCategory()
    await createProduct(cat.id, 'Alpha Product')
    await createProduct(cat.id, 'Beta Service')

    const result = await listCatalog('en', { search: 'alpha' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items.length).toBe(1)
      expect(result.data.items[0].name).toBe('Alpha Product')
      expect(result.data.total).toBe(1)
    }
  })

  it('searches the description as well as the name', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Nondescript')
    await db
      .update(productTranslations)
      .set({ description: 'Runs on a Kubernetes cluster' })
      .where(eq(productTranslations.productId, product.id))
    await createProduct(cat.id, 'Something Else')

    const result = await listCatalog('en', { search: 'kubernetes' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items.map((r) => r.id)).toEqual([product.id])
    }
  })

  it('treats % and _ in a search term as text, not wildcards', async () => {
    // Issue #91: the term is the user's own text. Unescaped, a search for "50%"
    // matched every product and one for "a_b" matched "axb".
    const cat = await createCategory()
    const discounted = await createProduct(cat.id, 'Reduced by 50% today')
    await createProduct(cat.id, 'Full price')

    const result = await listCatalog('en', { search: '50%' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items.map((r) => r.id)).toEqual([discounted.id])
    }

    const underscore = await listCatalog('en', { search: 'a_b' })
    expect(underscore.ok).toBe(true)
    if (underscore.ok) expect(underscore.data.items).toEqual([])
  })

  it('category filter restricts to that category', async () => {
    const cat1 = await createCategory('Cat 1')
    const cat2 = await createCategory('Cat 2')
    await createProduct(cat1.id, 'P1')
    await createProduct(cat2.id, 'P2')

    const result = await listCatalog('en', { categoryId: cat2.id })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items.length).toBe(1)
      expect(result.data.items[0].categoryId).toBe(cat2.id)
      expect(result.data.total).toBe(1)
    }
  })

  it('returns one page and the full total, so the UI can count what it has not got', async () => {
    const cat = await createCategory()
    for (let i = 0; i < 5; i++) await createProduct(cat.id, `Product ${i}`)

    const first = await listCatalog('en', { limit: 2 })
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.data.items.length).toBe(2)
      expect(first.data.total).toBe(5)
      expect(first.data.limit).toBe(2)
      expect(first.data.offset).toBe(0)
    }

    const second = await listCatalog('en', { limit: 2, offset: 2 })
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.data.items.length).toBe(2)
      // A different page of the same ordering, not the same rows again.
      if (first.ok) {
        expect(second.data.items.map((r) => r.id)).not.toEqual(first.data.items.map((r) => r.id))
      }
    }
  })

  it('reports the total even on a page past the end of the results', async () => {
    // Counted separately from the rows for exactly this: "no rows here" must not
    // be reported as "nothing matched".
    const cat = await createCategory()
    await createProduct(cat.id, 'Only one')

    const result = await listCatalog('en', { limit: 10, offset: 50 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items).toEqual([])
      expect(result.data.total).toBe(1)
    }
  })

  it('caps the page size rather than honouring an unbounded limit', async () => {
    const result = await listCatalog('en', { limit: 100_000 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.limit).toBe(CATALOG_MAX_LIMIT)
  })

  it('counts matches for the filters, not the whole table', async () => {
    const cat = await createCategory()
    await createProduct(cat.id, 'Match me')
    await createProduct(cat.id, 'Not me')

    const result = await listCatalog('en', { search: 'Match', limit: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.total).toBe(1)
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

  it('collapses same-name rows to the product-scoped definition (resolved precedence)', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Overlap Product')

    // A global and a product row share the name SHARED. The resolved set the
    // order form renders must keep only the product-scoped definition (product
    // > category > global), not both duplicate controls.
    await db.insert(parameters).values([
      { scope: 'global', scopeId: 0, name: 'SHARED', type: 'string', defaultValue: 'from-global' },
      { scope: 'product', scopeId: product.id, name: 'SHARED', type: 'string', defaultValue: 'from-product' },
    ])

    const result = await getProduct(product.id, 'en')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const shared = (result.data.parameters as { name: string; scope: string; defaultValue: string }[])
      .filter((p) => p.name === 'SHARED')
    expect(shared).toHaveLength(1)
    expect(shared[0].scope).toBe('product')
    expect(shared[0].defaultValue).toBe('from-product')
  })

  it('does not let an env-A override erase the all-environments definition when no environment is requested', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Cross-Env Product')
    const ci = await createCiSource()
    const envA = await createEnvironment(ci.id)
    const envB = await createEnvironment(ci.id)

    // SHARED exists as an all-environments global row and as a product-scoped
    // override for env A only. Collapsing purely by name (the catalog page
    // fetches WITHOUT an environment — the user picks it in the order form)
    // would keep only the env-A row, and the form would then render no control
    // at all for env B while createOrder still resolves the global one.
    await db.insert(parameters).values([
      { scope: 'global', scopeId: 0, name: 'SHARED', type: 'string', defaultValue: 'all-envs' },
      { scope: 'product', scopeId: product.id, environmentId: envA.id, name: 'SHARED', type: 'string', defaultValue: 'env-a' },
    ])

    const unscoped = await getProduct(product.id, 'en')
    expect(unscoped.ok).toBe(true)
    if (!unscoped.ok) return

    const shared = (unscoped.data.parameters as { name: string; environmentId: number | null; defaultValue: string }[])
      .filter((p) => p.name === 'SHARED')
    // Both candidates survive — one per environment scope, not one overall.
    expect(shared).toHaveLength(2)
    expect(shared.map((p) => p.defaultValue).sort()).toEqual(['all-envs', 'env-a'])

    // Refetching with a concrete environment collapses to exactly what the
    // order service validates against: env A gets its override…
    const forA = await getProduct(product.id, 'en', envA.id)
    expect(forA.ok).toBe(true)
    if (forA.ok) {
      const rows = (forA.data.parameters as { name: string; defaultValue: string }[]).filter((p) => p.name === 'SHARED')
      expect(rows).toHaveLength(1)
      expect(rows[0].defaultValue).toBe('env-a')
    }

    // …and env B still gets the all-environments definition.
    const forB = await getProduct(product.id, 'en', envB.id)
    expect(forB.ok).toBe(true)
    if (forB.ok) {
      const rows = (forB.data.parameters as { name: string; defaultValue: string }[]).filter((p) => p.name === 'SHARED')
      expect(rows).toHaveLength(1)
      expect(rows[0].defaultValue).toBe('all-envs')
    }
  })

  it('still de-duplicates same-name rows within one environment when no environment is requested', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Intra-Env Product')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    // Two rows, same name, SAME environment, different scopes — the form must
    // not render duplicate controls for these.
    await db.insert(parameters).values([
      { scope: 'global', scopeId: 0, environmentId: env.id, name: 'DUP', type: 'string', defaultValue: 'from-global' },
      { scope: 'product', scopeId: product.id, environmentId: env.id, name: 'DUP', type: 'string', defaultValue: 'from-product' },
    ])

    const result = await getProduct(product.id, 'en')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const dup = (result.data.parameters as { name: string; scope: string; defaultValue: string }[])
      .filter((p) => p.name === 'DUP')
    expect(dup).toHaveLength(1)
    expect(dup[0].scope).toBe('product')
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
