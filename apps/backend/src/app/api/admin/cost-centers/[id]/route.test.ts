import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT, DELETE } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { costCenters } from '@/lib/db/schema'

const makeReq = (id: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/cost-centers/${id}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

const seedCostCenter = async () => {
  const [cc] = await db.insert(costCenters).values({ code: `CC-${Math.random().toString(36).slice(2)}`, name: 'Test CC' }).returning()
  return cc
}

describe('GET /api/admin/cost-centers/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq('1'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager (requires admin)', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq('1', 'GET', undefined, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 for unknown id', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('999999', 'GET', undefined, auth), { params: Promise.resolve({ id: '999999' }) })
    expect(res.status).toBe(404)
  })

  it('returns cost center for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const cc = await seedCostCenter()
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq(String(cc.id), 'GET', undefined, auth), { params: Promise.resolve({ id: String(cc.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(cc.id)
  })
})

describe('PUT /api/admin/cost-centers/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(makeReq('1', 'PUT', { name: 'X' }), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await PUT(makeReq('1', 'PUT', { name: 'X' }, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('updates cost center for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const cc = await seedCostCenter()
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq(String(cc.id), 'PUT', { name: 'Updated' }, auth), { params: Promise.resolve({ id: String(cc.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Updated')
  })
})

describe('DELETE /api/admin/cost-centers/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await DELETE(makeReq('1', 'DELETE'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await DELETE(makeReq('1', 'DELETE', undefined, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('deletes cost center for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const cc = await seedCostCenter()
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(makeReq(String(cc.id), 'DELETE', undefined, auth), { params: Promise.resolve({ id: String(cc.id) }) })
    expect(res.status).toBe(200)
  })
})
