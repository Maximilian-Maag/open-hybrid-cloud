import { db } from '@/lib/db/client'
import {
  deploymentEnvironments,
  ciSources,
  infrastructureElements,
  productEnvironments,
  productWebhooks,
  orders,
  type DeploymentEnvironment,
} from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'
import { randomBytes } from 'node:crypto'

// Portal-generated shared secret sent as the X-Gitlab-Token header of the
// pipeline event webhook. 32 bytes → 64 hex chars, matches Linode-style
// tokens and is comfortably URL-safe. Prefix `ohc-cb-` so it's obvious what
// this is if it shows up in a log or a copy-paste error.
export const generateCallbackSecret = (): string => `ohc-cb-${randomBytes(32).toString('hex')}`

export interface CreateEnvironmentInput {
  name: string
  description?: string
  ciSourceId: number
  webhookUrl: string
  webhookToken: string
}

export interface UpdateEnvironmentInput {
  name?: string
  description?: string
  ciSourceId?: number
  webhookUrl?: string
  webhookToken?: string
}

// Column projection for a deployment environment — everything EXCEPT the inbound
// callback secret. That secret is revealed only through the root-only
// getCallbackSecret/regenerateCallbackSecret endpoints, never leaked from the
// general create/get/update/list paths.
//
// It still selects the OUTBOUND webhook_token, which `toPublic` strips before the
// row leaves this module: see below for why the two are handled differently.
const environmentColumns = {
  id: deploymentEnvironments.id,
  name: deploymentEnvironments.name,
  description: deploymentEnvironments.description,
  ciSourceId: deploymentEnvironments.ciSourceId,
  webhookUrl: deploymentEnvironments.webhookUrl,
  webhookToken: deploymentEnvironments.webhookToken,
}

export type PublicEnvironment = Omit<DeploymentEnvironment, 'callbackSecret' | 'webhookToken'> & {
  /**
   * Whether an outbound trigger token is configured — NOT the token itself.
   *
   * webhook_token is the credential that lets its holder fire arbitrary pipelines
   * in the CI project, and it used to come back in cleartext from every admin-level
   * read while the inbound callback_secret was correctly root-gated: the more
   * dangerous of the two, at the lower role (issue #144). An admin managing an
   * environment needs to know a token is set, and can always replace it through
   * updateEnvironment — neither needs the current value.
   */
  webhookTokenSet: boolean
}

export interface EnvironmentRow extends PublicEnvironment {
  ciSourceName: string | null
}

/**
 * Drop the outbound trigger token, keeping the one fact a caller needs about it.
 *
 * Done in JS rather than as a SQL projection because the boolean is derived from
 * the column — but the token never leaves this function either way, and every
 * public return path in this module goes through it.
 */
const toPublic = <T extends { webhookToken: string }>(
  row: T,
): Omit<T, 'webhookToken'> & { webhookTokenSet: boolean } => {
  const { webhookToken, ...rest } = row
  return { ...rest, webhookTokenSet: webhookToken !== '' }
}

export const listEnvironments = async (): Promise<Result<EnvironmentRow[]>> => {
  const rows = await db
    .select({ ...environmentColumns, ciSourceName: ciSources.name })
    .from(deploymentEnvironments)
    .leftJoin(ciSources, eq(deploymentEnvironments.ciSourceId, ciSources.id))
    .orderBy(deploymentEnvironments.name)

  return ok(rows.map(toPublic) as EnvironmentRow[])
}

export const createEnvironment = async (
  input: CreateEnvironmentInput,
): Promise<Result<PublicEnvironment>> => {
  const [env] = await db
    .insert(deploymentEnvironments)
    .values({
      name: input.name,
      description: input.description ?? '',
      ciSourceId: input.ciSourceId,
      webhookUrl: input.webhookUrl,
      webhookToken: input.webhookToken,
      // Portal generates the callback secret; the operator can never set it
      // directly (only reveal or regenerate afterwards).
      callbackSecret: generateCallbackSecret(),
    })
    // Never return callback_secret here — it is only revealed via the
    // dedicated root-only endpoints.
    .returning(environmentColumns)

  return ok(toPublic(env))
}

export const getCallbackSecret = async (id: number): Promise<Result<{ callbackSecret: string }>> => {
  const rows = await db
    .select({ callbackSecret: deploymentEnvironments.callbackSecret })
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, id))
    .limit(1)
  if (!rows.length) return err(404, 'Not found')
  return ok({ callbackSecret: rows[0].callbackSecret })
}

export const regenerateCallbackSecret = async (
  id: number,
): Promise<Result<{ callbackSecret: string }>> => {
  const next = generateCallbackSecret()
  const [updated] = await db
    .update(deploymentEnvironments)
    .set({ callbackSecret: next })
    .where(eq(deploymentEnvironments.id, id))
    .returning({ id: deploymentEnvironments.id, callbackSecret: deploymentEnvironments.callbackSecret })
  if (!updated) return err(404, 'Not found')
  return ok({ callbackSecret: updated.callbackSecret })
}

export const getEnvironmentById = async (id: number): Promise<Result<PublicEnvironment>> => {
  const rows = await db
    .select(environmentColumns)
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, id))
    .limit(1)

  if (!rows.length) return err(404, 'Not found')
  return ok(toPublic(rows[0]))
}

export const updateEnvironment = async (
  id: number,
  input: UpdateEnvironmentInput,
): Promise<Result<PublicEnvironment>> => {
  const [updated] = await db
    .update(deploymentEnvironments)
    .set(input)
    .where(eq(deploymentEnvironments.id, id))
    .returning(environmentColumns)

  if (!updated) return err(404, 'Not found')
  return ok(toPublic(updated))
}

export const deleteEnvironment = async (id: number): Promise<Result<void>> => {
  // Serialize the reference checks and the DELETE in one transaction, holding a
  // FOR UPDATE lock on the environment row. A concurrent insert of a referencing
  // row takes a FK KEY-SHARE lock on the same row, so it can't slip in between
  // the pre-check and the delete (which would resurrect the 500 this guards).
  return db.transaction(async (tx): Promise<Result<void>> => {
    const existing = await tx
      .select({ id: deploymentEnvironments.id })
      .from(deploymentEnvironments)
      .where(eq(deploymentEnvironments.id, id))
      .for('update')
      .limit(1)
    if (!existing.length) return err(404, 'Not found')

    // Refuse when ANY non-cascading FK still references this env — the previous
    // silent 500 (FK violation) was the frontend's "Delete does nothing"
    // symptom. infrastructure_elements, product_environments, product_webhooks
    // and orders all reference deployment_environments without ON DELETE
    // CASCADE. Checks run sequentially since they share the tx connection.
    const infraRefs = await tx.select({ id: infrastructureElements.id }).from(infrastructureElements).where(eq(infrastructureElements.environmentId, id))
    const prodEnvRefs = await tx.select({ productId: productEnvironments.productId }).from(productEnvironments).where(eq(productEnvironments.environmentId, id))
    const webhookRefs = await tx.select({ id: productWebhooks.id }).from(productWebhooks).where(eq(productWebhooks.environmentId, id))
    const orderRefs = await tx.select({ id: orders.id }).from(orders).where(eq(orders.environmentId, id))

    const blockers: string[] = []
    if (infraRefs.length > 0) blockers.push(`${infraRefs.length} infrastructure element(s)`)
    if (prodEnvRefs.length > 0) blockers.push(`${prodEnvRefs.length} product-environment offering(s)`)
    if (webhookRefs.length > 0) blockers.push(`${webhookRefs.length} product webhook(s)`)
    if (orderRefs.length > 0) blockers.push(`${orderRefs.length} order(s)`)

    if (blockers.length > 0) {
      return err(
        409,
        `Cannot delete environment: ${blockers.join(', ')} still reference it. Remove them first.`,
      )
    }

    const deleted = await tx
      .delete(deploymentEnvironments)
      .where(eq(deploymentEnvironments.id, id))
      .returning({ id: deploymentEnvironments.id })

    if (!deleted.length) return err(404, 'Not found')
    return ok(undefined)
  })
}
