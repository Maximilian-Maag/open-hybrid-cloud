import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
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

  await handlePipelineEvent(event)

  return NextResponse.json({ received: true })
}
