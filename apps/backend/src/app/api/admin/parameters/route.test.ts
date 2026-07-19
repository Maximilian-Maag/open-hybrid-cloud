import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest('http://localhost/api/admin/parameters', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

const validPayload = { scope: 'global' as const, name: 'cpu_limit', type: 'string' as const }

describe('GET /api/admin/parameters', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager (requires admin)', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq('GET', undefined, auth))
    expect(res.status).toBe(403)
  })

  it('returns parameter list for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('GET', undefined, auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /api/admin/parameters', () => {
  it('returns 401 without auth', async () => {
    const res = await POST(makeReq('POST', validPayload))
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(makeReq('POST', validPayload, auth))
    expect(res.status).toBe(403)
  })

  it('creates parameter for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(makeReq('POST', validPayload, auth))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('cpu_limit')
  })

  it('stores label field when provided', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(makeReq('POST', { scope: 'global' as const, name: 'hostname', label: 'Hostname', type: 'string' as const }, auth))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.label).toBe('Hostname')
  })

  it('returns 400 for invalid scope', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(makeReq('POST', { ...validPayload, scope: 'invalid' }, auth))
    expect(res.status).toBe(400)
  })
})
