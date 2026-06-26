import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import {
  infrastructureElements,
  productWebhooks,
  deploymentEnvironments,
  ciSources,
  projects,
} from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { triggerPipeline } from '@/lib/ci'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const infraId = parseInt(id, 10)

  const infraRows = await db
    .select()
    .from(infrastructureElements)
    .where(eq(infrastructureElements.id, infraId))
    .limit(1)

  if (!infraRows.length) {
    return NextResponse.json({ error: 'Infrastructure element not found' }, { status: 404 })
  }

  const infra = infraRows[0]

  // project_manager can only decommission own project's infra
  if (session.role === 'project_manager') {
    const projectRows = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, infra.projectId))
      .limit(1)

    if (!projectRows.length || projectRows[0].ownerId !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (infra.status !== 'active') {
    return NextResponse.json({ error: 'Infrastructure element is not active' }, { status: 400 })
  }

  // Get CI source
  const envRows = await db
    .select({ ciSourceId: deploymentEnvironments.ciSourceId })
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, infra.environmentId))
    .limit(1)

  const ciSourceRows = envRows.length
    ? await db.select().from(ciSources).where(eq(ciSources.id, envRows[0].ciSourceId)).limit(1)
    : []

  // Load webhooks
  const webhooks = await db
    .select()
    .from(productWebhooks)
    .where(
      sql`${productWebhooks.productId} = ${infra.productId} AND ${productWebhooks.environmentId} = ${infra.environmentId}`,
    )
    .orderBy(productWebhooks.execOrder)

  const pipelineIds: string[] = []

  if (ciSourceRows[0]) {
    const ciSource = {
      url: ciSourceRows[0].url,
      accessToken: ciSourceRows[0].accessToken,
      provider: ciSourceRows[0].provider as 'gitlab' | 'github' | 'bitbucket',
    }

    const variables = {
      ...(infra.parameters as Record<string, string>),
      TF_ACTION: 'destroy',
      INFRA_ID: String(infra.id),
    }

    for (const wh of webhooks) {
      try {
        const pid = await triggerPipeline(ciSource, wh.webhookUrl, wh.webhookToken, variables)
        pipelineIds.push(pid)
      } catch (err) {
        console.error('[decommission] Pipeline trigger failed:', err)
      }
    }
  }

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

  return NextResponse.json({ success: true, pipelineIds })
}
