import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import {
  infrastructureElements,
  deploymentEnvironments,
  projects,
  productTranslations,
} from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const isAdmin = session.role === 'admin' || session.role === 'root'

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
    .where(
      isAdmin
        ? undefined
        : sql`${projects.ownerId} = ${session.id}`,
    )
    .orderBy(sql`${infrastructureElements.deployedAt} DESC`)

  return NextResponse.json(rows)
}
