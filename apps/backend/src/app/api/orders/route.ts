import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import {
  orders,
  productWebhooks,
  infrastructureElements,
  productTranslations,
  deploymentEnvironments,
  users,
  ciSources,
} from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { sendOrderCreated, sendApprovalRequest } from '@/lib/notification'
import { triggerPipeline } from '@/lib/ci'

const CreateOrderSchema = z.object({
  projectId: z.number().int().positive(),
  productId: z.number().int().positive(),
  environmentId: z.number().int().positive(),
  costCenterId: z.number().int().positive().optional(),
  parameters: z.record(z.string()),
})

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

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

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateOrderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { projectId, productId, environmentId, costCenterId, parameters } = parsed.data
  const isAdmin = session.role === 'admin' || session.role === 'root'

  if (isAdmin) {
    // Admins get immediate provisioning
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

    // Get CI source for this environment
    const envRows = await db
      .select({ ciSourceId: deploymentEnvironments.ciSourceId })
      .from(deploymentEnvironments)
      .where(eq(deploymentEnvironments.id, environmentId))
      .limit(1)

    const ciSourceRows = envRows.length
      ? await db.select().from(ciSources).where(eq(ciSources.id, envRows[0].ciSourceId)).limit(1)
      : []

    // Trigger webhooks in execOrder
    const webhooks = await db
      .select()
      .from(productWebhooks)
      .where(
        sql`${productWebhooks.productId} = ${productId} AND ${productWebhooks.environmentId} = ${environmentId}`,
      )
      .orderBy(productWebhooks.execOrder)

    const pipelineIds: string[] = []

    if (ciSourceRows[0]) {
      const ciSource = {
        url: ciSourceRows[0].url,
        accessToken: ciSourceRows[0].accessToken,
        provider: ciSourceRows[0].provider as 'gitlab' | 'github' | 'bitbucket',
      }
      for (const wh of webhooks) {
        try {
          const pid = await triggerPipeline(ciSource, wh.webhookUrl, wh.webhookToken, {
            ...parameters,
            ORDER_ID: String(order.id),
          })
          pipelineIds.push(pid)
        } catch (err) {
          console.error('[orders] Pipeline trigger failed:', err)
        }
      }
    }

    // Update pipeline IDs
    if (pipelineIds.length > 0) {
      await db.update(orders).set({ pipelineId: pipelineIds }).where(eq(orders.id, order.id))
    }

    // Create infra element
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

    // Notify
    const userRows = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, session.id))
      .limit(1)
    const productNameRows = await db
      .select({ name: productTranslations.name })
      .from(productTranslations)
      .where(sql`${productTranslations.productId} = ${productId} AND ${productTranslations.languageCode} = 'en'`)
      .limit(1)
    const productName = productNameRows[0]?.name ?? `Product #${productId}`
    if (userRows[0]?.email) {
      await sendOrderCreated(userRows[0].email, productName, order.id)
    }

    return NextResponse.json({ ...order, pipelineId: pipelineIds, infraId: infra.id }, { status: 201 })
  } else {
    // project_managers create pending orders
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

    // Notify orderer
    const userRows = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, session.id))
      .limit(1)
    const productNameRows = await db
      .select({ name: productTranslations.name })
      .from(productTranslations)
      .where(sql`${productTranslations.productId} = ${productId} AND ${productTranslations.languageCode} = 'en'`)
      .limit(1)
    const productName = productNameRows[0]?.name ?? `Product #${productId}`
    if (userRows[0]?.email) {
      await sendOrderCreated(userRows[0].email, productName, order.id)
    }

    // Notify admins that approval is needed
    const ordererRows = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, session.id))
      .limit(1)
    const ordererName = ordererRows[0]?.name ?? `User #${session.id}`
    const adminRows = await db
      .select({ email: users.email })
      .from(users)
      .where(sql`${users.role} IN ('admin', 'root') AND ${users.active} = true`)
    for (const admin of adminRows) {
      await sendApprovalRequest(admin.email, productName, order.id, ordererName)
    }

    return NextResponse.json(order, { status: 201 })
  }
}
