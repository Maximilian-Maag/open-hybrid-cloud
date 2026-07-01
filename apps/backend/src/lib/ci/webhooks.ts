import { db } from '@/lib/db/client'
import { productWebhooks } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { findCiSourceForEnv } from '@/lib/db/queries'
import { triggerPipeline } from './index'

export const triggerProductWebhooks = async (
  productId: number,
  environmentId: number,
  variables: Record<string, string>,
): Promise<string[]> => {
  const ciSource = await findCiSourceForEnv(environmentId)
  if (!ciSource) return []

  const webhooks = await db
    .select()
    .from(productWebhooks)
    .where(
      sql`${productWebhooks.productId} = ${productId} AND ${productWebhooks.environmentId} = ${environmentId}`,
    )
    .orderBy(productWebhooks.execOrder)

  const pipelineIds: string[] = []
  for (const wh of webhooks) {
    try {
      const pid = await triggerPipeline(ciSource, wh.webhookUrl, wh.webhookToken, variables)
      pipelineIds.push(pid)
    } catch (err) {
      console.error('[ci] Pipeline trigger failed:', err)
    }
  }
  return pipelineIds
}
