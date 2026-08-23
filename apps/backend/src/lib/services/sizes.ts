import { db } from '@/lib/db/client'
import { productEnvironments, productEnvironmentSizes } from '@/lib/db/schema'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'

/**
 * Sizing and quantity (issues #98 / #104).
 *
 * ── Where the price lives ─────────────────────────────────────────────────────
 * On the SIZE, once an offering has sizes: that is what the customer picks and
 * what they pay for. `product_environments.price` is not dropped, because an
 * offering with no sizes still has to cost something and every row that existed
 * before sizes did is exactly that offering. So there is one rule, applied
 * everywhere:
 *
 *   the chosen size's price, or the offering's price when the line has no size.
 *
 * A line has no size in exactly two cases — the offering defines none, or the line
 * predates sizes altogether — and both mean the same thing, which is why a
 * nullable `size_code` was preferred over synthesising a "default" size row per
 * offering. See migration 0020 for the rejected alternative.
 *
 * ── Bounds ────────────────────────────────────────────────────────────────────
 * Quantity fans out into that many pipeline runs, so it is capped. An unbounded
 * quantity is an unbounded pipeline trigger, which is the same hazard
 * MAX_CART_ITEMS exists to contain.
 */

/** Most elements one order line may ask for. "20 VMs" (issue #104) must fit. */
export const MAX_ORDER_QUANTITY = 20

/** The effective unit price of a line, resolved against its size. */
export interface OfferingPrice {
  /** The code that was chosen, or null when the offering has no sizes. */
  sizeCode: string | null
  /** Human-readable label of the size, or null when there is none. */
  sizeLabel: string | null
  price: string
  currency: string
}

/** One size as offered, for the catalogue and the admin list. */
export interface OfferingSize {
  id: number
  code: string
  label: string
  price: string
  currency: string
  sortOrder: number
  active: boolean
}

const sizeColumns = {
  id: productEnvironmentSizes.id,
  code: productEnvironmentSizes.code,
  label: productEnvironmentSizes.label,
  price: productEnvironmentSizes.price,
  currency: productEnvironmentSizes.currency,
  sortOrder: productEnvironmentSizes.sortOrder,
  active: productEnvironmentSizes.active,
} as const

/** The active sizes of one offering, in the order an admin arranged them. */
export const listActiveSizes = async (
  productId: number,
  environmentId: number,
): Promise<OfferingSize[]> =>
  db
    .select(sizeColumns)
    .from(productEnvironmentSizes)
    .where(
      and(
        eq(productEnvironmentSizes.productId, productId),
        eq(productEnvironmentSizes.environmentId, environmentId),
        eq(productEnvironmentSizes.active, true),
      ),
    )
    .orderBy(productEnvironmentSizes.sortOrder, productEnvironmentSizes.code)

/** Every size of one offering, retired ones included — the admin list. */
export const listAllSizes = async (
  productId: number,
  environmentId: number,
): Promise<OfferingSize[]> =>
  db
    .select(sizeColumns)
    .from(productEnvironmentSizes)
    .where(
      and(
        eq(productEnvironmentSizes.productId, productId),
        eq(productEnvironmentSizes.environmentId, environmentId),
      ),
    )
    .orderBy(productEnvironmentSizes.sortOrder, productEnvironmentSizes.code)

/**
 * The active sizes of every offering of one product, keyed by environment id.
 *
 * For the catalogue detail page, which needs the sizes of each environment the
 * product is offered in and must not run a query per environment.
 */
export const listActiveSizesForProduct = async (
  productId: number,
): Promise<Map<number, OfferingSize[]>> => {
  const rows = await db
    .select({ environmentId: productEnvironmentSizes.environmentId, ...sizeColumns })
    .from(productEnvironmentSizes)
    .where(
      and(
        eq(productEnvironmentSizes.productId, productId),
        eq(productEnvironmentSizes.active, true),
      ),
    )
    .orderBy(productEnvironmentSizes.sortOrder, productEnvironmentSizes.code)

  const byEnvironment = new Map<number, OfferingSize[]>()
  for (const { environmentId, ...size } of rows) {
    const group = byEnvironment.get(environmentId)
    if (group) group.push(size)
    else byEnvironment.set(environmentId, [size])
  }
  return byEnvironment
}

/**
 * Decide what one line costs per unit, and validate the size it names.
 *
 * Four outcomes, each of them a rule the browser cannot be trusted to enforce
 * because the size picker is simply absent for an offering that has none:
 *
 *  - the offering has sizes and the line names an active one → that size's price
 *  - the offering has sizes and the line names none → 400. There is no honest
 *    price to charge: the offering's own is whatever it happened to be before
 *    sizes were introduced, and charging that for an unspecified size is a guess.
 *  - the offering has sizes and the line names an unknown or retired one → 400
 *  - the offering has NO sizes → the offering's price, with a null size code
 *
 * 400 rather than 404 throughout: the offering exists, it is the request about it
 * that does not make sense.
 */
export const resolveOfferingPrice = async (
  productId: number,
  environmentId: number,
  sizeCode: string | null | undefined,
): Promise<Result<OfferingPrice>> => {
  const sizes = await listActiveSizes(productId, environmentId)
  const wanted = sizeCode?.trim() ?? ''

  if (sizes.length === 0) {
    // A size named against an offering that has none is a stale form or a
    // hand-written request. Saying so beats silently ignoring it and charging the
    // offering's price for a size the customer believes they chose.
    if (wanted !== '') return err(400, 'This offering has no sizes')

    const [offering] = await db
      .select({ price: productEnvironments.price, currency: productEnvironments.currency })
      .from(productEnvironments)
      .where(
        and(
          eq(productEnvironments.productId, productId),
          eq(productEnvironments.environmentId, environmentId),
        ),
      )
      .limit(1)
    if (!offering) return err(400, 'Product is not offered in the selected environment')

    return ok({ sizeCode: null, sizeLabel: null, price: offering.price, currency: offering.currency })
  }

  if (wanted === '') return err(400, 'A size must be chosen for this offering')

  const size = sizes.find((s) => s.code === wanted)
  if (!size) return err(400, `Size ${wanted} is not available in the selected environment`)

  return ok({
    sizeCode: size.code,
    sizeLabel: size.label,
    price: size.price,
    currency: size.currency,
  })
}

/** Reject a quantity that is not a whole number of elements within the cap. */
export const validateQuantity = (quantity: number | undefined | null): Result<number> => {
  if (quantity === undefined || quantity === null) return ok(1)
  if (!Number.isInteger(quantity) || quantity < 1) {
    return err(400, 'The quantity must be a whole number of at least 1')
  }
  if (quantity > MAX_ORDER_QUANTITY) {
    return err(400, `At most ${MAX_ORDER_QUANTITY} can be ordered on one line`)
  }
  return ok(quantity)
}

/**
 * SQL for the unit price of a line, as a correlated lookup of its size.
 *
 * Written once and shared by the cart, the cost report and the cost export,
 * because three copies of "which price applies" are three chances to drift — and
 * the one that drifts is the one on the invoice. Requires `product_environments`
 * to be in the caller's FROM/JOIN chain, since that is the fallback. NULL when
 * neither a matching size nor an offering row exists, which callers report as "no
 * longer offered" rather than as free.
 */
export const linePriceSql = (
  productId: SQL | unknown,
  environmentId: SQL | unknown,
  sizeCode: SQL | unknown,
): SQL<string | null> => sql<string | null>`COALESCE(
  (SELECT s.price FROM product_environment_sizes s
    WHERE s.product_id = ${productId}
      AND s.environment_id = ${environmentId}
      AND s.code = ${sizeCode}
    LIMIT 1),
  ${productEnvironments.price}
)`

/** Currency of the same line, resolved the same way. */
export const lineCurrencySql = (
  productId: SQL | unknown,
  environmentId: SQL | unknown,
  sizeCode: SQL | unknown,
): SQL<string | null> => sql<string | null>`COALESCE(
  (SELECT s.currency FROM product_environment_sizes s
    WHERE s.product_id = ${productId}
      AND s.environment_id = ${environmentId}
      AND s.code = ${sizeCode}
    LIMIT 1),
  ${productEnvironments.currency}
)`

/**
 * The label of the size a line names, for display. NULL for a line without one,
 * and for one whose size has since been deleted outright.
 */
export const lineSizeLabelSql = (
  productId: SQL | unknown,
  environmentId: SQL | unknown,
  sizeCode: SQL | unknown,
): SQL<string | null> => sql<string | null>`(
  SELECT s.label FROM product_environment_sizes s
    WHERE s.product_id = ${productId}
      AND s.environment_id = ${environmentId}
      AND s.code = ${sizeCode}
    LIMIT 1
)`

/**
 * Whether the size a line names is still orderable. A line with no size counts as
 * fine — the offering has none — while a named one must still exist and be active,
 * so a cart holding a retired size can say so instead of failing at checkout.
 */
export const lineSizeStillOfferedSql = (
  productId: SQL | unknown,
  environmentId: SQL | unknown,
  sizeCode: SQL | unknown,
): SQL<boolean> => sql<boolean>`(
  ${sizeCode} IS NULL
  OR EXISTS (
    SELECT 1 FROM product_environment_sizes s
      WHERE s.product_id = ${productId}
        AND s.environment_id = ${environmentId}
        AND s.code = ${sizeCode}
        AND s.active = TRUE
  )
)`
