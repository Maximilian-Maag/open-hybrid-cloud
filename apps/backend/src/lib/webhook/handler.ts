import type { PipelineEvent } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { orders, infrastructureElements } from '@/lib/db/schema'
import { eq, sql, inArray } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import {
  sendProvisioningCompleted,
  sendProvisioningFailed,
  sendDecommissioned,
} from '@/lib/notification'
import { fetchJobTraces, parseTofuOutputs, supportsJobTrace } from '@/lib/ci'
import { findProductName, findUserEmail, findCiSourceForEnv, findAdminEmails } from '@/lib/db/queries'

export const handlePipelineEvent = async (
  event: PipelineEvent,
  environmentId: number,
): Promise<void> => {
  const pipelineIdJson = JSON.stringify([event.pipelineId])

  // Scope the match to the environment whose callback secret authenticated this
  // request. A pipeline id is only unique within a CI source/environment, and
  // (more importantly) env A's secret must never be able to transition an
  // order/infra element that belongs to env B.
  const matchingOrders = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      productId: orders.productId,
      environmentId: orders.environmentId,
      pipelineId: orders.pipelineId,
      pipelineStatus: orders.pipelineStatus,
    })
    .from(orders)
    .where(
      sql`${orders.status} = 'provisioning' AND ${orders.environmentId} = ${environmentId} AND ${orders.pipelineId} @> ${pipelineIdJson}::jsonb`,
    )

  const matchingInfra = await db
    .select({
      id: infrastructureElements.id,
      orderId: infrastructureElements.orderId,
      productId: infrastructureElements.productId,
      environmentId: infrastructureElements.environmentId,
      pipelineId: infrastructureElements.pipelineId,
      pipelineStatus: infrastructureElements.pipelineStatus,
    })
    .from(infrastructureElements)
    .where(
      sql`${infrastructureElements.status} = 'decommissioning' AND ${infrastructureElements.environmentId} = ${environmentId} AND ${infrastructureElements.pipelineId} @> ${pipelineIdJson}::jsonb`,
    )

  if (event.status === 'success') {
    for (const order of matchingOrders) {
      // Merge this pipeline's success into the JSONB map atomically: `||` is a
      // single UPDATE, so two concurrent success events can't lose each other's
      // keys (read-modify-write would). Guard on the order still being
      // 'provisioning' so a stale event can't resurrect a terminal order.
      const successPatch = JSON.stringify({ [event.pipelineId]: 'success' })
      const merged = await db
        .update(orders)
        .set({
          pipelineStatus: sql`${orders.pipelineStatus} || ${successPatch}::jsonb`,
          updatedAt: new Date(),
        })
        .where(sql`${orders.id} = ${order.id} AND ${orders.status} = 'provisioning'`)
        .returning({ pipelineId: orders.pipelineId, pipelineStatus: orders.pipelineStatus })

      if (!merged.length) continue // already terminal — ignore stale/duplicate event

      // Only complete the order once EVERY pipeline that belongs to it has
      // succeeded (multi-pipeline products: webhooks + stacks).
      const statusMap = merged[0].pipelineStatus
      const allSucceeded =
        merged[0].pipelineId.every((pid) => statusMap[pid] === 'success') &&
        // Also require every recorded entry to be a success, mirroring the infra
        // branch below. A trigger that never started contributes no pipeline id
        // but does leave a `trigger-failed:*` sentinel (see retryProvisioning),
        // so without this the order would complete as soon as the pipelines that
        // DID start succeed — reporting a fully provisioned order while one
        // webhook or stack was never fired at all.
        Object.values(statusMap).every((status) => status === 'success')
      if (!allSucceeded) continue

      // Compare-and-swap: only the caller that flips provisioning → completed
      // runs the terminal effects (audit, email, outputs), so concurrent final
      // events don't double-notify.
      const completed = await db
        .update(orders)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(sql`${orders.id} = ${order.id} AND ${orders.status} = 'provisioning'`)
        .returning({ id: orders.id })
      if (!completed.length) continue

      await logAudit(null, 'order.completed', order.id, `Pipeline ${event.pipelineId} succeeded`)

      // Every element of the order, not one of them: the outputs below are written
      // to all of them, and a `.limit(1)` here meant an order that provisioned
      // several had its outputs land on whichever row Postgres returned first.
      const infraElements = await db
        .select({ id: infrastructureElements.id })
        .from(infrastructureElements)
        .where(eq(infrastructureElements.orderId, order.id))

      const productName = await findProductName(order.productId)
      const infraId = infraElements[0]?.id ?? order.id
      const email = await findUserEmail(order.userId)

      if (email) {
        await sendProvisioningCompleted(email, productName, infraId)
      }

      if (infraElements.length > 0) {
        try {
          const ciSource = await findCiSourceForEnv(order.environmentId)
          if (!ciSource) {
            console.warn(`[webhook] No CI source for environment ${order.environmentId}; no outputs recorded.`)
          } else if (!supportsJobTrace(ciSource.provider)) {
            // Said out loud rather than silently producing an element with no
            // outputs, which looked like a template that declared none.
            console.warn(
              `[webhook] Reading job logs is not implemented for ${ciSource.provider}; ` +
                `order ${order.id} will have no Terraform outputs. See lib/ci/index.ts supportsJobTrace.`,
            )
          } else if (!ciSource.projectRef) {
            // GitLab's job endpoints are project-scoped and the project is only
            // named in the environment's trigger URL, so a URL of another shape
            // means the log cannot be located at all. An operator can fix this, but
            // only if they are told.
            console.warn(
              `[webhook] Cannot tell which GitLab project environment ${order.environmentId} triggers ` +
                `(its webhook URL has no /projects/<id>/ segment); order ${order.id} will have no ` +
                `Terraform outputs.`,
            )
          } else {
            // Every pipeline of the order, not only the one whose event completed
            // it: an order fans out over the product's webhooks and pipeline stacks,
            // and reading just `event.pipelineId` meant the other pipelines' outputs
            // were dropped — with which set survived decided by CI timing (#121).
            const outputs: Record<string, string> = {}
            for (const pipelineId of merged[0].pipelineId) {
              let traces: string[]
              try {
                traces = await fetchJobTraces(ciSource, pipelineId)
              } catch (err) {
                // One unreadable pipeline log must not cost the outputs of the
                // pipelines that did report.
                console.error(
                  `[webhook] Could not read the job log of pipeline ${pipelineId} (order ${order.id}):`,
                  err,
                )
                continue
              }
              for (const trace of traces) {
                for (const [key, value] of Object.entries(parseTofuOutputs(trace))) {
                  // First writer wins, iterating the pipeline ids in the order they
                  // were triggered: two pipelines that both declare `ip_address` are
                  // a naming collision in the templates, and picking by CI timing
                  // would make the recorded value change from run to run.
                  if (key in outputs) {
                    if (outputs[key] !== value) {
                      console.warn(
                        `[webhook] Order ${order.id}: output "${key}" is reported by more than one ` +
                          `pipeline with different values; keeping the first.`,
                      )
                    }
                    continue
                  }
                  outputs[key] = value
                }
              }
            }

            if (Object.keys(outputs).length > 0) {
              // Every element of the order, not just the first: an order that
              // provisioned several left the rest empty for no reason a user could
              // see. One statement, so a concurrent event cannot half-apply it.
              await db
                .update(infrastructureElements)
                .set({ outputs })
                .where(
                  inArray(
                    infrastructureElements.id,
                    infraElements.map((el) => el.id),
                  ),
                )
            } else {
              console.warn(`[webhook] No job log of order ${order.id} contained an Outputs block.`)
            }
          }
        } catch (err) {
          console.error('[webhook] Failed to fetch/parse job trace:', err)
        }
      }
    }

    for (const infra of matchingInfra) {
      // Same all-pipelines rule as orders: a teardown can fan out to several
      // pipelines (product webhooks + pipeline stacks), so merge this one's
      // success into the JSONB map (`||` is a single atomic UPDATE, so
      // concurrent events can't lose each other's keys) and only flip the
      // element to 'decommissioned' once EVERY pipeline it is waiting on has
      // succeeded. Guard on 'decommissioning' so a stale event can't resurrect
      // an already-terminal element.
      const successPatch = JSON.stringify({ [event.pipelineId]: 'success' })
      const merged = await db
        .update(infrastructureElements)
        .set({ pipelineStatus: sql`${infrastructureElements.pipelineStatus} || ${successPatch}::jsonb` })
        .where(
          sql`${infrastructureElements.id} = ${infra.id} AND ${infrastructureElements.status} = 'decommissioning'`,
        )
        .returning({
          pipelineId: infrastructureElements.pipelineId,
          pipelineStatus: infrastructureElements.pipelineStatus,
        })

      if (!merged.length) continue // already terminal — ignore stale/duplicate event

      const statusMap = merged[0].pipelineStatus
      const allSucceeded =
        merged[0].pipelineId.every((pid) => statusMap[pid] === 'success') &&
        // Also require every recorded entry to be a success. A destroy trigger
        // that never started contributes no pipeline id but does leave a
        // `trigger-failed:*` sentinel (see fireDestroyTriggers), so this is what
        // stops a partially-fired teardown from reporting itself complete.
        Object.values(statusMap).every((status) => status === 'success')
      if (!allSucceeded) continue

      // Compare-and-swap so only the caller that flips decommissioning →
      // decommissioned runs the terminal effects (audit, notification).
      const done = await db
        .update(infrastructureElements)
        .set({ status: 'decommissioned' })
        .where(
          sql`${infrastructureElements.id} = ${infra.id} AND ${infrastructureElements.status} = 'decommissioning'`,
        )
        .returning({ id: infrastructureElements.id })
      if (!done.length) continue

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
      // A single failed/canceled pipeline fails the whole order immediately,
      // regardless of how many siblings already succeeded. Guard on
      // 'provisioning' (compare-and-swap) so a stale failure can't overwrite a
      // completed order and re-send notifications, and merge the status
      // atomically to avoid losing concurrent updates.
      const failPatch = JSON.stringify({ [event.pipelineId]: event.status })
      const failed = await db
        .update(orders)
        .set({
          status: 'failed',
          pipelineStatus: sql`${orders.pipelineStatus} || ${failPatch}::jsonb`,
          updatedAt: new Date(),
        })
        .where(sql`${orders.id} = ${order.id} AND ${orders.status} = 'provisioning'`)
        .returning({ id: orders.id })

      if (!failed.length) continue // already terminal — ignore stale/duplicate event

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
      // Record the failure in the per-pipeline map so a sibling pipeline's
      // later success can never satisfy the all-succeeded check and report the
      // teardown as complete. The element deliberately stays 'decommissioning'
      // — there is no terminal failure status, and leaving it non-'active'
      // keeps it out of service while flagging it for manual attention.
      const failPatch = JSON.stringify({ [event.pipelineId]: event.status })
      await db
        .update(infrastructureElements)
        .set({ pipelineStatus: sql`${infrastructureElements.pipelineStatus} || ${failPatch}::jsonb` })
        .where(
          sql`${infrastructureElements.id} = ${infra.id} AND ${infrastructureElements.status} = 'decommissioning'`,
        )

      await logAudit(
        null,
        'infra.decommission_failed',
        infra.id,
        `Pipeline ${event.pipelineId} ${event.status}`,
      )
    }
  }
}
