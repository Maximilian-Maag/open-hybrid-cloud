import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/lib/db/client'
import { categories, ciSources, costCenters, deploymentEnvironments, productImages, products } from '@/lib/db/schema'
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

/**
 * The seed writes a CI source and two environments. Both carry credentials, and
 * both used to carry LITERAL ones — `demo-token`, `demo-callback-1`.
 *
 * A callback secret an attacker can type is a pipeline callback an attacker can
 * forge. It only takes this running once somewhere real, and the old guard —
 * the marker category — answers "has this run before", not "should it run at
 * all" (#147).
 */
describe('the credentials it writes', () => {
  const seeded = async () => {
    await createUser({ role: 'root' })
    expect(await seedDemoData()).toEqual({ created: true })
  }

  it('generates them rather than using a literal anyone can read here', async () => {
    await seeded()

    const [source] = await db.select().from(ciSources)
    const envs = await db.select().from(deploymentEnvironments)

    for (const secret of [source.accessToken, ...envs.map((e) => e.callbackSecret)]) {
      expect(secret).not.toMatch(/^demo-/)
      // base64url of 24 bytes. Long enough that guessing is not the attack.
      expect(secret.length).toBeGreaterThanOrEqual(32)
    }
  })

  it('gives the two environments different secrets', async () => {
    await seeded()
    const envs = await db.select().from(deploymentEnvironments)
    expect(envs).toHaveLength(2)
    expect(envs[0].callbackSecret).not.toBe(envs[1].callbackSecret)
  })
})

describe('where it will and will not run', () => {
  const withEnv = async (env: Record<string, string | undefined>, work: () => Promise<void>) => {
    const before = { ...process.env }
    Object.assign(process.env, env)
    try {
      await work()
    } finally {
      process.env = before
    }
  }

  it('refuses a production database outright', async () => {
    await createUser({ role: 'root' })

    await withEnv({ NODE_ENV: 'production', ALLOW_DEMO_SEED_IN_PRODUCTION: undefined }, async () => {
      expect(await seedDemoData()).toEqual({ created: false })
    })

    // Nothing written, not even the marker — so a later run in the right
    // environment is not fooled into thinking the work is done.
    expect(await marker()).toEqual([])
  })

  // Explicit, and named after what it does. An operator who genuinely wants demo
  // rows in a production-mode database can have them; nobody gets them by
  // accident.
  it('seeds a production database when told to in so many words', async () => {
    await createUser({ role: 'root' })

    await withEnv({ NODE_ENV: 'production', ALLOW_DEMO_SEED_IN_PRODUCTION: '1' }, async () => {
      expect(await seedDemoData()).toEqual({ created: true })
    })

    expect(await marker()).toHaveLength(1)
  })
})
