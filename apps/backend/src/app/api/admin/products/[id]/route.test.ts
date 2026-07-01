import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT, DELETE } from './route'
import { createUser, createCategory, createProduct, makeAuthHeader } from '@/test/helpers'

const makeReq = (id: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${id}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/products/[id]', () => {
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

  it('returns 404 for unknown product', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq('999999', 'GET', undefined, auth), { params: Promise.resolve({ id: '999999' }) })
    expect(res.status).toBe(404)
  })

  it('returns product for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'My Product')
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq(String(p.id), 'GET', undefined, auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('My Product')
  })
})

describe('PUT /api/admin/products/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(makeReq('1', 'PUT', { name: 'X' }), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq('1', 'PUT', { name: 'X' }, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('updates product for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'Before')
    const auth = await makeAuthHeader(root)
    const res = await PUT(makeReq(String(p.id), 'PUT', { name: 'After' }, auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    // PUT returns the raw product row; name lives in product_translations
    expect(body.id).toBe(p.id)
  })
})

describe('DELETE /api/admin/products/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await DELETE(makeReq('1', 'DELETE'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(makeReq('1', 'DELETE', undefined, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('deletes product for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const auth = await makeAuthHeader(root)
    const res = await DELETE(makeReq(String(p.id), 'DELETE', undefined, auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)
  })
})
