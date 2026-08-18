import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { infrastructureElements, deploymentEnvironments, projects, orders } from '@/lib/db/schema'
import { eq, and, sql, gte, lte } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { fireDestroyTriggers } from '@/lib/services/teardown'
import { triggerProductWebhooksTracked, triggerPipelineStacksTracked } from '@/lib/ci/webhooks'
import { ok, err, type Result } from '@/lib/services/result'

export interface InfraRow {
  id: number
  orderId: number
  projectId: number
  environmentId: number
  productId: number
  status: string
  parameters: Record<string, string>
  pipelineId: string[]
  outputs: Record<string, string>
  deployedAt: Date | null
  productName: string
  environmentName: string | null
  projectName: string | null
  /**
   * Status of the order this element was provisioned from.
   *
   * Exposed because the element's own status cannot express a failed deployment:
   * it is inserted `active` the moment provisioning starts and stays there when
   * the pipeline fails. Without this the list shows `active` for infrastructure
   * that was never successfully provisioned — and the Retry action (issue #29)
   * has nothing to key off.
   */
  orderStatus: string | null
}

/** The `status` values an infrastructure element can actually hold. */
export const INFRA_STATUSES = ['active', 'decommissioning', 'decommissioned'] as const
export type InfraStatus = (typeof INFRA_STATUSES)[number]

export const INFRA_SORT_FIELDS = ['date', 'name', 'status'] as const
export type InfraSortField = (typeof INFRA_SORT_FIELDS)[number]

export interface InfraFilters {
  productId?: number
  projectId?: number
  environmentId?: number
  /** Free text matched against product, environment and project name. */
  search?: string
  status?: InfraStatus
  /** Inclusive lower / upper bound on `deployed_at`. */
  deployedFrom?: Date
  deployedTo?: Date
  sort?: InfraSortField
  direction?: 'asc' | 'desc'
}

// Matched against the same expression the row displays, so a search hit is
// always visibly explicable. Deliberately excludes `parameters`: the values
// there include ones flagged sensitive, and a substring match would turn the
// filter into an oracle for confirming a secret's value.
const productNameSql = sql<string>`(
  SELECT name FROM product_translations
  WHERE product_id = ${infrastructureElements.productId}
    AND language_code = 'en'
  LIMIT 1
)`

export const listInfrastructure = async (
  session: SessionUser,
  filters: InfraFilters,
): Promise<Result<InfraRow[]>> => {
  const isAdmin = session.role === 'admin' || session.role === 'root'

  const conditions: ReturnType<typeof sql>[] = []
  if (!isAdmin) conditions.push(sql`${projects.ownerId} = ${session.id}`)
  if (filters.productId) conditions.push(sql`${infrastructureElements.productId} = ${filters.productId}`)
  if (filters.projectId) conditions.push(sql`${infrastructureElements.projectId} = ${filters.projectId}`)
  if (filters.environmentId) conditions.push(sql`${infrastructureElements.environmentId} = ${filters.environmentId}`)
  if (filters.status) conditions.push(sql`${infrastructureElements.status} = ${filters.status}`)

  if (filters.search) {
    // Escape the LIKE metacharacters so a literal % or _ in the query narrows
    // the result set instead of widening it to everything.
    const pattern = `%${filters.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    conditions.push(sql`(
      ${productNameSql} ILIKE ${pattern} ESCAPE '\\'
      OR ${deploymentEnvironments.name} ILIKE ${pattern} ESCAPE '\\'
      OR ${projects.name} ILIKE ${pattern} ESCAPE '\\'
    )`)
  }

  // Both bounds are inclusive; the caller passes the exact boundary it wants
  // (parseInfraFilters widens a bare date to cover the whole day). gte/lte
  // rather than a raw sql template because the driver needs the column's type to
  // bind a JS Date — a hand-written `>= ${date}` fails at query time.
  if (filters.deployedFrom) conditions.push(gte(infrastructureElements.deployedAt, filters.deployedFrom))
  if (filters.deployedTo) conditions.push(lte(infrastructureElements.deployedAt, filters.deployedTo))

  const where = conditions.length > 0
    ? conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)
    : undefined

  // Whitelisted rather than interpolated — the sort field reaches this from a
  // query string.
  const direction = filters.direction === 'asc' ? sql`ASC` : sql`DESC`
  const orderBy = {
    date: sql`${infrastructureElements.deployedAt} ${direction}`,
    name: sql`${productNameSql} ${direction}`,
    status: sql`${infrastructureElements.status} ${direction}`,
  }[filters.sort ?? 'date']

  const rows = await db
    .select({
      id: infrastructureElements.id,
      orderId: infrastructureElements.orderId,
      projectId: infrastructureElements.projectId,
      environmentId: infrastructureElements.environmentId,
      productId: infrastructureElements.productId,
      status: infrastructureElements.status,
      parameters: infrastructureElements.parameters,
      pipelineId: infrastructureElements.pipelineId,
      outputs: infrastructureElements.outputs,
      deployedAt: infrastructureElements.deployedAt,
      productName: productNameSql,
      environmentName: deploymentEnvironments.name,
      projectName: projects.name,
      orderStatus: orders.status,
    })
    .from(infrastructureElements)
    .leftJoin(
      deploymentEnvironments,
      eq(infrastructureElements.environmentId, deploymentEnvironments.id),
    )
    .leftJoin(projects, eq(infrastructureElements.projectId, projects.id))
    .leftJoin(orders, eq(infrastructureElements.orderId, orders.id))
    .where(where)
    // Tie-break on id so a page of rows sharing a sort key (same status, same
    // deploy timestamp) comes back in a stable order across requests — an
    // export is expected to match the list it was taken from.
    .orderBy(orderBy, sql`${infrastructureElements.id} DESC`)

  return ok(rows as InfraRow[])
}

export interface InfraFacets {
  environments: { id: number; name: string }[]
  projects: { id: number; name: string }[]
  products: { id: number; name: string }[]
}

/**
 * The distinct environments, projects and products present in the caller's
 * visible infrastructure — the option lists for the list page's filters.
 *
 * Derived from the elements rather than from the admin catalogue endpoints for
 * two reasons: those are root-only, so a project manager could not populate the
 * dropdowns at all; and offering an environment with nothing deployed in it only
 * gives the user a way to filter down to an empty list.
 *
 * Scoping mirrors listInfrastructure exactly, so the facets can never hint at
 * the existence of a project the caller cannot otherwise see.
 */
export const listInfrastructureFacets = async (
  session: SessionUser,
): Promise<Result<InfraFacets>> => {
  const isAdmin = session.role === 'admin' || session.role === 'root'
  const scope = isAdmin ? undefined : sql`${projects.ownerId} = ${session.id}`

  const rows = await db
    .selectDistinct({
      environmentId: infrastructureElements.environmentId,
      environmentName: deploymentEnvironments.name,
      projectId: infrastructureElements.projectId,
      projectName: projects.name,
      productId: infrastructureElements.productId,
      productName: productNameSql,
    })
    .from(infrastructureElements)
    .leftJoin(
      deploymentEnvironments,
      eq(infrastructureElements.environmentId, deploymentEnvironments.id),
    )
    .leftJoin(projects, eq(infrastructureElements.projectId, projects.id))
    .where(scope)

  const collect = (
    pairs: { id: number; name: string | null }[],
  ): { id: number; name: string }[] => {
    const byId = new Map<number, string>()
    for (const { id, name } of pairs) if (!byId.has(id)) byId.set(id, name ?? `#${id}`)
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  return ok({
    environments: collect(rows.map((r) => ({ id: r.environmentId, name: r.environmentName }))),
    projects: collect(rows.map((r) => ({ id: r.projectId, name: r.projectName }))),
    products: collect(rows.map((r) => ({ id: r.productId, name: r.productName }))),
  })
}

/**
 * Re-fire provisioning for an element whose deployment failed (issue #29).
 *
 * On the failure model, since issue #29 describes one this codebase does not
 * have: there is no `failed` infrastructure status. The element is inserted as
 * `active` the moment provisioning STARTS (see approveOrder / createOrder), and a
 * failed pipeline sets `orders.status = 'failed'` while leaving the element
 * `active` — claiming infrastructure that was never successfully provisioned.
 * So the retryable condition lives on the order, and that is what this checks.
 *
 * Recovery uses the element's stored parameters, which are the ones the order was
 * placed with, so a retry cannot quietly provision something different from what
 * was approved. Previously the only route was a brand-new order, which duplicated
 * the record and lost the original approval context.
 */
export const retryProvisioning = async (
  session: SessionUser,
  infraId: number,
): Promise<Result<{ pipelineIds: string[] }>> => {
  const [infra] = await db
    .select()
    .from(infrastructureElements)
    .where(eq(infrastructureElements.id, infraId))
    .limit(1)

  if (!infra) return err(404, 'Infrastructure element not found')

  const [order] = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(eq(orders.id, infra.orderId))
    .limit(1)

  if (!order) return err(404, 'Order not found')
  if (order.status !== 'failed') {
    return err(400, `Only a failed deployment can be retried — this order is ${order.status}`)
  }

  // Atomically claim the order (failed → provisioning) and clear the previous
  // attempt's pipeline tracking in the same statement. Only one concurrent
  // caller can win, so a double-clicked Retry cannot fire two sets of pipelines
  // against the same infrastructure.
  const claimed = await db
    .update(orders)
    .set({ status: 'provisioning', pipelineId: [], pipelineStatus: {}, updatedAt: new Date() })
    .where(and(eq(orders.id, order.id), eq(orders.status, 'failed')))
    .returning({ id: orders.id })

  if (!claimed.length) return err(409, 'Retry already in progress for this deployment')

  const variables = {
    ...(infra.parameters as Record<string, string>),
    // Pipeline stacks derive TF_STATE_NAME from stateKeyParam ?? ORDER_ID, and
    // the stored parameters do not carry the server-generated order id. Reusing
    // the ORIGINAL order id is the point: the retry has to target the same
    // Terraform state the failed attempt was working on.
    ORDER_ID: String(infra.orderId),
  }

  let outcome: { pipelineIds: string[]; failures: string[] }
  try {
    const webhooks = await triggerProductWebhooksTracked(infra.productId, infra.environmentId, variables)
    const stacks = await triggerPipelineStacksTracked(infra.productId, infra.environmentId, variables)
    outcome = {
      pipelineIds: [...webhooks.pipelineIds, ...stacks.pipelineIds],
      failures: [...webhooks.failures, ...stacks.failures],
    }
  } catch (e) {
    await releaseRetryClaim(order.id)
    throw e
  }

  if (outcome.pipelineIds.length === 0) {
    // Nothing started, so nothing changed: hand the order back to 'failed' so
    // the Retry button stays available rather than leaving it stuck in a
    // 'provisioning' state no callback will ever resolve.
    await releaseRetryClaim(order.id)
    await logAudit(
      session.id,
      'infra.retry_failed',
      infraId,
      `No pipeline could be started: ${outcome.failures.join('; ')}`,
    )
    return err(502, `Could not start the deployment: ${outcome.failures.join('; ')}`)
  }

  // Sentinel per trigger that failed to start, mirroring fireDestroyTriggers. A
  // failed trigger contributes no pipeline id, so without this the order would
  // complete as soon as the pipelines that DID start succeed — reporting a
  // successful retry while one webhook never fired.
  const pipelineStatus: Record<string, string> = {}
  outcome.failures.forEach((failure, i) => {
    pipelineStatus[`trigger-failed:${i}`] = failure
  })

  await db
    .update(orders)
    .set({ pipelineId: outcome.pipelineIds, pipelineStatus, updatedAt: new Date() })
    .where(eq(orders.id, order.id))

  await db
    .update(infrastructureElements)
    .set({
      status: 'active',
      pipelineId: outcome.pipelineIds,
      pipelineStatus: {},
      // Outputs are parsed from the job trace on success. Any left over from an
      // earlier attempt describe infrastructure this retry is about to replace.
      outputs: {},
    })
    .where(eq(infrastructureElements.id, infraId))

  await logAudit(
    session.id,
    'infra.retried',
    infraId,
    `Deployment retried by ${session.email} (order #${infra.orderId}, ${outcome.pipelineIds.length} pipeline(s))`,
  )

  if (outcome.failures.length > 0) {
    // Some pipelines ARE running and cannot be recalled, so the order stays
    // 'provisioning' and the sentinels above keep it from ever reporting itself
    // complete. Tell the operator what still needs attention.
    return err(
      502,
      `Retry started ${outcome.pipelineIds.length} pipeline(s), but ${outcome.failures.length} could not be started: ${outcome.failures.join('; ')}`,
    )
  }

  return ok({ pipelineIds: outcome.pipelineIds })
}

const releaseRetryClaim = async (orderId: number): Promise<void> => {
  await db
    .update(orders)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(eq(orders.id, orderId))
}

export const decommissionInfra = async (
  session: SessionUser,
  infraId: number,
): Promise<Result<{ pipelineIds: string[] }>> => {
  const infraRows = await db
    .select()
    .from(infrastructureElements)
    .where(eq(infrastructureElements.id, infraId))
    .limit(1)

  if (!infraRows.length) return err(404, 'Infrastructure element not found')

  const infra = infraRows[0]

  if (session.role === 'project_manager') {
    const projectRows = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, infra.projectId))
      .limit(1)

    if (!projectRows.length || projectRows[0].ownerId !== session.id) {
      return err(403, 'Forbidden')
    }
  }

  // Atomically claim the element (active → decommissioning) so two concurrent
  // decommission calls can't both fire a destroy pipeline.
  const claimed = await db
    .update(infrastructureElements)
    .set({ status: 'decommissioning' })
    .where(sql`${infrastructureElements.id} = ${infraId} AND ${infrastructureElements.status} = 'active'`)
    .returning({ id: infrastructureElements.id })

  if (!claimed.length) return err(400, 'Infrastructure element is not active')

  const variables = {
    ...(infra.parameters as Record<string, string>),
    TF_ACTION: 'destroy',
    INFRA_ID: String(infra.id),
    // Pipeline stacks derive TF_STATE_NAME from stateKeyParam ?? ORDER_ID; the
    // stored infra parameters don't carry the server-generated ORDER_ID, so pass
    // it explicitly or a stack whose stateKeyParam is absent would destroy an
    // empty/wrong state.
    ORDER_ID: String(infra.orderId),
  }

  // Fires product webhooks AND pipeline stacks, and persists the started
  // pipeline ids (plus a sentinel per trigger that failed to start) so the
  // outcome is durable rather than swallowed.
  let outcome: Awaited<ReturnType<typeof fireDestroyTriggers>>
  try {
    outcome = await fireDestroyTriggers(infra, variables)
  } catch (e) {
    // Destroy pipeline could not be started — restore the element to active.
    await db
      .update(infrastructureElements)
      .set({ status: 'active' })
      .where(eq(infrastructureElements.id, infraId))
    throw e
  }

  if (outcome.restoredToActive) {
    // Nothing was started, so nothing was destroyed: the element is back to
    // 'active' and the caller can simply try again.
    await logAudit(
      session.id,
      'infra.decommission_failed',
      infraId,
      `No destroy pipeline could be started: ${outcome.failures.join('; ')}`,
    )
    return err(502, `Could not start the destroy pipeline: ${outcome.failures.join('; ')}`)
  }

  if (outcome.failures.length > 0) {
    // Some destroys ARE running and cannot be recalled, so the element stays
    // 'decommissioning' — and the sentinel written by fireDestroyTriggers keeps
    // it from ever reporting itself fully decommissioned. Tell the operator
    // which triggers need manual cleanup instead of returning success.
    await logAudit(
      session.id,
      'infra.decommission_partial',
      infraId,
      `Destroy started for ${outcome.pipelineIds.length} pipeline(s); could not start: ${outcome.failures.join('; ')}`,
    )
    return err(
      502,
      `Destroy started for ${outcome.pipelineIds.length} pipeline(s), but ${outcome.failures.length} could not be started and need manual cleanup: ${outcome.failures.join('; ')}`,
    )
  }

  await logAudit(
    session.id,
    'infra.decommissioning',
    infraId,
    `Decommission initiated by ${session.email}`,
  )

  return ok({ pipelineIds: outcome.pipelineIds })
}
