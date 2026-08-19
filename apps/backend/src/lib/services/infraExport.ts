import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { parameters, orders } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import type { ProductSnapshot } from '@/lib/services/snapshot'
import { ok, type Result } from '@/lib/services/result'
import { listInfrastructure, type InfraFilters } from '@/lib/services/infrastructure'
import { getCostCentersForInfra } from '@/lib/services/infraCostCenters'

export interface InfraExportRow {
  id: number
  productName: string
  environmentName: string
  projectName: string
  costCenter: string
  status: string
  deployedAt: string
  parameters: string
}

export const REDACTED = '[redacted]'

/**
 * Flatten the filtered infrastructure list into export rows.
 *
 * Runs through listInfrastructure so the export is, by construction, the same
 * query the page ran — including the caller's visibility scope. An export that
 * could return rows the list would not is a data leak; one that applies its
 * filters differently is worse than no export at all, because it looks
 * authoritative.
 */
export const buildInfraExportRows = async (
  session: SessionUser,
  filters: InfraFilters,
  options: { includeParameters?: boolean } = {},
): Promise<Result<InfraExportRow[]>> => {
  const listed = await listInfrastructure(session, filters)
  if (!listed.ok) return listed

  const elements = listed.data
  const costCenters = await getCostCentersForInfra(elements.map((e) => e.orderId))
  // Two sources, unioned per row: the live catalogue, and the sensitivity recorded
  // in each order's own snapshot. The catalogue alone loses the flag as soon as a
  // definition is renamed or deleted — and then an export of an OLD order emits the
  // secret it was placed with verbatim.
  const sensitive = options.includeParameters
    ? await loadSensitiveParameterNames()
    : new Set<string>()
  const sensitivePerOrder = options.includeParameters
    ? await loadSnapshotSensitiveNames(elements.map((e) => e.orderId))
    : new Map<number, Set<string>>()

  return ok(
    elements.map((el) => ({
      id: el.id,
      productName: el.productName ?? `#${el.productId}`,
      environmentName: el.environmentName ?? `#${el.environmentId}`,
      projectName: el.projectName ?? `#${el.projectId}`,
      costCenter: costCenters.get(el.orderId) ?? '',
      status: el.status,
      deployedAt: el.deployedAt ? new Date(el.deployedAt).toISOString() : '',
      parameters: options.includeParameters
        ? formatParameters(el.parameters, union(sensitive, sensitivePerOrder.get(el.orderId)))
        : '',
    })),
  )
}

/**
 * Names of parameters flagged sensitive anywhere in the catalogue.
 *
 * Matched by name across every scope rather than resolved per product: an export
 * file gets mailed around and archived, so over-redacting a name that is
 * sensitive for one product and not another is the right way to be wrong.
 */
const loadSensitiveParameterNames = async (): Promise<Set<string>> => {
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
const loadSnapshotSensitiveNames = async (
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
const union = (a: Set<string>, b?: Set<string>): Set<string> =>
  b === undefined ? a : new Set([...a, ...b])

const formatParameters = (
  values: Record<string, string>,
  sensitive: Set<string>,
): string =>
  Object.entries(values ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${sensitive.has(key) ? REDACTED : value}`)
    .join('; ')
