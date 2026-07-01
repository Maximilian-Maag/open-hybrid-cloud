import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import {
  orders,
  infrastructureElements,
  deploymentEnvironments,
  users,
} from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { sendOrderCreated, sendApprovalRequest } from '@/lib/notification'
import { triggerProductWebhooks } from '@/lib/ci/webhooks'
import { findProductName, findUserEmail, findUserName, findAdminEmails } from '@/lib/db/queries'
import { ok, err, type Result } from '@/lib/services/result'

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

export const createOrder = async (
  session: SessionUser,
  input: CreateOrderInput,
): Promise<Result<CreatedOrder>> => {
  const { projectId, productId, environmentId, costCenterId, parameters } = input
  const isAdmin = session.role === 'admin' || session.role === 'root'

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
        costCenterId: costCenterId ?? null,
      })
      .returning()

    const pipelineIds = await triggerProductWebhooks(productId, environmentId, {
      ...parameters,
      ORDER_ID: String(order.id),
    })

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
        costCenterId: costCenterId ?? null,
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
