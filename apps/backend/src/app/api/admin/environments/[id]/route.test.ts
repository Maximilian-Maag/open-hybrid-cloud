import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT, DELETE } from './route'
import { createUser, createCiSource, createEnvironment, makeAuthHeader } from '@/test/helpers'

const makeReq = (id: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/environments/${id}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/environments/[id]', () => {
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

  it('returns environment for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq(String(env.id), 'GET', undefined, auth), { params: Promise.resolve({ id: String(env.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(env.id)
  })
})

describe('PUT /api/admin/environments/[id]', () => {
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

  it('updates environment for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq(String(env.id), 'PUT', { name: 'Updated Env' }, auth), { params: Promise.resolve({ id: String(env.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Updated Env')
  })
})

describe('DELETE /api/admin/environments/[id]', () => {
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

  it('deletes environment for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(makeReq(String(env.id), 'DELETE', undefined, auth), { params: Promise.resolve({ id: String(env.id) }) })
    expect(res.status).toBe(200)
  })
})
