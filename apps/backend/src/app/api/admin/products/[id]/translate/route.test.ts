import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai', () => ({
  translateProduct: vi.fn().mockResolvedValue({}),
}))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { createUser, createCategory, createProduct, makeAuthHeader } from '@/test/helpers'

const makeReq = (productId: string, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/translate`, {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  })

describe('POST /api/admin/products/[id]/translate', () => {
  it('returns 401 without auth', async () => {
    const res = await POST(makeReq('1'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(makeReq('1', auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 for unknown product', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(makeReq('999999', auth), { params: Promise.resolve({ id: '999999' }) })
    expect(res.status).toBe(404)
  })

  it('triggers translation for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'Hello')
    const auth = await makeAuthHeader(root)
    const res = await POST(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)
  })
})
