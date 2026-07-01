import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from './route'
import { createUser, createCategory, createProduct, makeAuthHeader } from '@/test/helpers'

const makeReq = (productId: string, auth?: string) => {
  const form = new FormData()
  form.append('image', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'image.png')
  return new NextRequest(`http://localhost/api/admin/products/${productId}/image`, {
    method: 'PUT',
    body: form,
    headers: auth ? { authorization: auth } : {},
  })
}

describe('PUT /api/admin/products/[id]/image', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(makeReq('1'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq('1', auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('uploads image for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const auth = await makeAuthHeader(root)
    const res = await PUT(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)
  })
})
