import { db } from '@/lib/db/client'
import { deploymentEnvironments, productEnvironments, productEnvironmentSizes, products } from '@/lib/db/schema'
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
    .select({
      id: productEnvironmentSizes.id,
      price: productEnvironmentSizes.price,
      currency: productEnvironmentSizes.currency,
    })
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
    // Compared against the PERSISTED value, not the request's. The column is
    // NUMERIC(12,2), so '10' comes back '10.00' — comparing the raw input would
    // report a re-price on every save that merely spelled the same amount
    // differently, in the one record whose worth is that its entries are true.
    summary: existing
      ? existing.price === row.price && existing.currency === row.currency
        ? `Size ${code} updated`
        : `Size ${code} re-priced ${existing.price} ${existing.currency} → ${row.price} ${row.currency}`
      : `Size ${code} added at ${row.price} ${row.currency}`,
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

/**
 * ── The matrix view (issue #249) ──────────────────────────────────────────────
 *
 * Everything above is scoped to one (product, environment) pair, which is how the
 * rows are stored and is not how anyone reasons about them. "What does XL cost?"
 * is a question about a size across environments, and answering it through the
 * per-offering endpoints means one request per environment and a comparison done
 * in the reader's head.
 *
 * So the same rows are also offered transposed: sizes down, environments across.
 * The row axis is the UNION of the codes in the product's offerings, because a
 * code is unique per offering and not global — 'XL' existing in one environment
 * says nothing about the others, and a hole in the grid is a legitimate state,
 * not a missing row.
 */

/** What one size costs in one environment. Absent from a row means not offered there. */
export interface SizeMatrixCell {
  environmentId: number
  id: number
  price: string
  currency: string
  /** Retired cells stay in the payload: the price is still what past orders were struck at. */
  active: boolean
}

/**
 * One size, across every environment.
 *
 * `label` and `sortOrder` are per (product, environment) in the table but are the
 * same property of the same size in every one of them, so the matrix treats them
 * as belonging to the row and writes them to every cell it touches. Price and
 * currency stay per cell — differing per environment is the point of the feature.
 */
export interface SizeMatrixRow {
  code: string
  label: string
  sortOrder: number
  cells: SizeMatrixCell[]
}

export interface SizeMatrixEnvironment {
  environmentId: number
  name: string
  /** The offering's own price, the fallback for a size cell that has no currency yet. */
  currency: string
}

export interface SizeMatrix {
  /** Only the environments the product is actually offered in — the matrix's columns. */
  environments: SizeMatrixEnvironment[]
  rows: SizeMatrixRow[]
}

/** One cell as a caller asks for it. Omitting an environment retires the size there. */
export interface SizeMatrixCellInput {
  environmentId: number
  price?: string
  currency?: string
}

export interface SaveSizeRowInput {
  label?: string
  sortOrder?: number
  /** The environments the size IS offered in, with what it costs in each. */
  cells: SizeMatrixCellInput[]
  changelog?: string
  userId?: number | null
}

const assertProductExists = async (productId: number): Promise<Result<void>> => {
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)
  if (!product) return err(404, 'Product not found')
  return ok(undefined)
}

/** The product's offerings, in the column order the matrix renders them in. */
const listColumns = async (productId: number): Promise<SizeMatrixEnvironment[]> =>
  db
    .select({
      environmentId: productEnvironments.environmentId,
      name: deploymentEnvironments.name,
      currency: productEnvironments.currency,
    })
    .from(productEnvironments)
    .innerJoin(deploymentEnvironments, eq(deploymentEnvironments.id, productEnvironments.environmentId))
    .where(eq(productEnvironments.productId, productId))
    // Named explicitly because the columns are read left to right by a human: with
    // no ORDER BY the grid's columns would be in whatever order the plan produced
    // and could reorder themselves between two loads of the same page.
    .orderBy(deploymentEnvironments.name, productEnvironments.environmentId)

/**
 * Every size of a product, transposed into rows of environments.
 *
 * One query for the columns and one for the cells, rather than one per
 * environment: the grid is the whole point and a per-column fetch would make the
 * page slower the more environments a product is offered in.
 */
export const getSizeMatrix = async (productId: number): Promise<Result<SizeMatrix>> => {
  const exists = await assertProductExists(productId)
  if (!exists.ok) return exists

  const environments = await listColumns(productId)

  const cells = await db
    .select({
      environmentId: productEnvironmentSizes.environmentId,
      id: productEnvironmentSizes.id,
      code: productEnvironmentSizes.code,
      label: productEnvironmentSizes.label,
      price: productEnvironmentSizes.price,
      currency: productEnvironmentSizes.currency,
      sortOrder: productEnvironmentSizes.sortOrder,
      active: productEnvironmentSizes.active,
    })
    .from(productEnvironmentSizes)
    .where(eq(productEnvironmentSizes.productId, productId))
    .orderBy(
      productEnvironmentSizes.sortOrder,
      productEnvironmentSizes.code,
      productEnvironmentSizes.environmentId,
    )

  const rows = new Map<string, SizeMatrixRow>()
  for (const cell of cells) {
    const row = rows.get(cell.code)
    if (!row) {
      rows.set(cell.code, {
        code: cell.code,
        label: cell.label,
        sortOrder: cell.sortOrder,
        cells: [{ environmentId: cell.environmentId, id: cell.id, price: cell.price, currency: cell.currency, active: cell.active }],
      })
      continue
    }
    // The row's label is whichever cell has one. The column is per offering, so a
    // size added in a second environment without one would otherwise blank the
    // label the admin already wrote — and a blank row header reads as a bug.
    if (row.label === '') row.label = cell.label
    row.cells.push({ environmentId: cell.environmentId, id: cell.id, price: cell.price, currency: cell.currency, active: cell.active })
  }

  // Insertion order already follows the query's ORDER BY, so the rows come out
  // sorted by the sortOrder of their first cell; nothing further to sort.
  return ok({ environments, rows: [...rows.values()] })
}

/** How one environment's cell changed, phrased for the product history. */
const cellSummary = (
  code: string,
  before: { price: string; currency: string; active: boolean; label: string; sortOrder: number } | undefined,
  after: { price: string; currency: string; active: boolean; label: string; sortOrder: number },
): string | null => {
  if (!before) {
    // A row that arrives already retired is a cell that was never offered here and
    // still is not, so there is nothing for the history to report.
    return after.active ? `Size ${code} added at ${after.price} ${after.currency}` : null
  }
  if (before.active && !after.active) return `Size ${code} retired`
  if (!before.active && after.active) return `Size ${code} restored at ${after.price} ${after.currency}`
  // Compared against the PERSISTED values on both sides: NUMERIC(12,2) turns '10'
  // into '10.00', so comparing the request's spelling would report a re-price on
  // every save that merely typed the same amount differently.
  if (before.price !== after.price || before.currency !== after.currency) {
    return `Size ${code} re-priced ${before.price} ${before.currency} → ${after.price} ${after.currency}`
  }
  if (before.label !== after.label || before.sortOrder !== after.sortOrder) return `Size ${code} updated`
  return null
}

/**
 * Write one size across every environment of a product, in one transaction.
 *
 * The unit of editing is the ROW, not the cell: pricing S in four environments is
 * one intent and one save. Cell by cell it is four requests, and a failure on the
 * third leaves a product priced in two environments and not the other two — half
 * of a price list is worse than none, because it looks complete.
 *
 * `cells` is the full desired state of the row, so an environment the caller
 * leaves out is one the size is no longer offered in. That RETIRES it (active
 * false) and never deletes it: an order that already names the code has to keep
 * resolving to something, and the price it was struck at lives on this row.
 * A cell that is left out and does not exist is not created — an offering that
 * never had the size should not gain a retired one just for being in the grid.
 */
export const saveSizeRow = async (
  productId: number,
  rawCode: string,
  input: SaveSizeRowInput,
): Promise<Result<SizeMatrixRow>> => {
  const exists = await assertProductExists(productId)
  if (!exists.ok) return exists

  const code = rawCode.trim()
  if (!CODE_PATTERN.test(code)) {
    return err(400, 'A size code may only contain letters, digits, dot, dash and underscore')
  }

  const offered = new Set((await listColumns(productId)).map((e) => e.environmentId))

  const wanted = new Map<number, { price: string; currency: string }>()
  for (const cell of input.cells) {
    if (!offered.has(cell.environmentId)) {
      return err(404, 'The product is not offered in that environment')
    }
    // Two cells for one environment is a caller that has lost track of its own
    // grid; picking one of them silently would write a price nobody chose.
    if (wanted.has(cell.environmentId)) {
      return err(400, 'The same environment was priced twice')
    }

    const price = (cell.price ?? '0').trim()
    if (!PRICE_PATTERN.test(price)) {
      return err(400, 'The price must be a non-negative amount with at most two decimals')
    }
    const currency = (cell.currency ?? 'EUR').trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) return err(400, 'The currency must be a three-letter code')

    wanted.set(cell.environmentId, { price, currency })
  }

  const label = (input.label ?? '').trim()
  const sortOrder = input.sortOrder ?? 0

  const changes = await db.transaction(async (tx) => {
    const before = new Map(
      (
        await tx
          .select({
            environmentId: productEnvironmentSizes.environmentId,
            price: productEnvironmentSizes.price,
            currency: productEnvironmentSizes.currency,
            active: productEnvironmentSizes.active,
            label: productEnvironmentSizes.label,
            sortOrder: productEnvironmentSizes.sortOrder,
          })
          .from(productEnvironmentSizes)
          .where(
            and(
              eq(productEnvironmentSizes.productId, productId),
              eq(productEnvironmentSizes.code, code),
            ),
          )
      ).map((r) => [r.environmentId, r]),
    )

    const written: { environmentId: number; summary: string }[] = []

    for (const [environmentId, { price, currency }] of wanted) {
      const [row] = await tx
        .insert(productEnvironmentSizes)
        .values({ productId, environmentId, code, label, price, currency, sortOrder, active: true })
        .onConflictDoUpdate({
          target: [
            productEnvironmentSizes.productId,
            productEnvironmentSizes.environmentId,
            productEnvironmentSizes.code,
          ],
          set: { label, price, currency, sortOrder, active: true },
        })
        .returning()
      const summary = cellSummary(code, before.get(environmentId), row)
      if (summary) written.push({ environmentId, summary })
    }

    // Only the cells that already exist: an environment the size was never offered
    // in stays that way rather than gaining a retired row nobody asked for.
    for (const [environmentId, previous] of before) {
      if (wanted.has(environmentId)) continue
      const [row] = await tx
        .update(productEnvironmentSizes)
        .set({ label, sortOrder, active: false })
        .where(
          and(
            eq(productEnvironmentSizes.productId, productId),
            eq(productEnvironmentSizes.environmentId, environmentId),
            eq(productEnvironmentSizes.code, code),
          ),
        )
        .returning()
      const summary = cellSummary(code, previous, row)
      if (summary) written.push({ environmentId, summary })
    }

    return written
  })

  // After the commit, not inside it: `recordProductVersion` writes on the pool's
  // own connection and snapshots the offering, so calling it in the transaction
  // would read rows the transaction has not published yet.
  for (const change of changes) {
    await recordProductVersion({
      productId,
      environmentId: change.environmentId,
      summary: change.summary,
      changelog: input.changelog,
      userId: input.userId ?? null,
    })
  }

  const matrix = await getSizeMatrix(productId)
  if (!matrix.ok) return matrix
  const row = matrix.data.rows.find((r) => r.code === code)
  // Only reachable when the row was retired into nothing — no cell was written and
  // none existed — which is a no-op save, not a failure.
  return ok(row ?? { code, label, sortOrder, cells: [] })
}

/**
 * Remove a size from every environment of a product at once.
 *
 * The counterpart of `deleteSize` for the matrix, and the same warning applies:
 * retiring is the gentler option and is what emptying a row's prices does. This is
 * for a code that was mistyped and never ordered. Existing ORDERS survive it —
 * they store the code as text and their own price — but a CART line naming it
 * reports itself unavailable.
 */
export const deleteSizeRow = async (productId: number, rawCode: string): Promise<Result<void>> => {
  const code = rawCode.trim()

  const deleted = await db
    .delete(productEnvironmentSizes)
    .where(
      and(eq(productEnvironmentSizes.productId, productId), eq(productEnvironmentSizes.code, code)),
    )
    .returning({ environmentId: productEnvironmentSizes.environmentId })

  if (deleted.length === 0) return err(404, 'Size not found')

  for (const row of deleted) {
    await recordProductVersion({
      productId,
      environmentId: row.environmentId,
      summary: `Size ${code} removed`,
      userId: null,
    })
  }

  return ok(undefined)
}
