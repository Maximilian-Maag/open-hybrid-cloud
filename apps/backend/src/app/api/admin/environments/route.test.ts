import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, createCiSource, makeAuthHeader } from '@/test/helpers'

const makeReq = (url: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/environments', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/environments'))
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq('http://localhost/api/admin/environments', 'GET', undefined, auth))
    expect(res.status).toBe(403)
  })

  it('returns environments list for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/admin/environments', 'GET', undefined, auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('root can also list environments', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq('http://localhost/api/admin/environments', 'GET', undefined, auth))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/admin/environments', () => {
  it('returns 401 without auth token', async () => {
    const res = await POST(
      makeReq('http://localhost/api/admin/environments', 'POST', {
        name: 'Env',
        ciSourceId: 1,
        webhookUrl: 'https://example.com',
        webhookToken: 'token',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const ci = await createCiSource()
    const auth = await makeAuthHeader(pm)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/environments',
        'POST',
        {
          name: 'Env',
          ciSourceId: ci.id,
          webhookUrl: 'https://example.com/hook',
          webhookToken: 'token',
        },
        auth,
      ),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid webhookUrl', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/environments',
        'POST',
        {
          name: 'Env',
          ciSourceId: ci.id,
          webhookUrl: 'not-a-url',
          webhookToken: 'token',
        },
        auth,
      ),
    )
    expect(res.status).toBe(400)
  })

  it('creates environment for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/environments',
        'POST',
        {
          name: 'Production',
          ciSourceId: ci.id,
          webhookUrl: 'https://gitlab.example.com/trigger',
          webhookToken: 'my-secret-token',
        },
        auth,
      ),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('Production')
    expect(body.ciSourceId).toBe(ci.id)
    expect(body.id).toBeDefined()
  })
})
