import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT, DELETE } from './route'
import { createUser, createCategory, createProduct, createCiSource, createEnvironment, makeAuthHeader } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { productEnvironments } from '@/lib/db/schema'

const makeReq = (productId: string, envId: string, method: string, body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/environments/${envId}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('PUT /api/admin/products/[id]/environments/[envId]', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(makeReq('1', '1', 'PUT', { price: '10.00' }), { params: Promise.resolve({ id: '1', envId: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq('1', '1', 'PUT', { price: '10.00' }, auth), { params: Promise.resolve({ id: '1', envId: '1' }) })
    expect(res.status).toBe(403)
  })

  it('updates product environment for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await db.insert(productEnvironments).values({ productId: p.id, environmentId: env.id, price: '10.00' })
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq(String(p.id), String(env.id), 'PUT', { price: '99.00' }, auth),
      { params: Promise.resolve({ id: String(p.id), envId: String(env.id) }) },
    )
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/admin/products/[id]/environments/[envId]', () => {
  it('returns 401 without auth', async () => {
    const res = await DELETE(makeReq('1', '1', 'DELETE'), { params: Promise.resolve({ id: '1', envId: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(makeReq('1', '1', 'DELETE', undefined, auth), { params: Promise.resolve({ id: '1', envId: '1' }) })
    expect(res.status).toBe(403)
  })

  it('deletes product environment for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await db.insert(productEnvironments).values({ productId: p.id, environmentId: env.id, price: '0.00' })
    const auth = await makeAuthHeader(root)
    const res = await DELETE(
      makeReq(String(p.id), String(env.id), 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: String(p.id), envId: String(env.id) }) },
    )
    expect(res.status).toBe(200)
  })
})
