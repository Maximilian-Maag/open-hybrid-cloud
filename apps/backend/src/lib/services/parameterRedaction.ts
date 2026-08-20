import { db } from '@/lib/db/client'
import { parameters, orders } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import type { ProductSnapshot } from '@/lib/services/snapshot'

/**
 * Which stored parameter values must never be shown, and what to show instead.
 *
 * Its own module because two consumers need exactly the same answer — the CSV/PDF
 * export and the infrastructure detail page — and a value hidden in one place and
 * shown in the other is worse than either choice made consistently. (It also breaks
 * the import cycle that putting it in either consumer would create.)
 */
export const REDACTED = '[redacted]'

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
