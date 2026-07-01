import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT, DELETE } from './route'
import { createUser, createCiSource, makeAuthHeader } from '@/test/helpers'

const makeReq = (id: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/ci-sources/${id}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/ci-sources/[id]', () => {
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

  it('returns 404 for non-existent source', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq('999999', 'GET', undefined, auth), { params: Promise.resolve({ id: '999999' }) })
    expect(res.status).toBe(404)
  })

  it('returns CI source for root', async () => {
    const root = await createUser({ role: 'root' })
    const src = await createCiSource()
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq(String(src.id), 'GET', undefined, auth), { params: Promise.resolve({ id: String(src.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(src.id)
  })
})

describe('PUT /api/admin/ci-sources/[id]', () => {
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

  it('updates CI source for root', async () => {
    const root = await createUser({ role: 'root' })
    const src = await createCiSource()
    const auth = await makeAuthHeader(root)
    const res = await PUT(makeReq(String(src.id), 'PUT', { name: 'Updated' }, auth), { params: Promise.resolve({ id: String(src.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Updated')
  })
})

describe('DELETE /api/admin/ci-sources/[id]', () => {
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

  it('deletes CI source for root', async () => {
    const root = await createUser({ role: 'root' })
    const src = await createCiSource()
    const auth = await makeAuthHeader(root)
    const res = await DELETE(makeReq(String(src.id), 'DELETE', undefined, auth), { params: Promise.resolve({ id: String(src.id) }) })
    expect(res.status).toBe(200)
  })
})
