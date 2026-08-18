import { describe, it, expect } from 'vitest'
import {
  recordProductVersion,
  listProductVersions,
  diffProductVersions,
  diffSnapshots,
  MAX_CHANGELOG_LENGTH,
} from './versions'
import type { ProductSnapshot } from './snapshot'
import { db } from '@/lib/db/client'
import { productVersions, auditLog, productEnvironments } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  linkProductEnvironment,
} from '@/test/helpers'

const build = async () => {
  const root = await createUser({ role: 'root', email: 'ver-root@test.dev', name: 'Root User' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Nginx Gateway')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id, undefined, 'AWS Frankfurt')
  await linkProductEnvironment(product.id, env.id, { price: '10.00' })
  return { root, product, env }
}

describe('recordProductVersion', () => {
  it('records an environment-scoped change with a snapshot', async () => {
    const { root, product, env } = await build()
    await recordProductVersion({
      productId: product.id,
      environmentId: env.id,
      summary: 'Offering updated: price',
      changelog: 'Annual price review',
      userId: root.id,
    })

    const [row] = await db.select().from(productVersions)
    expect(row).toMatchObject({
      productId: product.id,
      environmentId: env.id,
      summary: 'Offering updated: price',
      changelog: 'Annual price review',
      createdBy: root.id,
    })
    expect(row.snapshot?.price).toBe('10.00')
  })

  it('records a product-level change without a snapshot', async () => {
    // A rename is not specific to one environment, so there is no single offering
    // to capture and picking one would be misleading.
    const { root, product } = await build()
    await recordProductVersion({
      productId: product.id,
      environmentId: null,
      summary: 'Product updated: name',
      userId: root.id,
    })

    const [row] = await db.select().from(productVersions)
    expect(row.snapshot).toBeNull()
    expect(row.environmentId).toBeNull()
  })

  it('defaults the changelog to an empty string, not null', async () => {
    // One representation of "no note" so readers do not have to handle both.
    const { root, product, env } = await build()
    await recordProductVersion({ productId: product.id, environmentId: env.id, summary: 'x', userId: root.id })
    const [row] = await db.select().from(productVersions)
    expect(row.changelog).toBe('')
  })

  it('trims and truncates an oversized changelog', async () => {
    const { root, product, env } = await build()
    await recordProductVersion({
      productId: product.id,
      environmentId: env.id,
      summary: 'x',
      changelog: `  ${'y'.repeat(MAX_CHANGELOG_LENGTH + 100)}  `,
      userId: root.id,
    })
    const [row] = await db.select().from(productVersions)
    expect(row.changelog).toHaveLength(MAX_CHANGELOG_LENGTH)
  })

  it('audits the change, so the record survives the product being deleted', async () => {
    const { root, product, env } = await build()
    await recordProductVersion({
      productId: product.id,
      environmentId: env.id,
      summary: 'Offering updated: price',
      changelog: 'Annual review',
      userId: root.id,
    })

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'product.version_recorded'))
    expect(entry.entityId).toBe(product.id)
    expect(entry.details).toContain('Annual review')
  })

  it('never throws — a history failure must not fail the edit it describes', async () => {
    // Losing one history row is a smaller problem than an operator being unable to
    // fix a price.
    await expect(
      recordProductVersion({ productId: 999_999, environmentId: null, summary: 'x', userId: null }),
    ).resolves.toBeUndefined()
  })
})

describe('listProductVersions', () => {
  it('returns 404 for an unknown product', async () => {
    const result = await listProductVersions(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns newest first with the author and environment resolved', async () => {
    const { root, product, env } = await build()
    await recordProductVersion({ productId: product.id, environmentId: env.id, summary: 'first', userId: root.id })
    await recordProductVersion({ productId: product.id, environmentId: env.id, summary: 'second', userId: root.id })

    const result = await listProductVersions(product.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((v) => v.summary)).toEqual(['second', 'first'])
    expect(result.data[0]).toMatchObject({ authorName: 'Root User', environmentName: 'AWS Frankfurt' })
  })

  it('returns an empty history rather than an error', async () => {
    const { product } = await build()
    const result = await listProductVersions(product.id)
    expect(result.ok && result.data).toEqual([])
  })

  it('cascades away with the product', async () => {
    const { root, product, env } = await build()
    await recordProductVersion({ productId: product.id, environmentId: env.id, summary: 'x', userId: root.id })
    await db.execute(`DELETE FROM products WHERE id = ${product.id}` as never)
    expect(await db.select().from(productVersions)).toHaveLength(0)
  })
})

// ─── Diffing ──────────────────────────────────────────────────────────────────

const snapshot = (over?: Partial<ProductSnapshot>): ProductSnapshot => ({
  version: 1,
  capturedAt: '2026-06-01T10:00:00.000Z',
  productName: 'Nginx Gateway',
  productDescription: 'A proxy',
  environmentName: 'AWS Frankfurt',
  price: '10.00',
  currency: 'EUR',
  costCenterMode: 'project',
  forcedCostCenter: false,
  trialEnabled: false,
  trialDurationMinutes: 30,
  parameters: [
    { name: 'REGION', label: 'Region', type: 'string', description: '', defaultValue: 'eu', required: false, sensitive: false },
  ],
  ...over,
})

describe('diffSnapshots', () => {
  it('reports two identical snapshots as identical', () => {
    const diff = diffSnapshots(snapshot(), snapshot())
    expect(diff).toMatchObject({ fields: [], parameters: [], identical: true })
  })

  it('ignores capturedAt — a later capture of the same config is not a change', () => {
    const diff = diffSnapshots(snapshot(), snapshot({ capturedAt: '2027-01-01T00:00:00.000Z' }))
    expect(diff.identical).toBe(true)
  })

  it('reports a changed price', () => {
    const diff = diffSnapshots(snapshot(), snapshot({ price: '12.00' }))
    expect(diff.fields).toEqual([{ field: 'price', from: '10.00', to: '12.00' }])
    expect(diff.identical).toBe(false)
  })

  it('reports changed booleans and numbers', () => {
    const diff = diffSnapshots(snapshot(), snapshot({ trialEnabled: true, trialDurationMinutes: 60 }))
    expect(diff.fields).toEqual([
      { field: 'trialEnabled', from: 'false', to: 'true' },
      { field: 'trialDurationMinutes', from: '30', to: '60' },
    ])
  })

  it('reports an added parameter', () => {
    const added = { name: 'SIZE', label: '', type: 'number', description: '', defaultValue: '', required: true, sensitive: false }
    const diff = diffSnapshots(snapshot(), snapshot({ parameters: [...snapshot().parameters, added] }))
    expect(diff.parameters).toEqual([{ kind: 'added', name: 'SIZE', to: added }])
  })

  it('reports a removed parameter', () => {
    const diff = diffSnapshots(snapshot(), snapshot({ parameters: [] }))
    expect(diff.parameters).toMatchObject([{ kind: 'removed', name: 'REGION' }])
  })

  it('reports a changed default and a changed required flag', () => {
    const changed = { ...snapshot().parameters[0], defaultValue: 'us', required: true }
    const diff = diffSnapshots(snapshot(), snapshot({ parameters: [changed] }))
    expect(diff.parameters).toEqual([
      {
        kind: 'changed',
        name: 'REGION',
        fields: [
          { field: 'defaultValue', from: 'eu', to: 'us' },
          { field: 'required', from: 'false', to: 'true' },
        ],
      },
    ])
  })

  it('sorts parameter changes so the same pair always diffs the same way', () => {
    const from = snapshot({ parameters: [] })
    const to = snapshot({
      parameters: [
        { name: 'ZONE', label: '', type: 'string', description: '', defaultValue: '', required: false, sensitive: false },
        { name: 'ALPHA', label: '', type: 'string', description: '', defaultValue: '', required: false, sensitive: false },
      ],
    })
    expect(diffSnapshots(from, to).parameters.map((p) => p.name)).toEqual(['ALPHA', 'ZONE'])
  })

  it('is not identical when either side is missing', () => {
    expect(diffSnapshots(null, snapshot()).identical).toBe(false)
    expect(diffSnapshots(snapshot(), null).identical).toBe(false)
  })
})

describe('diffProductVersions', () => {
  const twoVersions = async () => {
    const ctx = await build()
    await recordProductVersion({ productId: ctx.product.id, environmentId: ctx.env.id, summary: 'v1', userId: ctx.root.id })
    await db
      .update(productEnvironments)
      .set({ price: '25.00' })
      .where(
        and(
          eq(productEnvironments.productId, ctx.product.id),
          eq(productEnvironments.environmentId, ctx.env.id),
        ),
      )
    await recordProductVersion({ productId: ctx.product.id, environmentId: ctx.env.id, summary: 'v2', userId: ctx.root.id })

    const listed = await listProductVersions(ctx.product.id)
    if (!listed.ok) throw new Error('setup failed')
    // Newest first, so [0] is v2.
    return { ...ctx, older: listed.data[1], newer: listed.data[0] }
  }

  it('diffs two versions of the same product', async () => {
    const { product, older, newer } = await twoVersions()
    const result = await diffProductVersions(product.id, older.id, newer.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.fields).toEqual([{ field: 'price', from: '10.00', to: '25.00' }])
    expect(result.data.fromVersionId).toBe(older.id)
  })

  it('returns 404 for a version id that is not this product\'s', async () => {
    // Otherwise a version belonging to another product could be compared through
    // this product's URL.
    const { product, older, newer } = await twoVersions()
    const other = await createProduct((await createCategory()).id, 'Other')

    const result = await diffProductVersions(other.id, older.id, newer.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
    // And the reverse: an unknown id under the right product.
    const missing = await diffProductVersions(product.id, older.id, 999_999)
    expect(missing.ok).toBe(false)
  })

  it('refuses to diff a version that has no snapshot', async () => {
    const ctx = await build()
    await recordProductVersion({ productId: ctx.product.id, environmentId: ctx.env.id, summary: 'with', userId: ctx.root.id })
    await recordProductVersion({ productId: ctx.product.id, environmentId: null, summary: 'without', userId: ctx.root.id })

    const listed = await listProductVersions(ctx.product.id)
    if (!listed.ok) throw new Error('setup failed')
    const result = await diffProductVersions(ctx.product.id, listed.data[1].id, listed.data[0].id)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toMatch(/no configuration snapshot/i)
    }
  })

  it('reports no difference when the same version is compared with itself', async () => {
    const { product, newer } = await twoVersions()
    const result = await diffProductVersions(product.id, newer.id, newer.id)
    expect(result.ok && result.data.identical).toBe(true)
  })
})
