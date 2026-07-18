import { db } from '@/lib/db/client'
import { productWebhooks, pipelineStacks } from '@/lib/db/schema'
import { sql, eq, and } from 'drizzle-orm'
import { findCiSourceForEnv } from '@/lib/db/queries'
import { triggerPipeline } from './index'

export const triggerPipelineStacks = async (
  productId: number,
  environmentId: number,
  variables: Record<string, string>,
): Promise<string[]> => {
  const ciSource = await findCiSourceForEnv(environmentId)
  if (!ciSource) return []

  const stacks = await db
    .select()
    .from(pipelineStacks)
    .where(and(eq(pipelineStacks.productId, productId), eq(pipelineStacks.environmentId, environmentId)))

  const pipelineIds: string[] = []
  for (const stack of stacks) {
    if (!stack.steps || (stack.steps as unknown[]).length === 0) continue
    const tfStateName = variables[stack.stateKeyParam] ?? variables['ORDER_ID'] ?? ''
    try {
      const pid = await triggerPipeline(ciSource, stack.webhookUrl, stack.webhookToken, {
        ...variables,
        TEMPLATE: 'orchestrator',
        TF_STATE_NAME: tfStateName,
        PIPELINE_STACK: JSON.stringify(stack.steps),
      })
      pipelineIds.push(pid)
    } catch (err) {
      console.error('[ci] Pipeline stack trigger failed:', err)
    }
  }
  return pipelineIds
}

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
