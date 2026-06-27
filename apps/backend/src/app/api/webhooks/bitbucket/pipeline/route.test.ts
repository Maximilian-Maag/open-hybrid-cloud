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
  if (signature) headers['x-hub-signature'] = signature
  return new NextRequest('http://localhost/api/webhooks/bitbucket/pipeline', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

const validPipelineBody = {
  data: {
    uuid: '{abc-def-123}',
    state: {
      name: 'COMPLETED',
      result: { name: 'SUCCESSFUL' },
    },
  },
}

describe('POST /api/webhooks/bitbucket/pipeline', () => {
  it('accepts valid payload without signature', async () => {
    const res = await POST(makeRequest(validPipelineBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('accepts valid payload with matching HMAC signature', async () => {
    const ci = await createCiSource()
    const token = 'bitbucket-webhook-secret'
    await createEnvironment(ci.id, token)

    const rawBody = JSON.stringify(validPipelineBody)
    const sig = `sha256=${createHmac('sha256', token).update(rawBody).digest('hex')}`

    const req = new NextRequest('http://localhost/api/webhooks/bitbucket/pipeline', {
      method: 'POST',
      body: rawBody,
      headers: { 'content-type': 'application/json', 'x-hub-signature': sig },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('returns 401 for invalid signature', async () => {
    const res = await POST(makeRequest(validPipelineBody, 'sha256=invalidsignature'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid signature')
  })

  it('returns 400 for non-JSON body', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/bitbucket/pipeline', {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 200 received:true when data.uuid is missing', async () => {
    const res = await POST(makeRequest({ data: { state: { name: 'COMPLETED' } } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('maps IN_PROGRESS to running', async () => {
    const res = await POST(
      makeRequest({
        data: {
          uuid: '{xyz-789}',
          state: { name: 'IN_PROGRESS' },
        },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('maps COMPLETED FAILED to failed', async () => {
    const res = await POST(
      makeRequest({
        data: {
          uuid: '{xyz-000}',
          state: {
            name: 'COMPLETED',
            result: { name: 'FAILED' },
          },
        },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('maps PENDING state correctly', async () => {
    const res = await POST(
      makeRequest({
        data: {
          uuid: '{pending-uuid}',
          state: { name: 'PENDING' },
        },
      }),
    )
    expect(res.status).toBe(200)
  })
})
