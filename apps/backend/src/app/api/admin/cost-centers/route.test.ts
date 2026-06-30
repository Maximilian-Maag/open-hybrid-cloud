import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (url: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/cost-centers', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/cost-centers'))
    expect(res.status).toBe(401)
  })

  it('returns cost-centers list for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq('http://localhost/api/admin/cost-centers', 'GET', undefined, auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('returns cost-centers list for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/admin/cost-centers', 'GET', undefined, auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /api/admin/cost-centers', () => {
  it('returns 401 without auth token', async () => {
    const res = await POST(
      makeReq('http://localhost/api/admin/cost-centers', 'POST', {
        code: 'CC001',
        name: 'Engineering',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/cost-centers',
        'POST',
        { code: 'CC001', name: 'Engineering' },
        auth,
      ),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 for missing code', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq('http://localhost/api/admin/cost-centers', 'POST', { name: 'Engineering' }, auth),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing name', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq('http://localhost/api/admin/cost-centers', 'POST', { code: 'CC001' }, auth),
    )
    expect(res.status).toBe(400)
  })

  it('creates cost center for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/cost-centers',
        'POST',
        { code: 'CC-ENG', name: 'Engineering', active: true },
        auth,
      ),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.code).toBe('CC-ENG')
    expect(body.name).toBe('Engineering')
    expect(body.active).toBe(true)
    expect(body.id).toBeDefined()
  })

  it('root user can also create cost centers', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/cost-centers',
        'POST',
        { code: 'CC-ROOT', name: 'Root Center' },
        auth,
      ),
    )
    expect(res.status).toBe(201)
  })
})
