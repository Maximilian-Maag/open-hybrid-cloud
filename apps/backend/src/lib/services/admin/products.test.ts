import { describe, it, expect } from 'vitest'
import {
  listProducts,
  createProduct,
  getProductAdmin,
  updateProduct,
  deleteProduct,
  listTranslations,
  upsertTranslation,
  listProductEnvironments,
  createProductEnvironment,
  updateProductEnvironment,
  deleteProductEnvironment,
  listProductWebhooks,
  createProductWebhook,
  updateProductWebhook,
  deleteProductWebhook,
} from './products'
import { db } from '@/lib/db/client'
import { products, productTranslations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createCategory,
  createCiSource,
  createEnvironment,
  createProduct as seedProduct,
} from '@/test/helpers'

describe('listProducts', () => {
  it('returns all products with English translation', async () => {
    const cat = await createCategory()
    await seedProduct(cat.id, 'Alpha')
    await seedProduct(cat.id, 'Beta')

    const result = await listProducts()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(2)
      expect(result.data.map((p) => p.name).sort()).toEqual(['Alpha', 'Beta'])
    }
  })
})

describe('createProduct', () => {
  it('inserts a product with translation for baseLanguage', async () => {
    const cat = await createCategory()
    const result = await createProduct({
      categoryId: cat.id,
      baseLanguage: 'de',
      name: 'Deutsch Name',
      description: 'beschr',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.name).toBe('Deutsch Name')

    const tRows = await db
      .select()
      .from(productTranslations)
      .where(eq(productTranslations.productId, result.data.id))
    const codes = tRows.map((r) => r.languageCode).sort()
    expect(codes).toContain('de')
    expect(codes).toContain('en')
  })
})

describe('getProductAdmin', () => {
  it('returns 404 for unknown id', async () => {
    const result = await getProductAdmin(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns the product when found', async () => {
    const cat = await createCategory()
    const p = await seedProduct(cat.id, 'Find')
    const result = await getProductAdmin(p.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('Find')
  })
})

describe('updateProduct', () => {
  it('returns 404 for unknown id', async () => {
    const result = await updateProduct(999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updates name in the English translation', async () => {
    const cat = await createCategory()
    const p = await seedProduct(cat.id, 'Before')

    const result = await updateProduct(p.id, { name: 'After' })
    expect(result.ok).toBe(true)

    const tRows = await db
      .select()
      .from(productTranslations)
      .where(eq(productTranslations.productId, p.id))
    const en = tRows.find((r) => r.languageCode === 'en')
    expect(en?.name).toBe('After')
  })
})

describe('deleteProduct', () => {
  it('returns 404 for unknown id', async () => {
    const result = await deleteProduct(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('deletes from DB', async () => {
    const cat = await createCategory()
    const p = await seedProduct(cat.id, 'Del')
    const result = await deleteProduct(p.id)
    expect(result.ok).toBe(true)

    const rows = await db.select().from(products).where(eq(products.id, p.id))
    expect(rows.length).toBe(0)
  })
})

describe('listTranslations / upsertTranslation', () => {
  it('lists all translations for a product', async () => {
    const cat = await createCategory()
    const p = await seedProduct(cat.id, 'P')
    await db.insert(productTranslations).values({
      productId: p.id,
      languageCode: 'de',
      name: 'P-DE',
      description: '',
    })

    const result = await listTranslations(p.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const codes = result.data.map((t) => t.languageCode).sort()
      expect(codes).toEqual(['de', 'en'])
    }
  })

  it('inserts a new translation when none exists for that language', async () => {
    const cat = await createCategory()
    const p = await seedProduct(cat.id, 'P')

    const result = await upsertTranslation(p.id, 'fr', { name: 'Le Produit', description: 'fr desc' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('Le Produit')
      expect(result.data.languageCode).toBe('fr')
    }
  })

  it('updates an existing translation on conflict', async () => {
    const cat = await createCategory()
    const p = await seedProduct(cat.id, 'P')

    await upsertTranslation(p.id, 'fr', { name: 'Old FR', description: '' })
    const result = await upsertTranslation(p.id, 'fr', { name: 'New FR', description: 'updated' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('New FR')

    const rows = await db
      .select()
      .from(productTranslations)
      .where(eq(productTranslations.productId, p.id))
    const fr = rows.filter((r) => r.languageCode === 'fr')
    expect(fr.length).toBe(1)
    expect(fr[0].name).toBe('New FR')
  })
})

describe('product environments', () => {
  const buildEnv = async () => {
    const cat = await createCategory()
    const p = await seedProduct(cat.id, 'P')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    return { p, env }
  }

  it('createProductEnvironment then listProductEnvironments', async () => {
    const { p, env } = await buildEnv()

    const createRes = await createProductEnvironment(p.id, {
      environmentId: env.id,
      price: '50.00',
      currency: 'USD',
    })
    expect(createRes.ok).toBe(true)

    const listRes = await listProductEnvironments(p.id)
    expect(listRes.ok).toBe(true)
    if (listRes.ok) {
      expect(listRes.data.length).toBe(1)
      expect(listRes.data[0].environmentName).toBe('Test Env')
      expect(listRes.data[0].currency).toBe('USD')
    }
  })

  it('updateProductEnvironment returns 404 for unknown pair', async () => {
    const { p } = await buildEnv()
    const result = await updateProductEnvironment(p.id, 999_999, { price: '1.00' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updateProductEnvironment updates fields', async () => {
    const { p, env } = await buildEnv()
    await createProductEnvironment(p.id, { environmentId: env.id, price: '1.00' })

    const result = await updateProductEnvironment(p.id, env.id, { price: '99.99', currency: 'CHF' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.currency).toBe('CHF')
    }
  })

  it('deleteProductEnvironment returns 404 for unknown pair, removes existing', async () => {
    const { p, env } = await buildEnv()
    const missing = await deleteProductEnvironment(p.id, 999_999)
    expect(missing.ok).toBe(false)

    await createProductEnvironment(p.id, { environmentId: env.id })
    const ok = await deleteProductEnvironment(p.id, env.id)
    expect(ok.ok).toBe(true)
  })
})

describe('product webhooks', () => {
  const buildEnv = async () => {
    const cat = await createCategory()
    const p = await seedProduct(cat.id, 'P')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    return { p, env }
  }

  it('createProductWebhook then listProductWebhooks', async () => {
    const { p, env } = await buildEnv()
    const created = await createProductWebhook(p.id, {
      environmentId: env.id,
      name: 'wh',
      webhookUrl: 'http://example.com',
      webhookToken: 'tok',
      execOrder: 1,
    })
    expect(created.ok).toBe(true)

    const result = await listProductWebhooks(p.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe('wh')
    }
  })

  it('updateProductWebhook returns 404 for unknown id', async () => {
    const { p } = await buildEnv()
    const result = await updateProductWebhook(p.id, 999_999, { name: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updateProductWebhook updates fields', async () => {
    const { p, env } = await buildEnv()
    const created = await createProductWebhook(p.id, {
      environmentId: env.id,
      name: 'old',
      webhookUrl: 'http://e',
      webhookToken: 't',
    })
    if (!created.ok) throw new Error('seed failed')

    const result = await updateProductWebhook(p.id, created.data.id, { name: 'new' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('new')
  })

  it('deleteProductWebhook returns 404 for unknown id, removes existing', async () => {
    const { p, env } = await buildEnv()
    const missing = await deleteProductWebhook(p.id, 999_999)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.status).toBe(404)

    const created = await createProductWebhook(p.id, {
      environmentId: env.id,
      name: 'wh',
      webhookUrl: 'http://e',
      webhookToken: 't',
    })
    if (!created.ok) throw new Error('seed failed')
    const ok = await deleteProductWebhook(p.id, created.data.id)
    expect(ok.ok).toBe(true)
  })
})
