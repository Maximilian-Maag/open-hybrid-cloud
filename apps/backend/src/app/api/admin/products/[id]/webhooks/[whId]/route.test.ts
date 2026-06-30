import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT, DELETE } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { productWebhooks } from '@/lib/db/schema'

const makeReq = (productId: string, whId: string, method: string, body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/webhooks/${whId}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

const seedWebhook = async () => {
  const cat = await import('@/test/helpers').then(m => m.createCategory())
  const p = await import('@/test/helpers').then(m => m.createProduct(cat.id))
  const ci = await import('@/test/helpers').then(m => m.createCiSource())
  const env = await import('@/test/helpers').then(m => m.createEnvironment(ci.id))
  const [wh] = await db.insert(productWebhooks).values({
    productId: p.id,
    environmentId: env.id,
    name: 'Test Hook',
    webhookUrl: 'https://hook.example.com',
    webhookToken: 'secret',
  }).returning()
  return { p, wh }
}

describe('PUT /api/admin/products/[id]/webhooks/[whId]', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(makeReq('1', '1', 'PUT', { name: 'x' }), { params: Promise.resolve({ id: '1', whId: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq('1', '1', 'PUT', { name: 'x' }, auth), { params: Promise.resolve({ id: '1', whId: '1' }) })
    expect(res.status).toBe(403)
  })

  it('updates webhook for root', async () => {
    const root = await createUser({ role: 'root' })
    const { p, wh } = await seedWebhook()
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq(String(p.id), String(wh.id), 'PUT', { name: 'Updated Hook' }, auth),
      { params: Promise.resolve({ id: String(p.id), whId: String(wh.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Updated Hook')
  })
})

describe('DELETE /api/admin/products/[id]/webhooks/[whId]', () => {
  it('returns 401 without auth', async () => {
    const res = await DELETE(makeReq('1', '1', 'DELETE'), { params: Promise.resolve({ id: '1', whId: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(makeReq('1', '1', 'DELETE', undefined, auth), { params: Promise.resolve({ id: '1', whId: '1' }) })
    expect(res.status).toBe(403)
  })

  it('deletes webhook for root', async () => {
    const root = await createUser({ role: 'root' })
    const { p, wh } = await seedWebhook()
    const auth = await makeAuthHeader(root)
    const res = await DELETE(
      makeReq(String(p.id), String(wh.id), 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: String(p.id), whId: String(wh.id) }) },
    )
    expect(res.status).toBe(200)
  })
})
