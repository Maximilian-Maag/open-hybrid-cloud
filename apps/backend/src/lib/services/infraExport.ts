import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { parameters } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
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
  const sensitive = options.includeParameters ? await loadSensitiveParameterNames() : new Set<string>()

  return ok(
    elements.map((el) => ({
      id: el.id,
      productName: el.productName ?? `#${el.productId}`,
      environmentName: el.environmentName ?? `#${el.environmentId}`,
      projectName: el.projectName ?? `#${el.projectId}`,
      costCenter: costCenters.get(el.orderId) ?? '',
      status: el.status,
      deployedAt: el.deployedAt ? new Date(el.deployedAt).toISOString() : '',
      parameters: options.includeParameters ? formatParameters(el.parameters, sensitive) : '',
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

const formatParameters = (
  values: Record<string, string>,
  sensitive: Set<string>,
): string =>
  Object.entries(values ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${sensitive.has(key) ? REDACTED : value}`)
    .join('; ')
