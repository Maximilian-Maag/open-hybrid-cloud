import { type NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { handlePipelineEvent } from '@/lib/webhook/handler'
import { db } from '@/lib/db/client'
import { deploymentEnvironments } from '@/lib/db/schema'
import type { PipelineEvent } from '@open-hybrid-cloud/types'

interface BitbucketPipelineBody {
  data: {
    uuid: string
    state: {
      name: string
      result?: { name: string }
    }
  }
}

const mapBitbucketStatus = (
  stateName: string,
  resultName?: string,
): PipelineEvent['status'] => {
  switch (stateName) {
    case 'COMPLETED':
      if (resultName === 'SUCCESSFUL') return 'success'
      if (resultName === 'FAILED' || resultName === 'ERROR') return 'failed'
      return 'canceled'
    case 'IN_PROGRESS':
      return 'running'
    case 'PENDING':
      return 'pending'
    default:
      return 'pending'
  }
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-hub-signature')
  const rawBody = await req.text()

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  // Validate against the inbound callback_secret, not the outbound
  // webhook_token used to trigger pipelines (migration 0004 split the two).
  // Legacy environments have callback_secret backfilled to webhook_token.
  // Identify WHICH environment the signature belongs to so the event is scoped
  // to that environment — one env's secret must not transition another's orders.
  const envRows = await db
    .select({ id: deploymentEnvironments.id, callbackSecret: deploymentEnvironments.callbackSecret })
    .from(deploymentEnvironments)

  const matchedEnv = envRows.find((env) => {
    const expected = `sha256=${createHmac('sha256', env.callbackSecret).update(rawBody).digest('hex')}`
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    } catch {
      return false
    }
  })

  if (!matchedEnv) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: BitbucketPipelineBody
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.data?.uuid) {
    return NextResponse.json({ received: true })
  }

  const event: PipelineEvent = {
    provider: 'bitbucket',
    pipelineId: body.data.uuid,
    status: mapBitbucketStatus(
      body.data.state?.name ?? '',
      body.data.state?.result?.name,
    ),
  }

  await handlePipelineEvent(event, matchedEnv.id)

  return NextResponse.json({ received: true })
}
