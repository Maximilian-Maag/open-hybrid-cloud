import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { createUser, createCategory, createProduct, makeAuthHeader } from '@/test/helpers'

const makeReq = (productId: string, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/translations`, {
    headers: auth ? { authorization: auth } : {},
  })

describe('GET /api/admin/products/[id]/translations', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq('1'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('1', auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns translations for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'My Product')
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(1)
  })
})
