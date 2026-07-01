import { type NextRequest, NextResponse } from 'next/server'
import { handlePipelineEvent } from '@/lib/webhook/handler'
import { db } from '@/lib/db/client'
import { deploymentEnvironments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { PipelineEvent } from '@open-hybrid-cloud/types'

interface GitLabPipelineBody {
  object_kind: string
  object_attributes: {
    id: number
    status: string
  }
}

const mapGitLabStatus = (
  status: string,
): PipelineEvent['status'] => {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
      return 'failed'
    case 'running':
      return 'running'
    case 'pending':
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
      return 'pending'
    case 'canceled':
    case 'skipped':
      return 'canceled'
    default:
      return 'pending'
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-gitlab-token')

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 401 })
  }

  const envRows = await db
    .select({ id: deploymentEnvironments.id })
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.webhookToken, token))
    .limit(1)

  if (!envRows.length) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as GitLabPipelineBody | null

  if (!body || body.object_kind !== 'pipeline' || !body.object_attributes) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const event: PipelineEvent = {
    provider: 'gitlab',
    pipelineId: String(body.object_attributes.id),
    status: mapGitLabStatus(body.object_attributes.status),
  }

  await handlePipelineEvent(event)

  return NextResponse.json({ received: true })
}
