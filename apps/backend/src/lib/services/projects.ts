import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { projects, users, costCenters, infrastructureElements, type Project } from '@/lib/db/schema'
import { eq, sql, and } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'
import { triggerProductWebhooks } from '@/lib/ci/webhooks'

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
    .select({ id: infrastructureElements.id, productId: infrastructureElements.productId, environmentId: infrastructureElements.environmentId, parameters: infrastructureElements.parameters })
    .from(infrastructureElements)
    .where(and(eq(infrastructureElements.projectId, projectId), eq(infrastructureElements.status, 'active')))

  for (const infra of activeInfra) {
    await db.update(infrastructureElements).set({ status: 'decommissioning' }).where(eq(infrastructureElements.id, infra.id))
    triggerProductWebhooks(infra.productId, infra.environmentId, { ...infra.parameters, TF_ACTION: 'destroy' }).catch(console.error)
  }

  const deleted = await db.delete(projects).where(eq(projects.id, projectId)).returning({ id: projects.id })
  if (!deleted.length) return err(404, 'Project not found')
  return ok(undefined)
}
