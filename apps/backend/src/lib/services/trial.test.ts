import { describe, it, expect } from 'vitest'
import { resolveTrial, trialVariables, trialExpiry, TRIAL_VAR, TRIAL_DURATION_VAR } from './trial'
import { db } from '@/lib/db/client'
import { productEnvironments } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  linkProductEnvironment,
} from '@/test/helpers'

const offering = async (over?: { trialEnabled?: boolean; trialDurationMinutes?: number }) => {
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'P')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  await linkProductEnvironment(product.id, env.id, over)
  return { product, env }
}

describe('resolveTrial', () => {
  it('rejects a product that is not offered in the environment', async () => {
    const { product } = await offering()
    const ci = await createCiSource()
    const other = await createEnvironment(ci.id)

    const result = await resolveTrial(product.id, other.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejects an offering that has not opted in', async () => {
    // Trials provision real infrastructure with elevated rights inside it, so
    // they cannot be catalogue-wide by default.
    const { product, env } = await offering()
    const result = await resolveTrial(product.id, env.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/not available as a trial/i)
  })

  it('returns the configured duration for an opted-in offering', async () => {
    const { product, env } = await offering({ trialEnabled: true, trialDurationMinutes: 45 })
    const result = await resolveTrial(product.id, env.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.trialDurationMinutes).toBe(45)
  })

  it('defaults to the 30 minutes the issue names', async () => {
    const { product, env } = await offering({ trialEnabled: true })
    const result = await resolveTrial(product.id, env.id)
    expect(result.ok && result.data.trialDurationMinutes).toBe(30)
  })

  it('rejects a non-positive duration', async () => {
    // The teardown would be scheduled at or before provisioning, so the trial
    // would be swept away before it came up.
    const { product, env } = await offering({ trialEnabled: true })
    await db
      .update(productEnvironments)
      .set({ trialDurationMinutes: 0 })
      .where(and(eq(productEnvironments.productId, product.id), eq(productEnvironments.environmentId, env.id)))

    const result = await resolveTrial(product.id, env.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/not usable/i)
  })
})

describe('trialVariables', () => {
  it('marks the run as a trial and passes the duration through', () => {
    // The portal cannot grant rights inside somebody else's Terraform, so it
    // passes the intent and the product's pipeline decides.
    expect(trialVariables(30)).toEqual({ [TRIAL_VAR]: 'true', [TRIAL_DURATION_VAR]: '30' })
  })

  it('stringifies the duration — CI variables are strings', () => {
    expect(trialVariables(45)[TRIAL_DURATION_VAR]).toBe('45')
  })
})

describe('trialExpiry', () => {
  it('adds the duration in minutes to the given instant', () => {
    const from = new Date('2026-06-01T12:00:00.000Z')
    expect(trialExpiry(30, from).toISOString()).toBe('2026-06-01T12:30:00.000Z')
    expect(trialExpiry(90, from).toISOString()).toBe('2026-06-01T13:30:00.000Z')
  })

  it('defaults to counting from now', () => {
    const before = Date.now()
    const expiry = trialExpiry(30).getTime()
    expect(expiry).toBeGreaterThanOrEqual(before + 30 * 60_000)
    expect(expiry).toBeLessThanOrEqual(Date.now() + 30 * 60_000)
  })
})
