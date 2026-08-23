import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { projects, users, costCenters, infrastructureElements, type Project } from '@/lib/db/schema'
import { eq, sql, and } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'
import { fireDestroyTriggers } from '@/lib/services/teardown'
import { isEmptyUpdate, EMPTY_UPDATE_MESSAGE } from '@/lib/services/updates'

export interface ProjectRow {
  id: number
  name: string
  description: string
  ownerId: number
  costCenterId: number | null
  createdAt: Date
  ownerName: string | null
  costCenterName: string | null
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  costCenterId?: number | null
}

export const listProjects = async (session: SessionUser): Promise<Result<ProjectRow[]>> => {
  const isAdmin = session.role === 'admin' || session.role === 'root'

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      ownerId: projects.ownerId,
      costCenterId: projects.costCenterId,
      createdAt: projects.createdAt,
      ownerName: users.name,
      costCenterName: costCenters.name,
    })
    .from(projects)
    .leftJoin(users, eq(projects.ownerId, users.id))
    .leftJoin(costCenters, eq(projects.costCenterId, costCenters.id))
    .where(isAdmin ? undefined : eq(projects.ownerId, session.id))
    .orderBy(sql`${projects.createdAt} DESC`)

  return ok(rows as ProjectRow[])
}

export const getProjectById = async (
  session: SessionUser,
  projectId: number,
): Promise<Result<ProjectRow>> => {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      ownerId: projects.ownerId,
      costCenterId: projects.costCenterId,
      createdAt: projects.createdAt,
      ownerName: users.name,
      costCenterName: costCenters.name,
    })
    .from(projects)
    .leftJoin(users, eq(projects.ownerId, users.id))
    .leftJoin(costCenters, eq(projects.costCenterId, costCenters.id))
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!rows.length) return err(404, 'Project not found')

  const project = rows[0] as ProjectRow
  if (session.role === 'project_manager' && project.ownerId !== session.id) {
    return err(403, 'Forbidden')
  }

  return ok(project)
}

export const createProject = async (
  session: SessionUser,
  input: { name: string; description?: string; costCenterId?: number },
): Promise<Result<Project>> => {
  const [project] = await db
    .insert(projects)
    .values({
      name: input.name,
      description: input.description ?? '',
      ownerId: session.id,
      costCenterId: input.costCenterId ?? null,
    })
    .returning()

  return ok(project)
}

export const updateProject = async (
  session: SessionUser,
  projectId: number,
  input: UpdateProjectInput,
): Promise<Result<Project>> => {
  const existing = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!existing.length) return err(404, 'Project not found')

  if (session.role === 'project_manager' && existing[0].ownerId !== session.id) {
    return err(403, 'Forbidden')
  }

  const update: Partial<UpdateProjectInput> = {}
  if (input.name !== undefined) update.name = input.name
  if (input.description !== undefined) update.description = input.description
  if (input.costCenterId !== undefined) update.costCenterId = input.costCenterId

  // A well-formed `{}` used to reach `.set({})`, where Drizzle's mapUpdateSet
  // throws "No values to set" — an unhandled 500 any project manager could hit on
  // their own project (issue #143). Checked after the ownership check so it cannot
  // be used to probe which projects exist.
  if (isEmptyUpdate(update)) return err(400, EMPTY_UPDATE_MESSAGE)

  const [updated] = await db
    .update(projects)
    .set(update)
    .where(eq(projects.id, projectId))
    .returning()

  return ok(updated)
}

export const deleteProject = async (
  session: SessionUser,
  projectId: number,
): Promise<Result<void>> => {
  // ownership check for PMs
  if (session.role === 'project_manager') {
    const existing = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId)).limit(1)
    if (!existing.length) return err(404, 'Project not found')
    if (existing[0].ownerId !== session.id) return err(403, 'Forbidden')
  }

  // fire destroy webhooks for all active infra elements
  const activeInfra = await db
    .select({ id: infrastructureElements.id, orderId: infrastructureElements.orderId, productId: infrastructureElements.productId, environmentId: infrastructureElements.environmentId, parameters: infrastructureElements.parameters })
    .from(infrastructureElements)
    .where(and(eq(infrastructureElements.projectId, projectId), eq(infrastructureElements.status, 'active')))

  // Await the destroy trigger request BEFORE deleting the project. The delete
  // cascades to infrastructure_elements (ON DELETE CASCADE); firing the webhook
  // fire-and-forget raced the cascade. NOTE: awaiting only guarantees the CI
  // system accepted the trigger — the destroy pipeline still runs asynchronously
  // afterwards, so a late failure cannot be reconciled once the rows are gone.
  const triggerFailures: string[] = []
  for (const infra of activeInfra) {
    // Atomically claim the row (active → decommissioning) so two concurrent
    // deletes can't both fire a destroy pipeline for the same element.
    const claimed = await db
      .update(infrastructureElements)
      .set({ status: 'decommissioning' })
      .where(and(eq(infrastructureElements.id, infra.id), eq(infrastructureElements.status, 'active')))
      .returning({ id: infrastructureElements.id })
    if (!claimed.length) continue
    const destroyVars = { ...infra.parameters, TF_ACTION: 'destroy', INFRA_ID: String(infra.id), ORDER_ID: String(infra.orderId) }
    try {
      // Fires destroy for BOTH product webhooks and pipeline stacks — stack-
      // provisioned infra would otherwise leak on project deletion.
      const outcome = await fireDestroyTriggers(infra, destroyVars)
      triggerFailures.push(...outcome.failures.map((f) => `infra #${infra.id}: ${f}`))
    } catch (e) {
      console.error(e)
      triggerFailures.push(`infra #${infra.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Block the delete when any destroy could not be started — the cascade would
  // remove the infrastructure_elements rows and leave the provisioned
  // infrastructure running with nothing left to reconcile it against. The
  // claimed rows keep their state, so the operator can fix the CI side and retry.
  if (triggerFailures.length > 0) {
    return err(
      502,
      `Cannot delete project: ${triggerFailures.length} destroy trigger(s) could not be started, so deleting now would leak infrastructure. Fix and retry — ${triggerFailures.join('; ')}`,
    )
  }

  const deleted = await db.delete(projects).where(eq(projects.id, projectId)).returning({ id: projects.id })
  if (!deleted.length) return err(404, 'Project not found')
  return ok(undefined)
}
