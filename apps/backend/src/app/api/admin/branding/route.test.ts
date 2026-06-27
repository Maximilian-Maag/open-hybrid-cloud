import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest('http://localhost/api/admin/branding', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

const validPayload = { shopName: 'Test Shop', primaryColor: '#ff0000' }

describe('GET /api/admin/branding', () => {
  it('returns 200 without auth (public endpoint)', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
  })
})

describe('PUT /api/admin/branding', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(makeReq('PUT', validPayload))
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq('PUT', validPayload, auth))
    expect(res.status).toBe(403)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await PUT(makeReq('PUT', validPayload, auth))
    expect(res.status).toBe(403)
  })

  it('updates branding for root', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await PUT(makeReq('PUT', validPayload, auth))
    expect(res.status).toBe(200)
  })

  it('returns 400 for invalid payload', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await PUT(makeReq('PUT', { primaryColor: 123 }, auth))
    expect(res.status).toBe(400)
  })
})
