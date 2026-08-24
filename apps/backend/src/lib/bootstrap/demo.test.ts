import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/lib/db/client'
import { categories, costCenters, productImages, products } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createUser } from '@/test/helpers'
import { seedDemoData } from './demo'

const MARKER = 'Demo — Compute'
const marker = () =>
  db.select({ id: categories.id }).from(categories).where(eq(categories.name, MARKER))

beforeEach(() => {
  // The seed narrates what it did; nothing here needs to read that.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('seedDemoData', () => {
  it('does nothing without a root user, rather than seeding half a catalogue', async () => {
    expect(await seedDemoData()).toEqual({ created: false })
    expect(await marker()).toHaveLength(0)
  })

  it('creates the demo catalogue', async () => {
    await createUser({ role: 'root', email: 'demo-root@test.dev' })

    expect(await seedDemoData()).toEqual({ created: true })
    expect(await marker()).toHaveLength(1)
    // Every demo product carries pictures AND a description for each (#105) —
    // seeding an image with no alt text would defeat the rule it was added for.
    // Two apiece, so the dev database exercises the gallery rather than the
    // single-picture case the gallery replaced (#107).
    const productRows = await db.select({ id: products.id }).from(products)
    expect(productRows).toHaveLength(3)
    for (const product of productRows) {
      const images = await db
        .select({ position: productImages.position, alt: productImages.alt })
        .from(productImages)
        .where(eq(productImages.productId, product.id))
        .orderBy(productImages.position)
      expect(images.length).toBeGreaterThan(1)
      expect(images.map((image) => image.position)).toEqual(images.map((_, index) => index))
      for (const image of images) expect(image.alt.trim()).toBeTruthy()
    }
  })

  it('skips a database that already has the demo data', async () => {
    await createUser({ role: 'root', email: 'demo-root-2@test.dev' })
    await seedDemoData()

    expect(await seedDemoData()).toEqual({ created: false })
    expect(await db.select({ id: products.id }).from(products)).toHaveLength(3)
  })

  it('rolls the marker back when a later insert fails', async () => {
    await createUser({ role: 'root', email: 'demo-root-3@test.dev' })
    // CC-100 is one of the seed's own cost centres and the code is UNIQUE, so this
    // makes an insert *after* the marker category fail. Before the seed ran in one
    // transaction, the marker survived that failure and every later run reported
    // "already present" over a half-built dataset.
    await db.insert(costCenters).values({ code: 'CC-100', name: 'Taken' })

    await expect(seedDemoData()).rejects.toThrow()
    expect(await marker()).toHaveLength(0)
    expect(await db.select({ id: products.id }).from(products)).toHaveLength(0)
  })
})
