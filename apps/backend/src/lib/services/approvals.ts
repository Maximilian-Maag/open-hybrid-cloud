import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import {
  orders,
  infrastructureElements,
  deploymentEnvironments,
  users,
  projects,
  productEnvironments,
} from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { sendOrderApproved, sendOrderRejected } from '@/lib/notification'
import { triggerProductWebhooks, triggerPipelineStacks } from '@/lib/ci/webhooks'
import { findProductName, findUserEmail } from '@/lib/db/queries'
import { ok, err, type Result } from '@/lib/services/result'
import { trialVariables, trialExpiry } from '@/lib/services/trial'
import { redactParametersForOrders } from '@/lib/services/parameterRedaction'

export interface ApprovalRow {
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
  /**
   * Ordered as a time-boxed trial (issue #1). Surfaced in the queue because it
   * changes what the approver is agreeing to: a trial is torn down again shortly
   * after it comes up, and asks the pipeline for elevated rights inside it.
   */
  isTrial: boolean
  productName: string
  environmentName: string | null
  userName: string | null
  projectName: string | null
}

export const listApprovals = async (): Promise<Result<ApprovalRow[]>> => {
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
      projectName: projects.name,
    })
    .from(orders)
    .leftJoin(deploymentEnvironments, eq(orders.environmentId, deploymentEnvironments.id))
    .leftJoin(users, eq(orders.userId, users.id))
    .leftJoin(projects, eq(orders.projectId, projects.id))
    .where(eq(orders.status, 'pending'))
    .orderBy(sql`${orders.createdAt} ASC`)

  // The queue is every pending order, shown to every admin, and the approvals page
  // renders none of these values — so returning them in cleartext shipped every
  // orderer's secrets to every admin for nothing (issue #131).
  return ok(await redactParametersForOrders(rows as ApprovalRow[], (row) => row.id))
}

export const approveOrder = async (
  session: SessionUser,
  orderId: number,
): Promise<Result<{ success: true; infraId: number; pipelineIds: string[] }>> => {
  // Atomically claim the order (pending → provisioning). Only one concurrent
  // caller can win this conditional update, which prevents a double-clicked or
  // concurrently-approved order from triggering provisioning twice.
  const claimed = await db
    .update(orders)
    .set({ status: 'provisioning', updatedAt: new Date() })
    .where(sql`${orders.id} = ${orderId} AND ${orders.status} = 'pending'`)
    .returning()

  if (!claimed.length) {
    const existing = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
    return existing.length ? err(400, 'Order is not pending') : err(404, 'Order not found')
  }

  const order = claimed[0]

  // A trial's clock starts HERE, at provisioning, not when the order was placed:
  // the order may have waited for approval, and starting the clock then could
  // burn the whole trial — or expire it outright — before the infrastructure
  // existed. The duration is re-read from the offering rather than snapshotted on
  // the order, so a duration an admin corrected while the order was pending is
  // the one that applies.
  let trialDurationMinutes = 0
  if (order.isTrial) {
    const [offering] = await db
      .select({ trialDurationMinutes: productEnvironments.trialDurationMinutes })
      .from(productEnvironments)
      .where(
        and(
          eq(productEnvironments.productId, order.productId),
          eq(productEnvironments.environmentId, order.environmentId),
        ),
      )
      .limit(1)
    // An offering withdrawn or with a nonsense duration while the order was
    // pending falls back to the schema default rather than blocking an approval
    // an admin already decided on — the trial is still torn down.
    trialDurationMinutes = offering && offering.trialDurationMinutes > 0 ? offering.trialDurationMinutes : 30
  }

  const triggerVars = {
    ...(order.parameters as Record<string, string>),
    ORDER_ID: String(order.id),
    ...(order.isTrial ? trialVariables(trialDurationMinutes) : {}),
  }
  let pipelineIds: string[]
  try {
    const webhookIds = await triggerProductWebhooks(order.productId, order.environmentId, triggerVars)
    const stackIds = await triggerPipelineStacks(order.productId, order.environmentId, triggerVars)
    pipelineIds = [...webhookIds, ...stackIds]
  } catch (e) {
    // Provisioning could not be started — release the claim so it can be retried.
    await db
      .update(orders)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(eq(orders.id, orderId))
    throw e
  }

  await db
    .update(orders)
    .set({ pipelineId: pipelineIds, updatedAt: new Date() })
    .where(eq(orders.id, orderId))

  const [infra] = await db
    .insert(infrastructureElements)
    .values({
      orderId: order.id,
      projectId: order.projectId,
      environmentId: order.environmentId,
      productId: order.productId,
      status: 'active',
      parameters: order.parameters as Record<string, string>,
      pipelineId: pipelineIds,
      // The scheduled-decommission sweep (issue #30) tears the trial down, so a
      // trial needs no expiry mechanism of its own.
      ...(order.isTrial ? { scheduledDecommissionAt: trialExpiry(trialDurationMinutes) } : {}),
    })
    .returning()

  await logAudit(session.id, 'order.approved', order.id, `Order approved by ${session.email}`)

  const email = await findUserEmail(order.userId)
  const productName = await findProductName(order.productId)
  if (email) {
    await sendOrderApproved(email, productName, order.id)
  }

  return ok({ success: true as const, infraId: infra.id, pipelineIds })
}

export const rejectOrder = async (
  session: SessionUser,
  orderId: number,
  rejectionNote: string,
): Promise<Result<void>> => {
  // Atomically transition pending → rejected so a concurrent approve/reject
  // (or double submit) on the same order can't both take effect.
  const rejected = await db
    .update(orders)
    .set({ status: 'rejected', rejectionNote, updatedAt: new Date() })
    .where(sql`${orders.id} = ${orderId} AND ${orders.status} = 'pending'`)
    .returning()

  if (!rejected.length) {
    const existing = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
    return existing.length ? err(400, 'Order is not pending') : err(404, 'Order not found')
  }

  const order = rejected[0]

  await logAudit(session.id, 'order.rejected', order.id, `Rejected: ${rejectionNote}`)

  const email = await findUserEmail(order.userId)
  const productName = await findProductName(order.productId)
  if (email) {
    await sendOrderRejected(email, productName, order.id, rejectionNote)
  }

  return ok(undefined)
}
