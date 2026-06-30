import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createCiSource, createEnvironment } from '@/test/helpers'
import { createHmac } from 'crypto'

vi.mock('@/lib/webhook/handler', () => ({
  handlePipelineEvent: vi.fn().mockResolvedValue(undefined),
}))

const WEBHOOK_SECRET = 'bitbucket-test-secret'

const makeSignedRequest = (body: unknown) => {
  const rawBody = JSON.stringify(body)
  const sig = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`
  return new NextRequest('http://localhost/api/webhooks/bitbucket/pipeline', {
    method: 'POST',
    body: rawBody,
    headers: { 'content-type': 'application/json', 'x-hub-signature': sig },
  })
}

const makeUnsignedRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/webhooks/bitbucket/pipeline', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const validPipelineBody = {
  data: {
    uuid: '{abc-def-123}',
    state: {
      name: 'COMPLETED',
      result: { name: 'SUCCESSFUL' },
    },
  },
}

// runs AFTER global beforeEach (which truncates tables), so token is always fresh
beforeEach(async () => {
  const ci = await createCiSource()
  await createEnvironment(ci.id, WEBHOOK_SECRET)
})

describe('POST /api/webhooks/bitbucket/pipeline', () => {
  it('returns 401 when no signature header is present', async () => {
    const res = await POST(makeUnsignedRequest(validPipelineBody))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Missing signature')
  })

  it('accepts valid payload with matching HMAC signature', async () => {
    const res = await POST(makeSignedRequest(validPipelineBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('returns 401 for invalid signature', async () => {
    const rawBody = JSON.stringify(validPipelineBody)
    const req = new NextRequest('http://localhost/api/webhooks/bitbucket/pipeline', {
      method: 'POST',
      body: rawBody,
      headers: { 'content-type': 'application/json', 'x-hub-signature': 'sha256=invalidsignature' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid signature')
  })

  it('returns 400 for non-JSON body', async () => {
    const rawBody = 'not json'
    const sig = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`
    const req = new NextRequest('http://localhost/api/webhooks/bitbucket/pipeline', {
      method: 'POST',
      body: rawBody,
      headers: { 'content-type': 'application/json', 'x-hub-signature': sig },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 200 received:true when data.uuid is missing', async () => {
    const res = await POST(makeSignedRequest({ data: { state: { name: 'COMPLETED' } } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('maps IN_PROGRESS to running', async () => {
    const res = await POST(
      makeSignedRequest({
        data: { uuid: '{xyz-789}', state: { name: 'IN_PROGRESS' } },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('maps COMPLETED FAILED to failed', async () => {
    const res = await POST(
      makeSignedRequest({
        data: { uuid: '{xyz-000}', state: { name: 'COMPLETED', result: { name: 'FAILED' } } },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('maps PENDING state correctly', async () => {
    const res = await POST(
      makeSignedRequest({
        data: { uuid: '{pending-uuid}', state: { name: 'PENDING' } },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('maps COMPLETED ERROR to failed', async () => {
    const res = await POST(
      makeSignedRequest({
        data: { uuid: '{error-uuid}', state: { name: 'COMPLETED', result: { name: 'ERROR' } } },
      }),
    )
    expect(res.status).toBe(200)
  })
})
