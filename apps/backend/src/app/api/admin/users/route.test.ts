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

const validUserPayload = {
  email: 'newuser@test.dev',
  name: 'New User',
  role: 'project_manager' as const,
  password: 'password123',
  active: true,
}

describe('GET /api/admin/users', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/users'))
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/admin/users', 'GET', undefined, auth))
    expect(res.status).toBe(403)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq('http://localhost/api/admin/users', 'GET', undefined, auth))
    expect(res.status).toBe(403)
  })

  it('returns users list for root', async () => {
    const root = await createUser({ role: 'root' })
    await createUser({ role: 'project_manager' })

    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq('http://localhost/api/admin/users', 'GET', undefined, auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBeGreaterThanOrEqual(2)
  })

  it('does not expose password hashes in response', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq('http://localhost/api/admin/users', 'GET', undefined, auth))
    const text = await res.text()
    expect(text).not.toContain('$2')
    expect(text).not.toContain('passwordHash')
  })
})

describe('POST /api/admin/users', () => {
  it('returns 401 without auth token', async () => {
    const res = await POST(makeReq('http://localhost/api/admin/users', 'POST', validUserPayload))
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq('http://localhost/api/admin/users', 'POST', validUserPayload, auth),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid email', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/users',
        'POST',
        { ...validUserPayload, email: 'not-an-email' },
        auth,
      ),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for short password', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/users',
        'POST',
        { ...validUserPayload, email: 'unique2@test.dev', password: 'short' },
        auth,
      ),
    )
    expect(res.status).toBe(400)
  })

  it('creates user for root', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(
      makeReq('http://localhost/api/admin/users', 'POST', validUserPayload, auth),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.email).toBe('newuser@test.dev')
    expect(body.role).toBe('project_manager')
    expect(body).not.toHaveProperty('passwordHash')
  })
})
