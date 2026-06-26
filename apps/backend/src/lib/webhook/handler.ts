import type { PipelineEvent } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import {
  orders,
  infrastructureElements,
  users,
  productTranslations,
  ciSources,
  deploymentEnvironments,
} from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import {
  sendProvisioningCompleted,
  sendProvisioningFailed,
  sendDecommissioned,
} from '@/lib/notification'
import { fetchJobTrace, parseTofuOutputs } from '@/lib/ci'

export const handlePipelineEvent = async (event: PipelineEvent): Promise<void> => {
  const pipelineIdJson = JSON.stringify([event.pipelineId])

  // Query orders in provisioning state that have this pipeline ID
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

  // Query infra elements in decommissioning state
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
    // Handle matching orders
    for (const order of matchingOrders) {
      await db
        .update(orders)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(orders.id, order.id))

      await logAudit(null, 'order.completed', order.id, `Pipeline ${event.pipelineId} succeeded`)

      // Find infra element for this order to get its ID
      const infraElements = await db
        .select({ id: infrastructureElements.id })
        .from(infrastructureElements)
        .where(eq(infrastructureElements.orderId, order.id))
        .limit(1)

      // Get user email and product name for notification
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
      const infraId = infraElements[0]?.id ?? order.id

      if (userRows[0]?.email) {
        await sendProvisioningCompleted(userRows[0].email, productName, infraId)
      }

      // Try to fetch job trace and parse outputs
      if (infraElements.length > 0) {
        try {
          // Get ci source for the environment
          const envData = await db
            .select({ ciSourceId: deploymentEnvironments.ciSourceId })
            .from(deploymentEnvironments)
            .where(eq(deploymentEnvironments.id, order.environmentId))
            .limit(1)

          if (envData[0]) {
            const ciSourceRows = await db
              .select()
              .from(ciSources)
              .where(eq(ciSources.id, envData[0].ciSourceId))
              .limit(1)

            if (ciSourceRows[0]) {
              const ciSource = {
                url: ciSourceRows[0].url,
                accessToken: ciSourceRows[0].accessToken,
                provider: ciSourceRows[0].provider as 'gitlab' | 'github' | 'bitbucket',
              }
              const trace = await fetchJobTrace(ciSource, event.pipelineId)
              const outputs = parseTofuOutputs(trace)

              if (Object.keys(outputs).length > 0) {
                await db
                  .update(infrastructureElements)
                  .set({ outputs })
                  .where(eq(infrastructureElements.id, infraElements[0].id))
              }
            }
          }
        } catch (err) {
          console.error('[webhook] Failed to fetch/parse job trace:', err)
        }
      }
    }

    // Handle matching infra (decommissioning)
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

      // Get order info for notification
      const orderRows = await db
        .select({ userId: orders.userId })
        .from(orders)
        .where(eq(orders.id, infra.orderId))
        .limit(1)

      if (orderRows[0]) {
        const userRows = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, orderRows[0].userId))
          .limit(1)

        const productNameRows = await db
          .select({ name: productTranslations.name })
          .from(productTranslations)
          .where(
            sql`${productTranslations.productId} = ${infra.productId} AND ${productTranslations.languageCode} = 'en'`,
          )
          .limit(1)

        const productName = productNameRows[0]?.name ?? `Product #${infra.productId}`

        if (userRows[0]?.email) {
          await sendDecommissioned(userRows[0].email, productName, infra.id)
        }
      }
    }
  } else if (event.status === 'failed' || event.status === 'canceled') {
    // Handle matching orders
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
        await sendProvisioningFailed(userRows[0].email, productName, order.id)
      }
    }

    // Handle matching infra — keep as decommissioning, log audit
    for (const infra of matchingInfra) {
      await logAudit(
        null,
        'infra.decommission_failed',
        infra.id,
        `Pipeline ${event.pipelineId} ${event.status}`,
      )
    }
  }
}
