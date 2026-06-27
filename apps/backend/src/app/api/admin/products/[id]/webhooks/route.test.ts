import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, createCategory, createProduct, createCiSource, createEnvironment, makeAuthHeader } from '@/test/helpers'

const makeReq = (productId: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/webhooks`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/products/[id]/webhooks', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq('1'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('1', 'GET', undefined, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns webhooks for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq(String(p.id), 'GET', undefined, auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /api/admin/products/[id]/webhooks', () => {
  it('returns 401 without auth', async () => {
    const res = await POST(makeReq('1', 'POST', { environmentId: 1, name: 'wh', webhookUrl: 'http://x', webhookToken: 't' }), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(makeReq('1', 'POST', { environmentId: 1, name: 'wh', webhookUrl: 'http://x', webhookToken: 't' }, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('creates webhook for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(root)
    const res = await POST(
      makeReq(String(p.id), 'POST', { environmentId: env.id, name: 'Deploy Hook', webhookUrl: 'https://hook.example.com', webhookToken: 'secret' }, auth),
      { params: Promise.resolve({ id: String(p.id) }) },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('Deploy Hook')
  })
})
