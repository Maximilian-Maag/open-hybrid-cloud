import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT, DELETE } from './route'
import { createUser, createCategory, makeAuthHeader } from '@/test/helpers'

const makeReq = (url: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/categories/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/categories/1'), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role', async () => {
    const admin = await createUser({ role: 'admin' })
    const cat = await createCategory()
    const auth = await makeAuthHeader(admin)
    const res = await GET(
      makeReq(`http://localhost/api/admin/categories/${cat.id}`, 'GET', undefined, auth),
      { params: Promise.resolve({ id: String(cat.id) }) },
    )
    expect(res.status).toBe(403)
  })

  it('returns 404 for non-existent category', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await GET(
      makeReq('http://localhost/api/admin/categories/999999', 'GET', undefined, auth),
      { params: Promise.resolve({ id: '999999' }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns category for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory('Test Cat')
    const auth = await makeAuthHeader(root)
    const res = await GET(
      makeReq(`http://localhost/api/admin/categories/${cat.id}`, 'GET', undefined, auth),
      { params: Promise.resolve({ id: String(cat.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Test Cat')
  })
})

describe('PUT /api/admin/categories/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(
      makeReq('http://localhost/api/admin/categories/1', 'PUT', { name: 'Updated' }),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role', async () => {
    const admin = await createUser({ role: 'admin' })
    const cat = await createCategory()
    const auth = await makeAuthHeader(admin)
    const res = await PUT(
      makeReq(`http://localhost/api/admin/categories/${cat.id}`, 'PUT', { name: 'Updated' }, auth),
      { params: Promise.resolve({ id: String(cat.id) }) },
    )
    expect(res.status).toBe(403)
  })

  it('updates category name for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory('Original')
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq(
        `http://localhost/api/admin/categories/${cat.id}`,
        'PUT',
        { name: 'Renamed' },
        auth,
      ),
      { params: Promise.resolve({ id: String(cat.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Renamed')
  })

  it('returns 404 for non-existent category', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq('http://localhost/api/admin/categories/999999', 'PUT', { name: 'X' }, auth),
      { params: Promise.resolve({ id: '999999' }) },
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/admin/categories/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await DELETE(makeReq('http://localhost/api/admin/categories/1', 'DELETE'), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role', async () => {
    const admin = await createUser({ role: 'admin' })
    const cat = await createCategory()
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(
      makeReq(`http://localhost/api/admin/categories/${cat.id}`, 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: String(cat.id) }) },
    )
    expect(res.status).toBe(403)
  })

  it('deletes category for root', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const auth = await makeAuthHeader(root)
    const res = await DELETE(
      makeReq(`http://localhost/api/admin/categories/${cat.id}`, 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: String(cat.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 404 for non-existent category', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await DELETE(
      makeReq('http://localhost/api/admin/categories/999999', 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: '999999' }) },
    )
    expect(res.status).toBe(404)
  })
})
