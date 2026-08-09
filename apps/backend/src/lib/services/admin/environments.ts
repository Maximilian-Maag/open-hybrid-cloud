import { db } from '@/lib/db/client'
import {
  deploymentEnvironments,
  ciSources,
  infrastructureElements,
  type DeploymentEnvironment,
} from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'

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

export interface EnvironmentRow extends DeploymentEnvironment {
  ciSourceName: string | null
}

export const listEnvironments = async (): Promise<Result<EnvironmentRow[]>> => {
  const rows = await db
    .select({
      id: deploymentEnvironments.id,
      name: deploymentEnvironments.name,
      description: deploymentEnvironments.description,
      ciSourceId: deploymentEnvironments.ciSourceId,
      webhookUrl: deploymentEnvironments.webhookUrl,
      webhookToken: deploymentEnvironments.webhookToken,
      ciSourceName: ciSources.name,
    })
    .from(deploymentEnvironments)
    .leftJoin(ciSources, eq(deploymentEnvironments.ciSourceId, ciSources.id))
    .orderBy(deploymentEnvironments.name)

  return ok(rows as EnvironmentRow[])
}

export const createEnvironment = async (
  input: CreateEnvironmentInput,
): Promise<Result<DeploymentEnvironment>> => {
  const [env] = await db
    .insert(deploymentEnvironments)
    .values({
      name: input.name,
      description: input.description ?? '',
      ciSourceId: input.ciSourceId,
      webhookUrl: input.webhookUrl,
      webhookToken: input.webhookToken,
    })
    .returning()

  return ok(env)
}

export const getEnvironmentById = async (id: number): Promise<Result<DeploymentEnvironment>> => {
  const rows = await db
    .select()
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, id))
    .limit(1)

  if (!rows.length) return err(404, 'Not found')
  return ok(rows[0])
}

export const updateEnvironment = async (
  id: number,
  input: UpdateEnvironmentInput,
): Promise<Result<DeploymentEnvironment>> => {
  const [updated] = await db
    .update(deploymentEnvironments)
    .set(input)
    .where(eq(deploymentEnvironments.id, id))
    .returning()

  if (!updated) return err(404, 'Not found')
  return ok(updated)
}

export const deleteEnvironment = async (id: number): Promise<Result<void>> => {
  const existing = await db
    .select({ id: deploymentEnvironments.id })
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, id))
    .limit(1)
  if (!existing.length) return err(404, 'Not found')

  // Refuse when any infrastructure element still references this env — the
  // previous silent 500 (FK violation from Postgres) was the frontend's
  // "Delete does nothing" symptom. Return 409 with a message the UI can
  // surface directly so the operator knows to decommission first.
  const referencing = await db
    .select({ id: infrastructureElements.id })
    .from(infrastructureElements)
    .where(eq(infrastructureElements.environmentId, id))
  if (referencing.length > 0) {
    return err(
      409,
      `Cannot delete environment: ${referencing.length} infrastructure element(s) still reference it. Decommission them first.`,
    )
  }

  const deleted = await db
    .delete(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, id))
    .returning({ id: deploymentEnvironments.id })

  if (!deleted.length) return err(404, 'Not found')
  return ok(undefined)
}
