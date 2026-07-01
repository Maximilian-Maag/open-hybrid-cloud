import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createCiSource, createEnvironment } from '@/test/helpers'

vi.mock('@/lib/webhook/handler', () => ({
  handlePipelineEvent: vi.fn().mockResolvedValue(undefined),
}))

const VALID_TOKEN = 'gitlab-valid-token'

const validPayload = {
  object_kind: 'pipeline',
  object_attributes: { id: 123, status: 'success' },
}

const makeRequest = (body: unknown, token?: string) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers['x-gitlab-token'] = token
  return new NextRequest('http://localhost/api/webhooks/gitlab/pipeline', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

// runs AFTER global beforeEach (which truncates tables), so token is always fresh
beforeEach(async () => {
  const ci = await createCiSource()
  await createEnvironment(ci.id, VALID_TOKEN)
})

describe('POST /api/webhooks/gitlab/pipeline', () => {
  it('returns 401 when no token header is present', async () => {
    const res = await POST(makeRequest(validPayload))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Missing token')
  })

  it('accepts a valid payload with a matching token', async () => {
    const res = await POST(makeRequest(validPayload, VALID_TOKEN))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('returns 401 for an unknown token', async () => {
    const res = await POST(makeRequest(validPayload, 'invalid-token'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid token')
  })

  it('returns 400 for wrong object_kind', async () => {
    const res = await POST(makeRequest({ object_kind: 'push', object_attributes: { id: 1 } }, VALID_TOKEN))
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing object_attributes', async () => {
    const res = await POST(makeRequest({ object_kind: 'pipeline' }, VALID_TOKEN))
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-JSON body', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/gitlab/pipeline', {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json', 'x-gitlab-token': VALID_TOKEN },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('maps gitlab running status and returns 200', async () => {
    const res = await POST(
      makeRequest({ object_kind: 'pipeline', object_attributes: { id: 99, status: 'running' } }, VALID_TOKEN),
    )
    expect(res.status).toBe(200)
  })

  it('maps canceled status correctly', async () => {
    const res = await POST(
      makeRequest({ object_kind: 'pipeline', object_attributes: { id: 100, status: 'canceled' } }, VALID_TOKEN),
    )
    expect(res.status).toBe(200)
  })

  it('maps failed status correctly', async () => {
    const res = await POST(
      makeRequest({ object_kind: 'pipeline', object_attributes: { id: 101, status: 'failed' } }, VALID_TOKEN),
    )
    expect(res.status).toBe(200)
  })
})
