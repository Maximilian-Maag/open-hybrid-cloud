import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createCiSource, createEnvironment } from '@/test/helpers'
import { createHmac } from 'crypto'

vi.mock('@/lib/webhook/handler', () => ({
  handlePipelineEvent: vi.fn().mockResolvedValue(undefined),
}))

const WEBHOOK_SECRET = 'github-test-secret'

const makeSignedRequest = (body: unknown) => {
  const rawBody = JSON.stringify(body)
  const sig = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`
  return new NextRequest('http://localhost/api/webhooks/github/workflow', {
    method: 'POST',
    body: rawBody,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
  })
}

const makeUnsignedRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/webhooks/github/workflow', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const validWorkflowRunBody = {
  action: 'completed',
  workflow_run: {
    id: 12345,
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
  },
}

// runs AFTER global beforeEach (which truncates tables), so token is always fresh
beforeEach(async () => {
  const ci = await createCiSource()
  await createEnvironment(ci.id, WEBHOOK_SECRET)
})

describe('POST /api/webhooks/github/workflow', () => {
  it('returns 401 when no signature header is present', async () => {
    const res = await POST(makeUnsignedRequest(validWorkflowRunBody))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Missing signature')
  })

  it('accepts valid payload with matching HMAC signature', async () => {
    const res = await POST(makeSignedRequest(validWorkflowRunBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('returns 401 for invalid signature', async () => {
    const rawBody = JSON.stringify(validWorkflowRunBody)
    const req = new NextRequest('http://localhost/api/webhooks/github/workflow', {
      method: 'POST',
      body: rawBody,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=invalidsignature' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid signature')
  })

  it('returns 400 for non-JSON body', async () => {
    const rawBody = 'not json'
    const sig = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`
    const req = new NextRequest('http://localhost/api/webhooks/github/workflow', {
      method: 'POST',
      body: rawBody,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 200 received:true when workflow_run is missing (other event types)', async () => {
    const res = await POST(makeSignedRequest({ action: 'completed' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('maps in_progress status to running', async () => {
    const res = await POST(
      makeSignedRequest({
        action: 'in_progress',
        workflow_run: { id: 999, name: 'CI', status: 'in_progress', conclusion: null },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('maps completed with failure conclusion to failed', async () => {
    const res = await POST(
      makeSignedRequest({
        action: 'completed',
        workflow_run: { id: 888, name: 'CI', status: 'completed', conclusion: 'failure' },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('maps completed with cancelled conclusion to canceled', async () => {
    const res = await POST(
      makeSignedRequest({
        action: 'completed',
        workflow_run: { id: 777, name: 'CI', status: 'completed', conclusion: 'cancelled' },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('maps completed with timed_out conclusion to failed', async () => {
    const res = await POST(
      makeSignedRequest({
        action: 'completed',
        workflow_run: { id: 666, name: 'CI', status: 'completed', conclusion: 'timed_out' },
      }),
    )
    expect(res.status).toBe(200)
  })
})
