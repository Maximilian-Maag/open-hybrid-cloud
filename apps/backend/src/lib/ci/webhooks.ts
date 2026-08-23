import { db } from '@/lib/db/client'
import { productWebhooks, pipelineStacks, deploymentEnvironments } from '@/lib/db/schema'
import { sql, eq, and } from 'drizzle-orm'
import { findCiSourceForEnv } from '@/lib/db/queries'
import { triggerPipeline } from './index'
import { ELEMENT_SEQUENCE_VAR, elementStateSuffix } from './stateKey'

/**
 * Result of fanning a trigger out over every configured webhook/stack.
 *
 * A single failing trigger must not abort the others (one broken stack should
 * not block the rest of a teardown), so failures are collected instead of
 * thrown. Callers that only provision can ignore them — a failed provision
 * surfaces as an order that never completes — but the teardown paths MUST
 * inspect `failures`: they delete or terminally transition their tracking rows,
 * so a swallowed failure there means infrastructure leaks with no record of it.
 */
export interface TriggerOutcome {
  /** Pipeline ids that were successfully started. */
  pipelineIds: string[]
  /** One human-readable entry per configured trigger that could not be started. */
  failures: string[]
}

export const triggerPipelineStacksTracked = async (
  productId: number,
  environmentId: number,
  variables: Record<string, string>,
): Promise<TriggerOutcome> => {
  const ciSource = await findCiSourceForEnv(environmentId)
  if (!ciSource) return { pipelineIds: [], failures: [] }

  // Stack rows carry their JSON step definition; the trigger URL + token are
  // owned by the deployment environment (single source of truth — see
  // migration 0003_stack_inherits_env_webhook.sql for the history).
  const [env] = await db
    .select({ webhookUrl: deploymentEnvironments.webhookUrl, webhookToken: deploymentEnvironments.webhookToken })
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, environmentId))
    .limit(1)
  if (!env) return { pipelineIds: [], failures: [] }

  const stacks = await db
    .select()
    .from(pipelineStacks)
    .where(and(eq(pipelineStacks.productId, productId), eq(pipelineStacks.environmentId, environmentId)))

  const pipelineIds: string[] = []
  const failures: string[] = []
  // Appended to whichever base the state key is derived from, so two elements of
  // one order never share a state file — including when the base comes from the
  // stack's own stateKeyParam, which is a user-supplied parameter and therefore
  // identical across the elements of one line.
  const suffix = elementStateSuffix(variables[ELEMENT_SEQUENCE_VAR])
  for (const stack of stacks) {
    if (!stack.steps || (stack.steps as unknown[]).length === 0) continue
    const stateKeyBase = variables[stack.stateKeyParam] ?? variables['ORDER_ID'] ?? ''
    // Never suffix an empty base: `-2` on its own is not a state name, and an
    // empty TF_STATE_NAME is the existing signal that nothing identified a state.
    const tfStateName = stateKeyBase === '' ? '' : `${stateKeyBase}${suffix}`
    try {
      const pid = await triggerPipeline(ciSource, env.webhookUrl, env.webhookToken, {
        ...variables,
        TEMPLATE: 'orchestrator',
        TF_STATE_NAME: tfStateName,
        PIPELINE_STACK: JSON.stringify(stack.steps),
      })
      pipelineIds.push(pid)
    } catch (err) {
      console.error('[ci] Pipeline stack trigger failed:', err)
      failures.push(`pipeline stack "${stack.name}" (#${stack.id}): ${errMessage(err)}`)
    }
  }
  return { pipelineIds, failures }
}

export const triggerProductWebhooksTracked = async (
  productId: number,
  environmentId: number,
  variables: Record<string, string>,
): Promise<TriggerOutcome> => {
  const ciSource = await findCiSourceForEnv(environmentId)
  if (!ciSource) return { pipelineIds: [], failures: [] }

  const webhooks = await db
    .select()
    .from(productWebhooks)
    .where(
      sql`${productWebhooks.productId} = ${productId} AND ${productWebhooks.environmentId} = ${environmentId}`,
    )
    .orderBy(productWebhooks.execOrder)

  const pipelineIds: string[] = []
  const failures: string[] = []
  for (const wh of webhooks) {
    try {
      const pid = await triggerPipeline(ciSource, wh.webhookUrl, wh.webhookToken, variables)
      pipelineIds.push(pid)
    } catch (err) {
      console.error('[ci] Pipeline trigger failed:', err)
      failures.push(`product webhook "${wh.name}" (#${wh.id}): ${errMessage(err)}`)
    }
  }
  return { pipelineIds, failures }
}

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Pipeline-ids-only wrappers for the provisioning paths, which have no action to
 * take on a partial failure beyond what the order's pipeline tracking already
 * records. Teardown paths use the *Tracked variants above instead.
 */
export const triggerProductWebhooks = async (
  productId: number,
  environmentId: number,
  variables: Record<string, string>,
): Promise<string[]> =>
  (await triggerProductWebhooksTracked(productId, environmentId, variables)).pipelineIds

export const triggerPipelineStacks = async (
  productId: number,
  environmentId: number,
  variables: Record<string, string>,
): Promise<string[]> =>
  (await triggerPipelineStacksTracked(productId, environmentId, variables)).pipelineIds
