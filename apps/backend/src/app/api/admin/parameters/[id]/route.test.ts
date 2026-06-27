import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT, DELETE } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { parameters } from '@/lib/db/schema'

const makeReq = (id: string, method: string, body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/parameters/${id}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

const seedParameter = async () => {
  const [p] = await db.insert(parameters).values({
    scope: 'global',
    scopeId: 0,
    name: 'test_param',
    type: 'string',
  }).returning()
  return p
}

describe('PUT /api/admin/parameters/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(makeReq('1', 'PUT', { name: 'x' }), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager (requires admin)', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await PUT(makeReq('1', 'PUT', { name: 'x' }, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('updates parameter for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const param = await seedParameter()
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq(String(param.id), 'PUT', { name: 'updated' }, auth), { params: Promise.resolve({ id: String(param.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('updated')
  })
})

describe('DELETE /api/admin/parameters/[id]', () => {
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

  it('deletes parameter for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const param = await seedParameter()
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(makeReq(String(param.id), 'DELETE', undefined, auth), { params: Promise.resolve({ id: String(param.id) }) })
    expect(res.status).toBe(200)
  })
})
