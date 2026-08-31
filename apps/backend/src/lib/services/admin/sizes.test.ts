import { describe, it, expect } from 'vitest'
import {
  listSizes, upsertSize, deleteSize, getSizeMatrix, saveSizeRow, deleteSizeRow,
} from './sizes'
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

  it("does not call '10' -> '10.00' a re-price", async () => {
    // NUMERIC(12,2) normalises on the way in, so a save that merely spells the
    // same amount differently used to be recorded as a price change. In a version
    // history a spurious entry is worse than a missing one: it is the record
    // someone reads to find out what actually happened.
    const { root, product, env } = await setup()
    await upsertSize(product.id, env.id, { code: 'M', price: '10', userId: root.id })

    const result = await upsertSize(product.id, env.id, {
      code: 'M',
      label: 'Medium',
      price: '10',
      userId: root.id,
    })
    expect(result.ok).toBe(true)

    const versions = await db
      .select()
      .from(productVersions)
      .where(eq(productVersions.productId, product.id))
    expect(versions).toHaveLength(2)
    expect(versions[1].summary).not.toContain('re-priced')
    expect(versions[1].summary).toContain('updated')
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

/**
 * The matrix (#249).
 *
 * Two environments the product IS offered in and one it is not, because the two
 * mistakes this shape invites are pricing a size into an offering that does not
 * exist and inventing a row for an environment that never had the size.
 */
const matrixSetup = async () => {
  const root = await createUser({ role: 'root', email: 'root@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'VM')
  const ci = await createCiSource()
  const frankfurt = await createEnvironment(ci.id, undefined, 'Frankfurt')
  const vienna = await createEnvironment(ci.id, undefined, 'Vienna')
  const unoffered = await createEnvironment(ci.id, undefined, 'Nowhere')
  await linkProductEnvironment(product.id, frankfurt.id, { price: '99.00', currency: 'EUR' })
  await linkProductEnvironment(product.id, vienna.id, { price: '80.00', currency: 'CHF' })
  return { root, product, frankfurt, vienna, unoffered }
}

describe('getSizeMatrix', () => {
  it('answers what a size costs everywhere, in one row', async () => {
    const { product, frankfurt, vienna } = await matrixSetup()
    await createSize(product.id, frankfurt.id, { code: 'XL', price: '40.00', sortOrder: 2 })
    await createSize(product.id, vienna.id, { code: 'XL', price: '100.00', currency: 'CHF', sortOrder: 2 })
    await createSize(product.id, frankfurt.id, { code: 'S', price: '10.00', sortOrder: 1 })

    const result = await getSizeMatrix(product.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Sorted by the admin's own sortOrder, which is the whole reason the column
    // exists — alphabetically 'S' and 'XL' happen to agree, so the fixture makes
    // them disagree with insertion order instead.
    expect(result.data.rows.map((r) => r.code)).toEqual(['S', 'XL'])
    const xl = result.data.rows[1]
    expect(xl.cells.map((c) => [c.environmentId, c.price, c.currency])).toEqual(
      expect.arrayContaining([
        [frankfurt.id, '40.00', 'EUR'],
        [vienna.id, '100.00', 'CHF'],
      ]),
    )
  })

  it('leaves a hole where the size is not offered, rather than a zero', async () => {
    const { product, frankfurt, vienna } = await matrixSetup()
    await createSize(product.id, frankfurt.id, { code: 'S', price: '10.00' })

    const result = await getSizeMatrix(product.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // A code is unique per (product, environment), never global. Vienna simply has
    // no S — reporting it as 0.00 would be a price nobody set.
    expect(result.data.rows[0].cells.map((c) => c.environmentId)).toEqual([frankfurt.id])
    expect(result.data.environments.map((e) => e.environmentId)).toEqual([frankfurt.id, vienna.id])
  })

  it('offers only the environments the product is actually offered in as columns', async () => {
    const { product, unoffered } = await matrixSetup()

    const result = await getSizeMatrix(product.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.environments.map((e) => e.environmentId)).not.toContain(unoffered.id)
    // The offering's own currency travels with the column: it is the sensible
    // default for a cell that has none yet, and CHF here is not EUR.
    expect(result.data.environments.map((e) => e.currency)).toEqual(['EUR', 'CHF'])
  })

  it('answers 404 for a product that does not exist', async () => {
    const result = await getSizeMatrix(999999)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
  })
})

describe('saveSizeRow', () => {
  it('prices one size in every environment in a single save', async () => {
    const { root, product, frankfurt, vienna } = await matrixSetup()

    const result = await saveSizeRow(product.id, 'XL', {
      label: 'Extra large',
      sortOrder: 3,
      cells: [
        { environmentId: frankfurt.id, price: '40.00', currency: 'EUR' },
        { environmentId: vienna.id, price: '100', currency: 'CHF' },
      ],
      userId: root.id,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.cells).toHaveLength(2)
    const rows = await db
      .select()
      .from(productEnvironmentSizes)
      .where(eq(productEnvironmentSizes.productId, product.id))
    expect(rows).toHaveLength(2)
    // The row's label and order are properties of the SIZE, so both cells carry
    // them — a grid whose row header is blank in one column reads as a bug.
    expect(rows.every((r) => r.label === 'Extra large' && r.sortOrder === 3)).toBe(true)
  })

  it('does not force one currency across the row', async () => {
    const { root, product, frankfurt, vienna } = await matrixSetup()

    await saveSizeRow(product.id, 'XL', {
      cells: [
        { environmentId: frankfurt.id, price: '40.00', currency: 'EUR' },
        { environmentId: vienna.id, price: '100.00', currency: 'CHF' },
      ],
      userId: root.id,
    })

    const matrix = await getSizeMatrix(product.id)
    expect(matrix.ok).toBe(true)
    if (!matrix.ok) return
    // Comparing across currencies is what exchangeRates is for; flattening them
    // here would silently re-price one of the two environments.
    expect(matrix.data.rows[0].cells.map((c) => c.currency).sort()).toEqual(['CHF', 'EUR'])
  })

  it('retires the cell it is asked to clear, and keeps the price it was struck at', async () => {
    const { root, product, frankfurt, vienna } = await matrixSetup()
    await saveSizeRow(product.id, 'XL', {
      cells: [
        { environmentId: frankfurt.id, price: '40.00' },
        { environmentId: vienna.id, price: '100.00' },
      ],
      userId: root.id,
    })

    await saveSizeRow(product.id, 'XL', {
      cells: [{ environmentId: frankfurt.id, price: '40.00' }],
      userId: root.id,
    })

    const rows = await db
      .select()
      .from(productEnvironmentSizes)
      .where(eq(productEnvironmentSizes.productId, product.id))
      .orderBy(productEnvironmentSizes.environmentId)
    // Two rows still: a size that has been ordered is referenced by those orders
    // by code, and deleting it stops their history rendering. Vienna's price
    // survives with it, because that is what its orders were charged.
    expect(rows).toHaveLength(2)
    const viennaRow = rows.find((r) => r.environmentId === vienna.id)
    expect(viennaRow).toMatchObject({ active: false, price: '100.00' })
    expect(rows.find((r) => r.environmentId === frankfurt.id)).toMatchObject({ active: true })
  })

  it('does not invent a retired cell for an environment that never offered the size', async () => {
    const { root, product, frankfurt, vienna } = await matrixSetup()

    await saveSizeRow(product.id, 'XL', {
      cells: [{ environmentId: frankfurt.id, price: '40.00' }],
      userId: root.id,
    })

    const rows = await db
      .select()
      .from(productEnvironmentSizes)
      .where(eq(productEnvironmentSizes.productId, product.id))
    // Writing the whole grid on every save would give Vienna a retired XL it never
    // had, which is a row in the admin list, an entry in the history and a lie
    // about what was once orderable.
    expect(rows).toHaveLength(1)
    expect(rows[0].environmentId).toBe(frankfurt.id)
    expect(rows.some((r) => r.environmentId === vienna.id)).toBe(false)
  })

  it('restores a retired cell when it is priced again', async () => {
    const { root, product, frankfurt } = await matrixSetup()
    await saveSizeRow(product.id, 'XL', { cells: [{ environmentId: frankfurt.id, price: '40.00' }], userId: root.id })
    await saveSizeRow(product.id, 'XL', { cells: [], userId: root.id })

    await saveSizeRow(product.id, 'XL', { cells: [{ environmentId: frankfurt.id, price: '45.00' }], userId: root.id })

    const [row] = await db.select().from(productEnvironmentSizes).where(eq(productEnvironmentSizes.productId, product.id))
    expect(row).toMatchObject({ active: true, price: '45.00' })
    const versions = await db.select().from(productVersions).where(eq(productVersions.productId, product.id))
    expect(versions.map((v) => v.summary)).toEqual([
      'Size XL added at 40.00 EUR',
      'Size XL retired',
      'Size XL restored at 45.00 EUR',
    ])
  })

  it('writes no cell at all when one of them is priced wrongly', async () => {
    const { root, product, frankfurt, vienna } = await matrixSetup()

    const result = await saveSizeRow(product.id, 'XL', {
      cells: [
        { environmentId: frankfurt.id, price: '40.00' },
        { environmentId: vienna.id, price: '-5' },
      ],
      userId: root.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
    // The point of saving a row rather than a cell at a time: half a price list
    // looks finished and is not.
    expect(await db.select().from(productEnvironmentSizes)).toHaveLength(0)
  })

  it('refuses to price a size into an environment the product is not offered in', async () => {
    const { root, product, frankfurt, unoffered } = await matrixSetup()

    const result = await saveSizeRow(product.id, 'XL', {
      cells: [
        { environmentId: frankfurt.id, price: '40.00' },
        { environmentId: unoffered.id, price: '40.00' },
      ],
      userId: root.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
    expect(await db.select().from(productEnvironmentSizes)).toHaveLength(0)
  })

  it('refuses the same environment priced twice', async () => {
    const { root, product, frankfurt } = await matrixSetup()

    const result = await saveSizeRow(product.id, 'XL', {
      cells: [
        { environmentId: frankfurt.id, price: '40.00' },
        { environmentId: frankfurt.id, price: '50.00' },
      ],
      userId: root.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
    expect(await db.select().from(productEnvironmentSizes)).toHaveLength(0)
  })

  it('records history only for the environments whose cell actually changed', async () => {
    const { root, product, frankfurt, vienna } = await matrixSetup()
    await saveSizeRow(product.id, 'XL', {
      cells: [
        { environmentId: frankfurt.id, price: '40.00' },
        { environmentId: vienna.id, price: '100.00' },
      ],
      userId: root.id,
    })

    await saveSizeRow(product.id, 'XL', {
      cells: [
        { environmentId: frankfurt.id, price: '45.00' },
        { environmentId: vienna.id, price: '100' },
      ],
      userId: root.id,
    })

    const versions = await db
      .select()
      .from(productVersions)
      .where(eq(productVersions.productId, product.id))
      .orderBy(productVersions.id)
    // Two for the first save, one for the second: Vienna re-sent '100', which
    // NUMERIC(12,2) stores as the '100.00' already there. A history that reports
    // a re-price that did not happen is worse than one missing an entry — it is
    // the record someone reads to find out what changed.
    expect(versions.map((v) => [v.environmentId, v.summary])).toEqual([
      [frankfurt.id, 'Size XL added at 40.00 EUR'],
      [vienna.id, 'Size XL added at 100.00 EUR'],
      [frankfurt.id, 'Size XL re-priced 40.00 EUR → 45.00 EUR'],
    ])
  })

  it('refuses a code the pipeline could not carry', async () => {
    const { root, product, frankfurt } = await matrixSetup()

    const result = await saveSizeRow(product.id, 'X L; rm -rf /', {
      cells: [{ environmentId: frankfurt.id, price: '40.00' }],
      userId: root.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
  })
})

describe('deleteSizeRow', () => {
  it('removes the code from every environment and says so once per environment', async () => {
    const { root, product, frankfurt, vienna } = await matrixSetup()
    await saveSizeRow(product.id, 'XL', {
      cells: [
        { environmentId: frankfurt.id, price: '40.00' },
        { environmentId: vienna.id, price: '100.00' },
      ],
      userId: root.id,
    })
    await saveSizeRow(product.id, 'S', { cells: [{ environmentId: frankfurt.id, price: '10.00' }], userId: root.id })

    const result = await deleteSizeRow(product.id, 'XL')

    expect(result.ok).toBe(true)
    const rows = await db.select().from(productEnvironmentSizes).where(eq(productEnvironmentSizes.productId, product.id))
    expect(rows.map((r) => r.code)).toEqual(['S'])
    const removals = (
      await db.select().from(productVersions).where(eq(productVersions.productId, product.id))
    ).filter((v) => v.summary === 'Size XL removed')
    expect(removals).toHaveLength(2)
  })

  it('answers 404 for a code no environment has', async () => {
    const { product } = await matrixSetup()
    const result = await deleteSizeRow(product.id, 'XXL')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
  })
})
