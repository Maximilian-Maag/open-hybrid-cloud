import type { SessionUser } from '@open-hybrid-cloud/types'
import {
  REDACTED,
  loadSensitiveParameterNames,
  loadSnapshotSensitiveNames,
  union,
} from '@/lib/services/parameterRedaction'
import { ok, err, type Result } from '@/lib/services/result'
import { EXPORT_MAX_ROWS } from '@/lib/services/page'
import { listInfrastructure, type InfraFilters } from '@/lib/services/infrastructure'
import { getCostCentersForInfra } from '@/lib/services/infraCostCenters'

export interface InfraExportRow {
  id: number
  productName: string
  environmentName: string
  projectName: string
  costCenter: string
  status: string
  /** The size this element runs at (issue #98); blank when the offering has none. */
  size: string
  /** "3/20" for element three of an order of twenty (issue #104), else "1/1". */
  element: string
  deployedAt: string
  parameters: string
}

// Re-exported for the export route and its tests, which import it from here.
export { REDACTED } from '@/lib/services/parameterRedaction'

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
  // The export asks for one window as wide as an export is allowed to be. It is
  // not the list's ceiling — a CSV legitimately wants more than a screenful —
  // but it is a ceiling, which is what stands between a large download and the
  // container running out of memory building it (#158).
  const listed = await listInfrastructure(
    session,
    { ...filters, limit: EXPORT_MAX_ROWS, offset: 0 },
    'en',
    EXPORT_MAX_ROWS,
  )
  if (!listed.ok) return listed

  // Refused rather than truncated, the way the audit export already does it: a
  // file that quietly stops at ten thousand rows looks like a complete
  // inventory, and an operator reconciling chargeback against it would find
  // nothing wrong with it.
  if (listed.data.total > EXPORT_MAX_ROWS) {
    return err(
      413,
      `This export matches ${listed.data.total.toLocaleString('en-US')} elements, which is more than one export can carry. Narrow it with the project, environment or deployed-date filters and take the inventory a slice at a time.`,
    )
  }

  const elements = listed.data.items
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
      size: el.sizeCode ?? '',
      // Which of its order's elements this is. An inventory of twenty identical
      // rows is unreadable without it.
      element: `${el.sequence}/${el.orderQuantity ?? el.sequence}`,
      deployedAt: el.deployedAt ? new Date(el.deployedAt).toISOString() : '',
      parameters: options.includeParameters
        ? formatParameters(el.parameters, union(sensitive, sensitivePerOrder.get(el.orderId)))
        : '',
    })),
  )
}

const formatParameters = (
  values: Record<string, string>,
  sensitive: Set<string>,
): string =>
  Object.entries(values ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${sensitive.has(key) ? REDACTED : value}`)
    .join('; ')
