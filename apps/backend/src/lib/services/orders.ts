import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import {
  orders,
  infrastructureElements,
  deploymentEnvironments,
  productEnvironments,
  products,
  projects,
  users,
  costCenters,
  type Parameter,
} from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { sendOrderCreated, sendApprovalRequest } from '@/lib/notification'
import { triggerProductWebhooks, triggerPipelineStacks } from '@/lib/ci/webhooks'
import { findProductName, findUserEmail, findUserName, findAdminEmails } from '@/lib/db/queries'
import { ok, err, type Result } from '@/lib/services/result'
import { loadApplicableParameters, resolveParameterDefs } from '@/lib/services/catalog'
import { resolveTrial, trialVariables, trialExpiry } from '@/lib/services/trial'

export interface OrderRow {
  id: number
  projectId: number
  productId: number
  environmentId: number
  userId: number
  status: string
  parameters: Record<string, string>
  costCenterId: number | null
  rejectionNote: string | null
  pipelineId: string[]
  createdAt: Date
  updatedAt: Date
  /** Ordered as a time-boxed trial (issue #1). */
  isTrial: boolean
  productName: string
  environmentName: string | null
  userName: string | null
}

export interface CreateOrderInput {
  projectId: number
  productId: number
  environmentId: number
  costCenterId?: number
  parameters: Record<string, string>
  /** Order as a time-boxed trial (issue #1). Requires a trial-enabled offering. */
  trial?: boolean
}

export interface CreatedOrder {
  id: number
  projectId: number
  productId: number
  environmentId: number
  userId: number
  status: string
  parameters: Record<string, string>
  costCenterId: number | null
  rejectionNote: string | null
  pipelineId: string[]
  createdAt: Date
  updatedAt: Date
  isTrial: boolean
  infraId?: number
}

export const listOrders = async (session: SessionUser): Promise<Result<OrderRow[]>> => {
  const isAdmin = session.role === 'admin' || session.role === 'root'

  const rows = await db
    .select({
      id: orders.id,
      projectId: orders.projectId,
      productId: orders.productId,
      environmentId: orders.environmentId,
      userId: orders.userId,
      status: orders.status,
      parameters: orders.parameters,
      costCenterId: orders.costCenterId,
      rejectionNote: orders.rejectionNote,
      pipelineId: orders.pipelineId,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      isTrial: orders.isTrial,
      productName: sql<string>`(
        SELECT name FROM product_translations
        WHERE product_id = ${orders.productId}
          AND language_code = 'en'
        LIMIT 1
      )`,
      environmentName: deploymentEnvironments.name,
      userName: users.name,
    })
    .from(orders)
    .leftJoin(deploymentEnvironments, eq(orders.environmentId, deploymentEnvironments.id))
    .leftJoin(users, eq(orders.userId, users.id))
    .where(isAdmin ? undefined : eq(orders.userId, session.id))
    .orderBy(sql`${orders.createdAt} DESC`)

  return ok(rows as OrderRow[])
}

export const getOrderById = async (
  session: SessionUser,
  orderId: number,
): Promise<Result<OrderRow>> => {
  const rows = await db
    .select({
      id: orders.id,
      projectId: orders.projectId,
      productId: orders.productId,
      environmentId: orders.environmentId,
      userId: orders.userId,
      status: orders.status,
      parameters: orders.parameters,
      costCenterId: orders.costCenterId,
      rejectionNote: orders.rejectionNote,
      pipelineId: orders.pipelineId,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      isTrial: orders.isTrial,
      productName: sql<string>`(
        SELECT name FROM product_translations
        WHERE product_id = ${orders.productId}
          AND language_code = 'en'
        LIMIT 1
      )`,
      environmentName: deploymentEnvironments.name,
      userName: users.name,
    })
    .from(orders)
    .leftJoin(deploymentEnvironments, eq(orders.environmentId, deploymentEnvironments.id))
    .leftJoin(users, eq(orders.userId, users.id))
    .where(eq(orders.id, orderId))
    .limit(1)

  if (!rows.length) return err(404, 'Order not found')

  const order = rows[0] as OrderRow
  if (session.role === 'project_manager' && order.userId !== session.id) {
    return err(403, 'Forbidden')
  }

  return ok(order)
}

/**
 * Validate the submitted parameter values against the applicable parameter
 * definitions and fill in defaults for omitted optional parameters. Returns the
 * effective parameter map to persist/trigger with, or a 400 Result on the first
 * validation failure. Only keys that have a matching definition are kept —
 * submitted keys with no applicable definition are dropped so a client cannot
 * inject arbitrary CI trigger variables (e.g. REF, TF_ACTION). Server-only
 * trigger vars (ORDER_ID, TF_ACTION, …) are appended later in the trigger layer.
 */
const validateAndApplyParameters = (
  defs: Parameter[],
  submitted: Record<string, string>,
): Result<Record<string, string>> => {
  const resolved = resolveParameterDefs(defs)
  const result: Record<string, string> = {}

  for (const def of resolved) {
    const raw = submitted[def.name]
    // Normalize once, then validate and store the normalized value so a value
    // like `" true "` or `" 4 "` is accepted and persisted without whitespace
    // (which would otherwise leak into the CI trigger variables).
    const value = raw?.trim() ?? ''
    const provided = value !== ''

    if (!provided) {
      if (def.required) return err(400, `Missing required parameter: ${def.name}`)
      if (def.defaultValue !== '') result[def.name] = def.defaultValue
      continue
    }

    if (def.type === 'number') {
      if (!/^-?\d+(\.\d+)?$/.test(value) || Number.isNaN(Number(value))) {
        return err(400, `Parameter ${def.name} must be a number`)
      }
    } else if (def.type === 'bool') {
      if (value !== 'true' && value !== 'false') {
        return err(400, `Parameter ${def.name} must be 'true' or 'false'`)
      }
    }
    // `dropdown` definitions carry no stored option list in the schema, so
    // there is no allowed-value constraint to enforce here.

    result[def.name] = value
  }

  return ok(result)
}

/**
 * Resolve and validate the cost centre for an order against the rules stored on
 * the product/environment offering (FA-10.4).
 *
 * - `project`   the cost centre comes from the project, so a submitted one is
 *               ignored rather than silently stored against the order.
 * - `overhead`  the offering names a fixed shared cost centre. The user never
 *               picks, so a submitted one is ignored here too.
 * - `select`    the user picks one. `forcedCostCenter` makes that choice
 *               mandatory; otherwise it may be omitted.
 *
 * A cost centre must exist AND be active, whichever way it was arrived at — the
 * foreign key only proves existence, and ordering against a deactivated cost
 * centre is exactly what deactivating one is meant to prevent. That applies to a
 * configured overhead account as much as to a user's choice: it may have been
 * deactivated long after the offering was set up.
 */
const validateCostCenter = async (
  offering: { costCenterMode: string; forcedCostCenter: boolean; overheadCostCenterId: number | null },
  costCenterId: number | undefined,
): Promise<Result<number | null>> => {
  if (offering.costCenterMode === 'overhead') {
    // The whole point of an overhead account is that it is fixed by the
    // offering. Falling back to the submitted value here is what made this mode
    // indistinguishable from 'select'.
    if (offering.overheadCostCenterId === null) {
      if (offering.forcedCostCenter) {
        return err(400, 'No overhead cost center is configured for this environment')
      }
      return ok(null)
    }
    return validateActiveCostCenter(offering.overheadCostCenterId, 'Overhead cost center')
  }

  if (offering.costCenterMode !== 'select') {
    // 'project' mode: attribution follows the project, so don't store a
    // caller-supplied value that the UI never offered.
    return ok(null)
  }

  if (costCenterId === undefined || costCenterId === null) {
    if (offering.forcedCostCenter) {
      return err(400, 'A cost center is required for this environment')
    }
    return ok(null)
  }

  return validateActiveCostCenter(costCenterId, 'Cost center')
}

const validateActiveCostCenter = async (
  costCenterId: number,
  label: string,
): Promise<Result<number>> => {
  const [cc] = await db
    .select({ id: costCenters.id, active: costCenters.active })
    .from(costCenters)
    .where(eq(costCenters.id, costCenterId))
    .limit(1)

  if (!cc) return err(400, `${label} not found`)
  if (!cc.active) return err(400, `${label} is not active`)

  return ok(cc.id)
}

export const createOrder = async (
  session: SessionUser,
  input: CreateOrderInput,
): Promise<Result<CreatedOrder>> => {
  const { projectId, productId, environmentId, costCenterId } = input
  const isAdmin = session.role === 'admin' || session.role === 'root'

  // Ownership: a project_manager may only order into a project they own.
  if (!isAdmin) {
    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (!project) return err(404, 'Project not found')
    if (project.ownerId !== session.id) return err(403, 'Forbidden')
  }

  // The product must be resolvable (needed for parameter scope) …
  const [product] = await db
    .select({ categoryId: products.categoryId })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)
  if (!product) return err(404, 'Product not found')

  // … and must actually be offered in the chosen environment. The offering row
  // also carries the cost-centre rules, which are validated below.
  const [offered] = await db
    .select({
      productId: productEnvironments.productId,
      costCenterMode: productEnvironments.costCenterMode,
      forcedCostCenter: productEnvironments.forcedCostCenter,
      overheadCostCenterId: productEnvironments.overheadCostCenterId,
    })
    .from(productEnvironments)
    .where(
      and(
        eq(productEnvironments.productId, productId),
        eq(productEnvironments.environmentId, environmentId),
      ),
    )
    .limit(1)
  if (!offered) return err(400, 'Product is not offered in the selected environment')

  // Cost-centre rules (FA-10.4). These were previously enforced only in the
  // browser — OrderForm computes `needsCostCenter` and marks the field required —
  // so a direct POST could omit the cost centre on an environment that forces
  // one, or attach an inactive one. Both land in billing attribution, so the
  // server has to decide.
  const costCenterResult = await validateCostCenter(offered, costCenterId)
  if (!costCenterResult.ok) return costCenterResult
  const resolvedCostCenterId = costCenterResult.data

  // Trials are opt-in per offering (issue #1). Checked here rather than trusted
  // from the request: the toggle is hidden in the browser for products that do
  // not offer one, and a hidden control is not a control.
  const isTrial = input.trial === true
  let trialDurationMinutes = 0
  if (isTrial) {
    const trial = await resolveTrial(productId, environmentId)
    if (!trial.ok) return trial
    trialDurationMinutes = trial.data.trialDurationMinutes
  }

  // Server-side parameter validation (required/type checks + defaults).
  const defs = await loadApplicableParameters(productId, product.categoryId, environmentId)
  const validated = validateAndApplyParameters(defs, input.parameters)
  if (!validated.ok) return validated
  const parameters = validated.data

  if (isAdmin) {
    const [order] = await db
      .insert(orders)
      .values({
        projectId,
        productId,
        environmentId,
        userId: session.id,
        status: 'provisioning',
        parameters,
        costCenterId: resolvedCostCenterId,
        isTrial,
      })
      .returning()

    const triggerVars = {
      ...parameters,
      ORDER_ID: String(order.id),
      ...(isTrial ? trialVariables(trialDurationMinutes) : {}),
    }
    const webhookIds = await triggerProductWebhooks(productId, environmentId, triggerVars)
    const stackIds = await triggerPipelineStacks(productId, environmentId, triggerVars)
    const pipelineIds = [...webhookIds, ...stackIds]

    if (pipelineIds.length > 0) {
      await db.update(orders).set({ pipelineId: pipelineIds }).where(eq(orders.id, order.id))
    }

    const [infra] = await db
      .insert(infrastructureElements)
      .values({
        orderId: order.id,
        projectId,
        environmentId,
        productId,
        status: 'active',
        parameters,
        pipelineId: pipelineIds,
        // The trial's clock starts here, at provisioning. The scheduled-decommission
        // sweep (issue #30) is what actually tears it down, so a trial needs no
        // teardown mechanism of its own.
        ...(isTrial ? { scheduledDecommissionAt: trialExpiry(trialDurationMinutes) } : {}),
      })
      .returning()

    await logAudit(session.id, 'order.provisioning', order.id, `Admin-initiated order for product ${productId}`)

    const email = await findUserEmail(session.id)
    const productName = await findProductName(productId)
    if (email) {
      await sendOrderCreated(email, productName, order.id)
    }

    return ok({ ...order, pipelineId: pipelineIds, infraId: infra.id })
  } else {
    const [order] = await db
      .insert(orders)
      .values({
        projectId,
        productId,
        environmentId,
        userId: session.id,
        status: 'pending',
        parameters,
        costCenterId: resolvedCostCenterId,
        // Carried to approval time, which is where the trial is actually
        // provisioned and where its clock starts.
        isTrial,
      })
      .returning()

    await logAudit(session.id, 'order.created', order.id, `Order created for product ${productId}`)

    const email = await findUserEmail(session.id)
    const productName = await findProductName(productId)
    if (email) {
      await sendOrderCreated(email, productName, order.id)
    }

    const ordererName = await findUserName(session.id)
    const adminEmails = await findAdminEmails()
    for (const adminEmail of adminEmails) {
      await sendApprovalRequest(adminEmail, productName, order.id, ordererName)
    }

    return ok(order as CreatedOrder)
  }
}
