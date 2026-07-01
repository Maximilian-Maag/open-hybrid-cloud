import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { infrastructureElements, deploymentEnvironments, projects } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { triggerProductWebhooks } from '@/lib/ci/webhooks'
import { ok, err, type Result } from '@/lib/services/result'

export interface InfraRow {
  id: number
  orderId: number
  projectId: number
  environmentId: number
  productId: number
  status: string
  parameters: Record<string, string>
  pipelineId: string[]
  outputs: Record<string, string>
  deployedAt: Date | null
  productName: string
  environmentName: string | null
  projectName: string | null
}

export const listInfrastructure = async (
  session: SessionUser,
  filters: { productId?: number; projectId?: number },
): Promise<Result<InfraRow[]>> => {
  const isAdmin = session.role === 'admin' || session.role === 'root'

  const conditions: ReturnType<typeof sql>[] = []
  if (!isAdmin) conditions.push(sql`${projects.ownerId} = ${session.id}`)
  if (filters.productId) conditions.push(sql`${infrastructureElements.productId} = ${filters.productId}`)
  if (filters.projectId) conditions.push(sql`${infrastructureElements.projectId} = ${filters.projectId}`)

  const where = conditions.length > 0
    ? conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)
    : undefined

  const rows = await db
    .select({
      id: infrastructureElements.id,
      orderId: infrastructureElements.orderId,
      projectId: infrastructureElements.projectId,
      environmentId: infrastructureElements.environmentId,
      productId: infrastructureElements.productId,
      status: infrastructureElements.status,
      parameters: infrastructureElements.parameters,
      pipelineId: infrastructureElements.pipelineId,
      outputs: infrastructureElements.outputs,
      deployedAt: infrastructureElements.deployedAt,
      productName: sql<string>`(
        SELECT name FROM product_translations
        WHERE product_id = ${infrastructureElements.productId}
          AND language_code = 'en'
        LIMIT 1
      )`,
      environmentName: deploymentEnvironments.name,
      projectName: projects.name,
    })
    .from(infrastructureElements)
    .leftJoin(
      deploymentEnvironments,
      eq(infrastructureElements.environmentId, deploymentEnvironments.id),
    )
    .leftJoin(projects, eq(infrastructureElements.projectId, projects.id))
    .where(where)
    .orderBy(sql`${infrastructureElements.deployedAt} DESC`)

  return ok(rows as InfraRow[])
}

export const decommissionInfra = async (
  session: SessionUser,
  infraId: number,
): Promise<Result<{ pipelineIds: string[] }>> => {
  const infraRows = await db
    .select()
    .from(infrastructureElements)
    .where(eq(infrastructureElements.id, infraId))
    .limit(1)

  if (!infraRows.length) return err(404, 'Infrastructure element not found')

  const infra = infraRows[0]

  if (session.role === 'project_manager') {
    const projectRows = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, infra.projectId))
      .limit(1)

    if (!projectRows.length || projectRows[0].ownerId !== session.id) {
      return err(403, 'Forbidden')
    }
  }

  if (infra.status !== 'active') return err(400, 'Infrastructure element is not active')

  const variables = {
    ...(infra.parameters as Record<string, string>),
    TF_ACTION: 'destroy',
    INFRA_ID: String(infra.id),
  }

  const pipelineIds = await triggerProductWebhooks(infra.productId, infra.environmentId, variables)

  await db
    .update(infrastructureElements)
    .set({ status: 'decommissioning', pipelineId: pipelineIds })
    .where(eq(infrastructureElements.id, infraId))

  await logAudit(
    session.id,
    'infra.decommissioning',
    infraId,
    `Decommission initiated by ${session.email}`,
  )

  return ok({ pipelineIds })
}
