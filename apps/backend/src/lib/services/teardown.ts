import { db } from '@/lib/db/client'
import { infrastructureElements } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { triggerProductWebhooksTracked, triggerPipelineStacksTracked } from '@/lib/ci/webhooks'

export interface DestroyOutcome {
  /** Destroy pipelines that were actually started. */
  pipelineIds: string[]
  /** One entry per configured trigger that could NOT be started. Empty = clean. */
  failures: string[]
  /**
   * The element was handed back to 'active' because nothing at all started, so
   * the caller can safely report a retryable failure.
   */
  restoredToActive: boolean
}

/**
 * Fire the destroy triggers for an infrastructure element that the caller has
 * already atomically claimed (active → decommissioning), and persist what
 * happened so the outcome can never be silently lost.
 *
 * Both trigger kinds are fired: infrastructure provisioned by a pipeline stack
 * would otherwise never be torn down. Neither kind aborts on a single failure
 * (one broken stack must not block the rest of the teardown), so the caller has
 * to decide what a partial failure means for it — see `failures`.
 *
 * Three cases:
 *  - nothing failed → pipeline ids stored, teardown is trackable to completion
 *  - nothing STARTED → the element is untouched infrastructure, so it is handed
 *    back to 'active' and the caller can retry
 *  - partial → the started pipelines are stored, plus a sentinel entry per
 *    failed trigger. The sentinel matters: a failed trigger contributes no
 *    pipeline id, so without it the callback handler would flip the element to
 *    'decommissioned' as soon as the pipelines that DID start succeed —
 *    reporting a completed teardown while one stack was never destroyed.
 */
export const fireDestroyTriggers = async (
  infra: { id: number; productId: number; environmentId: number },
  variables: Record<string, string>,
): Promise<DestroyOutcome> => {
  const webhookOutcome = await triggerProductWebhooksTracked(
    infra.productId,
    infra.environmentId,
    variables,
  )
  const stackOutcome = await triggerPipelineStacksTracked(
    infra.productId,
    infra.environmentId,
    variables,
  )

  const pipelineIds = [...webhookOutcome.pipelineIds, ...stackOutcome.pipelineIds]
  const failures = [...webhookOutcome.failures, ...stackOutcome.failures]

  if (failures.length > 0 && pipelineIds.length === 0) {
    await db
      .update(infrastructureElements)
      .set({ status: 'active' })
      .where(eq(infrastructureElements.id, infra.id))
    return { pipelineIds, failures, restoredToActive: true }
  }

  const pipelineStatus: Record<string, string> = {}
  failures.forEach((failure, i) => {
    pipelineStatus[`trigger-failed:${i}`] = failure
  })

  await db
    .update(infrastructureElements)
    .set({ pipelineId: pipelineIds, pipelineStatus })
    .where(eq(infrastructureElements.id, infra.id))

  return { pipelineIds, failures, restoredToActive: false }
}
