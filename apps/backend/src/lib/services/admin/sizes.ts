import { db } from '@/lib/db/client'
import { productEnvironments, productEnvironmentSizes } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'
import { recordProductVersion } from '@/lib/services/versions'
import { listAllSizes, SIZE_CODE_MAX_LENGTH, type OfferingSize } from '@/lib/services/sizes'

/**
 * Admin CRUD for the sizes of one offering (issue #98).
 *
 * Scoped to a (product, environment) pair rather than to the product: the same
 * product legitimately comes in different sizes at different prices per
 * environment — "XL in Linode" and "XL in AWS" are two prices, and half the point
 * of the feature is being able to say so.
 *
 * Every mutation records a product version entry (issue #38), because a size's
 * price IS what a customer is offered and a change to it is exactly the kind of
 * change the history exists to explain.
 */

export interface UpsertSizeInput {
  code: string
  label?: string
  price?: string
  currency?: string
  sortOrder?: number
  active?: boolean
  changelog?: string
  userId?: number | null
}

/** A price is money: a fixed-point decimal, and never negative. */
const PRICE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/

/**
 * The code reaches CI as the SIZE variable and is stored on order lines, so it is
 * restricted to what is safe to pass through a shell and stable to compare:
 * letters, digits, dash, underscore and dot.
 */
const CODE_PATTERN = new RegExp(`^[A-Za-z0-9._-]{1,${SIZE_CODE_MAX_LENGTH}}$`)

const assertOfferingExists = async (
  productId: number,
  environmentId: number,
): Promise<Result<void>> => {
  const [offering] = await db
    .select({ productId: productEnvironments.productId })
    .from(productEnvironments)
    .where(
      and(
        eq(productEnvironments.productId, productId),
        eq(productEnvironments.environmentId, environmentId),
      ),
    )
    .limit(1)

  // 404 rather than creating the offering implicitly: a size for a product that is
  // not offered in that environment would never be reachable from the catalogue.
  if (!offering) return err(404, 'The product is not offered in that environment')
  return ok(undefined)
}

/** Every size of an offering, retired ones included — this is the admin view. */
export const listSizes = async (
  productId: number,
  environmentId: number,
): Promise<Result<OfferingSize[]>> => {
  const exists = await assertOfferingExists(productId, environmentId)
  if (!exists.ok) return exists
  return ok(await listAllSizes(productId, environmentId))
}

/**
 * Create a size, or update the one with that code.
 *
 * Upsert on the code rather than on the id, mirroring `createProductEnvironment`:
 * the code is the natural key an admin thinks in, and re-POSTing 'XL' should
 * correct 'XL' rather than fail on a constraint or create a second one.
 */
export const upsertSize = async (
  productId: number,
  environmentId: number,
  input: UpsertSizeInput,
): Promise<Result<OfferingSize>> => {
  const exists = await assertOfferingExists(productId, environmentId)
  if (!exists.ok) return exists

  const code = input.code.trim()
  if (!CODE_PATTERN.test(code)) {
    return err(400, 'A size code may only contain letters, digits, dot, dash and underscore')
  }

  const price = (input.price ?? '0').trim()
  if (!PRICE_PATTERN.test(price)) {
    return err(400, 'The price must be a non-negative amount with at most two decimals')
  }

  const currency = (input.currency ?? 'EUR').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    return err(400, 'The currency must be a three-letter code')
  }

  const values = {
    label: (input.label ?? '').trim(),
    price,
    currency,
    sortOrder: input.sortOrder ?? 0,
    active: input.active ?? true,
  }

  const [existing] = await db
    .select({ id: productEnvironmentSizes.id, price: productEnvironmentSizes.price })
    .from(productEnvironmentSizes)
    .where(
      and(
        eq(productEnvironmentSizes.productId, productId),
        eq(productEnvironmentSizes.environmentId, environmentId),
        eq(productEnvironmentSizes.code, code),
      ),
    )
    .limit(1)

  const [row] = await db
    .insert(productEnvironmentSizes)
    .values({ productId, environmentId, code, ...values })
    .onConflictDoUpdate({
      target: [
        productEnvironmentSizes.productId,
        productEnvironmentSizes.environmentId,
        productEnvironmentSizes.code,
      ],
      set: values,
    })
    .returning()

  await recordProductVersion({
    productId,
    environmentId,
    // Says what changed, not just that something did — a price move is the one
    // change a reader of the history is looking for.
    summary: existing
      ? existing.price === price
        ? `Size ${code} updated`
        : `Size ${code} re-priced ${existing.price} → ${price} ${currency}`
      : `Size ${code} added at ${price} ${currency}`,
    changelog: input.changelog,
    userId: input.userId ?? null,
  })

  return ok({
    id: row.id,
    code: row.code,
    label: row.label,
    price: row.price,
    currency: row.currency,
    sortOrder: row.sortOrder,
    active: row.active,
  })
}

/**
 * Remove a size outright.
 *
 * Existing ORDERS are unaffected: they store the code as text and the price they
 * were charged in their snapshot, which is the whole reason the size is not a
 * foreign key from the order. A CART line naming the deleted size is left exactly
 * as it is, and reports itself unavailable — `listCart` checks the size is still
 * active, so the shopper is told on the line rather than by a checkout error they
 * cannot act on. Retiring (`active: false`) is the gentler option and is what the
 * admin UI leads with.
 */
export const deleteSize = async (
  productId: number,
  environmentId: number,
  sizeId: number,
): Promise<Result<void>> => {
  const [deleted] = await db
    .delete(productEnvironmentSizes)
    .where(
      and(
        eq(productEnvironmentSizes.id, sizeId),
        eq(productEnvironmentSizes.productId, productId),
        eq(productEnvironmentSizes.environmentId, environmentId),
      ),
    )
    .returning({ code: productEnvironmentSizes.code })

  if (!deleted) return err(404, 'Size not found')

  await recordProductVersion({
    productId,
    environmentId,
    summary: `Size ${deleted.code} removed`,
    userId: null,
  })

  return ok(undefined)
}
