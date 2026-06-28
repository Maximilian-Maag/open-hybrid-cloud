import type { PipelineEvent } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { orders, infrastructureElements } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import {
  sendProvisioningCompleted,
  sendProvisioningFailed,
  sendDecommissioned,
} from '@/lib/notification'
import { fetchJobTrace, parseTofuOutputs } from '@/lib/ci'
import { findProductName, findUserEmail, findCiSourceForEnv, findAdminEmails } from '@/lib/db/queries'

export const handlePipelineEvent = async (event: PipelineEvent): Promise<void> => {
  const pipelineIdJson = JSON.stringify([event.pipelineId])

  const matchingOrders = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      productId: orders.productId,
      environmentId: orders.environmentId,
    })
    .from(orders)
    .where(
      sql`${orders.status} = 'provisioning' AND ${orders.pipelineId} @> ${pipelineIdJson}::jsonb`,
    )

  const matchingInfra = await db
    .select({
      id: infrastructureElements.id,
      orderId: infrastructureElements.orderId,
      productId: infrastructureElements.productId,
      environmentId: infrastructureElements.environmentId,
    })
    .from(infrastructureElements)
    .where(
      sql`${infrastructureElements.status} = 'decommissioning' AND ${infrastructureElements.pipelineId} @> ${pipelineIdJson}::jsonb`,
    )

  if (event.status === 'success') {
    for (const order of matchingOrders) {
      await db
        .update(orders)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(orders.id, order.id))

      await logAudit(null, 'order.completed', order.id, `Pipeline ${event.pipelineId} succeeded`)

      const infraElements = await db
        .select({ id: infrastructureElements.id })
        .from(infrastructureElements)
        .where(eq(infrastructureElements.orderId, order.id))
        .limit(1)

      const productName = await findProductName(order.productId)
      const infraId = infraElements[0]?.id ?? order.id
      const email = await findUserEmail(order.userId)

      if (email) {
        await sendProvisioningCompleted(email, productName, infraId)
      }

      if (infraElements.length > 0) {
        try {
          const ciSource = await findCiSourceForEnv(order.environmentId)
          if (ciSource) {
            const trace = await fetchJobTrace(ciSource, event.pipelineId)
            const outputs = parseTofuOutputs(trace)
            if (Object.keys(outputs).length > 0) {
              await db
                .update(infrastructureElements)
                .set({ outputs })
                .where(eq(infrastructureElements.id, infraElements[0].id))
            }
          }
        } catch (err) {
          console.error('[webhook] Failed to fetch/parse job trace:', err)
        }
      }
    }

    for (const infra of matchingInfra) {
      await db
        .update(infrastructureElements)
        .set({ status: 'decommissioned' })
        .where(eq(infrastructureElements.id, infra.id))

      await logAudit(
        null,
        'infra.decommissioned',
        infra.id,
        `Pipeline ${event.pipelineId} succeeded`,
      )

      const orderRows = await db
        .select({ userId: orders.userId })
        .from(orders)
        .where(eq(orders.id, infra.orderId))
        .limit(1)

      if (orderRows[0]) {
        const email = await findUserEmail(orderRows[0].userId)
        const productName = await findProductName(infra.productId)
        if (email) {
          await sendDecommissioned(email, productName, infra.id)
        }
      }
    }
  } else if (event.status === 'failed' || event.status === 'canceled') {
    for (const order of matchingOrders) {
      await db
        .update(orders)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(orders.id, order.id))

      await logAudit(
        null,
        'order.failed',
        order.id,
        `Pipeline ${event.pipelineId} ${event.status}`,
      )

      const email = await findUserEmail(order.userId)
      const productName = await findProductName(order.productId)
      if (email) {
        await sendProvisioningFailed(email, productName, order.id)
      }

      const adminEmails = await findAdminEmails()
      for (const adminEmail of adminEmails) {
        if (adminEmail !== email) {
          await sendProvisioningFailed(adminEmail, productName, order.id)
        }
      }
    }

    for (const infra of matchingInfra) {
      await db
        .update(infrastructureElements)
        .set({ status: 'active' })
        .where(eq(infrastructureElements.id, infra.id))

      await logAudit(
        null,
        'infra.decommission_failed',
        infra.id,
        `Pipeline ${event.pipelineId} ${event.status}`,
      )
    }
  }
}
