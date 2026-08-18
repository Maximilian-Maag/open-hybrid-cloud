import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai', () => ({
  translateProduct: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/ci/webhooks', () => ({
  triggerProductWebhooks: vi.fn().mockResolvedValue(['pipe-destroy']),
  triggerPipelineStacks: vi.fn().mockResolvedValue([]),
  // The teardown paths use the *Tracked variants so a trigger that fails to
  // start is reported rather than swallowed.
  triggerProductWebhooksTracked: vi.fn().mockResolvedValue({ pipelineIds: ['pipe-destroy'], failures: [] }),
  triggerPipelineStacksTracked: vi.fn().mockResolvedValue({ pipelineIds: [], failures: [] }),
}))

import {
  listProducts,
  createProduct,
  getProductAdmin,
  updateProduct,
  deleteProduct,
  updateProductImage,
  translateProductById,
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
import { translateProduct } from '@/lib/ai'
import { triggerProductWebhooksTracked, triggerPipelineStacksTracked } from '@/lib/ci/webhooks'
import { db } from '@/lib/db/client'
import { products, productTranslations, infrastructureElements } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createCiSource,
  createEnvironment,
  createProduct as seedProduct,
  createProject,
  createOrder as seedOrder,
  createInfraElement,
  createCostCenter,
} from '@/test/helpers'

const mockedTranslate = vi.mocked(translateProduct)
const mockedWebhooks = vi.mocked(triggerProductWebhooksTracked)
const mockedStacks = vi.mocked(triggerPipelineStacksTracked)

beforeEach(() => {
  mockedTranslate.mockReset().mockResolvedValue({})
  mockedWebhooks.mockReset().mockResolvedValue({ pipelineIds: ['pipe-destroy'], failures: [] })
  mockedStacks.mockReset().mockResolvedValue({ pipelineIds: [], failures: [] })
})

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

  // FA-09.6: cascade decommissioning on product delete
  it('cascade-decommissions all active infra elements provisioned from the product (FA-09.6)', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await seedProduct(cat.id, 'ToDelete')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(pm.id)
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id)
    await createInfraElement(order.id, project.id, env.id, product.id)

    const result = await deleteProduct(product.id)
    expect(result.ok).toBe(true)

    expect(mockedWebhooks).toHaveBeenCalledTimes(2)
    expect(mockedWebhooks).toHaveBeenCalledWith(
      product.id,
      env.id,
      expect.objectContaining({ TF_ACTION: 'destroy' }),
    )
    // Pipeline-stack destroy fired for every active element too.
    expect(mockedStacks).toHaveBeenCalledTimes(2)
    expect(mockedStacks).toHaveBeenCalledWith(
      product.id,
      env.id,
      expect.objectContaining({ TF_ACTION: 'destroy' }),
    )
    // Infra rows are gone via ON DELETE CASCADE on product_id
    const rows = await db.select().from(infrastructureElements).where(eq(infrastructureElements.productId, product.id))
    expect(rows.length).toBe(0)
  })

  // FA-09.8: skip already-in-flight elements
  it('does not re-trigger destroy for elements already decommissioning/decommissioned (FA-09.8)', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await seedProduct(cat.id, 'MixState')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(pm.id)
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id, { status: 'decommissioning' })
    await createInfraElement(order.id, project.id, env.id, product.id, { status: 'decommissioned' })
    await createInfraElement(order.id, project.id, env.id, product.id, { status: 'active' })

    const result = await deleteProduct(product.id)
    expect(result.ok).toBe(true)

    expect(mockedWebhooks).toHaveBeenCalledTimes(1)
    expect(mockedStacks).toHaveBeenCalledTimes(1)
  })

  // Cascade-delete race: the destroy trigger must complete BEFORE the product
  // (and its cascaded infra rows) are deleted.
  it('awaits the destroy trigger before deleting the product', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await seedProduct(cat.id, 'AwaitDestroy')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(pm.id)
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id)

    let productExistedAtTrigger = false
    let infraExistedAtTrigger = false
    mockedWebhooks.mockImplementationOnce(async () => {
      productExistedAtTrigger =
        (await db.select().from(products).where(eq(products.id, product.id))).length > 0
      infraExistedAtTrigger =
        (await db.select().from(infrastructureElements).where(eq(infrastructureElements.productId, product.id))).length > 0
      return { pipelineIds: ['pipe-destroy'], failures: [] }
    })

    const result = await deleteProduct(product.id)
    expect(result.ok).toBe(true)

    expect(productExistedAtTrigger).toBe(true)
    expect(infraExistedAtTrigger).toBe(true)

    const rows = await db.select().from(products).where(eq(products.id, product.id))
    expect(rows.length).toBe(0)
  })

  it('refuses to delete the product when a destroy trigger could not be started', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await seedProduct(cat.id, 'TriggerFails')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(pm.id)
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id)
    mockedStacks.mockResolvedValueOnce({ pipelineIds: [], failures: ['pipeline stack "s" (#3): refused'] })

    const result = await deleteProduct(product.id)
    // Deleting would cascade the infrastructure_elements rows away and leave the
    // provisioned infrastructure running with nothing to reconcile it against.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(502)
      expect(result.message).toContain('refused')
    }

    // Product and its tracking rows survive so the operator can retry.
    const rows = await db.select().from(products).where(eq(products.id, product.id))
    expect(rows.length).toBe(1)
    const infra = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.productId, product.id))
    expect(infra.length).toBe(1)
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

  it.each(['active', 'decommissioning'])(
    'deleteProductEnvironment refuses while %s infrastructure exists',
    async (status) => {
      const { p, env } = await buildEnv()
      await createProductEnvironment(p.id, { environmentId: env.id })
      const user = await createUser({ role: 'admin' })
      const project = await createProject(user.id)
      const order = await seedOrder(project.id, p.id, env.id, user.id)
      await createInfraElement(order.id, project.id, env.id, p.id, { status })

      const result = await deleteProductEnvironment(p.id, env.id)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)

      // The offering must survive the refused delete.
      const listRes = await listProductEnvironments(p.id)
      expect(listRes.ok && listRes.data.length).toBe(1)
    },
  )

  it('deleteProductEnvironment ignores decommissioned infrastructure', async () => {
    const { p, env } = await buildEnv()
    await createProductEnvironment(p.id, { environmentId: env.id })
    const user = await createUser({ role: 'admin' })
    const project = await createProject(user.id)
    const order = await seedOrder(project.id, p.id, env.id, user.id)
    await createInfraElement(order.id, project.id, env.id, p.id, { status: 'decommissioned' })

    const result = await deleteProductEnvironment(p.id, env.id)
    expect(result.ok).toBe(true)
  })

  // ── overhead cost centre (issue #22) ──────────────────────────────────────
  it('stores and clears the overhead cost centre', async () => {
    const { p, env } = await buildEnv()
    const cc = await createCostCenter({ code: 'CC-OVERHEAD' })

    const created = await createProductEnvironment(p.id, {
      environmentId: env.id,
      costCenterMode: 'overhead',
      overheadCostCenterId: cc.id,
    })
    expect(created.ok).toBe(true)
    if (created.ok) expect(created.data.overheadCostCenterId).toBe(cc.id)

    const cleared = await updateProductEnvironment(p.id, env.id, { overheadCostCenterId: null })
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect(cleared.data.overheadCostCenterId).toBeNull()
  })

  it('defaults the overhead cost centre to null', async () => {
    const { p, env } = await buildEnv()
    const created = await createProductEnvironment(p.id, { environmentId: env.id })
    expect(created.ok && created.data.overheadCostCenterId).toBeNull()
  })

  it('rejects an unknown overhead cost centre on create and update', async () => {
    const { p, env } = await buildEnv()

    const created = await createProductEnvironment(p.id, { environmentId: env.id, overheadCostCenterId: 999_999 })
    expect(created.ok).toBe(false)
    if (!created.ok) {
      expect(created.status).toBe(400)
      expect(created.message).toMatch(/overhead cost center not found/i)
    }

    await createProductEnvironment(p.id, { environmentId: env.id })
    const updated = await updateProductEnvironment(p.id, env.id, { overheadCostCenterId: 999_999 })
    expect(updated.ok).toBe(false)
    if (!updated.ok) expect(updated.status).toBe(400)
  })

  it('rejects a deactivated overhead cost centre', async () => {
    // Accepting it here would only defer the failure to the next order placed
    // against the offering, long after the operator who set it has moved on.
    const { p, env } = await buildEnv()
    const cc = await createCostCenter({ code: 'CC-DEAD', active: false })

    const created = await createProductEnvironment(p.id, {
      environmentId: env.id,
      costCenterMode: 'overhead',
      overheadCostCenterId: cc.id,
    })
    expect(created.ok).toBe(false)
    if (!created.ok) expect(created.message).toMatch(/not active/i)
  })

  it('surfaces the overhead cost centre through the list and detail reads', async () => {
    const { p, env } = await buildEnv()
    const cc = await createCostCenter({ code: 'CC-OVERHEAD' })
    await createProductEnvironment(p.id, {
      environmentId: env.id,
      costCenterMode: 'overhead',
      overheadCostCenterId: cc.id,
    })

    const listRes = await listProductEnvironments(p.id)
    expect(listRes.ok && listRes.data[0].overheadCostCenterId).toBe(cc.id)

    const detailRes = await getProductAdmin(p.id)
    expect(detailRes.ok && detailRes.data.environments[0].overheadCostCenterId).toBe(cc.id)
  })

  it('deleteProductEnvironment ignores live infrastructure in a different environment', async () => {
    const { p, env } = await buildEnv()
    const otherEnv = await createEnvironment((await createCiSource()).id)
    await createProductEnvironment(p.id, { environmentId: env.id })
    const user = await createUser({ role: 'admin' })
    const project = await createProject(user.id)
    const order = await seedOrder(project.id, p.id, otherEnv.id, user.id)
    await createInfraElement(order.id, project.id, otherEnv.id, p.id, { status: 'active' })

    const result = await deleteProductEnvironment(p.id, env.id)
    expect(result.ok).toBe(true)
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

describe('updateProductImage', () => {
  it('stores the image buffer in the DB', async () => {
    const cat = await createCategory()
    const p = await seedProduct(cat.id, 'Img')
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47])

    const result = await updateProductImage(p.id, buf)
    expect(result.ok).toBe(true)

    const [row] = await db.select({ image: products.image }).from(products).where(eq(products.id, p.id))
    expect(row.image).not.toBeNull()
    if (row.image) expect(Buffer.from(row.image).equals(buf)).toBe(true)
  })
})

describe('translateProductById', () => {
  it('returns 404 for unknown product', async () => {
    const result = await translateProductById(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns 404 when base translation is missing', async () => {
    const cat = await createCategory()
    // Insert product without any translation row
    const [raw] = await db
      .insert(products)
      .values({ categoryId: cat.id, baseLanguage: 'de' })
      .returning()

    const result = await translateProductById(raw.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('calls translateProduct with base text and upserts returned translations', async () => {
    const cat = await createCategory()
    const p = await seedProduct(cat.id, 'Hello')

    mockedTranslate.mockResolvedValueOnce({
      de: { name: 'Hallo', description: 'Beschreibung' },
      fr: { name: 'Bonjour', description: 'Description' },
    })

    const result = await translateProductById(p.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.languages.sort()).toEqual(['de', 'fr'])

    expect(mockedTranslate).toHaveBeenCalledTimes(1)

    const rows = await db
      .select()
      .from(productTranslations)
      .where(eq(productTranslations.productId, p.id))
    const codes = rows.map((r) => r.languageCode).sort()
    expect(codes).toContain('de')
    expect(codes).toContain('fr')
    const de = rows.find((r) => r.languageCode === 'de')
    expect(de?.name).toBe('Hallo')
  })
})
