import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from './route'
import { createUser, createCategory, createProduct, makeAuthHeader } from '@/test/helpers'

const makeReq = (productId: string, lang: string, body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/translations/${lang}`, {
    method: 'PUT',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('PUT /api/admin/products/[id]/translations/[lang]', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(makeReq('1', 'de', { name: 'Test', description: '' }), { params: Promise.resolve({ id: '1', lang: 'de' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq('1', 'de', { name: 'Test', description: '' }, auth), { params: Promise.resolve({ id: '1', lang: 'de' }) })
    expect(res.status).toBe(403)
  })

  it('upserts translation for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'My Product')
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq(String(p.id), 'de', { name: 'Mein Produkt', description: 'Beschreibung' }, auth),
      { params: Promise.resolve({ id: String(p.id), lang: 'de' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Mein Produkt')
  })
})
