import { db } from '@/lib/db/client'
import {
  orders,
  products,
  productTranslations,
  productEnvironments,
  productEnvironmentSizes,
  deploymentEnvironments,
  costCenters,
} from '@/lib/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { loadApplicableParameters, resolveParameterDefs } from '@/lib/services/catalog'
import type { logAuditWith } from '@/lib/audit'

/** `db`, or the handle a `db.transaction` callback receives. */
type Executor = Parameters<typeof logAuditWith>[0]

/**
 * Point-in-time capture of what a customer was actually offered (issue #38).
 *
 * Orders and infrastructure reference a product by id, so a later price change or
 * a removed parameter silently rewrites history: the order detail page would show
 * today's configuration as though it were the one that was approved. The snapshot
 * is what makes an order's own record of itself durable.
 *
 * Deliberately a denormalised JSON blob rather than a set of versioned rows. The
 * point is that it can never be changed by anything that happens to the catalogue
 * afterwards, and a foreign key into versioned tables would reintroduce exactly
 * that coupling. Migrating the shape is the price; it is the right one.
 */
export interface ParameterSnapshot {
  name: string
  label: string
  type: string
  description: string
  defaultValue: string
  required: boolean
  sensitive: boolean
}

export interface ProductSnapshot {
  /** Schema marker, so a reader can tell an old snapshot from a new one. */
  version: 1
  capturedAt: string
  productName: string
  productDescription: string
  environmentName: string
  /**
   * The UNIT price that applied — the chosen size's, or the offering's when the
   * order named no size (issue #98).
   *
   * Kept as `price`, the field it has always been, precisely so that every
   * existing reader (the cost report, the order detail page, the CSV/PDF export)
   * becomes correct by reading what it already read. The line total is this times
   * the order's quantity, which lives on the order row rather than here: quantity
   * is a fact about the order, not about what the catalogue offered.
   */
  price: string
  currency: string
  /**
   * The size that was ordered (issue #98), and its label as it read at the time.
   *
   * Both optional and both null-able, and the two absences mean different things:
   * ABSENT means the snapshot predates sizing, NULL means the offering had no
   * sizes when the order was placed. Recorded as text rather than an id because an
   * admin may retire or re-price a size, and this record has to survive that — it
   * is the whole reason the snapshot exists.
   */
  sizeCode?: string | null
  sizeLabel?: string | null
  costCenterMode: string
  forcedCostCenter: boolean
  /**
   * The overhead account this offering bills to, as a durable label (issue #22).
   *
   * Optional because snapshots taken before it was recorded do not carry it; a
   * reader must treat absent as "unknown", not as "none". Stored as a label rather
   * than an id for the same reason every other field here is denormalised — the id
   * could be reassigned or deleted out from under the record.
   */
  overheadCostCenter?: string | null
  trialEnabled: boolean
  trialDurationMinutes: number
  parameters: ParameterSnapshot[]
  /**
   * Present and true when this snapshot was written by `backfillOrderSnapshots`
   * long after the order, from the offering as it stood at withdrawal (issue #189).
   *
   * It exists so the cost report can go on calling the order ESTIMATED. Everything
   * else here is a point-in-time record of what the customer was offered; this one
   * is a record of what the catalogue said years later, which happens to be the
   * same figure the report was already showing for the order — the difference is
   * that now it survives the offering being deleted. Absent on every snapshot taken
   * at order time, which is the only other way one gets written.
   */
  backfilled?: boolean
}

/** Stand-in for a sensitive parameter's default value. */
export const REDACTED_DEFAULT = '[redacted]'

/**
 * Capture the product/environment offering as it stands right now.
 *
 * Returns null when the product is not offered in that environment — the caller
 * decides whether that is an error. Order creation has already validated the
 * offering by the time it snapshots, so for it a null means something raced.
 */
export const captureProductSnapshot = async (
  productId: number,
  categoryId: number,
  environmentId: number,
  /**
   * The size the order chose, if any.
   *
   * Three states, not two, matching the ABSENT/NULL distinction the snapshot
   * documents: omitting the argument leaves `sizeCode`/`sizeLabel` out of the
   * snapshot altogether, which is what the admin version-history paths want —
   * they snapshot an OFFERING, not an order, and have no answer to give. Passing
   * null records "this order named no size", which order creation does whenever
   * the offering has none.
   */
  sizeCode?: string | null,
  /**
   * Pass a transaction when the capture has to see — and stand or fall with —
   * writes that transaction has not committed yet. `backfillOrderSnapshots` reads
   * offerings it is about to delete; on the pool it would read them through a
   * different connection and could race its own deletion.
   */
  executor: Executor = db,
): Promise<ProductSnapshot | null> => {
  const [offering] = await executor
    .select({
      price: productEnvironments.price,
      currency: productEnvironments.currency,
      costCenterMode: productEnvironments.costCenterMode,
      forcedCostCenter: productEnvironments.forcedCostCenter,
      overheadCostCenterCode: costCenters.code,
      overheadCostCenterName: costCenters.name,
      trialEnabled: productEnvironments.trialEnabled,
      trialDurationMinutes: productEnvironments.trialDurationMinutes,
      environmentName: deploymentEnvironments.name,
    })
    .from(productEnvironments)
    .leftJoin(deploymentEnvironments, eq(productEnvironments.environmentId, deploymentEnvironments.id))
    .leftJoin(costCenters, eq(productEnvironments.overheadCostCenterId, costCenters.id))
    .where(
      and(
        eq(productEnvironments.productId, productId),
        eq(productEnvironments.environmentId, environmentId),
      ),
    )
    .limit(1)

  if (!offering) return null

  // The size's price, not the offering's, whenever the order named one. Read here
  // rather than passed in so the snapshot records what the DATABASE said at
  // capture time — the one thing this record is for. A code that no longer
  // resolves (retired between validation and capture) falls back to the offering's
  // price rather than losing the snapshot altogether.
  const size = sizeCode
    ? (
        await executor
          .select({
            label: productEnvironmentSizes.label,
            price: productEnvironmentSizes.price,
            currency: productEnvironmentSizes.currency,
          })
          .from(productEnvironmentSizes)
          .where(
            and(
              eq(productEnvironmentSizes.productId, productId),
              eq(productEnvironmentSizes.environmentId, environmentId),
              eq(productEnvironmentSizes.code, sizeCode),
            ),
          )
          .limit(1)
      )[0]
    : undefined

  const [translation] = await executor
    .select({ name: productTranslations.name, description: productTranslations.description })
    .from(productTranslations)
    .where(
      and(
        eq(productTranslations.productId, productId),
        eq(productTranslations.languageCode, 'en'),
      ),
    )
    .limit(1)

  // The same resolution the order form rendered and the order service validated
  // against, so the snapshot records the definitions that actually applied rather
  // than every row that happened to match.
  const defs = resolveParameterDefs(
    await loadApplicableParameters(productId, categoryId, environmentId, executor),
  )

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    productName: translation?.name ?? `Product #${productId}`,
    productDescription: translation?.description ?? '',
    environmentName: offering.environmentName ?? `Environment #${environmentId}`,
    price: size?.price ?? offering.price,
    currency: size?.currency ?? offering.currency,
    // Spread, so an omitted argument leaves both fields absent rather than
    // writing null. Null here means "the order named no size", and a snapshot
    // that predates sizing means "nobody asked" — writing null unconditionally
    // made every version-history snapshot claim the first of those.
    ...(sizeCode !== undefined ? { sizeCode, sizeLabel: size?.label ?? null } : {}),
    costCenterMode: offering.costCenterMode,
    forcedCostCenter: offering.forcedCostCenter,
    // Null, not omitted: "no overhead account is configured" is a fact worth
    // recording, and it is what distinguishes this from an older snapshot that
    // simply never captured the field.
    overheadCostCenter:
      offering.overheadCostCenterCode === null
        ? null
        : `${offering.overheadCostCenterCode} — ${offering.overheadCostCenterName}`,
    trialEnabled: offering.trialEnabled,
    trialDurationMinutes: offering.trialDurationMinutes,
    parameters: defs
      .map((def) => ({
        name: def.name,
        label: def.label,
        type: def.type,
        description: def.description,
        // A sensitive parameter's default can be a placeholder secret, and the
        // snapshot is rendered on a page the ORDERER sees. The definition is worth
        // recording; its default is not worth leaking.
        defaultValue: def.sensitive ? REDACTED_DEFAULT : def.defaultValue,
        required: def.required,
        sensitive: def.sensitive,
      }))
      // Stable order so two snapshots of the same configuration diff as identical.
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/**
 * Give every snapshot-less order of these products a snapshot, before the
 * offering it would otherwise be priced from is deleted (issue #189).
 *
 * ## What went wrong without it
 *
 * Retiring a product deletes its `product_environments` rows, because that is what
 * actually makes it unorderable. An order placed before migration 0013 has no
 * snapshot, so the cost report prices it through a leftJoin to exactly those rows;
 * with the row gone the join yields nothing, the price is NULL, and `Number(null ??
 * '0')` makes the order contribute **zero**. A product with thirty pre-snapshot
 * orders at €80 lost €2,400 of recorded spend the moment an admin retired it — the
 * orders stayed in `orderCount`, so the total simply came out lower, and nothing
 * flagged it: `unconverted[]` catches a missing RATE, not a missing price.
 *
 * ## Why backfill, and not the other two options
 *
 * Marking the offering withdrawn instead of deleting it is the tidier data model
 * and was rejected on blast radius: "there is a `product_environments` row" is what
 * a dozen reads spread over the cart, order creation, sizing, trials and the
 * catalogue currently take to mean "orderable", and a withdrawn flag missed at any
 * one of them re-opens a retired product for ordering. That is a worse failure than
 * the one being fixed.
 *
 * Counting a NULL fallback as *unpriced* rather than zero is worth doing on its own
 * merits, but it only makes the loss visible — the €2,400 is still gone from the
 * total, and the report already knew the number a moment earlier.
 *
 * Backfilling keeps the money, and it keeps the SAME money: the snapshot records
 * the price the report was already using for that order, taken from the live
 * offering, one moment before that offering disappears. It is deliberately not a
 * claim to be exact — `backfilled: true` is why the report goes on counting these
 * orders as estimated.
 *
 * Runs on the caller's executor and must be called inside the same transaction as
 * the delete, so a rollback takes the snapshots with it.
 *
 * Returns how many orders were given one.
 */
export const backfillOrderSnapshots = async (
  executor: Executor,
  productIds: number[],
  /** Narrow to one offering, for a withdrawal that removes only that pairing. */
  environmentId?: number,
): Promise<number> => {
  if (productIds.length === 0) return 0

  // Grouped, not one row per order: a product with 200 orders has a handful of
  // distinct (environment, size) pairings between them, and each pairing needs
  // exactly one capture — which is several queries and a parameter resolution.
  const pending = await executor
    .select({
      productId: orders.productId,
      categoryId: products.categoryId,
      environmentId: orders.environmentId,
      sizeCode: orders.sizeCode,
    })
    .from(orders)
    .innerJoin(products, eq(orders.productId, products.id))
    .where(
      and(
        inArray(orders.productId, productIds),
        isNull(orders.productSnapshot),
        environmentId === undefined ? undefined : eq(orders.environmentId, environmentId),
      ),
    )
    .groupBy(orders.productId, products.categoryId, orders.environmentId, orders.sizeCode)

  let written = 0
  for (const line of pending) {
    const snapshot = await captureProductSnapshot(
      line.productId,
      line.categoryId,
      line.environmentId,
      // Null, not undefined: these are ORDERS, and null is how the snapshot spells
      // "this order named no size" as against "this record predates sizing".
      line.sizeCode,
      executor,
    )
    // Null means the offering is already gone — a pairing withdrawn earlier, whose
    // orders this cannot rescue. Skipped rather than written as a stub: a snapshot
    // with a made-up price would turn a visible zero into an invisible wrong number.
    if (!snapshot) continue

    const updated = await executor
      .update(orders)
      .set({ productSnapshot: { ...snapshot, backfilled: true } })
      .where(
        and(
          eq(orders.productId, line.productId),
          eq(orders.environmentId, line.environmentId),
          line.sizeCode === null ? isNull(orders.sizeCode) : eq(orders.sizeCode, line.sizeCode),
          isNull(orders.productSnapshot),
        ),
      )
      .returning({ id: orders.id })
    written += updated.length
  }

  return written
}
