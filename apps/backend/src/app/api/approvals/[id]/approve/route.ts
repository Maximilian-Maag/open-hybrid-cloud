import { NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import {
  orders,
  productWebhooks,
  infrastructureElements,
  deploymentEnvironments,
  ciSources,
  users,
  productTranslations,
} from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { sendOrderApproved } from '@/lib/notification'
import { triggerPipeline } from '@/lib/ci'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const orderId = parseInt(id, 10)

  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)

  if (!orderRows.length) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const order = orderRows[0]

  if (order.status !== 'pending') {
    return NextResponse.json({ error: 'Order is not pending' }, { status: 400 })
  }

  // Get CI source for the environment
  const envRows = await db
    .select({ ciSourceId: deploymentEnvironments.ciSourceId })
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, order.environmentId))
    .limit(1)

  const ciSourceRows = envRows.length
    ? await db.select().from(ciSources).where(eq(ciSources.id, envRows[0].ciSourceId)).limit(1)
    : []

  // Load webhooks ordered by execOrder
  const webhooks = await db
    .select()
    .from(productWebhooks)
    .where(
      sql`${productWebhooks.productId} = ${order.productId} AND ${productWebhooks.environmentId} = ${order.environmentId}`,
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
          ...(order.parameters as Record<string, string>),
          ORDER_ID: String(order.id),
        })
        pipelineIds.push(pid)
      } catch (err) {
        console.error('[approve] Pipeline trigger failed:', err)
      }
    }
  }

  // Update order status
  await db
    .update(orders)
    .set({ status: 'provisioning', pipelineId: pipelineIds, updatedAt: new Date() })
    .where(eq(orders.id, orderId))

  // Create infrastructure element
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
    })
    .returning()

  await logAudit(session.id, 'order.approved', order.id, `Order approved by ${session.email}`)

  // Notify orderer
  const userRows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, order.userId))
    .limit(1)

  const productNameRows = await db
    .select({ name: productTranslations.name })
    .from(productTranslations)
    .where(
      sql`${productTranslations.productId} = ${order.productId} AND ${productTranslations.languageCode} = 'en'`,
    )
    .limit(1)

  const productName = productNameRows[0]?.name ?? `Product #${order.productId}`
  if (userRows[0]?.email) {
    await sendOrderApproved(userRows[0].email, productName, order.id)
  }

  return NextResponse.json({ success: true, infraId: infra.id, pipelineIds })
}
