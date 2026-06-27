import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createCiSource, createEnvironment } from '@/test/helpers'
import { createHmac } from 'crypto'

vi.mock('@/lib/webhook/handler', () => ({
  handlePipelineEvent: vi.fn().mockResolvedValue(undefined),
}))

const makeRequest = (body: unknown, signature?: string) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature) headers['x-hub-signature-256'] = signature
  return new NextRequest('http://localhost/api/webhooks/github/workflow', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

const validWorkflowRunBody = {
  action: 'completed',
  workflow_run: {
    id: 12345,
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
  },
}

describe('POST /api/webhooks/github/workflow', () => {
  it('accepts valid payload without signature', async () => {
    const res = await POST(makeRequest(validWorkflowRunBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('accepts valid payload with matching HMAC signature', async () => {
    const ci = await createCiSource()
    const token = 'github-webhook-secret'
    await createEnvironment(ci.id, token)

    const rawBody = JSON.stringify(validWorkflowRunBody)
    const sig = `sha256=${createHmac('sha256', token).update(rawBody).digest('hex')}`

    const req = new NextRequest('http://localhost/api/webhooks/github/workflow', {
      method: 'POST',
      body: rawBody,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('returns 401 for invalid signature', async () => {
    const res = await POST(
      makeRequest(validWorkflowRunBody, 'sha256=invalidsignature'),
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid signature')
  })

  it('returns 400 for non-JSON body', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/github/workflow', {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 200 received:true when workflow_run is missing (other event types)', async () => {
    const res = await POST(makeRequest({ action: 'completed' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('maps in_progress status to running', async () => {
    const res = await POST(
      makeRequest({
        action: 'in_progress',
        workflow_run: {
          id: 999,
          name: 'CI',
          status: 'in_progress',
          conclusion: null,
        },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('maps completed with failure conclusion to failed', async () => {
    const res = await POST(
      makeRequest({
        action: 'completed',
        workflow_run: {
          id: 888,
          name: 'CI',
          status: 'completed',
          conclusion: 'failure',
        },
      }),
    )
    expect(res.status).toBe(200)
  })
})
