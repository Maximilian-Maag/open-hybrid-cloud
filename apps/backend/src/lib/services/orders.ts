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
import { redactParametersForOrders, REDACTED } from '@/lib/services/parameterRedaction'
import { resolveTrial, trialVariables, trialExpiry } from '@/lib/services/trial'
import { captureProductSnapshot, type ProductSnapshot } from '@/lib/services/snapshot'

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
  /**
   * What the customer was offered when the order was placed (issue #38). Null for
   * orders placed before snapshots existed.
   */
  productSnapshot: ProductSnapshot | null
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
      productSnapshot: orders.productSnapshot,
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

  // Server-side, because the only masking used to be the order detail page's
  // `def?.sensitive ? '••••••'` — which reads the definition off the order's
  // snapshot, so an order placed before snapshots existed rendered the secret in
  // plaintext, and the raw value was in the JSON either way (issue #131).
  return ok(await redactParametersForOrders(rows as OrderRow[], (row) => row.id))
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
      productSnapshot: orders.productSnapshot,
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

  // See listOrders: the values leave the service redacted, whoever is asking.
  const [redacted] = await redactParametersForOrders([order], (row) => row.id)
  return ok(redacted)
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
    // A client that posts back the redaction sentinel is echoing the placeholder
    // it was shown, which means "unchanged" — never "the literal string
    // [redacted]". Reads are redacted (#131), so the reorder and apply-template
    // prefills hand the form this sentinel for every sensitive parameter; without
    // this line it would be stored as the value and shipped to the pipeline as a
    // trigger variable, overwriting the real secret.
    const provided = value !== '' && value !== REDACTED

    if (!provided) {
      // The default is applied BEFORE the required check, not after. A required
      // parameter that has a stored default is satisfied by it — and since #131
      // reads that value back redacted, the form can only ever return the
      // sentinel or an empty string for a required SENSITIVE one. Checking
      // `required` first made those orders impossible to place at all: the
      // server held the value, refused to use it, and asked the user for
      // something they are deliberately never shown.
      if (def.defaultValue !== '') {
        result[def.name] = def.defaultValue
        continue
      }
      if (def.required) return err(400, `Missing required parameter: ${def.name}`)
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

/**
 * Everything an order needs, resolved and validated, with nothing written yet.
 *
 * Extracted so the cart checkout (issue #28) can validate EVERY item before
 * creating any of them. Order creation fires CI pipelines, which cannot be
 * un-fired, so a checkout's only meaningful atomicity is an all-or-nothing
 * validation gate — and that gate has to apply exactly the rules a single order
 * would, not a second copy of them that drifts.
 */
export interface PreparedOrder {
  projectId: number
  productId: number
  environmentId: number
  parameters: Record<string, string>
  costCenterId: number | null
  isTrial: boolean
  trialDurationMinutes: number
  productSnapshot: ProductSnapshot | null
  isAdmin: boolean
}

export const prepareOrder = async (
  session: SessionUser,
  input: CreateOrderInput,
): Promise<Result<PreparedOrder>> => {
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

  // Captured before anything is written, so both an admin's direct order and a
  // project manager's pending order record what was actually offered (issue #38).
  // Taken after validation, so the offering is known to exist.
  const productSnapshot = await captureProductSnapshot(productId, product.categoryId, environmentId)

  return ok({
    projectId,
    productId,
    environmentId,
    parameters,
    costCenterId: resolvedCostCenterId,
    isTrial,
    trialDurationMinutes,
    productSnapshot,
    isAdmin,
  })
}

/**
 * Create one order, provisioning it immediately for an admin or queueing it for
 * approval for a project manager.
 */
export const createOrder = async (
  session: SessionUser,
  input: CreateOrderInput,
): Promise<Result<CreatedOrder>> => {
  const prepared = await prepareOrder(session, input)
  if (!prepared.ok) return prepared
  return createPreparedOrder(session, prepared.data)
}

/**
 * Write and provision an order that has already been validated.
 *
 * Separate from prepareOrder so the cart checkout can put its validation gate
 * between the two.
 */
export const createPreparedOrder = async (
  session: SessionUser,
  prepared: PreparedOrder,
): Promise<Result<CreatedOrder>> => {
  const {
    projectId, productId, environmentId, parameters,
    costCenterId: resolvedCostCenterId, isTrial, trialDurationMinutes, productSnapshot, isAdmin,
  } = prepared

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
        productSnapshot,
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
        productSnapshot,
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
