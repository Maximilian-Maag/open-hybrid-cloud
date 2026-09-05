import { and, eq, lte } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  appConfig, deploymentEnvironments, deploymentWindows, holidays, orders, productEnvironments,
} from '@/lib/db/schema'
import { isWithinWindow, nextWindowStart, type WindowPolicy } from './deploymentWindows'
import { logAudit } from '@/lib/audit'

/**
 * Reading the window policy out of the database (#330).
 *
 * The arithmetic in `deploymentWindows.ts` is pure and takes its inputs; this is
 * the only place that fetches them. Keeping the two apart is what lets every
 * DST and boundary case be tested without a database, and it means the rules
 * cannot quietly start depending on a clock.
 */

/** No windows configured means no restriction — the feature is opt-in twice. */
export const loadWindowPolicy = async (): Promise<WindowPolicy> => {
  const [config] = await db.select({ zone: appConfig.deploymentTimeZone }).from(appConfig).limit(1)
  const windows = await db
    .select({ startMinute: deploymentWindows.startMinute, durationMinutes: deploymentWindows.durationMinutes })
    .from(deploymentWindows)
  const observed = await db.select({ date: holidays.date }).from(holidays).where(eq(holidays.observed, true))

  return {
    windows,
    // UTC is the column default, so this is only ever null on a database that
    // predates the column — which the migration does not leave behind.
    timeZone: config?.zone ?? 'UTC',
    holidays: new Set(observed.map((h) => h.date)),
  }
}

/**
 * What should happen to an order that has just been approved.
 *
 * `null` means provision it now, which is the answer for every environment that
 * has not opted in and every moment inside a window.
 *
 * Two switches have to be on before an order ever waits: the environment must
 * set `respectsDeploymentWindows` — default false, so an upgrade changes nothing
 * — and at least one window must be configured. A deployment that turned the
 * flag on and defined no windows would otherwise queue every order for ever,
 * which is a worse failure than not having the feature.
 */
export const whenMayItDeploy = async (
  environmentId: number,
  now: Date,
): Promise<{ scheduledFor: Date } | null> => {
  const [environment] = await db
    .select({ respects: deploymentEnvironments.respectsDeploymentWindows })
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, environmentId))
    .limit(1)

  if (!environment?.respects) return null

  const policy = await loadWindowPolicy()
  if (isWithinWindow(now, policy)) return null

  const next = nextWindowStart(now, policy)
  /*
   * `null` covers both ways a configuration can fail to open, and both answer
   * the same: provision now.
   *
   *  - No windows configured at all. The flag is on but the second half of the
   *    opt-in was never done.
   *  - Windows exist but every day within a year is excluded.
   *
   * There was an explicit `windows.length === 0` guard above this; it was
   * removed because `nextWindowStart` already returns null for that case, so
   * nothing could ever reach it — an unreachable branch is one nobody can
   * trust, and a mutant that deleted it passed every test.
   *
   * Provisioning is the lesser wrong either way: the alternative is an order
   * that waits for ever with nothing to tell its requester.
   */
  if (next === null) return null

  return { scheduledFor: next }
}

/** Scheduled orders whose window has opened, oldest first. */
export const dueScheduledOrders = async (now: Date): Promise<number[]> => {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'scheduled'), lte(orders.scheduledFor, now)))
    .orderBy(orders.scheduledFor)
  return rows.map((r) => r.id)
}

/**
 * The trial length the offering currently declares, or the schema default.
 *
 * Same fallback as the approval path: an offering withdrawn or given a nonsense
 * duration while the order waited must not block a deployment an admin already
 * approved — the trial is still torn down, just on the default clock.
 */
const trialDurationFor = async (productId: number, environmentId: number): Promise<number> => {
  const [offering] = await db
    .select({ minutes: productEnvironments.trialDurationMinutes })
    .from(productEnvironments)
    .where(and(eq(productEnvironments.productId, productId), eq(productEnvironments.environmentId, environmentId)))
    .limit(1)
  return offering && offering.minutes > 0 ? offering.minutes : 30
}

/**
 * Release every scheduled order whose window has opened.
 *
 * The claim is `scheduled -> provisioning` conditioned on the row still being
 * scheduled, so two overlapping sweeps — or a sweep racing root's override —
 * cannot both provision one order. Whoever loses gets zero rows back and skips,
 * exactly as `claimAndDestroy` does for decommissioning.
 *
 * Each order is released independently: one product whose CI is unreachable
 * must not stop the other nineteen from deploying when their window opened.
 */
export const releaseDueScheduledOrders = async (
  now: Date,
): Promise<{ released: number[]; failed: { orderId: number; reason: string }[] }> => {
  const due = await dueScheduledOrders(now)
  const released: number[] = []
  const failed: { orderId: number; reason: string }[] = []

  for (const orderId of due) {
    const claimed = await db
      .update(orders)
      .set({ status: 'provisioning', updatedAt: now })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'scheduled')))
      .returning({
        id: orders.id, projectId: orders.projectId, productId: orders.productId,
        environmentId: orders.environmentId,
        parameters: orders.parameters, sizeCode: orders.sizeCode,
        quantity: orders.quantity, isTrial: orders.isTrial,
      })

    // Someone got there first — root's override, or another replica's sweep.
    if (claimed.length === 0) continue

    const order = claimed[0]
    try {
      const { provisionOrderElements } = await import('@/lib/services/orders')
      await provisionOrderElements({
        orderId: order.id,
        projectId: order.projectId,
        productId: order.productId,
        environmentId: order.environmentId,
        parameters: order.parameters,
        sizeCode: order.sizeCode,
        quantity: order.quantity > 0 ? order.quantity : 1,
        isTrial: order.isTrial,
        // Re-read here, exactly as the approval path does, and for a sharper
        // version of the same reason: a trial's clock starts when it
        // PROVISIONS, which for a scheduled order is now rather than when it
        // was approved. Passing 0 would have given every scheduled trial a
        // zero-minute lifetime — torn down by the next decommission sweep,
        // minutes after it came up.
        trialDurationMinutes: order.isTrial ? await trialDurationFor(order.productId, order.environmentId) : 0,
      })
      await logAudit(null, 'order.window_opened', order.id, 'Deployment window opened; provisioning started')
      released.push(order.id)
    } catch (e) {
      // Back to 'scheduled' rather than 'failed': the window is still open, the
      // next sweep will try again, and an order marked failed because CI blinked
      // is one a human has to notice and redo.
      await db.update(orders).set({ status: 'scheduled', updatedAt: new Date() }).where(eq(orders.id, order.id))
      failed.push({ orderId: order.id, reason: e instanceof Error ? e.message : String(e) })
    }
  }

  return { released, failed }
}
