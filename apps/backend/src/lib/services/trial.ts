import { db } from '@/lib/db/client'
import { productEnvironments } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'

/**
 * Time-boxed trials (issue #1).
 *
 * The issue reads "test a 1ClickApp for 30 minutes with Admin priv". "Admin priv"
 * is elevated rights INSIDE the provisioned app, not a portal privilege: the
 * portal cannot grant rights in someone else's Terraform, so it passes the intent
 * to CI and the product's pipeline decides what to do with it.
 *
 * A trial therefore does NOT bypass the approval workflow — a project manager's
 * trial still needs an Admin to approve it. Making trials self-service would turn
 * every trial-enabled product into a way around approval entirely, which is the
 * one thing a procurement portal cannot allow.
 */

/** Variable name a product's pipeline keys elevated-rights provisioning off. */
export const TRIAL_VAR = 'TRIAL'
/** How long the trial is meant to live, for a pipeline that wants to enforce it too. */
export const TRIAL_DURATION_VAR = 'TRIAL_DURATION_MINUTES'

export interface TrialOffering {
  trialEnabled: boolean
  trialDurationMinutes: number
}

/**
 * Confirm the offering actually allows trials, and return its duration.
 *
 * Called on the order path so a direct POST cannot request a trial of a product
 * that was never opted in — the toggle is hidden in the browser, which is not a
 * control.
 */
export const resolveTrial = async (
  productId: number,
  environmentId: number,
): Promise<Result<TrialOffering>> => {
  const [offering] = await db
    .select({
      trialEnabled: productEnvironments.trialEnabled,
      trialDurationMinutes: productEnvironments.trialDurationMinutes,
    })
    .from(productEnvironments)
    .where(
      and(
        eq(productEnvironments.productId, productId),
        eq(productEnvironments.environmentId, environmentId),
      ),
    )
    .limit(1)

  if (!offering) return err(400, 'Product is not offered in the selected environment')
  if (!offering.trialEnabled) {
    return err(400, 'This product is not available as a trial in the selected environment')
  }
  if (offering.trialDurationMinutes <= 0) {
    // A non-positive duration would schedule the teardown at or before the moment
    // of provisioning, so the trial would be swept away before it came up.
    return err(400, 'The trial duration configured for this environment is not usable')
  }

  return ok(offering)
}

/**
 * CI variables that mark a run as a trial.
 *
 * Merged into the trigger variables for both provisioning paths. A product whose
 * pipeline ignores them simply gets an ordinary deployment that is torn down
 * again when the trial expires — the portal-side time-boxing works either way.
 */
export const trialVariables = (durationMinutes: number): Record<string, string> => ({
  [TRIAL_VAR]: 'true',
  [TRIAL_DURATION_VAR]: String(durationMinutes),
})

/**
 * When a trial provisioned now should be torn down.
 *
 * The clock starts at PROVISIONING, not at ordering: a project manager's order
 * waits for approval, and starting the clock then could burn the whole trial — or
 * expire it outright — before the infrastructure existed.
 */
export const trialExpiry = (durationMinutes: number, from: Date = new Date()): Date =>
  new Date(from.getTime() + durationMinutes * 60_000)
