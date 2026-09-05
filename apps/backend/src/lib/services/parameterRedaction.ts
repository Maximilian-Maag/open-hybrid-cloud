import { db } from '@/lib/db/client'
import { parameters, orders } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import type { ProductSnapshot } from '@/lib/services/snapshot'
import { REDACTED_PARAMETER_VALUE } from '@open-hybrid-cloud/types'

/**
 * Which stored parameter values must never be shown, and what to show instead.
 *
 * Its own module because two consumers need exactly the same answer — the CSV/PDF
 * export and the infrastructure detail page — and a value hidden in one place and
 * shown in the other is worse than either choice made consistently. (It also breaks
 * the import cycle that putting it in either consumer would create.)
 */
export const REDACTED: string = REDACTED_PARAMETER_VALUE

/**
 * Names of parameters flagged sensitive anywhere in the catalogue.
 *
 * Matched by name across every scope rather than resolved per product: these values
 * get mailed around and archived, so over-redacting a name that is sensitive for one
 * product and not another is the right way to be wrong.
 */
export const loadSensitiveParameterNames = async (): Promise<Set<string>> => {
  const rows = await db
    .select({ name: parameters.name })
    .from(parameters)
    .where(eq(parameters.sensitive, true))
  return new Set(rows.map((r) => r.name))
}

/**
 * Parameter names each order's snapshot recorded as sensitive.
 *
 * The snapshot is the durable record of the definitions that applied when the order
 * was placed (issue #38), so it still knows a parameter was secret after the
 * definition itself has been edited away. Orders that predate snapshots contribute
 * nothing and fall back to the catalogue.
 */
export const loadSnapshotSensitiveNames = async (
  orderIds: number[],
): Promise<Map<number, Set<string>>> => {
  const byOrder = new Map<number, Set<string>>()
  if (orderIds.length === 0) return byOrder

  const rows = await db
    .select({ id: orders.id, snapshot: orders.productSnapshot })
    .from(orders)
    .where(inArray(orders.id, orderIds))

  for (const row of rows) {
    const snapshot = row.snapshot as ProductSnapshot | null
    if (!snapshot?.parameters) continue
    const names = snapshot.parameters.filter((p) => p.sensitive).map((p) => p.name)
    if (names.length > 0) byOrder.set(row.id, new Set(names))
  }
  return byOrder
}

/** Redact if EITHER source says sensitive — over-redacting is the safe direction. */
export const union = (a: Set<string>, b?: Set<string>): Set<string> =>
  b === undefined ? a : new Set([...a, ...b])

/** Replace the values of sensitive parameters, keeping the keys visible. */
export const redactParameters = (
  values: Record<string, string>,
  sensitive: Set<string>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [key, sensitive.has(key) ? REDACTED : value]),
  )

/**
 * The stored default of every sensitive definition, blanked.
 *
 * A sensitive parameter's default is a secret like any other stored value — often a
 * placeholder credential an admin typed once — and `GET /api/catalog/{id}` is
 * `requireAuth` only, so every authenticated user could read it (issue #131). The
 * DEFINITION is what the order form needs (name, label, type, required, sensitive);
 * the default is not, and `validateAndApplyParameters` fills the real one in
 * server-side for any value the client leaves empty, so nothing downstream loses it.
 *
 * Blanked rather than replaced with `REDACTED`: this shape feeds a form control whose
 * value is posted back at checkout, and a sentinel posted back would be *stored* as
 * the parameter's value. `''` reads as "you type this one".
 */
export const withoutSensitiveDefaults = <T extends { sensitive: boolean; defaultValue: string }>(
  defs: T[],
): T[] => defs.map((def) => (def.sensitive ? { ...def, defaultValue: '' } : def))

/**
 * Redact the sensitive values in a batch of rows that each belong to an order.
 *
 * The list read paths — orders, approvals and infrastructure — all carry the stored
 * parameter map of an order and all used to return it verbatim (issue #131). They
 * need exactly the answer `getInfrastructureElement` already computes for a single
 * row: the live catalogue's sensitive names unioned with the ones the order's own
 * snapshot recorded, so a definition renamed or deleted since cannot un-flag the
 * value it was placed with.
 *
 * Two queries for the whole batch rather than two per row — the catalogue answer is
 * shared and the snapshots come back in one `IN (…)`.
 */
export const redactParametersForOrders = async <T extends { parameters: Record<string, string> }>(
  rows: T[],
  orderIdOf: (row: T) => number | null,
): Promise<T[]> => {
  if (rows.length === 0) return rows

  const catalogue = await loadSensitiveParameterNames()
  const perOrder = await loadSnapshotSensitiveNames(
    rows.map(orderIdOf).filter((id): id is number => id !== null),
  )

  return rows.map((row) => {
    const orderId = orderIdOf(row)
    const sensitive = union(catalogue, orderId === null ? undefined : perOrder.get(orderId))
    return { ...row, parameters: redactParameters(row.parameters, sensitive) }
  })
}
