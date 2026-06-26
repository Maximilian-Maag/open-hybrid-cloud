import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { handlePipelineEvent } from '@/lib/webhook/handler'
import { db } from '@/lib/db/client'
import { deploymentEnvironments } from '@/lib/db/schema'
import type { PipelineEvent } from '@open-hybrid-cloud/types'

interface GitHubWorkflowRunBody {
  action: string
  workflow_run: {
    id: number
    name: string
    status: string
    conclusion: string | null
  }
}

const mapGitHubStatus = (
  status: string,
  conclusion: string | null,
): PipelineEvent['status'] => {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return 'success'
      case 'failure':
      case 'timed_out':
        return 'failed'
      case 'cancelled':
        return 'canceled'
      default:
        return 'failed'
    }
  }
  if (status === 'in_progress') return 'running'
  return 'pending'
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-hub-signature-256')
  const rawBody = await req.text()

  // Verify HMAC signature against known webhook tokens
  if (signature) {
    const envRows = await db
      .select({ webhookToken: deploymentEnvironments.webhookToken })
      .from(deploymentEnvironments)

    const isValid = envRows.some((env) => {
      const expected = `sha256=${createHmac('sha256', env.webhookToken).update(rawBody).digest('hex')}`
      return expected === signature
    })

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let body: GitHubWorkflowRunBody
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.workflow_run) {
    return NextResponse.json({ received: true })
  }

  const event: PipelineEvent = {
    provider: 'github',
    pipelineId: String(body.workflow_run.id),
    status: mapGitHubStatus(body.workflow_run.status, body.workflow_run.conclusion),
  }

  await handlePipelineEvent(event)

  return NextResponse.json({ received: true })
}
