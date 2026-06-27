import { type NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import {
  infrastructureElements,
  deploymentEnvironments,
  projects,
} from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const isAdmin = session.role === 'admin' || session.role === 'root'
  const { searchParams } = new URL(req.url)
  const filterProductId = searchParams.get('productId')
  const filterProjectId = searchParams.get('projectId')

  const conditions: ReturnType<typeof sql>[] = []
  if (!isAdmin) conditions.push(sql`${projects.ownerId} = ${session.id}`)
  if (filterProductId) conditions.push(sql`${infrastructureElements.productId} = ${Number(filterProductId)}`)
  if (filterProjectId) conditions.push(sql`${infrastructureElements.projectId} = ${Number(filterProjectId)}`)

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

  return NextResponse.json(rows)
}
