import { describe, it, expect } from 'vitest'
import { captureProductSnapshot, REDACTED_DEFAULT } from './snapshot'
import { db } from '@/lib/db/client'
import { parameters, productTranslations } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  linkProductEnvironment,
} from '@/test/helpers'

const build = async (over?: Parameters<typeof linkProductEnvironment>[2]) => {
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Nginx Gateway')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id, undefined, 'AWS Frankfurt')
  await linkProductEnvironment(product.id, env.id, { price: '12.50', currency: 'CHF', ...over })
  await db
    .update(productTranslations)
    .set({ description: 'A reverse proxy' })
    .where(and(eq(productTranslations.productId, product.id), eq(productTranslations.languageCode, 'en')))
  return { cat, product, env }
}

describe('captureProductSnapshot', () => {
  it('returns null when the product is not offered in that environment', async () => {
    const { cat, product } = await build()
    const ci = await createCiSource()
    const other = await createEnvironment(ci.id)

    expect(await captureProductSnapshot(product.id, cat.id, other.id)).toBeNull()
  })

  it('captures the offering as it stands now', async () => {
    const { cat, product, env } = await build({ costCenterMode: 'select', forcedCostCenter: true })
    const snapshot = await captureProductSnapshot(product.id, cat.id, env.id)

    expect(snapshot).toMatchObject({
      version: 1,
      productName: 'Nginx Gateway',
      productDescription: 'A reverse proxy',
      environmentName: 'AWS Frankfurt',
      price: '12.50',
      currency: 'CHF',
      costCenterMode: 'select',
      forcedCostCenter: true,
    })
    expect(snapshot?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('records the parameter definitions that actually applied', async () => {
    const { cat, product, env } = await build()
    await db.insert(parameters).values([
      { scope: 'global', scopeId: 0, name: 'REGION', type: 'string', defaultValue: 'eu-central-1' },
      { scope: 'product', scopeId: product.id, name: 'SIZE', type: 'number', required: true, label: 'Size' },
    ])

    const snapshot = await captureProductSnapshot(product.id, cat.id, env.id)
    expect(snapshot?.parameters.map((p) => p.name)).toEqual(['REGION', 'SIZE'])
    expect(snapshot?.parameters.find((p) => p.name === 'SIZE')).toMatchObject({
      type: 'number',
      required: true,
      label: 'Size',
    })
  })

  it('applies scope precedence, so it records the definition the order used', async () => {
    // A product-scoped override wins over the global definition of the same name,
    // exactly as the order form rendered and the order service validated.
    const { cat, product, env } = await build()
    await db.insert(parameters).values([
      { scope: 'global', scopeId: 0, name: 'REGION', type: 'string', defaultValue: 'global-default' },
      { scope: 'product', scopeId: product.id, name: 'REGION', type: 'string', defaultValue: 'product-default' },
    ])

    const snapshot = await captureProductSnapshot(product.id, cat.id, env.id)
    expect(snapshot?.parameters).toHaveLength(1)
    expect(snapshot?.parameters[0].defaultValue).toBe('product-default')
  })

  it('redacts a sensitive parameter\'s default value', async () => {
    // The snapshot is rendered on a page the ORDERER sees, and a sensitive
    // default can be a placeholder secret. The definition is worth recording; its
    // default is not worth leaking.
    const { cat, product, env } = await build()
    await db.insert(parameters).values({
      scope: 'product', scopeId: product.id, name: 'ADMIN_PASSWORD', type: 'string',
      defaultValue: 'sup3rs3cret', sensitive: true,
    })

    const snapshot = await captureProductSnapshot(product.id, cat.id, env.id)
    const param = snapshot?.parameters.find((p) => p.name === 'ADMIN_PASSWORD')
    expect(param?.defaultValue).toBe(REDACTED_DEFAULT)
    expect(param?.sensitive).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('sup3rs3cret')
  })

  it('sorts parameters by name so two identical configurations compare equal', async () => {
    const { cat, product, env } = await build()
    await db.insert(parameters).values([
      { scope: 'product', scopeId: product.id, name: 'ZONE', type: 'string' },
      { scope: 'product', scopeId: product.id, name: 'ALPHA', type: 'string' },
    ])

    const snapshot = await captureProductSnapshot(product.id, cat.id, env.id)
    expect(snapshot?.parameters.map((p) => p.name)).toEqual(['ALPHA', 'ZONE'])
  })

  it('captures the trial configuration too', async () => {
    const { cat, product, env } = await build({ trialEnabled: true, trialDurationMinutes: 45 })
    const snapshot = await captureProductSnapshot(product.id, cat.id, env.id)
    expect(snapshot).toMatchObject({ trialEnabled: true, trialDurationMinutes: 45 })
  })

  it('falls back to a placeholder name when there is no English translation', async () => {
    const { cat, product, env } = await build()
    await db.delete(productTranslations).where(eq(productTranslations.productId, product.id))

    const snapshot = await captureProductSnapshot(product.id, cat.id, env.id)
    expect(snapshot?.productName).toBe(`Product #${product.id}`)
  })
})
